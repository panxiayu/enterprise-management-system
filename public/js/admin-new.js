// js/admin-new.js - 管理后台（简化版）

console.log('admin-new.js loaded');

function showToast(message, duration = 2000) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), duration);
}

async function initAdmin() {
  console.log('initAdmin start');
  
  // 1. 检查权限
  try {
    const userRes = await api.getCurrentUser();
    if (!userRes || userRes.data.role !== 'admin') {
      showToast('需要管理员权限');
      setTimeout(() => window.location.href = '/admin/login.html', 1500);
      return;
    }
    console.log('auth ok');
  } catch (err) {
    console.error('auth failed:', err);
    showToast('认证失败，请重新登录');
    return;
  }

  // 2. 确保容器存在
  const container = document.getElementById('mainContent');
  if (!container) {
    console.error('mainContent not found');
    document.body.innerHTML = '<div style="padding:20px;color:red;">错误：页面结构不完整，请刷新重试</div>';
    return;
  }
  console.log('container found');

  // 3. 加载数据
  let banks = [];
  try {
    const res = await api.getQuestionBanks();
    console.log('getQuestionBanks response:', res);
    if (res.code === 0) {
      banks = res.data || [];
    } else {
      throw new Error(res.msg || '获取题库列表失败');
    }
  } catch (err) {
    console.error('load banks error:', err);
    showToast('加载题库失败，请刷新重试');
    return;
  }
  console.log('banks:', banks);

  // 4. 渲染题库列表
  try {
    renderPapers(container, banks);
    console.log('renderPapers success');
  } catch (err) {
    console.error('render error:', err);
    container.innerHTML = `<div style="padding:20px;color:red;">渲染失败：${err.message}</div>`;
  }

  // 5. 绑定事件
  setupEvents(container, banks);
}

