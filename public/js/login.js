// js/login.js - 登录逻辑
document.addEventListener('DOMContentLoaded', () => {
  const nicknameInput = document.getElementById('nickname');
  const loginBtn = document.getElementById('loginBtn');

  // 如果已经登录，直接跳转到考试列表
  if (checkLogin()) {
    window.location.href = '/exam-list.html';
    return;
  }

  loginBtn.addEventListener('click', async () => {
    const nickname = nicknameInput.value.trim();

    if (!nickname) {
      showToast('请输入昵称');
      return;
    }

    loginBtn.disabled = true;
    loginBtn.textContent = '登录中...';

    try {
      // 生成一个模拟的 openid（实际应从微信环境获取，这里简化处理）
      const openid = `h5_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      const res = await api.login(openid, nickname);
      
      if (res.code === 0) {
        showToast('登录成功');
        setTimeout(() => {
          window.location.href = '/exam-list.html';
        }, 500);
      } else {
        showToast(res.msg || '登录失败');
        loginBtn.disabled = false;
        loginBtn.textContent = '登录';
      }
    } catch (error) {
      showToast(error.message || '登录失败');
      loginBtn.disabled = false;
      loginBtn.textContent = '登录';
    }
  });

  // 回车登录
  nicknameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      loginBtn.click();
    }
  });
});

// 显示提示消息
function showToast(message, duration = 2000) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    document.body.removeChild(toast);
  }, duration);
}
