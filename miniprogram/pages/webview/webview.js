const { getWebViewUrl } = require("../../utils/request");

function decodeValue(value, fallback = "") {
  try {
    return decodeURIComponent(value || fallback);
  } catch (err) {
    return value || fallback;
  }
}

Page({
  data: {
    title: "兴利汽车模具",
    src: "",
    path: "/miniapp-entry.html",
  },

  onLoad(options) {
    const title = decodeValue(options.title, "兴利汽车模具");
    const path = decodeValue(options.path, "");
    const rawUrl = decodeValue(options.url, "");
    const finalPath = path || this.extractPathFromUrl(rawUrl) || "/miniapp-entry.html";

    wx.setNavigationBarTitle({ title });
    this.setData({
      title,
      path: finalPath,
      src: getWebViewUrl(finalPath),
    });
  },

  onPullDownRefresh() {
    this.setData({
      src: getWebViewUrl(this.data.path),
    });
    setTimeout(() => wx.stopPullDownRefresh(), 500);
  },

  extractPathFromUrl(url) {
    if (!url) return "";
    const marker = "://";
    const idx = url.indexOf(marker);
    if (idx === -1) return url;
    const pathIdx = url.indexOf("/", idx + marker.length);
    return pathIdx === -1 ? "/miniapp-entry.html" : url.slice(pathIdx);
  },

  onWebViewLoad() {},
});