function renderPapers(container, banks) {
  if (banks.length === 0) {
    container.innerHTML = `
      <div class="section">
        <div class="text-center" style="padding:40px;color:#999;">
          暂无题库，请先导入题目
        </div>
      </div>
    `;
    return;
  }

  const html = `
    <div class="section">
      <h2 class="section-title">📚 题库管理</h2>

      <div style="margin-bottom: 20px;">
        <button id="showImportBtn" class="btn btn-primary btn-small">导入新题库</button>
      </div>

      <div class="paper-list" id="paperList">
        ${banks.map(b => `
          <div class="paper-card" data-paper-id="${b.id}">
            <div class="paper-card-header">
              <h3>${b.title || `题库 ${b.id}`}</h3>
              <span class="paper-status ${b.is_active ? 'active' : 'inactive'}">
                ${b.is_active ? '已启用' : '未启用'}
              </span>
            </div>
            <div class="paper-card-body">
              <div class="paper-stat">
                <span class="stat-label">题目数量</span>
                <span class="stat-value">${b.question_count || 0} 题</span>
              </div>
              <div class="paper-stat">
                <span class="stat-label">总分</span>
                <span class="stat-value">${b.total_score || 0} 分</span>
              </div>
              <div class="paper-stat">
                <span class="stat-label">创建时间</span>
                <span class="stat-value">${formatDate(b.created_at)}</span>
              </div>
            </div>
            <div class="paper-card-actions">
              <button class="btn btn-danger btn-small delete-bank-btn" data-paper-id="${b.id}">
                删除
              </button>
            </div>
          </div>
        `).join('')}
      </div>
    </div>

    <div class="section" id="importSection" style="display:none;">
      <h2 class="section-title">📥 导入题库</h2>

      <div style="margin-bottom: 20px;">
        <label style="font-weight:600;margin-bottom:8px;display:block;">方式一：粘贴题目文本</label>
        <textarea id="importText" class="import-area" placeholder="请粘贴题目文本，每题格式：
1. 题目内容
A. 选项A
B. 选项B
C. 选项C
D. 选项D
答案：A

支持直接粘贴 Word 或记事本中的题目"></textarea>
      </div>

      <div style="margin-bottom: 20px;">
        <label style="font-weight:600;margin-bottom:8px;display:block;">方式二：上传文件（支持 docx/txt/doc）</label>
        <input type="file" id="importFile" accept=".docx,.txt,.doc" style="margin-bottom:8px;">
        <div id="fileInfo" style="font-size:12px;color:#999;margin-top:5px;"></div>
      </div>

      <div style="margin:15px 0;">
        <label style="font-weight:600;margin-bottom:8px;display:block;">题库标题</label>
        <input type="text" id="paperTitle" class="form-control" placeholder="例如：第三套题库">
      </div>

      <div style="display:flex;gap:10px;margin-bottom:15px;">
        <button id="previewBtn" class="btn btn-secondary btn-small">🔍 预览题目</button>
        <button id="importBtn" class="btn btn-primary btn-small">✅ 导入题目</button>
        <button id="cancelImportBtn" class="btn btn-secondary btn-small">取消</button>
      </div>

      <div id="previewSection" style="display:none;margin-top:15px;">
        <h4 style="margin-bottom:10px;">📋 预览（共 <span id="previewCount">0</span> 题）</h4>
        <div id="previewList" style="max-height:400px;overflow-y:auto;border:1px solid var(--border);border-radius:var(--radius);padding:10px;background:var(--bg-primary);"></div>
      </div>

      <div id="importResult" class="alert alert-info" style="display:none;margin-top:15px;"></div>
    </div>

    <style>
      .preview-item { padding: 12px; border-bottom: 1px solid var(--border); }
      .preview-item:last-child { border-bottom: none; }
      .preview-item .q-content { font-weight: 600; margin-bottom: 8px; }
      .preview-item .q-type { display: inline-block; padding: 2px 8px; background: var(--accent); color: white; border-radius: 10px; font-size: 11px; margin-right: 8px; }
      .preview-item .q-score { color: var(--text-secondary); font-size: 12px; }
      .preview-item .q-options { margin: 8px 0; padding-left: 20px; }
      .preview-item .q-option { margin: 4px 0; }
      .preview-item .q-answer { margin-top: 8px; padding: 8px; background: rgba(38,166,65,0.15); border-radius: var(--radius); color: var(--success); font-weight: 600; }
      .preview-empty { text-align: center; padding: 40px; color: var(--text-secondary); }
    </style>
  `;

  container.innerHTML = html;
}

function setupEvents(container, banks) {
  // 显示导入区域
  const showImportBtn = container.querySelector('#showImportBtn');
  const importSection = container.querySelector('#importSection');

  if (showImportBtn && importSection) {
    showImportBtn.addEventListener('click', () => {
      importSection.style.display = 'block';
      showImportBtn.style.display = 'none';
    });
  }

  // 取消导入
  const cancelImportBtn = container.querySelector('#cancelImportBtn');
  if (cancelImportBtn && showImportBtn && importSection) {
    cancelImportBtn.addEventListener('click', () => {
      importSection.style.display = 'none';
      showImportBtn.style.display = 'block';
    });
  }

  // 删除题库
  container.querySelectorAll('.delete-bank-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const bankId = e.target.dataset.paperId;
      if (!confirm('确定要删除此题库吗？')) return;
      try {
        const res = await api.deleteQuestionBank(bankId);
        if (res.code === 0) {
          showToast('删除成功');
          initAdmin();
        } else {
          showToast(res.msg || '删除失败');
        }
      } catch (err) {
        showToast(err.message || '删除失败');
      }
    });
  });

  // 文件上传
  setupFileUpload(container);

  // 预览题目
  setupPreview(container);

  // 导入题目
  setupImport(container, banks);
}

function setupFileUpload(container) {
  const fileInput = container.querySelector('#importFile');
  if (!fileInput) return;

  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const fileInfo = container.querySelector('#fileInfo');
    fileInfo.textContent = `已选择：${file.name} (${(file.size/1024).toFixed(1)} KB)`;

    // 上传并解析文件
    try {
      const res = await api.parseFile(file);
      if (res.code === 0) {
        container.querySelector('#importText').value = res.data.text;
        showToast('文件解析成功');
      } else {
        showToast(res.msg || '解析失败');
      }
    } catch (err) {
      showToast(err.message || '上传失败');
    }
  });
}

