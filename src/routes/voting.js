// src/routes/voting.js - 投票系统
const express = require('express');
const router = express.Router();
const db = require('../models/database');
const Joi = require('joi');
const crypto = require('crypto');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

// 生成随机Token
function generateToken() {
  return crypto.randomBytes(16).toString('hex');
}

// 获取投票的匿名访问基础URL
const getAnonymousBaseUrl = (req) => {
  if (process.env.ANONYMOUS_VOTE_URL) {
    return process.env.ANONYMOUS_VOTE_URL;
  }
  // 根据请求头自动选择 http/https 和 Host
  const protocol = req && req.protocol === 'https' ? 'https' : 'http';
  const host = req && req.get('Host') ? req.get('Host') : '112.16.178.98:3000';
  return `${protocol}://${host}/mobile-voting.html`;
};

// 创建投票
// POST /api/voting/create
router.post('/create', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const schema = Joi.object({
      title: Joi.string().required(),
      description: Joi.string().allow('').optional(),
      options: Joi.array().items(Joi.string()).min(2).required(),
      startDate: Joi.date().required(),
      endDate: Joi.date().required(),
      multipleChoice: Joi.boolean().default(false),
      isAnonymous: Joi.boolean().default(false),
      voteLimit: Joi.string().valid('once', 'daily').default('once'),
      allowedStaffIds: Joi.array().items(Joi.number()).optional()
    });

    const { error, value } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({
        code: -1,
        msg: error.details[0].message,
        data: null
      });
    }

    const { title, description, options, startDate, endDate, multipleChoice, isAnonymous, voteLimit, allowedStaffIds } = value;

    // 将 Date 对象格式化为本地时间字符串（SQLite datetime 格式）
    const formatLocalDateTime = (d) => {
      if (!d) return null;
      const pad = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    };
    const startDateStr = startDate instanceof Date ? formatLocalDateTime(startDate) : startDate;
    const endDateStr = endDate instanceof Date ? formatLocalDateTime(endDate) : endDate;

    // 创建投票
    // 生成匿名投票Token
    const anonymousToken = generateToken();
    // 将 allowedStaffIds 数组转为逗号分隔字符串存储
    const allowedStaffIdsStr = allowedStaffIds && allowedStaffIds.length > 0 ? JSON.stringify(allowedStaffIds) : null;

    const stmt = db.prepare(`
      INSERT INTO votings (title, description, start_date, end_date, multiple_choice, is_anonymous, vote_limit, anonymous_token, allowed_staff_ids, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);

    const result = stmt.run(title, description || '', startDateStr, endDateStr, multipleChoice === true ? 1 : 0, isAnonymous === true ? 1 : 0, voteLimit || 'once', anonymousToken, allowedStaffIdsStr, req.user.userId);
    const votingId = result.lastInsertRowid;

    // 创建投票选项（去掉前缀）
    const optionStmt = db.prepare(`
      INSERT INTO voting_options (voting_id, option_text, vote_count)
      VALUES (?, ?, 0)
    `);

    options.forEach(option => {
      // 去掉 "选项X: " 或 "选项X：" 前缀
      const cleanOption = option.replace(/^选项\d+[:：]\s*/, '');
      optionStmt.run(votingId, cleanOption);
    });

    // 构建匿名投票链接
    const anonymousUrl = `${getAnonymousBaseUrl(req)}?token=${anonymousToken}`;

    res.json({
      code: 0,
      msg: '投票创建成功',
      data: {
        votingId,
        title,
        anonymousToken,
        anonymousUrl,
        options: options.map((text, index) => ({
          id: index + 1,
          text,
          votes: 0
        }))
      }
    });
  } catch (err) {
    console.error('创建投票失败:', err);
    res.status(500).json({
      code: -1,
      msg: '服务器错误',
      data: null
    });
  }
});

// 获取投票列表
// GET /api/voting/list
router.get('/list', authMiddleware, (req, res) => {
  try {
    const staffId = req.user.type === 'employee' ? req.user.id : req.user.userId;

    const votings = db.prepare(`
      SELECT id, title, description, start_date, end_date, multiple_choice, is_anonymous, vote_limit, anonymous_token, allowed_staff_ids, created_at
      FROM votings
      ORDER BY created_at DESC
    `).all();

    // 过滤投票：匿名投票不显示，非匿名投票只显示有权限参与的
    const result = votings
      .filter(voting => {
        // 匿名投票不显示给移动端
        if (voting.is_anonymous === 1) return false;
        // 非匿名投票检查权限
        if (voting.allowed_staff_ids) {
          try {
            const allowed = JSON.parse(voting.allowed_staff_ids);
            // 如果设置了权限人员，只显示有权限的员工
            if (Array.isArray(allowed) && allowed.length > 0) {
              return allowed.includes(staffId);
            }
          } catch (e) {}
        }
        return true; // 没有设置权限则所有人都可以看到
      })
      .map(voting => ({
        id: voting.id,
        title: voting.title,
        description: voting.description,
        startDate: voting.start_date,
        endDate: voting.end_date,
        multipleChoice: voting.multiple_choice === 1,
        isAnonymous: voting.is_anonymous === 1,
        voteLimit: voting.vote_limit,
        anonymousToken: voting.anonymous_token,
        anonymousUrl: voting.anonymous_token ? `${getAnonymousBaseUrl(req)}?token=${voting.anonymous_token}` : null,
        createdAt: voting.created_at
      }));

    res.json({
      code: 0,
      msg: 'success',
      data: result
    });
  } catch (err) {
    console.error('获取投票列表失败:', err);
    res.status(500).json({
      code: -1,
      msg: '服务器错误',
      data: null
    });
  }
});

// 获取投票详情
// GET /api/voting/:id
router.get('/:id', authMiddleware, (req, res) => {
  try {
    const { id } = req.params;

    const voting = db.prepare(`
      SELECT id, title, description, start_date, end_date, multiple_choice, is_anonymous, vote_limit, anonymous_token, allowed_staff_ids, created_at
      FROM votings
      WHERE id = ?
    `).get(id);

    if (!voting) {
      return res.status(404).json({
        code: -1,
        msg: '投票不存在',
        data: null
      });
    }

    // 匿名投票不显示给移动端
    if (voting.is_anonymous === 1) {
      return res.status(404).json({
        code: -1,
        msg: '投票不存在',
        data: null
      });
    }

    // 检查是否有权限查看
    if (voting.allowed_staff_ids) {
      const currentUserId = req.user.type === 'employee' ? req.user.id : req.user.userId;
      try {
        const allowed = JSON.parse(voting.allowed_staff_ids);
        if (Array.isArray(allowed) && allowed.length > 0 && !allowed.includes(currentUserId)) {
          return res.status(403).json({
            code: -1,
            msg: '您没有此投票的权限',
            data: null
          });
        }
      } catch (e) {}
    }

    // 从投票记录实时统计票数，而不是依赖 vote_count 字段
    const options = db.prepare(`
      SELECT vo.id, vo.option_text,
        (SELECT COUNT(*) FROM voting_records vr WHERE vr.option_id = vo.id) as votes
      FROM voting_options vo
      WHERE vo.voting_id = ?
      ORDER BY vo.id
    `).all(id);

    // 检查用户是否已投票
    const currentUserId = req.user.type === 'employee' ? req.user.id : req.user.userId;
    const userVote = db.prepare(`
      SELECT option_ids FROM voting_records
      WHERE voting_id = ? AND user_id = ?
    `).get(id, currentUserId);

    res.json({
      code: 0,
      msg: 'success',
      data: {
        id: voting.id,
        title: voting.title,
        description: voting.description,
        startDate: voting.start_date,
        endDate: voting.end_date,
        multipleChoice: voting.multiple_choice === 1,
        isAnonymous: voting.is_anonymous === 1,
        voteLimit: voting.vote_limit,
        anonymousToken: voting.anonymous_token,
        anonymousUrl: voting.anonymous_token ? `${getAnonymousBaseUrl(req)}?token=${voting.anonymous_token}` : null,
        options: options.map(opt => ({
          id: opt.id,
          text: opt.option_text,
          votes: opt.votes
        })),
        hasVoted: !!userVote,
        userVote: userVote ? (userVote.option_ids ? userVote.option_ids.split(',').map(Number) : [userVote.option_id]) : []
      }
    });
  } catch (err) {
    console.error('获取投票详情失败:', err);
    res.status(500).json({
      code: -1,
      msg: '服务器错误',
      data: null
    });
  }
});

// 投票
// POST /api/voting/:id/vote
router.post('/:id/vote', authMiddleware, (req, res) => {
  try {
    const { id } = req.params;
    const { optionIds } = req.body;

    if (!optionIds || !Array.isArray(optionIds) || optionIds.length === 0) {
      return res.status(400).json({
        code: -1,
        msg: '请选择投票选项',
        data: null
      });
    }

    // 检查投票是否存在
    const voting = db.prepare('SELECT * FROM votings WHERE id = ?').get(id);
    if (!voting) {
      return res.status(404).json({
        code: -1,
        msg: '投票不存在',
        data: null
      });
    }

    // 检查是否是匿名投票
    if (voting.is_anonymous === 1) {
      return res.status(400).json({
        code: -1,
        msg: '匿名投票请通过链接投票',
        data: null
      });
    }

    // 检查是否有权限投票
    if (voting.allowed_staff_ids) {
      const currentUserId = req.user.type === 'employee' ? req.user.id : req.user.userId;
      try {
        const allowed = JSON.parse(voting.allowed_staff_ids);
        if (Array.isArray(allowed) && allowed.length > 0 && !allowed.includes(currentUserId)) {
          return res.status(403).json({
            code: -1,
            msg: '您没有此投票的权限',
            data: null
          });
        }
      } catch (e) {}
    }

    // 检查投票是否已过期
    if (new Date(voting.end_date) < new Date()) {
      return res.status(400).json({
        code: -1,
        msg: '投票已结束',
        data: null
      });
    }

    // 检查投票是否已开始
    if (new Date(voting.start_date) > new Date()) {
      return res.status(400).json({
        code: -1,
        msg: '投票尚未开始',
        data: null
      });
    }

    // 检查用户是否已投票
    const currentUserId = req.user.type === 'employee' ? req.user.id : req.user.userId;
    if (voting.vote_limit === 'once') {
      const existingVote = db.prepare(`
        SELECT * FROM voting_records
        WHERE voting_id = ? AND user_id = ?
      `).get(id, currentUserId);

      if (existingVote) {
        return res.status(400).json({
          code: -1,
          msg: '您已投过票',
          data: null
        });
      }
    } else if (voting.vote_limit === 'daily') {
      // 每天一次：检查今天是否投过
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayVote = db.prepare(`
        SELECT * FROM voting_records
        WHERE voting_id = ? AND user_id = ? AND date(created_at) = date('now')
      `).get(id, currentUserId);

      if (todayVote) {
        return res.status(400).json({
          code: -1,
          msg: '您今天已投过票',
          data: null
        });
      }
    }

    // 检查是否为多选
    if (!voting.multiple_choice && optionIds.length > 1) {
      return res.status(400).json({
        code: -1,
        msg: '此投票只能选择一个选项',
        data: null
      });
    }

    // 记录投票
    const recordStmt = db.prepare(`
      INSERT INTO voting_records (voting_id, user_id, option_ids, voted_at)
      VALUES (?, ?, ?, datetime('now'))
    `);
    recordStmt.run(id, currentUserId, optionIds.join(','));

    // 更新选项投票数
    const updateStmt = db.prepare(`
      UPDATE voting_options
      SET vote_count = vote_count + 1
      WHERE voting_id = ? AND id = ?
    `);

    optionIds.forEach(optionId => {
      updateStmt.run(id, optionId);
    });

    res.json({
      code: 0,
      msg: '投票成功',
      data: null
    });
  } catch (err) {
    console.error('投票失败:', err);
    res.status(500).json({
      code: -1,
      msg: '服务器错误',
      data: null
    });
  }
});

// 获取投票结果（公开接口）
// GET /api/voting/:id/results
router.get('/:id/results', (req, res) => {
  try {
    const { id } = req.params;

    const voting = db.prepare(`
      SELECT id, title, description, end_date, multiple_choice, is_anonymous, created_at
      FROM votings
      WHERE id = ?
    `).get(id);

    if (!voting) {
      return res.status(404).json({
        code: -1,
        msg: '投票不存在',
        data: null
      });
    }

    const options = db.prepare(`
      SELECT vo.id, vo.option_text,
        (SELECT COUNT(*) FROM voting_records vr WHERE vr.option_id = vo.id) as votes
      FROM voting_options vo
      WHERE vo.voting_id = ?
      ORDER BY votes DESC
    `).all(id);

    // 统计投票人数（匿名用device_token，非匿名用user_id）
    const totalVotes = db.prepare(`
      SELECT COUNT(*) as count FROM (
        SELECT 1 FROM voting_records
        WHERE voting_id = ?
        GROUP BY COALESCE(NULLIF(device_token, ''), user_id)
      )
    `).get(id).count;

    res.json({
      code: 0,
      msg: 'success',
      data: {
        id: voting.id,
        title: voting.title,
        totalVotes,
        options: options.map(opt => ({
          id: opt.id,
          text: opt.option_text,
          votes: opt.votes,
          percentage: totalVotes > 0 ? ((opt.votes / totalVotes) * 100).toFixed(2) : 0
        }))
      }
    });
  } catch (err) {
    console.error('获取投票结果失败:', err);
    res.status(500).json({
      code: -1,
      msg: '服务器错误',
      data: null
    });
  }
});

// 获取投票人详情（管理员）
// GET /api/voting/:id/voters
router.get('/:id/voters', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const { id } = req.params;

    const voting = db.prepare('SELECT id, is_anonymous FROM votings WHERE id = ?').get(id);
    if (!voting) {
      return res.status(404).json({ code: -1, msg: '投票不存在', data: null });
    }

    // 匿名投票不显示投票人详情
    if (voting.is_anonymous === 1) {
      return res.json({
        code: 0,
        msg: 'success',
        data: { anonymous: true, voters: [] }
      });
    }

    // 获取投票记录
    const records = db.prepare(`
      SELECT vr.id, vr.employee_id, vr.employee_name, vr.option_ids, vr.voted_at
      FROM voting_records vr
      WHERE vr.voting_id = ?
      ORDER BY vr.voted_at DESC
    `).all(id);

    // 获取所有选项
    const options = db.prepare(`
      SELECT id, option_text FROM voting_options WHERE voting_id = ?
    `).all(id);

    const optionMap = new Map(options.map(o => [o.id, o.option_text]));

    // 按人员分组
    const voterMap = new Map();
    records.forEach(r => {
      if (!voterMap.has(r.id)) {
        voterMap.set(r.id, {
          id: r.id,
          employeeId: r.employee_id,
          employeeName: r.employee_name,
          votedAt: r.voted_at,
          options: []
        });
      }
      // 解析 option_ids 并获取选项文本
      const optionIds = r.option_ids ? r.option_ids.split(',').map(Number) : [];
      optionIds.forEach(optId => {
        if (optionMap.has(optId)) {
          voterMap.get(r.id).options.push(optionMap.get(optId));
        }
      });
    });

    res.json({
      code: 0,
      msg: 'success',
      data: {
        anonymous: false,
        voters: Array.from(voterMap.values())
      }
    });
  } catch (err) {
    console.error('获取投票人详情失败:', err);
    res.status(500).json({
      code: -1,
      msg: '服务器错误',
      data: null
    });
  }
});

// 更新投票
// PUT /api/voting/:id
router.put('/:id', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const { id } = req.params;

    const schema = Joi.object({
      title: Joi.string().required(),
      description: Joi.string().allow('').optional(),
      options: Joi.array().items(Joi.string()).min(2).required(),
      startDate: Joi.date().required(),
      endDate: Joi.date().required(),
      multipleChoice: Joi.boolean().default(false),
      isAnonymous: Joi.boolean().default(false),
      voteLimit: Joi.string().valid('once', 'daily').default('once')
    });

    const { error, value } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({
        code: -1,
        msg: error.details[0].message,
        data: null
      });
    }

    const { title, description, options, startDate, endDate, multipleChoice, isAnonymous, voteLimit } = value;

    // 格式化日期时间
    const formatLocalDateTime = (d) => {
      if (!d) return null;
      const pad = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    };
    const startDateStr = startDate instanceof Date ? formatLocalDateTime(startDate) : startDate;
    const endDateStr = endDate instanceof Date ? formatLocalDateTime(endDate) : endDate;

    // 检查投票是否存在
    const voting = db.prepare('SELECT id FROM votings WHERE id = ?').get(id);
    if (!voting) {
      return res.status(404).json({
        code: -1,
        msg: '投票不存在',
        data: null
      });
    }

    // 更新投票信息
    db.prepare(`
      UPDATE votings
      SET title = ?, description = ?, start_date = ?, end_date = ?, multiple_choice = ?, is_anonymous = ?, vote_limit = ?
      WHERE id = ?
    `).run(title, description || '', startDateStr, endDateStr, multipleChoice ? 1 : 0, isAnonymous ? 1 : 0, voteLimit || 'once', id);

    // 删除旧选项
    db.prepare('DELETE FROM voting_options WHERE voting_id = ?').run(id);

    // 重新插入选项
    const optionStmt = db.prepare(`
      INSERT INTO voting_options (voting_id, option_text, vote_count)
      VALUES (?, ?, 0)
    `);
    options.forEach(option => {
      const cleanOption = option.replace(/^选项\d+[:：]\s*/, '');
      optionStmt.run(id, cleanOption);
    });

    res.json({
      code: 0,
      msg: '投票更新成功',
      data: null
    });
  } catch (err) {
    console.error('更新投票失败:', err);
    res.status(500).json({
      code: -1,
      msg: '服务器错误',
      data: null
    });
  }
});

// 删除投票
// DELETE /api/voting/:id
router.delete('/:id', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const { id } = req.params;

    const voting = db.prepare('SELECT id FROM votings WHERE id = ?').get(id);
    if (!voting) {
      return res.status(404).json({
        code: -1,
        msg: '投票不存在',
        data: null
      });
    }

    // 删除投票记录（先删，因为有外键引用voting_options）
    db.prepare('DELETE FROM voting_records WHERE voting_id = ?').run(id);
    // 删除投票选项
    db.prepare('DELETE FROM voting_options WHERE voting_id = ?').run(id);
    // 删除投票设备记录
    db.prepare('DELETE FROM voting_device_tokens WHERE voting_id = ?').run(id);
    // 删除投票
    db.prepare('DELETE FROM votings WHERE id = ?').run(id);

    res.json({
      code: 0,
      msg: '删除成功',
      data: null
    });
  } catch (err) {
    console.error('删除投票失败:', err);
    res.status(500).json({
      code: -1,
      msg: '服务器错误',
      data: null
    });
  }
});

// ============ 匿名投票接口（无需登录） ============

// 获取匿名投票卡片信息
// GET /api/voting/anonymous/:token
router.get('/anonymous/:token', (req, res) => {
  try {
    const { token } = req.params;

    const voting = db.prepare(`
      SELECT id, title, description, start_date, end_date, multiple_choice, is_anonymous, vote_limit, anonymous_token
      FROM votings
      WHERE anonymous_token = ?
    `).get(token);

    if (!voting) {
      return res.status(404).json({ code: -1, msg: '投票不存在', data: null });
    }

    const options = db.prepare(`
      SELECT vo.id, vo.option_text,
        (SELECT COUNT(*) FROM voting_records vr WHERE vr.option_id = vo.id) as votes
      FROM voting_options vo
      WHERE vo.voting_id = ?
      ORDER BY vo.id
    `).all(voting.id);

    // 获取设备Token（从header）
    const deviceToken = req.headers['x-device-token'];

    // 检查投票状态
    const now = new Date();
    let status = 'available';
    if (new Date(voting.end_date) < now) {
      status = 'ended';
    } else if (new Date(voting.start_date) > now) {
      status = 'notStarted';
    }

    // 检查是否已投票（仅对 once/daily 限制）
    let hasVoted = false;
    if (deviceToken && (voting.vote_limit === 'once' || voting.vote_limit === 'daily')) {
      if (voting.vote_limit === 'once') {
        const record = db.prepare(`
          SELECT id FROM voting_device_tokens WHERE voting_id = ? AND device_token = ?
        `).get(voting.id, deviceToken);
        hasVoted = !!record;
      } else if (voting.vote_limit === 'daily') {
        const record = db.prepare(`
          SELECT id FROM voting_device_tokens WHERE voting_id = ? AND device_token = ? AND date(voted_at) = date('now')
        `).get(voting.id, deviceToken);
        hasVoted = !!record;
      }
    }

    res.json({
      code: 0,
      msg: 'success',
      data: {
        id: voting.id,
        title: voting.title,
        description: voting.description,
        startDate: voting.start_date,
        endDate: voting.end_date,
        multipleChoice: voting.multiple_choice === 1,
        isAnonymous: voting.is_anonymous === 1,
        voteLimit: voting.vote_limit,
        options: options.map(opt => ({ id: opt.id, text: opt.option_text, votes: opt.votes })),
        hasVoted,
        status
      }
    });
  } catch (err) {
    console.error('获取匿名投票失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

// 提交匿名投票
// POST /api/voting/anonymous/:token/vote
router.post('/anonymous/:token/vote', (req, res) => {
  try {
    const { token } = req.params;
    const { optionIds, employeeId, employeeName } = req.body;
    const deviceToken = req.headers['x-device-token'] || req.body.deviceToken;

    if (!optionIds || !Array.isArray(optionIds) || optionIds.length === 0) {
      return res.status(400).json({ code: -1, msg: '请选择投票选项', data: null });
    }

    if (!deviceToken) {
      return res.status(400).json({ code: -1, msg: '设备标识无效', data: null });
    }

    const voting = db.prepare('SELECT * FROM votings WHERE anonymous_token = ?').get(token);
    if (!voting) {
      return res.status(404).json({ code: -1, msg: '投票不存在', data: null });
    }

    // 检查时间状态
    const now = new Date();
    if (new Date(voting.end_date) < now) {
      return res.status(400).json({ code: -2, msg: '投票已结束', data: null });
    }
    if (new Date(voting.start_date) > now) {
      return res.status(400).json({ code: -3, msg: '投票尚未开始', data: null });
    }

    // 检查频次限制
    if (voting.vote_limit === 'once') {
      const existing = db.prepare(`
        SELECT id FROM voting_device_tokens WHERE voting_id = ? AND device_token = ?
      `).get(voting.id, deviceToken);
      if (existing) {
        return res.status(400).json({ code: -4, msg: '您已投过票', data: null });
      }
    } else if (voting.vote_limit === 'daily') {
      const today = db.prepare(`
        SELECT id FROM voting_device_tokens WHERE voting_id = ? AND device_token = ? AND date(voted_at) = date('now')
      `).get(voting.id, deviceToken);
      if (today) {
        return res.status(400).json({ code: -5, msg: '您今天已投过票', data: null });
      }
    }

    // 非匿名投票需要工号验证
    if (!voting.is_anonymous) {
      if (!employeeId) {
        return res.status(400).json({ code: -6, msg: '请输入工号', data: null });
      }
      const staff = db.prepare(`SELECT id, name FROM staff WHERE employee_id = ? AND status = 'active'`).get(employeeId);
      if (!staff) {
        return res.status(400).json({ code: -6, msg: '工号无效', data: null });
      }
    }

    // 检查是否为多选
    if (!voting.multiple_choice && optionIds.length > 1) {
      return res.status(400).json({ code: -1, msg: '此投票只能选择一个选项', data: null });
    }

    // 记录投票设备
    db.prepare(`
      INSERT INTO voting_device_tokens (voting_id, device_token, employee_id, employee_name)
      VALUES (?, ?, ?, ?)
    `).run(voting.id, deviceToken, employeeId || null, employeeName || null);

    // 记录投票 - 每个选项一条记录
    // 使用 user_id = 1 作为占位符（匿名投票不关联真实用户）
    const insertStmt = db.prepare(`
      INSERT INTO voting_records (voting_id, user_id, device_token, employee_id, employee_name, option_id)
      VALUES (?, 1, ?, ?, ?, ?)
    `);
    optionIds.forEach(optId => {
      insertStmt.run(voting.id, deviceToken, employeeId || null, employeeName || null, optId);
    });

    // 更新票数
    const updateStmt = db.prepare('UPDATE voting_options SET vote_count = vote_count + 1 WHERE id = ? AND voting_id = ?');
    optionIds.forEach(optId => updateStmt.run(optId, voting.id));

    res.json({ code: 0, msg: '投票成功', data: null });
  } catch (err) {
    console.error('匿名投票失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

// 获取匿名投票结果（公开）
// GET /api/voting/anonymous/:token/results
router.get('/anonymous/:token/results', (req, res) => {
  try {
    const { token } = req.params;

    const voting = db.prepare('SELECT id, title, is_anonymous FROM votings WHERE anonymous_token = ?').get(token);
    if (!voting) {
      return res.status(404).json({ code: -1, msg: '投票不存在', data: null });
    }

    const options = db.prepare(`
      SELECT vo.id, vo.option_text,
        (SELECT COUNT(*) FROM voting_records vr WHERE vr.option_id = vo.id) as votes
      FROM voting_options vo
      WHERE vo.voting_id = ?
      ORDER BY votes DESC
    `).all(voting.id);

    const totalVotes = db.prepare('SELECT COUNT(DISTINCT device_token) as count FROM voting_records WHERE voting_id = ?').get(voting.id).count;

    res.json({
      code: 0,
      msg: 'success',
      data: {
        id: voting.id,
        title: voting.title,
        isAnonymous: voting.is_anonymous === 1,
        totalVotes,
        options: options.map(opt => ({
          id: opt.id,
          text: opt.option_text,
          votes: opt.votes,
          percentage: totalVotes > 0 ? ((opt.votes / totalVotes) * 100).toFixed(2) : 0
        }))
      }
    });
  } catch (err) {
    console.error('获取匿名投票结果失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

module.exports = router;
