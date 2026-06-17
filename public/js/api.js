// js/api.js - HTTP API 封装
// 使用相对路径，自动适配当前域名和端口
const API_BASE = '';

if (!window.AdminSession) {
  window.AdminSession = (() => {
    const SESSION_KEY = 'adminSession';
    const LOGIN_PATH = '/admin/login.html';

    function getEndOfTodayTimestamp() {
      const now = new Date();
      now.setHours(23, 59, 59, 999);
      return now.getTime();
    }

    function readSession() {
      try {
        const raw = localStorage.getItem(SESSION_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (error) {
        return null;
      }
    }

    function hasAdminSessionRecord() {
      return !!(readSession() || localStorage.getItem('adminToken') || localStorage.getItem('currentUser'));
    }

    function clearAdminSession() {
      localStorage.removeItem('token');
      localStorage.removeItem('adminToken');
      localStorage.removeItem('currentUser');
      localStorage.removeItem('user');
      localStorage.removeItem(SESSION_KEY);
    }

    function buildLoginUrl() {
      return window.location.origin + LOGIN_PATH;
    }

    function saveAdminSession(user, token) {
      const expiresAt = getEndOfTodayTimestamp();
      localStorage.setItem('token', token);
      localStorage.setItem('adminToken', token);
      localStorage.setItem('currentUser', JSON.stringify(user || {}));
      localStorage.setItem('user', JSON.stringify(user || {}));
      localStorage.setItem(SESSION_KEY, JSON.stringify({
        username: user?.username || '',
        expiresAt
      }));
      return expiresAt;
    }

    function isAdminSessionValid() {
      const token = localStorage.getItem('token') || localStorage.getItem('adminToken');
      const session = readSession();
      if (!token || !session || !session.expiresAt) {
        return false;
      }
      return Date.now() <= Number(session.expiresAt);
    }

    function ensureAdminSession() {
      if (isAdminSessionValid()) {
        return true;
      }
      clearAdminSession();
      return false;
    }

    function getAdminToken() {
      if (!ensureAdminSession()) {
        return '';
      }
      return localStorage.getItem('token') || localStorage.getItem('adminToken') || '';
    }

    function redirectToLogin() {
      clearAdminSession();
      const loginUrl = buildLoginUrl();
      if (window.location.pathname !== LOGIN_PATH) {
        window.location.replace(loginUrl);
      }
      return false;
    }

    function requireAdminSession() {
      const token = getAdminToken();
      if (token) {
        return token;
      }
      redirectToLogin();
      return '';
    }

    return {
      clear: clearAdminSession,
      ensureValid: ensureAdminSession,
      getToken: getAdminToken,
      getExpiresAt: () => readSession()?.expiresAt || null,
      hasSessionRecord: hasAdminSessionRecord,
      isValid: isAdminSessionValid,
      redirectToLogin,
      requireValid: requireAdminSession,
      save: saveAdminSession
    };
  })();
}

if (window.AdminSession && window.location.pathname !== '/admin/login.html' && window.AdminSession.hasSessionRecord && window.AdminSession.hasSessionRecord()) {
  window.AdminSession.ensureValid();
}

// 获取 token
function getToken() {
  if (window.AdminSession && window.AdminSession.hasSessionRecord && window.AdminSession.hasSessionRecord() && typeof window.AdminSession.getToken === 'function') {
    return window.AdminSession.getToken();
  }
  return localStorage.getItem('token') || localStorage.getItem('adminToken') || '';
}

// 设置 token
function setToken(token) {
  localStorage.setItem('token', token);
}

// 清除 token（退出登录）
function clearToken() {
  if (window.AdminSession) {
    window.AdminSession.clear();
    return;
  }
  localStorage.removeItem('token');
}

// 通用请求方法
async function request(options) {
  const token = getToken();
  const shouldGuardAdminSession = window.AdminSession
    && window.AdminSession.hasSessionRecord
    && window.AdminSession.hasSessionRecord()
    && window.location.pathname !== '/admin/login.html';
  if (!token && shouldGuardAdminSession) {
    window.AdminSession.redirectToLogin();
    throw new Error('管理员会话已跨天失效，请重新登录');
  }

  const headers = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const config = {
    url: `${API_BASE}${options.url}`,
    method: options.method || 'GET',
    headers: headers,
    data: options.data || {},
  };

  try {
    const response = await fetch(config.url, {
      method: config.method,
      headers: config.headers,
      body: ['GET', 'HEAD'].includes(config.method) ? undefined : JSON.stringify(config.data),
    });

    const data = await response.json();

    if (response.status === 401 && shouldGuardAdminSession) {
      const msg = data?.msg || '';
      if (msg.includes('重新登录') || msg.includes('跨天失效') || msg.includes('token 无效') || msg.includes('token无效')) {
        window.AdminSession.redirectToLogin();
      }
    }

    if (!response.ok || data.code !== 0) {
      throw new Error(data.msg || '请求失败');
    }

    return data;
  } catch (error) {
    console.error('API Error:', error);
    throw error;
  }
}

// API 方法
const api = {
  // 登录
  login: async (openid, nickname, avatar = '') => {
    const res = await request({
      url: '/api/auth/login',
      method: 'POST',
      data: { openid, nickname, avatar }
    });
    if (res.code === 0) {
      setToken(res.data.token);
    }
    return res;
  },

  // 管理员登录
  adminLogin: async (username, password) => {
    const res = await request({
      url: '/api/auth/login',
      method: 'POST',
      data: { username, password }
    });
    if (res.code === 0) {
      if (window.AdminSession) {
        window.AdminSession.save(res.data.user, res.data.token);
      } else {
        setToken(res.data.token);
      }
    }
    return res;
  },

  // 获取考试列表
  getExamList: () => request({
    url: '/api/exam/list'
  }),

  // 获取考试详情
  getExamDetail: (examId) => request({
    url: `/api/exam/${examId}`
  }),

  // 获取用户信息
  getCurrentUser: () => request({
    url: '/api/auth/me',
    method: 'GET'
  }),

  // 开始考试
  startExam: (examId) => request({
    url: '/api/exam/start',
    method: 'POST',
    data: { examId }
  }),

  // 提交答案
  submitExam: (answerId, responses) => request({
    url: '/api/exam/submit',
    method: 'POST',
    data: { answerId, responses }
  }),

  // 导入题目（管理员）
  importQuestions: (text, paperTitle) => request({
    url: '/api/import/upload',
    method: 'POST',
    data: { text, paperTitle }
  }),

  // 上传文件并提取文本（管理员）
  uploadFile: (file) => {
    return new Promise((resolve, reject) => {
      const token = getToken();
      const formData = new FormData();
      formData.append('file', file);

      fetch(`${API_BASE}/api/import/upload`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      })
      .then(res => res.json())
      .then(data => {
        if (data.code !== 0) {
          throw new Error(data.msg || '上传失败');
        }
        resolve(data);
      })
      .catch(err => reject(err));
    });
  },

  // 解析文本题目（管理员）
  parseText: (text) => request({
    url: '/api/import/parse-text',
    method: 'POST',
    data: { text }
  }),

  // 上传并解析文件（管理员）
  parseFile: (file) => {
    return new Promise((resolve, reject) => {
      const token = getToken();
      const formData = new FormData();
      formData.append('file', file);

      fetch(`${API_BASE}/api/import/parse-file`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      })
      .then(res => res.json())
      .then(data => {
        if (data.code !== 0) {
          throw new Error(data.msg || '解析失败');
        }
        resolve(data);
      })
      .catch(err => reject(err));
    });
  },

  // ============ 题库管理 API ============

  // 获取题库列表
  getQuestionBanks: () => request({
    url: '/api/question-banks',
    method: 'GET'
  }),

  // 创建题库
  createQuestionBank: (data) => request({
    url: '/api/question-banks',
    method: 'POST',
    data
  }),

  // 获取题库详情
  getQuestionBank: (id) => request({
    url: `/api/question-banks/${id}`,
    method: 'GET'
  }),

  // 更新题库
  updateQuestionBank: (id, data) => request({
    url: `/api/question-banks/${id}`,
    method: 'PUT',
    data
  }),

  // 删除题库
  deleteQuestionBank: (id) => request({
    url: `/api/question-banks/${id}`,
    method: 'DELETE'
  }),

  // 导入题目到题库
  importQuestionsToBank: (bankId, questions) => request({
    url: `/api/question-banks/${bankId}/import`,
    method: 'POST',
    data: { questions }
  }),
};

// 退出登录
function logout() {
  clearToken();
  window.location.href = '/';
}

// 检查登录状态
function checkLogin() {
  return !!getToken();
}
