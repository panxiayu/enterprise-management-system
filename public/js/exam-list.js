// js/exam-list.js - 考试列表逻辑
document.addEventListener('DOMContentLoaded', () => {
  // 检查登录状态
  if (!checkLogin()) {
    window.location.href = '/';
    return;
  }

  // 显示用户信息
  const userInfo = document.getElementById('userInfo');
  const token = getToken();
  if (token) {
    // 解码 token 获取用户信息（简单处理，实际应从后端获取）
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      userInfo.textContent = `用户: ${payload.nickname || '未知'}`;
    } catch (e) {
      userInfo.textContent = '';
    }
  }

  loadExamList();
});

async function loadExamList() {
  const examListEl = document.getElementById('examList');

  try {
    const res = await api.getExamList();
    const exams = res.data || [];

    if (exams.length === 0) {
      examListEl.innerHTML = `
        <div class="text-center" style="padding: 40px; color: #999;">
          暂无考试，请先导入题目
        </div>
      `;
      return;
    }

    examListEl.innerHTML = exams.map(exam => `
      <div class="exam-item" onclick="startExam('${exam.id}')">
        <h3>${exam.title}</h3>
        <p style="color: #666; font-size: 14px; margin-bottom: 10px;">
          ${exam.description || '暂无描述'}
        </p>
        <div class="meta">
          <span>题目数: ${exam.question_count || 0} 题</span>
          <span class="duration">⏱️ ${exam.duration} 分钟</span>
        </div>
        <div class="meta" style="margin-top: 5px;">
          <span>总分: ${exam.total_score || 0} 分</span>
        </div>
      </div>
    `).join('');
  } catch (error) {
    examListEl.innerHTML = `
      <div class="text-center" style="padding: 40px; color: #ff6b6b;">
        加载失败: ${error.message}
      </div>
    `;
  }
}

async function startExam(examId) {
  try {
    // 先调用开始考试接口
    await api.startExam(examId);
    
    // 跳转到答题页
    window.location.href = `/exam-doing.html?examId=${examId}`;
  } catch (error) {
    showToast(error.message || '开始考试失败');
  }
}

function logout() {
  if (confirm('确定要退出登录吗？')) {
    localStorage.removeItem('token');
    window.location.href = '/';
  }
}

// 显示提示消息（与 login.js 相同）
function showToast(message, duration = 2000) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    document.body.removeChild(toast);
  }, duration);
}
