// js/admin.js - 管理后台逻辑

console.log('admin.js loaded'); // 调试日志

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

document.addEventListener('DOMContentLoaded', async () => {
  console.log('DOM loaded, starting admin panel'); // 调试日志
  // 检查是否已登录管理员
  const userRes = await checkAuth();
  if (!userRes || userRes.data.role !== 'admin') {
    showToast('需要管理员权限');
    setTimeout(() => {
      window.location.href = '/admin/login.html';
    }, 1500);
    return;
  }

  // 初始化
  let currentPaperId = 1;
  let paperNameMap = { 1: '试卷一', 2: '试卷二', 3: '试卷三' };
  let records = [];
  let selectedRecords = new Set();

  // 绑定试卷标签切换
  document.querySelectorAll('.paper-tag').forEach(tag => {
    tag.addEventListener('click', () => {
      document.querySelectorAll('.paper-tag').forEach(t => t.classList.remove('active'));
      tag.classList.add('active');
      currentPaperId = parseInt(tag.dataset.paper);
      document.getElementById('currentPaper').textContent = paperNameMap[currentPaperId];
      // 隐藏导入结果
      document.getElementById('importResult').style.display = 'none';
    });
  });

  // 文件上传处理
  const fileInput = document.getElementById('importFile');
  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    document.getElementById('fileInfo').textContent = `已选择文件：${file.name} (${(file.size/1024).toFixed(1)} KB)`;

    try {
      const res = await api.uploadFile(file);
      if (res.code === 0) {
        document.getElementById('importText').value = res.data.text;
        showToast('文件解析成功，请点击"导入题目"');
      } else {
        showToast(res.msg || '文件解析失败');
      }
    } catch (err) {
      showToast(err.message || '文件上传失败');
    }
  });

  // 导入题目
  document.getElementById('importBtn').addEventListener('click', async () => {
    const text = document.getElementById('importText').value.trim();
    if (!text) {
      showToast('请输入题目内容或上传文件');
      return;
    }

    try {
      const res = await api.importQuestions(text, `第${currentPaperId}套试卷`);
      if (res.code === 0) {
        // 显示导入结果
        const resultEl = document.getElementById('importResult');
        resultEl.style.display = 'block';
        resultEl.innerHTML = `
          <strong>导入成功！</strong><br>
          试卷：${paperNameMap[currentPaperId]}<br>
          题目数量：${res.data.questionCount} 题<br>
          试卷总分：${res.data.totalScore} 分
        `;
        document.getElementById('importText').value = '';
        document.getElementById('fileInfo').textContent = '';
        fileInput.value = '';
      } else {
        showToast(res.msg || '导入失败');
      }
    } catch (err) {
      showToast(err.message || '导入失败');
    }
  });

  // 加载成绩列表
  await loadRecords();

  // 全选/取消全选
  document.getElementById('selectAllBtn').addEventListener('click', () => {
    if (selectedRecords.size === records.length) {
      selectedRecords.clear();
    } else {
      records.forEach(r => selectedRecords.add(r.id));
    }
    updateSelectedCount();
    renderRecords();
  });

  // 导出选中
  document.getElementById('exportBtn').addEventListener('click', () => {
    if (selectedRecords.size === 0) {
      showToast('请先选择要导出的记录');
      return;
    }

    const selectedData = records.filter(r => selectedRecords.has(r.id));
    generatePrintPage(selectedData);
  });

  async function loadRecords() {
    try {
      const res = await api.getAllExamRecords();
      if (res.code === 0) {
        records = res.data;
        renderRecords();
      }
    } catch (err) {
      showToast('加载成绩列表失败');
    }
  }

  function renderRecords() {
    const container = document.getElementById('recordsList');
    if (records.length === 0) {
      container.innerHTML = '<p class="text-center" style="color:#999;padding:20px;">暂无考试记录</p>';
      return;
    }

    container.innerHTML = records.map(r => `
      <div class="record-item">
        <div class="record-info">
          <div class="record-name">${r.nickname || r.openid.substring(0, 10)}</div>
          <div class="record-meta">
            ${r.examTitle} · ${formatDateTime(r.submittedAt)} · 
            分数：<span style="color:${r.totalScore >= 60 ? '#07c160' : '#ff6b6b'}">${r.totalScore}</span>
          </div>
        </div>
        <div style="display:flex;align-items:center;">
          <input type="checkbox" class="record-checkbox" data-id="${r.id}" 
                 ${selectedRecords.has(r.id) ? 'checked' : ''}>
          <span class="selected-count"></span>
        </div>
      </div>
    `).join('');

    // 绑定复选框事件
    container.querySelectorAll('.record-checkbox').forEach(cb => {
      cb.addEventListener('change', (e) => {
        const id = parseInt(e.target.dataset.id);
        if (e.target.checked) {
          selectedRecords.add(id);
        } else {
          selectedRecords.delete(id);
        }
        updateSelectedCount();
      });
    });

    updateSelectedCount();
  }

  function updateSelectedCount() {
    document.getElementById('selectedCount').textContent = selectedRecords.size;
    const btn = document.getElementById('exportBtn');
    btn.disabled = selectedRecords.size === 0;
  }

  function formatDateTime(isoString) {
    const d = new Date(isoString);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  }

  function generatePrintPage(data) {
    const printContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>考试成绩导出</title>
  <style>
    body { font-family: sans-serif; padding: 20px; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
    th, td { border: 1px solid #ddd; padding: 10px; text-align: left; }
    th { background: #f5f5f5; }
    .pass { color: #07c160; }
    .fail { color: #ff6b6b; }
    @media print {
      body { padding: 0; }
    }
  </style>
</head>
<body>
  <h1>考试成绩导出</h1>
  <p>导出时间：${new Date().toLocaleString()}</p>
  <table>
    <thead>
      <tr>
        <th>序号</th>
        <th>姓名</th>
        <th>考试名称</th>
        <th>分数</th>
        <th>是否及格</th>
        <th>提交时间</th>
      </tr>
    </thead>
    <tbody>
      ${data.map((r, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>${r.nickname || r.openid.substring(0, 10)}</td>
          <td>${r.examTitle}</td>
          <td>${r.totalScore}</td>
          <td class="${r.isPassed ? 'pass' : 'fail'}">${r.isPassed ? '及格' : '不及格'}</td>
          <td>${formatDateTime(r.submittedAt)}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>
  <script>
    window.onload = () => {
      setTimeout(() => window.print(), 500);
    };
  </script>
</body>
</html>
    `;

    const printWindow = window.open('', '_blank');
    printWindow.document.write(printContent);
    printWindow.document.close();
  }
});

// 检查管理员权限
async function checkAuth() {
  try {
    const res = await api.getCurrentUser();
    return res;
  } catch (err) {
    return null;
  }
}
