const { formatError, request } = require("../../utils/request");

function isLunchPeriod() {
  const hour = new Date().getHours();
  return hour >= 0 && hour < 12;
}

Page({
  data: {
    loading: true,
    empty: false,
    dateText: "",
    weekText: "",
    isLunch: true,
    stats: null,
  },

  onLoad() {
    this.initDate();
    this.loadData();
  },

  onPullDownRefresh() {
    this.loadData(true);
  },

  initDate() {
    const now = new Date();
    const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
    this.setData({
      dateText: `${now.getMonth() + 1}月${now.getDate()}日`,
      weekText: weekdays[now.getDay()],
      isLunch: isLunchPeriod(),
    });
  },

  async loadData(fromPull = false) {
    try {
      const res = await request({ url: "/meal/canteen-today" });
      this.setData({
        stats: res.data || null,
        empty: !(res.data),
        loading: false,
      });
    } catch (err) {
      this.setData({ loading: false, empty: true });
      wx.showToast({ title: formatError(err, "加载失败"), icon: "none" });
    } finally {
      if (fromPull) wx.stopPullDownRefresh();
    }
  },
});
