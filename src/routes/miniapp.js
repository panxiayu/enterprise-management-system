const express = require('express');
const https = require('https');
const Joi = require('joi');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const {
  buildHybridPath,
  buildMiniAppPagePath,
  getBinding,
  getMiniAppConfig,
  getRecipientFromUser,
  getTemplateRegistry,
  listPushQueue,
  listSubscriptions,
  saveSubscriptions,
  updateQueueStatus,
  upsertBinding
} = require('../services/miniapp-service');

const router = express.Router();

const bindSchema = Joi.object({
  app_id: Joi.string().allow('').optional(),
  openid: Joi.string().trim().required().messages({
    'string.empty': 'openid 不能为空',
    'any.required': '缺少 openid'
  }),
  unionid: Joi.string().allow('').optional(),
  nickname: Joi.string().allow('').optional(),
  avatar_url: Joi.string().allow('').optional()
});

const subscriptionsSchema = Joi.object({
  app_id: Joi.string().allow('').optional(),
  items: Joi.array().items(
    Joi.object({
      template_key: Joi.string().trim().required(),
      template_id: Joi.string().allow('').optional(),
      page_path: Joi.string().allow('').optional(),
      scene: Joi.string().allow('').optional(),
      subscribed: Joi.alternatives().try(Joi.boolean(), Joi.number().integer().valid(0, 1)).optional()
    })
  ).min(1).required()
});

const code2SessionSchema = Joi.object({
  code: Joi.string().trim().required().messages({
    'string.empty': 'code 不能为空',
    'any.required': '缺少 code'
  }),
  app_id: Joi.string().allow('').optional()
});

function requestWeChatCode2Session({ appId, code }) {
  const secret = String(process.env.WECHAT_MINIAPP_APP_SECRET || '').trim();
  if (!appId) throw new Error('未配置小程序 AppID');
  if (!secret) throw new Error('未配置 WECHAT_MINIAPP_APP_SECRET');

  const path =
    '/sns/jscode2session?appid=' +
    encodeURIComponent(appId) +
    '&secret=' +
    encodeURIComponent(secret) +
    '&js_code=' +
    encodeURIComponent(code) +
    '&grant_type=authorization_code';

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.weixin.qq.com',
        path,
        method: 'GET'
      },
      (resp) => {
        const chunks = [];
        resp.on('data', (chunk) => chunks.push(chunk));
        resp.on('end', () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
            if (body.errcode) {
              reject(new Error(body.errmsg || `微信接口错误(${body.errcode})`));
              return;
            }
            resolve(body);
          } catch (err) {
            reject(new Error('微信返回解析失败'));
          }
        });
      }
    );
    req.on('error', (err) => reject(err));
    req.end();
  });
}

function currentRecipient(req, res) {
  const recipient = getRecipientFromUser(req.user);
  if (!recipient) {
    res.status(400).json({ code: -1, msg: '无法识别当前用户', data: null });
    return null;
  }
  return recipient;
}

router.get('/config', (req, res) => {
  const config = getMiniAppConfig(req);
  res.json({
    code: 0,
    msg: 'success',
    data: {
      ...config,
      recommended_paths: {
        employee_home: '/employee.html',
        six_s_tasks: '/mobile-6s-tasks.html',
        six_s_admin: '/mobile-6s-list.html',
        six_s_add: '/mobile-6s-add.html'
      }
    }
  });
});

router.post('/code2session', async (req, res) => {
  const { error, value } = code2SessionSchema.validate(req.body || {});
  if (error) {
    return res.status(400).json({ code: -1, msg: error.details[0].message, data: null });
  }

  try {
    const config = getMiniAppConfig(req);
    const result = await requestWeChatCode2Session({
      appId: String(value.app_id || config.app_id || '').trim(),
      code: value.code
    });
    return res.json({
      code: 0,
      msg: 'success',
      data: {
        openid: result.openid || '',
        unionid: result.unionid || '',
        session_key: result.session_key || ''
      }
    });
  } catch (err) {
    console.error('小程序 code2session 失败:', err);
    return res.status(500).json({ code: -1, msg: err.message || 'code2session 失败', data: null });
  }
});

