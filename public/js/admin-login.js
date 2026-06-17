// js/admin-login.js - 管理员登录逻辑

document.addEventListener('DOMContentLoaded', () => {
  const loginBtn = document.getElementById('loginBtn');
  const errorMsg = document.getElementById('errorMsg');

  loginBtn.addEventListener('click', async () => {
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value.trim();

    if (!username || !password) {
      errorMsg.textContent = '请输入用户名和密码';
      return;
    }

    loginBtn.disabled = true;
    loginBtn.textContent = '登录中...';

    try {
      const res = await api.adminLogin(username, password);
      if (res.code === 0) {
        showToast('登录成功');
        setTimeout(() => {
          window.location.href = '/admin/panel.html';
        }, 1000);
      } else {
        errorMsg.textContent = res.msg || '登录失败';
        loginBtn.disabled = false;
        loginBtn.textContent = '登录';
      }
    } catch (err) {
      errorMsg.textContent = err.message || '网络错误';
      loginBtn.disabled = false;
      loginBtn.textContent = '登录';
    }
  });

  // 回车登录
  document.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      loginBtn.click();
    }
  });
});

function showToast(message, duration = 2000) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    document.body.removeChild(toast);
  }, duration);
}