function setupPreview(container) {
  const previewBtn = container.querySelector('#previewBtn');
  if (!previewBtn) return;

  previewBtn.addEventListener('click', async () => {
    const text = container.querySelector('#importText').value.trim();
    if (!text) {
      showToast('请输入或粘贴题目内容');
      return;
    }

    try {
      const res = await api.parseText(text);
      if (res.code === 0) {
        const questions = res.data.questions;
        const previewSection = container.querySelector('#previewSection');
        const previewList = container.querySelector('#previewList');
        const previewCount = container.querySelector('#previewCount');

        previewCount.textContent = questions.length;

        if (questions.length === 0) {
          previewList.innerHTML = '<div class="preview-empty">未识别到题目，请检查格式</div>';
        } else {
          previewList.innerHTML = questions.map((q, idx) => `
            <div class="preview-item">
              <div class="q-content">
                <span class="q-type">${getTypeName(q.type)}</span>
                <span class="q-score">${q.score}分</span>
                <strong>${idx + 1}.</strong> ${escapeHtml(q.content)}
              </div>
              ${q.options && q.options.length > 0 ? `
                <div class="q-options">
                  ${q.options.map((opt, i) => `<div class="q-option">${String.fromCharCode(65 + i)}. ${escapeHtml(opt)}</div>`).join('')}
                </div>
              ` : ''}
              ${q.answer ? `<div class="q-answer">✓ 答案：${escapeHtml(q.answer)}</div>` : ''}
            </div>
          `).join('');
        }

        previewSection.style.display = 'block';
      } else {
        showToast(res.msg || '预览失败');
      }
    } catch (err) {
      showToast(err.message || '预览失败');
    }
  });
}

function getTypeName(type) {
  const typeMap = {
    'single_choice': '单选题',
    'multiple_choice': '多选题',
    'true_false': '判断题',
    'fill_blank': '填空题',
    'essay': '简答题'
  };
  return typeMap[type] || type || '选择题';
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function setupImport(container, papers) {
  const importBtn = container.querySelector('#importBtn');
  if (!importBtn) return;

  importBtn.addEventListener('click', async () => {
    const text = container.querySelector('#importText').value.trim();
    const title = container.querySelector('#paperTitle').value.trim() || `第${papers.length + 1}套试卷`;
    
    if (!text) {
      showToast('请输入题目内容');
      return;
    }

    try {
      const res = await api.importQuestions(text, title);
      if (res.code === 0) {
        const resultEl = container.querySelector('#importResult');
        resultEl.style.display = 'block';
        resultEl.innerHTML = `
          <strong>导入成功！</strong><br>
          试卷：${title}<br>
          题目：${res.data.questionCount} 题<br>
          总分：${res.data.totalScore} 分
        `;
        container.querySelector('#importText').value = '';
        container.querySelector('#fileInfo').textContent = '';
        container.querySelector('#importFile').value = '';
        container.querySelector('#paperTitle').value = '';

        // 刷新列表
        const newRes = await api.getQuestionBanks();
        if (newRes.code === 0) {
          renderPapers(container, newRes.data);
          setupEvents(container, newRes.data);
        }
      } else {
        showToast(res.msg || '导入失败');
      }
    } catch (err) {
      showToast(err.message || '导入失败');
    }
  });
}

// 答题详情功能已移除 - 题库管理不再包含此功能
async function viewPaperDetail(paperId) {
  showToast('答题详情功能已移至培训管理');
}

function renderPaperDetail(container, data) {
  // 已移除
}

function generateDetailPrintPage(data) {
  // 已移除
}

function formatDate(isoString) {
  if (!isoString) return '-';
  const d = new Date(isoString);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// 启动
initAdmin().catch(err => {
  console.error('initAdmin failed:', err);
  document.body.innerHTML = `<div style="padding:20px;color:red;">初始化失败：${err.message}</div>`;
});
