const { formatError, getStaff, request, saveSession } = require("../../utils/request");

function redirectToDefaultEntry() {
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
    employeeId: "",
    name: "",
    namePlaceholder: "输入工号后自动填充",
    loading: false,
    canSubmit: false,
    lookupState: "idle",
    helperText: "请输入工号后自动匹配员工姓名",
  },

  onShow() {
    const staff = getStaff();
    if (staff) {
      redirectToDefaultEntry();
    }
  },

  onEmployeeIdInput(e) {
    const employeeId = (e.detail.value || "").trim();
    this.setData({
      employeeId,
      name: "",
      namePlaceholder: employeeId ? "查询中..." : "输入工号后自动填充",
      canSubmit: false,
      lookupState: employeeId ? "searching" : "idle",
      helperText: employeeId ? "正在匹配员工信息..." : "请输入工号后自动匹配员工姓名",
    });

    clearTimeout(this.lookupTimer);
    if (!employeeId) {
      return;
    }

    this.lookupTimer = setTimeout(() => {
      this.lookupName(employeeId);
    }, 350);
  },

  onNameInput(e) {
    const name = (e.detail.value || "").trim();
    this.setData({
      name,
      canSubmit: !!(this.data.employeeId && name),
    });
  },

  async lookupName(employeeId) {
    try {
      const res = await request({
        url: `/auth/lookup?employee_id=${encodeURIComponent(employeeId)}`,
      });
      const name = res.data?.name || "";
      this.setData({
        name,
        namePlaceholder: name || "未找到该工号",
        canSubmit: !!(employeeId && name),
        lookupState: name ? "found" : "missing",
        helperText: name ? "已匹配员工姓名，请确认后登录" : "未查询到该工号，请检查后重试",
      });
    } catch (err) {
      this.setData({
        name: "",
        namePlaceholder: "请输入姓名",
        canSubmit: false,
        lookupState: "missing",
        helperText: "查询失败，请检查网络后重试",
      });
    }
  },

  async submit() {
    const employeeId = this.data.employeeId.trim();
    const name = this.data.name.trim();

    if (!employeeId) {
      wx.showToast({ title: "请输入工号", icon: "none" });
      return;
    }
    if (!name) {
      wx.showToast({ title: "请输入姓名", icon: "none" });
      return;
    }

    this.setData({ loading: true });
    try {
      const res = await request({
        url: "/auth/employee-login",
        method: "POST",
        data: {
          employee_id: employeeId,
          name,
        },
        header: {
          "Content-Type": "application/json",
        },
      });
      saveSession(res.data.staff, res.data.token);
      try {
        await getApp().ensureBound({
          nickname: res.data.staff?.name || "",
        });
      } catch (bindErr) {
        console.warn("miniapp bind failed after login:", bindErr);
      }
      wx.showToast({ title: "登录成功", icon: "success" });
      setTimeout(() => {
        redirectToDefaultEntry();
      }, 300);
    } catch (err) {
      wx.showToast({ title: formatError(err, "登录失败"), icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },
});
