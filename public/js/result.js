// js/result.js - 结果页面逻辑
document.addEventListener('DOMContentLoaded', async () => {
  const urlParams = new URLSearchParams(window.location.search);
  const score = parseFloat(urlParams.get('score'));
  const answerId = urlParams.get('answerId');

  const scoreEl = document.getElementById('score');
  const scoreLabelEl = document.getElementById('score-label');
  const resultMsgEl = document.getElementById('resultMsg');

  // 获取用户昵称
  let nickname = '用户';
  try {
    const userRes = await api.getCurrentUser();
    if (userRes && userRes.data && userRes.data.nickname) {
      nickname = userRes.data.nickname;
    } else if (userRes && userRes.data && userRes.data.nickName) {
      nickname = userRes.data.nickName;
    }
  } catch (err) {
    console.log('未登录或获取用户信息失败，使用默认昵称');
  }

  // 更新成绩标签为"昵称的成绩"
  if (scoreLabelEl) {
    scoreLabelEl.textContent = `${nickname}的成绩`;
  }

  if (isNaN(score)) {
    scoreEl.textContent = '--';
    resultMsgEl.textContent = '未获取到成绩';
    return;
  }

  scoreEl.textContent = score.toFixed(1);

  // 根据分数显示不同消息
  let msg = '';
  if (score >= 90) {
    msg = '太棒了！优秀！继续保持！🏆';
  } else if (score >= 80) {
    msg = '做得很好！继续加油！👍';
  } else if (score >= 60) {
    msg = '及格了，再接再厉！📚';
  } else {
    msg = '不及格，建议重新学习后再考一次！💪';
  }
  resultMsgEl.textContent = msg;
});

function goToExamList() {
  window.location.href = '/exam-list.html';
}