router.get('/session', authMiddleware, (req, res) => {
  const recipient = currentRecipient(req, res);
  if (!recipient) return;
  const config = getMiniAppConfig(req);
  const binding = getBinding(recipient, config.app_id);
  const subscriptions = listSubscriptions(recipient, config.app_id);
  const homePath = req.user.type === 'employee' ? '/employee.html' : '/dashboard.html';

  res.json({
    code: 0,
    msg: 'success',
    data: {
      recipient,
      config,
      binding: binding || null,
      subscriptions,
      default_entry: {
        hybrid_path: homePath,
        miniapp_page: buildMiniAppPagePath({}, recipient, homePath)
      }
    }
  });
});

router.post('/bind', authMiddleware, (req, res) => {
  const recipient = currentRecipient(req, res);
  if (!recipient) return;

  const { error, value } = bindSchema.validate(req.body || {});
  if (error) {
    return res.status(400).json({ code: -1, msg: error.details[0].message, data: null });
  }

  try {
    const binding = upsertBinding(recipient, value);
    return res.json({ code: 0, msg: '绑定成功', data: binding });
  } catch (err) {
    console.error('小程序绑定失败:', err);
    return res.status(500).json({ code: -1, msg: err.message || '绑定失败', data: null });
  }
});

router.get('/subscriptions', authMiddleware, (req, res) => {
  const recipient = currentRecipient(req, res);
  if (!recipient) return;

  const config = getMiniAppConfig(req);
  const subscriptions = listSubscriptions(recipient, config.app_id);
  const registry = getTemplateRegistry().map((item) => {
    const saved = subscriptions.find((row) => row.template_key === item.template_key);
    const hybridPath = buildHybridPath(
      { module: item.module, category: item.categories[0] || '', source_id: 0 },
      recipient
    );
    return {
      ...item,
      subscribed: saved ? Number(saved.subscribed || 0) : 0,
      template_id: saved?.template_id || '',
      page_path: saved?.page_path || buildMiniAppPagePath({}, recipient, hybridPath),
      scene: saved?.scene || ''
    };
  });

  res.json({ code: 0, msg: 'success', data: registry });
});

router.post('/subscriptions', authMiddleware, (req, res) => {
  const recipient = currentRecipient(req, res);
  if (!recipient) return;

  const { error, value } = subscriptionsSchema.validate(req.body || {});
  if (error) {
    return res.status(400).json({ code: -1, msg: error.details[0].message, data: null });
  }

  try {
    const rows = saveSubscriptions(recipient, value.items, value.app_id);
    return res.json({ code: 0, msg: '订阅配置已保存', data: rows });
  } catch (err) {
    console.error('保存小程序订阅配置失败:', err);
    return res.status(500).json({ code: -1, msg: '保存失败', data: null });
  }
});

router.get('/push-queue', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const rows = listPushQueue({
      status: String(req.query.status || 'pending'),
      limit: Number(req.query.limit || 100)
    });
    res.json({ code: 0, msg: 'success', data: rows });
  } catch (err) {
    console.error('获取小程序推送队列失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

router.post('/push-queue/:id/status', authMiddleware, adminMiddleware, (req, res) => {
  const schema = Joi.object({
    status: Joi.string().valid('pending', 'sent', 'failed', 'skipped').required(),
    error_message: Joi.string().allow('').optional()
  });
  const { error, value } = schema.validate(req.body || {});
  if (error) {
    return res.status(400).json({ code: -1, msg: error.details[0].message, data: null });
  }

  try {
    updateQueueStatus(req.params.id, value.status, value.error_message || '');
    return res.json({ code: 0, msg: '状态已更新', data: null });
  } catch (err) {
    console.error('更新小程序推送队列状态失败:', err);
    return res.status(500).json({ code: -1, msg: err.message || '更新失败', data: null });
  }
});

module.exports = router;
