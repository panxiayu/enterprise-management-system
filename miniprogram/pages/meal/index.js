const { clearSession, formatError, request } = require("../../utils/request");

function getToday() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

Page({
  data: {
    loading: true,
    activities: [],
  },

  onShow() {
    this.loadActivities();
  },

  onPullDownRefresh() {
    this.loadActivities(true);
  },

  async loadActivities(fromPull = false) {
    this.setData({ loading: !fromPull });
    try {
      const res = await request({ url: "/meal/list", auth: true });
      const activities = (res.data || []).map((item) => ({
        ...item,
        lunchChecked: !!item.todayEmployeeLunch,
        dinnerChecked: !!item.todayEmployeeDinner,
      }));
      this.setData({ activities, loading: false });
    } catch (err) {
      const message = formatError(err, "加载失败");
      if (message.includes("登录")) {
        clearSession();
        wx.reLaunch({ url: "/pages/login/index" });
        return;
      }
      this.setData({ loading: false });
      wx.showToast({ title: message, icon: "none" });
    } finally {
      if (fromPull) wx.stopPullDownRefresh();
    }
  },

  onLunchChange(e) {
    this.toggleMeal(e.currentTarget.dataset.id, "lunchChecked", e.detail.value);
  },

  onDinnerChange(e) {
    this.toggleMeal(e.currentTarget.dataset.id, "dinnerChecked", e.detail.value);
  },

  toggleMeal(id, key, value) {
    const activities = this.data.activities.map((item) =>
      item.id === id ? { ...item, [key]: value } : item
    );
    this.setData({ activities });
  },

  async submitMeal(e) {
    const id = Number(e.currentTarget.dataset.id);
    const activity = this.data.activities.find((item) => item.id === id);
    if (!activity) return;

    const payload = {
      date: getToday(),
      lunch_employee: activity.lunchChecked ? 1 : 0,
      dinner_employee: activity.dinnerChecked ? 1 : 0,
    };

    try {
      wx.showLoading({ title: "提交中..." });
      await request({
        url: `/meal/${id}/signup`,
        method: "POST",
        auth: true,
        data: payload,
        header: {
          "Content-Type": "application/json",
        },
      });
      wx.showToast({ title: "提交成功", icon: "success" });
      this.loadActivities();
    } catch (err) {
      wx.showToast({ title: formatError(err, "提交失败"), icon: "none" });
    } finally {
      wx.hideLoading();
    }
  },
});
