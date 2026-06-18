const BASE_ORIGIN = "https://www.xlmould.work";
const BASE_URL = `${BASE_ORIGIN}/api`;
const MINIAPP_APP_ID = "wx4a0fd7786a7ece59";
const TOKEN_KEY = "employeeToken";
const STAFF_KEY = "employeeStaff";
const MINIAPP_OPENID_KEY = "miniappOpenId";
const MINIAPP_UNIONID_KEY = "miniappUnionId";
const MINIAPP_BOUND_KEY = "miniappBoundAt";

const TEMPLATE_MAP = {
  s6_task_assigned: "",
  s6_task_result: "",
  s6_admin_review: "",
  task_assigned: "",
  task_progress: "",
};

function getToken() {
  return wx.getStorageSync(TOKEN_KEY) || "";
}

function getStaff() {
  return wx.getStorageSync(STAFF_KEY) || null;
}

function saveSession(staff, token) {
  wx.setStorageSync(TOKEN_KEY, token);
  wx.setStorageSync(STAFF_KEY, staff);
}

function clearSession() {
  wx.removeStorageSync(TOKEN_KEY);
  wx.removeStorageSync(STAFF_KEY);
  wx.removeStorageSync(MINIAPP_BOUND_KEY);
}

function setMiniAppIdentity(identity = {}) {
  if (identity.openid) wx.setStorageSync(MINIAPP_OPENID_KEY, identity.openid);
  if (identity.unionid) wx.setStorageSync(MINIAPP_UNIONID_KEY, identity.unionid);
}

function getMiniAppIdentity() {
  return {
    openid: wx.getStorageSync(MINIAPP_OPENID_KEY) || "",
    unionid: wx.getStorageSync(MINIAPP_UNIONID_KEY) || "",
    boundAt: wx.getStorageSync(MINIAPP_BOUND_KEY) || "",
  };
}

function markMiniAppBound() {
  wx.setStorageSync(MINIAPP_BOUND_KEY, Date.now());
}

function formatError(err, fallback = "请求失败") {
  if (!err) return fallback;
  if (typeof err === "string") return err;
  if (err.message) return err.message;
  if (err.msg) return err.msg;
  if (err.errMsg) return err.errMsg;
  return fallback;
}

function request({ url, method = "GET", data, auth = false, header = {} }) {
  return new Promise((resolve, reject) => {
    const headers = { ...header };
    if (auth) {
      const token = getToken();
      if (!token) {
        reject(new Error("请先登录"));
        return;
      }
      headers.Authorization = `Bearer ${token}`;
    }

    wx.request({
      url: `${BASE_URL}${url}`,
      method,
      data,
      header: headers,
      success(res) {
        const body = res.data || {};
        if (res.statusCode === 401) {
          clearSession();
          reject(new Error(body.msg || "登录已失效"));
          return;
        }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          if (typeof body.code !== "undefined" && body.code !== 0) {
            reject(new Error(body.msg || "请求失败"));
            return;
          }
          resolve(body);
          return;
        }
        reject(new Error(body.msg || `请求失败(${res.statusCode})`));
      },
      fail(err) {
        reject(new Error(formatError(err)));
      },
    });
  });
}

function getWebViewUrl(path, extraQuery = {}) {
  const cleanPath = String(path || "/").startsWith("/")
    ? String(path || "/")
    : `/${String(path || "")}`;
  const token = getToken();
  const staff = getStaff();
  const query = [];
  query.push(`miniapp=${encodeURIComponent("1")}`);
  query.push(`t=${encodeURIComponent(String(Date.now()))}`);
  if (token) query.push(`miniapp_token=${encodeURIComponent(token)}`);
  if (staff) query.push(`miniapp_staff=${encodeURIComponent(JSON.stringify(staff))}`);
  Object.keys(extraQuery || {}).forEach((key) => {
    const value = extraQuery[key];
    if (value === undefined || value === null || value === "") return;
    query.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  });
  return `${BASE_ORIGIN}${cleanPath}${cleanPath.includes("?") ? "&" : "?"}${query.join("&")}`;
}

async function fetchMiniAppConfig() {
  const res = await request({ url: "/miniapp/config" });
  return res.data || {};
}

async function fetchMiniAppSession() {
  const res = await request({ url: "/miniapp/session", auth: true });
  return res.data || {};
}

async function exchangeMiniAppCode(code, appId = "") {
  const res = await request({
    url: "/miniapp/code2session",
    method: "POST",
    data: { code, app_id: appId || MINIAPP_APP_ID },
    header: { "Content-Type": "application/json" },
  });
  const data = res.data || {};
  setMiniAppIdentity(data);
  return data;
}

async function bindMiniAppUser(extraProfile = {}) {
  const identity = getMiniAppIdentity();
  if (!identity.openid) throw new Error("尚未获取小程序 openid");
  const res = await request({
    url: "/miniapp/bind",
    method: "POST",
    auth: true,
    data: {
      openid: identity.openid,
      unionid: identity.unionid || "",
      nickname: extraProfile.nickname || "",
      avatar_url: extraProfile.avatar_url || "",
    },
    header: { "Content-Type": "application/json" },
  });
  markMiniAppBound();
  return res.data || null;
}

async function saveMiniAppSubscriptions(templateKeys) {
  const items = (Array.isArray(templateKeys) ? templateKeys : [])
    .map((templateKey) => ({
      template_key: templateKey,
      template_id: TEMPLATE_MAP[templateKey] || "",
      subscribed: TEMPLATE_MAP[templateKey] ? 1 : 0,
    }))
    .filter((item) => item.template_key);

  if (!items.length) return [];

  const res = await request({
    url: "/miniapp/subscriptions",
    method: "POST",
    auth: true,
    data: { items },
    header: { "Content-Type": "application/json" },
  });
  return res.data || [];
}

function resolveTemplateIds(templateKeys) {
  return (Array.isArray(templateKeys) ? templateKeys : [])
    .map((key) => TEMPLATE_MAP[key])
    .filter(Boolean);
}

module.exports = {
  BASE_ORIGIN,
  BASE_URL,
  MINIAPP_APP_ID,
  MINIAPP_BOUND_KEY,
  TEMPLATE_MAP,
  bindMiniAppUser,
  clearSession,
  exchangeMiniAppCode,
  fetchMiniAppConfig,
  fetchMiniAppSession,
  formatError,
  getMiniAppIdentity,
  getStaff,
  getToken,
  getWebViewUrl,
  markMiniAppBound,
  request,
  resolveTemplateIds,
  saveMiniAppSubscriptions,
  saveSession,
};
