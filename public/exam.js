// js/exam.js - 考试管理
const API_URL = window.location.origin + '/api';
let token = '';
let currentTab = 'papers';
let exams = [];
let papers = [];
let records = [];

document.addEventListener('DOMContentLoaded', () => {
    token = window.AdminSession && window.AdminSession.requireValid
        ? window.AdminSession.requireValid()
        : (localStorage.getItem('token') || localStorage.getItem('adminToken') || '');
    if (!token) {
        return;
    }
    loadData();
});

function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.toggle('active', content.id === tab + 'Tab');
    });
}

function renderExamList(stats) {
    const totalExams = stats.total_exams || 0;
    const passedExams = stats.passed_exams || 0;
    const avgScore = stats.avg_score || 0;

    document.getElementById('examList').innerHTML = `
        <div class="stats-row">
            <div class="card" style="text-align: center;">
                <div class="stat-value" style="color: var(--accent);">${exams.length}</div>
                <div class="stat-label">试卷数量</div>
            </div>
            <div class="card" style="text-align: center;">
                <div class="stat-value" style="color: var(--accent);">${totalExams}</div>
                <div class="stat-label">考试次数</div>
            </div>
            <div class="card" style="text-align: center;">
                <div class="stat-value" style="color: var(--success);">${passedExams}</div>
                <div class="stat-label">通过考试</div>
            </div>
            <div class="card" style="text-align: center;">
                <div class="stat-value" style="color: var(--warning);">${avgScore}</div>
                <div class="stat-label">平均分数</div>
            </div>
        </div>

        <div class="tab-bar">
            <button class="tab-btn active" data-tab="papers" onclick="switchTab('papers')">试卷列表</button>
            <button class="tab-btn" data-tab="records" onclick="switchTab('records')">考试记录</button>
            <button class="tab-btn" data-tab="questions" onclick="switchTab('questions')">题库管理</button>
        </div>

        <div id="papersTab" class="tab-content active">
            ${exams.length === 0 ? '<div class="empty-state">暂无试卷</div>' : ''}
            <div class="card-grid">
                ${exams.map(exam => `
                    <div class="card" style="padding: 16px;">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px;">
                            <div class="card-title" style="margin: 0;">${exam.title || '未命名试卷'}</div>
                            <span class="badge ${exam.status === 'active' ? 'badge-success' : 'badge-danger'}">
                                ${exam.status === 'active' ? '启用' : '禁用'}
                            </span>
                        </div>
                        <p class="card-desc">${exam.description || '暂无描述'}</p>
                        <div class="card-meta">
                            <span>题目: ${exam.question_count || 0} 题</span>
                            <span>时长: ${exam.duration || 60} 分钟</span>
                        </div>
                        <button class="btn btn-primary btn-sm" onclick="openExamDetail('${exam.id}')" style="margin-top: 12px; width: 100%;">查看详情</button>
                    </div>
                `).join('')}
            </div>
        </div>

        <div id="recordsTab" class="tab-content">
            <div class="card">
                <div class="card-title">我的考试记录</div>
                <div class="table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>试卷名称</th>
                                <th>得分</th>
                                <th>是否通过</th>
                                <th>考试时间</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${(stats.records || []).map(r => `
                                <tr>
                                    <td>${r.title || '-'}</td>
                                    <td>${r.score != null ? r.score : '-'}</td>
                                    <td><span class="badge ${r.is_passed ? 'badge-success' : 'badge-danger'}">${r.is_passed ? '通过' : '未通过'}</span></td>
                                    <td>${r.created_at ? new Date(r.created_at).toLocaleString('zh-CN') : '-'}</td>
                                </tr>
                            `).join('') || '<tr><td colspan="4" style="text-align: center; color: var(--text-secondary);">暂无考试记录</td></tr>'}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>

        <div id="questionsTab" class="tab-content">
            <div class="card">
                <div class="card-title" style="display:flex;justify-content:space-between;align-items:center;">
                    <span>题库题目 (${papers.length}题)</span>
                    <button class="btn btn-primary btn-sm" onclick="showQuestionImport()">📥 导入题目</button>
                </div>
                ${papers.length === 0 ? '<div class="empty-state">题库暂无题目</div>' : ''}
                <div class="table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>题目内容</th>
                                <th>类型</th>
                                <th>分值</th>
                                <th>答案</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${papers.map(q => `
                                <tr>
                                    <td style="text-align: left; max-width: 300px; overflow: hidden; text-overflow: ellipsis;">${q.question_text || q.content || '-'}</td>
                                    <td>${getQuestionTypeName(q.type)}</td>
                                    <td>${q.score || 10}</td>
                                    <td>${q.answer || '-'}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>

        <!-- 题库导入弹窗 -->
        <div class="modal" id="questionImportModal" style="display:none;position:fixed;z-index:1000;left:0;top:0;width:100%;height:100%;background:rgba(0,0,0,0.5);align-items:center;justify-content:center;">
            <div class="modal-box" style="background:var(--bg-card);border-radius:var(--radius-lg);padding:24px;width:90%;max-width:800px;max-height:90vh;overflow-y:auto;">
                <div class="modal-title" style="font-size:18px;font-weight:700;margin-bottom:16px;">📥 导入题目</div>

                <div class="form-group">
                    <label style="font-weight:600;margin-bottom:8px;display:block;">方式一：粘贴题目文本</label>
                    <textarea id="importText" class="import-area" style="width:100%;height:200px;border:1px solid var(--border);border-radius:var(--radius);padding:12px;font-size:14px;resize:vertical;background:var(--bg-input);color:var(--text-primary);" placeholder="请粘贴题目文本，每题格式：
1. 题目内容
A. 选项A
B. 选项B
C. 选项C
D. 选项D
答案：A

支持直接粘贴 Word 或记事本中的题目"></textarea>
                </div>

                <div class="form-group">
                    <label style="font-weight:600;margin-bottom:8px;display:block;">方式二：上传文件（支持 docx/txt/doc）</label>
                    <input type="file" id="importFile" accept=".docx,.txt,.doc" style="margin-bottom:8px;">
                    <div id="fileInfo" style="font-size:12px;color:var(--text-secondary);margin-top:5px;"></div>
                </div>

                <div class="form-group">
                    <label style="font-weight:600;margin-bottom:8px;display:block;">选择试卷</label>
                    <select id="importPaperId" class="form-control" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg-input);color:var(--text-primary);">
                        ${exams.map(e => `<option value="${e.id}">${e.title || '试卷 ' + e.id}</option>`).join('')}
                    </select>
                </div>

                <div style="display:flex;gap:10px;margin-top:16px;">
                    <button class="btn btn-secondary btn-sm" onclick="previewQuestions()">🔍 预览</button>
                    <button class="btn btn-primary btn-sm" onclick="importQuestions()">✅ 导入</button>
                    <button class="btn btn-secondary btn-sm" onclick="closeQuestionImport()">取消</button>
                </div>

                <div id="previewSection" style="display:none;margin-top:16px;">
                    <h4 style="margin-bottom:10px;">📋 预览（共 <span id="previewCount">0</span> 题）</h4>
                    <div id="previewList" style="max-height:300px;overflow-y:auto;border:1px solid var(--border);border-radius:var(--radius);padding:10px;background:var(--bg-surface);"></div>
                </div>

                <div id="importResult" class="import-result" style="display:none;margin-top:16px;padding:12px;border-radius:var(--radius);"></div>
            </div>
        </div>

        <style>
            .import-result.success { background: rgba(34, 197, 94, 0.1); color: #22c55e; }
            .import-result.error { background: rgba(239, 68, 68, 0.1); color: #ef4444; }
        </style>
    `;
}

function openExamDetail(examId) {
    window.location.href = `exam-doing.html?examId=${examId}`;
}

function getQuestionTypeName(type) {
    const typeMap = {
        'single_choice': '单选题',
        'multiple_choice': '多选题',
        'true_false': '判断题',
        'fill_blank': '填空题',
        'essay': '简答题'
    };
    return typeMap[type] || type || '选择题';
}

function showQuestionImport() {
    // 初始化试卷下拉框
    const select = document.getElementById('importPaperId');
    if (select && exams.length > 0) {
        select.innerHTML = exams.map(e => `<option value="${e.id}">${e.title || '试卷 ' + e.id}</option>`).join('');
    }
    document.getElementById('questionImportModal').style.display = 'flex';
    document.getElementById('importText').value = '';
    document.getElementById('importFile').value = '';
    document.getElementById('fileInfo').textContent = '';
    document.getElementById('previewSection').style.display = 'none';
    document.getElementById('importResult').style.display = 'none';
}

function closeQuestionImport() {
    document.getElementById('questionImportModal').style.display = 'none';
}

// 文件上传处理
document.getElementById('importFile')?.addEventListener('change', async function(e) {
    const file = e.target.files[0];
    if (!file) return;

    document.getElementById('fileInfo').textContent = `已选择：${file.name} (${(file.size/1024).toFixed(1)} KB)`;

    try {
        const res = await parseFileAPI(file);
        if (res.code === 0) {
            document.getElementById('importText').value = res.data.text;
            alert('文件解析成功');
        } else {
            alert(res.msg || '解析失败');
        }
    } catch (err) {
        alert('上传失败');
    }
});

async function parseFileAPI(file) {
    return new Promise((resolve, reject) => {
        const formData = new FormData();
        formData.append('file', file);

        fetch(`${API_URL}/import/parse-file`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData
        })
        .then(res => res.json())
        .then(data => resolve(data))
        .catch(err => reject(err));
    });
}

async function parseTextAPI(text) {
    const res = await fetch(`${API_URL}/import/parse-text`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
    });
    return res.json();
}

async function previewQuestions() {
    const text = document.getElementById('importText').value.trim();
    if (!text) {
        alert('请输入或粘贴题目内容');
        return;
    }

    try {
        const res = await parseTextAPI(text);
        if (res.code === 0) {
            const questions = res.data.questions;
            document.getElementById('previewCount').textContent = questions.length;

            const previewList = document.getElementById('previewList');
            if (questions.length === 0) {
                previewList.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-secondary);">未识别到题目</div>';
            } else {
                previewList.innerHTML = questions.map((q, idx) => `
                    <div style="padding:12px;border-bottom:1px solid var(--border);">
                        <div style="font-weight:600;margin-bottom:8px;">
                            <span style="background:var(--accent);color:white;padding:2px 8px;border-radius:10px;font-size:11px;margin-right:8px;">${getQuestionTypeName(q.type)}</span>
                            <span style="color:var(--text-secondary);font-size:12px;">${q.score}分</span>
                            <strong>${idx + 1}.</strong> ${escapeHtml(q.content)}
                        </div>
                        ${q.options && q.options.length > 0 ? `
                            <div style="padding-left:20px;margin:8px 0;">
                                ${q.options.map((opt, i) => `<div style="margin:4px 0;">${String.fromCharCode(65 + i)}. ${escapeHtml(opt)}</div>`).join('')}
                            </div>
                        ` : ''}
                        ${q.answer ? `<div style="background:rgba(34,197,94,0.15);color:#22c55e;padding:8px;border-radius:var(--radius);font-weight:600;">✓ 答案：${escapeHtml(q.answer)}</div>` : ''}
                    </div>
                `).join('');
            }

            document.getElementById('previewSection').style.display = 'block';
        } else {
            alert(res.msg || '预览失败');
        }
    } catch (err) {
        alert('预览失败');
    }
}

async function importQuestions() {
    const text = document.getElementById('importText').value.trim();
    const paperId = document.getElementById('importPaperId').value;

    if (!text) {
        alert('请输入或粘贴题目内容');
        return;
    }

    if (!paperId) {
        alert('请选择试卷');
        return;
    }

    try {
        const res = await importQuestionsAPI(text, paperId);
        const resultEl = document.getElementById('importResult');

        if (res.code === 0) {
            resultEl.className = 'import-result success';
            resultEl.textContent = `导入成功！共 ${res.data.questionCount} 题`;
            resultEl.style.display = 'block';

            // 刷新页面数据
            setTimeout(() => {
                closeQuestionImport();
                loadData();
            }, 1500);
        } else {
            resultEl.className = 'import-result error';
            resultEl.textContent = res.msg || '导入失败';
            resultEl.style.display = 'block';
        }
    } catch (err) {
        alert('导入失败');
    }
}

async function importQuestionsAPI(text, paperId) {
    const res = await fetch(`${API_URL}/import/upload`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, paperId })
    });
    return res.json();
}

// 解析文件并返回文本
async function parseFileAPI(file) {
    return new Promise((resolve, reject) => {
        const formData = new FormData();
        formData.append('file', file);

        fetch(`${API_URL}/import/parse-file`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData
        })
        .then(res => res.json())
        .then(data => resolve(data))
        .catch(err => reject(err));
    });
}

// 解析文本并返回题目
async function parseTextAPI(text) {
    const res = await fetch(`${API_URL}/import/parse-text`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
    });
    return res.json();
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
