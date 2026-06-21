const { getStaff } = require("../../utils/request");

function redirectToEmployeeHome() {
  wx.reLaunch({
    url:
      "/pages/webview/webview?title=" +
      encodeURIComponent("兴利汽车模具") +
      "&path=" +
      encodeURIComponent("/miniapp-entry.html"),
  });
}

Page({
  data: {
    loading: true,
  },

  onShow() {
    const staff = getStaff();
    if (!staff) {
      wx.reLaunch({ url: "/pages/login/index" });
      return;
    }
    redirectToEmployeeHome();
  },
});
