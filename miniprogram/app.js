const {
  bindMiniAppUser,
  exchangeMiniAppCode,
  fetchMiniAppConfig,
  formatError,
  getMiniAppIdentity,
  getStaff,
  getToken,
} = require("./utils/request");

App({
  globalData: {
    miniappConfig: null,
    miniappIdentity: getMiniAppIdentity(),
  },

  onLaunch() {},

  async ensureMiniAppConfig() {
    if (this.globalData.miniappConfig) return this.globalData.miniappConfig;
    try {
      const config = await fetchMiniAppConfig();
      this.globalData.miniappConfig = config || null;
      return this.globalData.miniappConfig;
    } catch (err) {
      console.warn("fetch miniapp config failed:", err);
      return null;
    }
  },

  async ensureMiniAppIdentity() {
    const existing = getMiniAppIdentity();
    if (existing.openid) {
      this.globalData.miniappIdentity = existing;
      return existing;
    }

    await this.ensureMiniAppConfig();

    const loginRes = await new Promise((resolve, reject) => {
      wx.login({
        success: resolve,
        fail: reject,
      });
    });

    if (!loginRes.code) throw new Error("微信登录失败");
    const appId = this.globalData.miniappConfig?.app_id || "";
    const identity = await exchangeMiniAppCode(loginRes.code, appId);
    this.globalData.miniappIdentity = identity;
    return identity;
  },

  async ensureBound(profile = {}) {
    const token = getToken();
    const staff = getStaff();
    if (!token || !staff) return null;
    await this.ensureMiniAppIdentity();
    const binding = await bindMiniAppUser(profile);
    return binding;
  },

  showError(err, fallback) {
    wx.showToast({
      title: formatError(err, fallback),
      icon: "none",
    });
  },
});
