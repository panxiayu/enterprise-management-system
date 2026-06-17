// js/exam.js - 考试管理
const API_URL = window.location.origin + '/api';
let token = '';
let currentTab = 'records';
let exams = [];
let papers = [];
let records = [];
let trainingTasks = [];
let myTrainingRecords = [];
let questionBanks = []; // 题库数据（来自 exam_banks 表）
let currentImportExamId = null;
let pendingExamForm = null; // 保存新建培训表单状态，用于从创建资料/题库返回后恢复
let pendingQuestionData = null; // 保存待导入的题库数据（file或text）
let pendingQuestionFile = null; // 保存待导入的文件

function matchPinyinSubstring(initials, search) {
    if (!search) return true;
    search = search.toLowerCase();
    if (initials.includes(search)) return true;
    // Check if search chars appear in order within initials
    let searchIdx = 0;
    for (const c of initials) {
        if (searchIdx < search.length && c === search[searchIdx]) {
            searchIdx++;
        }
    }
    return searchIdx === search.length;
}

function matchName(searchText, staff) {
    if (!searchText) return true;
    const n = staff.name;
    if (n.toLowerCase().includes(searchText.toLowerCase())) return true;
    return matchPinyinSubstring(staff._pinyinInitials, searchText);
}

document.addEventListener('DOMContentLoaded', () => {
    token = window.AdminSession && window.AdminSession.requireValid
        ? window.AdminSession.requireValid()
        : (localStorage.getItem('token') || localStorage.getItem('adminToken') || '');
    if (!token) {
        return;
    }
    // 权限检查
    const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
    if (!currentUser.can_manage_training) { alert('无权限访问培训管理'); window.location.href = 'dashboard.html'; return; }
    loadData();

    // 培训记录卡片悬停效果
    const style = document.createElement('style');
    style.textContent = `.training-record-card:hover{transform:translateY(-4px);box-shadow:0 12px 32px rgba(74,144,226,0.12);border-color:#D6E4FF;}`;
    document.head.appendChild(style);
});

// 打印状态管理
function getPrintedRecords() {
    try {
        return JSON.parse(localStorage.getItem('printed_exam_records') || '{}');
    } catch { return {}; }
}

function isRecordPrinted(recordId) {
    const printed = getPrintedRecords();
    return !!printed[recordId];
}

function markRecordsPrinted(recordIds) {
    const printed = getPrintedRecords();
    recordIds.forEach(id => { printed[id] = true; });
    localStorage.setItem('printed_exam_records', JSON.stringify(printed));
}

function clearPrintedRecords() {
    localStorage.removeItem('printed_exam_records');
}

// 批量打印页面回调：标记一批记录为已打印
function markBatchPrinted(recordIds) {
    if (!recordIds || recordIds.length === 0) return;
    markRecordsPrinted(recordIds);
    // 刷新当前显示的人员列表，更新按钮状态
    renderTrainingParticipants();
}

// 上传文件带进度条
function uploadWithProgress(url, file, authToken) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const progressContainer = document.getElementById('uploadProgressContainer');
        const progressBar = document.getElementById('uploadProgressBar');
        const progressPercent = document.getElementById('uploadProgressPercent');
        const uploadStatus = document.getElementById('uploadStatus');

        xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
                const percent = Math.round((e.loaded / e.total) * 100);
                progressBar.style.width = percent + '%';
                progressPercent.textContent = percent;
                progressContainer.style.display = 'block';
                if (uploadStatus) {
                    uploadStatus.textContent = '上传中 ' + percent + '%';
                    uploadStatus.style.display = 'block';
                }
            }
        });

        xhr.addEventListener('load', () => {
            progressContainer.style.display = 'none';
            progressBar.style.width = '0%';
            progressPercent.textContent = '0';
            if (uploadStatus) {
                uploadStatus.style.display = 'none';
            }
            try {
                const response = JSON.parse(xhr.responseText);
                // 如果返回转码相关信息，显示提示
                if (response.msg && response.msg.includes('转码')) {
                    console.log('视频转码信息:', response.msg);
                }
                resolve(response);
            } catch (e) {
                reject(new Error('解析响应失败'));
            }
        });

        xhr.addEventListener('error', () => {
            progressContainer.style.display = 'none';
            if (uploadStatus) {
                uploadStatus.style.display = 'none';
            }
            reject(new Error('上传失败'));
        });

        xhr.addEventListener('abort', () => {
            progressContainer.style.display = 'none';
            if (uploadStatus) {
                uploadStatus.style.display = 'none';
            }
            reject(new Error('上传取消'));
        });

        xhr.open('POST', url);
        xhr.setRequestHeader('Authorization', `Bearer ${authToken}`);
        const formData = new FormData();
        formData.append('file', file);
        xhr.send(formData);
    });
}

// 视频文件选择处理
document.getElementById('taskVideoFile')?.addEventListener('change', function(e) {
    const file = e.target.files[0];
    const fileInfo = document.getElementById('videoFileInfo');
    if (file) {
        const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
        fileInfo.textContent = `已选择：${file.name} (${sizeMB} MB)`;
        fileInfo.style.display = 'block';
    } else {
        fileInfo.style.display = 'none';
    }
});

function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.toggle('active', content.id === tab + 'Tab');
    });
    document.querySelector('.tab-bar').dataset.active = tab;
    // 控制按钮显示
    document.getElementById('btnsTraining').style.display = tab === 'training' ? '' : 'none';
    document.getElementById('btnsPapers').style.display = tab === 'papers' ? '' : 'none';
    document.getElementById('btnsQuestions').style.display = tab === 'questions' ? '' : 'none';
    // 切换到学习资料标签页时，渲染任务列表
    if (tab === 'training') {
        renderTrainingTasks();
    }
    // 切换到题库管理标签页时，重新渲染题库列表
    if (tab === 'questions') {
        renderQuestionBanks();
    }
}

function jumpToStep(stepNum) {
    if (stepNum < 1 || stepNum > 4) return;

    // 自动保存当前步骤内容（不验证）
    saveCurrentStep();

    // 如果是在新建表单外调用（如从标签页跳转），先显示表单
    const form = document.getElementById('createExamForm');
    if (form) form.style.display = 'block';

    // 设置当前步骤
    currentStep = stepNum;

    // 更新步骤指示器和表单内容
    updateStepUI();

    // 滚动到表单顶部，带滑动效果
    const formEl = document.getElementById('createExamForm');
    if (formEl) {
        formEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

function saveCurrentStep() {
    // 暂存当前步骤的内容到 localStorage，不验证
    const title = document.getElementById('examTitle')?.value || '';
    const description = document.getElementById('examDescription')?.value || '';
    const start_time = document.getElementById('examStartTime')?.value || '';
    const end_time = document.getElementById('examEndTime')?.value || '';
    const duration = document.getElementById('examDuration')?.value || '60';
    const pass_score = document.getElementById('examPassScore')?.value || '60';
    const learningTaskId = document.getElementById('examLearningTask')?.value || '';
    const questionBankId = document.getElementById('examQuestionBank')?.value || '';
    const permType = document.querySelector('input[name="permType"]:checked')?.value || 'all';

    localStorage.setItem('draftExam_title', title);
    localStorage.setItem('draftExam_description', description);
    localStorage.setItem('draftExam_start_time', start_time);
    localStorage.setItem('draftExam_end_time', end_time);
    localStorage.setItem('draftExam_duration', duration);
    localStorage.setItem('draftExam_pass_score', pass_score);
    localStorage.setItem('draftExam_learning_task_id', learningTaskId);
    localStorage.setItem('draftExam_question_bank_id', questionBankId);
    localStorage.setItem('draftExam_perm_type', permType);
}

function loadDraftExam(mode) {
    // mode: 'full' - 恢复所有字段（包括学习资料和题库）
    //      'basic' - 只恢复基本信息，不恢复学习资料和题库
    mode = mode || 'basic';

    // 从 localStorage 恢复暂存的内容
    const title = localStorage.getItem('draftExam_title');
    const description = localStorage.getItem('draftExam_description');
    const start_time = localStorage.getItem('draftExam_start_time');
    const end_time = localStorage.getItem('draftExam_end_time');
    const duration = localStorage.getItem('draftExam_duration');
    const pass_score = localStorage.getItem('draftExam_pass_score');
    const learningTaskId = localStorage.getItem('draftExam_learning_task_id');
    const questionBankId = localStorage.getItem('draftExam_question_bank_id');
    const permType = localStorage.getItem('draftExam_perm_type');

    if (title || description || start_time) {
        if (document.getElementById('examTitle')) document.getElementById('examTitle').value = title || '';
        if (document.getElementById('examDescription')) document.getElementById('examDescription').value = description || '';
        if (document.getElementById('examStartTime')) document.getElementById('examStartTime').value = start_time || '';
        if (document.getElementById('examEndTime')) document.getElementById('examEndTime').value = end_time || '';
        if (document.getElementById('examDuration')) document.getElementById('examDuration').value = duration || '60';
        if (document.getElementById('examPassScore')) document.getElementById('examPassScore').value = pass_score || '60';

        // 只有 mode='full' 时才恢复学习资料和题库
        if (mode === 'full') {
            if (document.getElementById('examLearningTask')) document.getElementById('examLearningTask').value = learningTaskId || '';
            if (document.getElementById('examQuestionBank')) document.getElementById('examQuestionBank').value = questionBankId || '';
        }

        if (permType === 'manual' && document.getElementById('radioManual')) {
            document.getElementById('radioManual').checked = true;
        }
    }
}

function clearDraftExam() {
    // 清除暂存的内容
    localStorage.removeItem('draftExam_title');
    localStorage.removeItem('draftExam_description');
    localStorage.removeItem('draftExam_start_time');
    localStorage.removeItem('draftExam_end_time');
    localStorage.removeItem('draftExam_duration');
    localStorage.removeItem('draftExam_pass_score');
    localStorage.removeItem('draftExam_learning_task_id');
    localStorage.removeItem('draftExam_question_bank_id');
    localStorage.removeItem('draftExam_perm_type');
}

function loadData() {
    document.getElementById('examList').innerHTML = '<div class="loading">加载中...</div>';

    if (!token) {
        document.getElementById('examList').innerHTML = '<div class="empty-state" style="padding:40px;text-align:center;color:var(--text-secondary);">请先登录</div>';
        return;
    }

    console.log('loadData started, token:', token ? 'exists' : 'missing');

    Promise.all([
        fetch(`${API_URL}/exam/list`, { headers: { 'Authorization': `Bearer ${token}` } }).then(r => {
            console.log('exam/list response:', r.status, r.statusText);
            if (!r.ok) throw new Error('exam/list failed: ' + r.status);
            return r.json();
        }).catch(err => {
            console.error('exam/list error:', err);
            return { code: -1, data: [] };
        }),
        fetch(`${API_URL}/exam/stats/user`, { headers: { 'Authorization': `Bearer ${token}` } }).then(r => {
            console.log('stats/user response:', r.status, r.statusText);
            if (!r.ok) throw new Error('stats/user failed: ' + r.status);
            return r.json();
        }).catch(err => {
            console.error('stats/user error:', err);
            return { code: -1, data: {} };
        }),
        fetch(`${API_URL}/exam-trainings`, { headers: { 'Authorization': `Bearer ${token}` } }).then(r => {
            console.log('exam-trainings response:', r.status, r.statusText);
            if (!r.ok) throw new Error('exam-trainings failed: ' + r.status);
            return r.json();
        }).catch(err => {
            console.error('exam-trainings error:', err);
            return { code: -1, data: [] };
        }),
        fetch(`${API_URL}/learning-materials`, { headers: { 'Authorization': `Bearer ${token}` } }).then(r => {
            console.log('learning-tasks response:', r.status, r.statusText);
            if (!r.ok) throw new Error('learning-tasks failed: ' + r.status);
            return r.json();
        }).catch(err => {
            console.error('learning-tasks error:', err);
            return { code: -1, data: [] };
        }),
        fetch(`${API_URL}/exam-trainings/records-summary`, { headers: { 'Authorization': `Bearer ${token}` } }).then(r => {
            console.log('exam-trainings/records-summary response:', r.status, r.statusText);
            if (!r.ok) throw new Error('exam-trainings/records-summary failed: ' + r.status);
            return r.json();
        }).catch(err => {
            console.error('exam-trainings/records-summary error:', err);
            return { code: -1, data: [] };
        }),
        fetch(`${API_URL}/question-banks`, { headers: { 'Authorization': `Bearer ${token}` } }).then(r => {
            console.log('question-banks response:', r.status, r.statusText);
            if (!r.ok) throw new Error('question-banks failed: ' + r.status);
            return r.json();
        }).catch(err => {
            console.error('question-banks error:', err);
            return { code: -1, data: [] };
        })
    ]).then(([examData, statsData, papersData, trainingData, myRecordsData, questionBanksData]) => {
        console.log('All responses received:', { examData, statsData, papersData, trainingData, myRecordsData, questionBanksData });
        console.log('trainingData.raw:', trainingData);
        exams = examData.data || [];
        papers = papersData.data || [];
        trainingTasks = trainingData.data || [];
        questionBanks = questionBanksData.data || [];
        console.log('loadData后trainingTasks:', trainingTasks.length, '条');
        console.log('DEBUG trainingTasks[0]:', JSON.stringify(trainingTasks[0], null, 2));
        console.log('loadData后questionBanks:', questionBanks.length, '条');
        myTrainingRecords = myRecordsData.data || [];
        const stats = statsData.data?.summary || {};
        renderExamList(stats);
        // 恢复当前标签页状态
        switchTab(currentTab);
        renderTrainingTasks();
        renderQuestionBanks();
    }).catch(err => {
        console.error('loadData error:', err);
        document.getElementById('examList').innerHTML = '<div class="empty-state" style="padding:40px;text-align:center;color:var(--text-secondary);">加载失败: ' + err.message + '</div>';
    });
}

function renderExamList(stats) {
    const totalExams = stats.total_exams || 0;
    const passedExams = stats.passed_exams || 0;
    const avgScore = stats.avg_score || 0;

    document.getElementById('examList').innerHTML = `
        <div class="tab-bar">
            <button class="tab-btn active" data-tab="records" onclick="switchTab('records')">培训记录</button>
            <button class="tab-btn" data-tab="papers" onclick="switchTab('papers')">培训任务</button>
            <button class="tab-btn" data-tab="training" onclick="switchTab('training')">学习资料</button>
            <button class="tab-btn" data-tab="questions" onclick="switchTab('questions')">题库管理</button>
        </div>

        <!-- 考试列表标签页 -->
        <div id="papersTab" class="tab-content ${currentTab === 'papers' ? 'active' : ''}">
            <!-- 新建培训表单 -->
            <div id="createExamForm" class="card" style="padding:24px;margin-bottom:24px;display:none;">
                <div style="font-size:18px;font-weight:700;margin-bottom:20px;" id="examFormTitle">新建培训</div>

                <!-- 步骤指示器 -->
                <div class="step-indicator">
                    <div class="step-item active" data-step="1" onclick="jumpToStep(1)">
                        <div class="step-num">1</div>
                        <div class="step-label">基本信息</div>
                    </div>
                    <div class="step-line"></div>
                    <div class="step-item" data-step="2" onclick="jumpToStep(2)">
                        <div class="step-num">2</div>
                        <div class="step-label">学习资料</div>
                    </div>
                    <div class="step-line"></div>
                    <div class="step-item" data-step="3" onclick="jumpToStep(3)">
                        <div class="step-num">3</div>
                        <div class="step-label">题库试卷</div>
                    </div>
                    <div class="step-line"></div>
                    <div class="step-item" data-step="4" onclick="jumpToStep(4)">
                        <div class="step-num">4</div>
                        <div class="step-label">分配权限</div>
                    </div>
                </div>

                <!-- 步骤1：基本信息 -->
                <div id="step1" class="step-content">
                    <div class="form-group">
                        <label style="font-weight:600;margin-bottom:8px;display:block;">培训标题 *</label>
                        <input type="text" id="examTitle" class="form-control" style="width:100%;padding:12px;border:1.5px solid var(--border);border-radius:14px;background:var(--bg);color:var(--text);font-size:14px;" placeholder="请输入培训标题" value="">
                    </div>

                    <div class="form-group">
                        <label style="font-weight:600;margin-bottom:8px;display:block;">培训描述</label>
                        <textarea id="examDescription" class="form-control" style="width:100%;padding:12px;border:1.5px solid var(--border);border-radius:14px;background:var(--bg);color:var(--text);resize:vertical;min-height:80px;font-size:14px;" placeholder="请输入培训描述（可选）"></textarea>
                    </div>

                    <div style="display:flex;gap:16px;">
                        <div class="form-group" style="flex:1;">
                            <label style="font-weight:600;margin-bottom:8px;display:block;">培训开始时间 *</label>
                            <input type="datetime-local" id="examStartTime" class="form-control" style="width:100%;padding:12px;border:1.5px solid var(--border);border-radius:14px;background:var(--bg);color:var(--text);font-size:14px;" value="">
                        </div>
                        <div class="form-group" style="flex:1;">
                            <label style="font-weight:600;margin-bottom:8px;display:block;">培训结束时间 *</label>
                            <input type="datetime-local" id="examEndTime" class="form-control" style="width:100%;padding:12px;border:1.5px solid var(--border);border-radius:14px;background:var(--bg);color:var(--text);font-size:14px;" value="">
                        </div>
                    </div>

                    <div style="display:flex;gap:16px;">
                        <div class="form-group" style="flex:1;">
                            <label style="font-weight:600;margin-bottom:8px;display:block;">考试时长（分钟）*</label>
                            <input type="number" id="examDuration" class="form-control" style="width:100%;padding:12px;border:1.5px solid var(--border);border-radius:14px;background:var(--bg);color:var(--text);font-size:14px;" value="60" min="1">
                        </div>
                        <div class="form-group" style="flex:1;">
                            <label style="font-weight:600;margin-bottom:8px;display:block;">及格分数 *</label>
                            <input type="number" id="examPassScore" class="form-control" style="width:100%;padding:12px;border:1.5px solid var(--border);border-radius:14px;background:var(--bg);color:var(--text);font-size:14px;" value="60" min="1" max="100">
                        </div>
                    </div>
                </div>

                <!-- 步骤2：关联学习资料 -->
                <div id="step2" class="step-content" style="display:none;">
                    <div class="form-group">
                        <label style="font-weight:600;margin-bottom:8px;display:block;">关联学习资料 *</label>
                        <select id="examLearningTask" class="form-control" style="width:100%;padding:12px 16px;border:1.5px solid var(--border);border-radius:14px;background:var(--bg);color:var(--text);font-size:14px;" onchange="onLearningTaskChangeInline(this.value)">
                            <option value="">请选择学习资料</option>
                            ${(Array.isArray(trainingTasks) ? trainingTasks : []).map(t => `<option value="${t.id}">${t.title || '资料 ' + t.id}</option>`).join('') || '<option value="">暂无学习资料</option>'}
                            <option value="__new__">+ 创建新资料</option>
                        </select>
                    </div>
                    <div id="selectedLearningTask" style="margin-top:12px;padding:12px;background:rgba(74,144,226,0.08);border-radius:12px;display:none;">
                        <div style="font-size:13px;color:var(--text-soft);">已选择：<span id="selectedLearningTaskName" style="font-weight:600;color:var(--text);"></span></div>
                    </div>
                </div>

                <!-- 步骤3：关联题库 -->
                <div id="step3" class="step-content" style="display:none;">
                    <div class="form-group">
                        <label style="font-weight:600;margin-bottom:8px;display:block;">关联题库试卷 *</label>
                        <select id="examQuestionBank" class="form-control" style="width:100%;padding:12px 16px;border:1.5px solid var(--border);border-radius:14px;background:var(--bg);color:var(--text);font-size:14px;" onchange="onQuestionBankChangeInline(this.value)">
                            <option value="">请选择题库</option>
                            ${questionBanks.map(b => `<option value="${b.id}">${b.title || '题库 ' + b.id} (${b.question_count || 0}题)</option>`).join('') || '<option value="">暂无题库题目</option>'}
                            <option value="__new__">+ 创建新题库</option>
                        </select>
                    </div>
                    <div id="selectedQuestionBank" style="margin-top:12px;padding:12px;background:rgba(74,144,226,0.08);border-radius:12px;display:none;">
                        <div style="font-size:13px;color:var(--text-soft);">已选择：<span id="selectedQuestionBankName" style="font-weight:600;color:var(--text);"></span></div>
                    </div>
                </div>

                <!-- 步骤4：分配权限 -->
                <div id="step4" class="step-content" style="display:none;">
                    <div class="form-group">
                        <label style="font-weight:600;margin-bottom:12px;display:block;">授权方式</label>
                        <div style="display:flex;gap:12px;margin-bottom:16px;">
                            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:12px 20px;background:var(--bg);border:1.5px solid var(--border);border-radius:var(--radius);flex:1;transition:all 0.2s;" id="radioAllStaffLabel">
                                <input type="radio" name="permType" value="all" id="radioAllStaff" checked onchange="togglePermType()" onclick="togglePermType()" style="width:18px;height:18px;accent-color:var(--primary);">
                                <div>
                                    <div style="font-weight:600;font-size:14px;">全员授权</div>
                                    <div style="font-size:11px;color:var(--text-soft);margin-top:2px;">所有员工均可参加考试</div>
                                </div>
                            </label>
                            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:12px 20px;background:var(--bg);border:1.5px solid var(--border);border-radius:var(--radius);flex:1;transition:all 0.2s;" id="radioManualLabel">
                                <input type="radio" name="permType" value="manual" id="radioManual" onchange="togglePermType()" onclick="togglePermType()" style="width:18px;height:18px;accent-color:var(--primary);">
                                <div>
                                    <div style="font-weight:600;font-size:14px;">手动选择</div>
                                    <div style="font-size:11px;color:var(--text-soft);margin-top:2px;">指定员工参加考试</div>
                                </div>
                            </label>
                        </div>
                        <div id="manualPermSection" style="display:none;">
                            <div style="display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px;">
                                <input type="text" id="step4SearchName" style="padding:8px 10px;border:1px solid #E5F0FF;border-radius:8px;font-size:13px;outline:none;width:90px;" placeholder="姓名" oninput="applyStep4Filters()">
                                <input type="text" id="step4SearchEmpId" style="padding:8px 10px;border:1px solid #E5F0FF;border-radius:8px;font-size:13px;outline:none;width:80px;" placeholder="工号" oninput="applyStep4Filters()">
                                <select id="step4SearchStatus" style="padding:8px 10px;border:1px solid #E5F0FF;border-radius:8px;font-size:13px;outline:none;color:#5B72A9;background:#fff;" onchange="applyStep4Filters()">
                                    <option value="">全部状态</option>
                                    <option value="has">有权限</option>
                                    <option value="no">无权限</option>
                                </select>
                                <button class="btn btn-sm btn-secondary" onclick="selectAllStep4Staff()" style="padding:6px 12px;font-size:12px;">全部选中</button>
                                <button class="btn btn-sm btn-secondary" onclick="deselectAllStep4Staff()" style="padding:6px 12px;font-size:12px;">全部取消</button>
                                <div style="flex:1;"></div>
                                <span style="font-size:12px;color:#8B9DC3;">有培训权限人员 <span id="step4SelectedCount" style="font-weight:700;color:var(--primary);">0</span> 人</span>
                            </div>
                            <div id="step4DeptFilter" style="display:flex;flex-wrap:nowrap;gap:8px;margin-bottom:12px;overflow-x:auto;padding:0;background:#FFFFFF;border-radius:12px;"></div>
                            <div id="step4StaffList" style="height:50vh;overflow-y:auto;border-radius:12px;background:linear-gradient(135deg,#fff 0%,#F8FCFF 100%);padding:12px;">
                                <div style="text-align:center;padding:40px;color:var(--text-soft);">加载中...</div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 部门选择弹窗 -->
                <div class="modal" id="deptSelectModal">
                    <div class="modal-box" style="max-width:400px;">
                        <div class="modal-title">按部门选择</div>
                        <div id="deptCheckboxes" style="max-height:300px;overflow-y:auto;margin:16px 0;"></div>
                        <div class="modal-actions">
                            <button class="btn btn-secondary btn-sm" onclick="closeDeptSelectModal()">取消</button>
                            <button class="btn btn-primary btn-sm" onclick="confirmDeptSelect()">确认</button>
                        </div>
                    </div>
                </div>

                <!-- 按钮区域 -->
                <div style="display:flex;gap:10px;margin-top:24px;padding-top:20px;border-top:1px solid var(--border);">
                    <button class="btn btn-secondary btn-sm" id="prevStepBtn" onclick="prevStep()" style="display:none;">上一步</button>
                    <button class="btn btn-success btn-sm" id="draftSubmitBtn" onclick="draftExam()">暂存</button>
                    <button class="btn btn-primary btn-sm" id="nextStepBtn" onclick="console.log('NEXT button clicked, currentStep=', currentStep); nextStep()">下一步 →</button>
                    <button class="btn btn-success btn-sm" id="submitExamBtn" onclick="console.log('SUBMIT button clicked, currentStep=', currentStep); createExam()" style="display:none;">✓ 完成创建</button>
                    <button class="btn btn-secondary btn-sm" onclick="hideCreateExamForm()" style="margin-left:auto;">取消</button>
                </div>

                <div id="createExamResult" class="import-result" style="display:none;margin-top:16px;padding:12px;border-radius:14px;"></div>
            </div>

            <style>
                .step-indicator { display:flex;align-items:center;justify-content:space-between;margin-bottom:24px; }
                .step-item { display:flex;flex-direction:column;align-items:center;gap:6px;min-width:70px;cursor:pointer;transition:transform 0.2s; }
                .step-item:hover { transform: translateY(-2px); }
                .step-item:hover .step-num { background:var(--primary);color:#fff; }
                .step-item:hover .step-label { color:var(--primary);font-weight:600; }
                .step-item[data-step="1"] { cursor:default; }
                .step-item[data-step="1"]:hover { transform: none; }
                .step-item[data-step="1"]:hover .step-num { background:var(--border);color:var(--text-soft); }
                .step-item[data-step="1"]:hover .step-label { color:var(--text-soft);font-weight:normal; }
                .step-num { width:28px;height:28px;min-width:28px;border-radius:50%;background:var(--border);color:var(--text-soft);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600;position:relative;z-index:1;transition:all 0.2s; }
                .step-item.active .step-num { background:var(--primary);color:#fff; }
                .step-item.completed .step-num { background:var(--accent);color:#fff; }
                .step-label { font-size:12px;color:var(--text-soft);white-space:nowrap;text-align:center;transition:all 0.2s; }
                .step-item.active .step-label { color:var(--text);font-weight:600; }
                .step-line { flex:1;height:2px;background:var(--border);min-width:40px;margin-top:-18px;position:relative;z-index:0; }
                .step-content { animation:fadeIn 0.3s ease; }
                @keyframes fadeIn { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
            </style>

            <!-- 培训列表容器（新建培训时隐藏） -->
            <div id="papersListContainer">
            <!-- 草稿列表 -->
            ${papers.filter(t => t.is_draft === 1).length > 0 ? `
                <div style="margin-bottom:16px;">
                    <div style="font-size:14px;font-weight:600;color:var(--text-soft);margin-bottom:12px;">草稿</div>
                    <div class="card-grid">
                        ${papers.filter(t => t.is_draft === 1).map(exam => {
                            return `
                            <div class="card exam-card" style="padding: 16px; position: relative; border: 2px dashed var(--border);">
                                <div style="position: absolute; top: 12px; right: 12px; display: flex; gap: 6px; align-items: center;">
                                    <span style="font-size: 11px; padding: 3px 8px; background: #F59E0B; color: white; border-radius: 4px;">草稿</span>
                                </div>
                                <div class="card-title" style="margin: 0 0 8px 0; padding-right: 80px;">${exam.title || '未命名培训'}</div>
                                <p class="card-desc" style="margin-bottom: 10px;">${exam.description || '暂无描述'}</p>
                                <div class="card-meta" style="flex-wrap: wrap; gap: 8px;">
                                    <span>时长: ${exam.duration || 60}分钟</span>
                                    <span>及格: ${exam.pass_score || 60}分</span>
                                </div>
                                <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border); display: flex; gap: 6px; flex-wrap: nowrap; align-items: center;">
                                    <button class="btn btn-secondary btn-sm" onclick="openExamSettings(${exam.id})" style="flex: 1; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.15); font-weight: 600;">
                                        继续编辑
                                    </button>
                                    <button class="btn btn-danger btn-sm" onclick="deleteExam(${exam.id})" style="flex: 1; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.15); font-weight: 600;">
                                        删除
                                    </button>
                                </div>
                            </div>
                        `}).join('')}
                    </div>
                </div>
            ` : ''}

            <!-- 正式培训列表（只显示已分配权限的） -->
            ${papers.filter(t => t.is_draft !== 1 && t.perm_count > 0).length === 0 && papers.filter(t => t.is_draft === 1).length === 0 ? '<div class="empty-state" style="padding:40px;text-align:center;color:var(--text-secondary);">暂无培训任务</div>' : ''}
            ${papers.filter(t => t.is_draft !== 1 && t.perm_count > 0).length > 0 ? `
                <div class="card-grid">
                        ${papers.filter(t => t.is_draft !== 1 && t.perm_count > 0).map(exam => {
                            const isActive = exam.is_active === 1;
                            // 检查是否已过结束时间
                            const now = new Date();
                            const endTime = exam.end_time ? new Date(exam.end_time) : null;
                            const isExpired = endTime && now > endTime;
                            // 已过期的培训显示"已结束"状态，已停用显示红色
                            const displayStatus = isExpired ? '已结束' : (isActive ? '已启用' : '已停用');
                            let statusBg;
                            if (isExpired) {
                                statusBg = 'linear-gradient(135deg,#9E9E9E,#BDBDBD)';
                            } else if (isActive) {
                                statusBg = 'linear-gradient(135deg,#4CAF50,#66BB6A)';
                            } else {
                                statusBg = 'linear-gradient(135deg,#EF4444,#F87171)'; // 红色
                            }
                            return `
                            <div class="card exam-card" style="padding: 16px; position: relative;">
                                <div style="position: absolute; top: 12px; right: 12px; display: flex; gap: 6px; align-items: center;">
                                    <span style="display:inline-flex;align-items:center;gap:5px;padding:5px 14px;border-radius:20px;font-size:12px;font-weight:600;background:${statusBg};color:#fff;flex-shrink:0;">
                                        <span style="width:6px;height:6px;border-radius:50%;background:#fff;"></span>
                                        ${displayStatus}
                                    </span>
                                </div>
                                <div class="card-title" style="margin: 0 0 8px 0; padding-right: 80px;">${exam.title || '未命名考试'}</div>
                                <p class="card-desc" style="margin-bottom: 10px;">${exam.description || '暂无描述'}</p>
                                <div class="card-meta" style="flex-wrap: wrap; gap: 8px;">
                                    <span>时长: ${exam.duration || 60}分钟</span>
                                    <span>及格: ${exam.pass_score || 60}分</span>
                                    <span>题目: ${exam.question_count || 0} 题</span>
                                    <span>授权: ${exam.perm_count || 0} 人</span>
                                </div>
                                <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border); display: flex; gap: 6px; flex-wrap: nowrap; align-items: center;">
                                    <button class="btn btn-sm ${isExpired ? 'btn-secondary' : (isActive ? 'btn-danger' : 'btn-success')}" onclick="toggleExamStatus(${exam.id}, ${isActive ? 1 : 0}, ${exam.learning_task_id || 0})" style="flex: 1; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.15); font-weight: 600; ${isExpired ? 'opacity: 0.5; cursor: not-allowed;' : ''}" ${isExpired ? 'disabled' : ''}>
                                        ${isActive ? '停用' : '启用'}
                                    </button>
                                    <button class="btn btn-secondary btn-sm" onclick="previewPaper(${exam.id})" style="flex: 1; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.15); font-weight: 600;">
                                        预览
                                    </button>
                                    <button class="btn btn-secondary btn-sm" onclick="viewExamPermissions(${exam.id})" style="flex: 1; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.15); font-weight: 600;">
                                        人员
                                    </button>
                                    <button class="btn btn-secondary btn-sm" onclick="${isActive || isExpired ? '' : `openExamSettings(${exam.id})`}" style="flex: 1; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.15); font-weight: 600; opacity: ${isActive || isExpired ? 0.5 : 1}; cursor: ${isActive || isExpired ? 'not-allowed' : 'pointer'};">
                                        设置
                                    </button>
                                    <button class="btn btn-danger btn-sm" onclick="${isActive ? '' : `deleteExam(${exam.id})`}" style="flex: 1; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.15); font-weight: 600; opacity: ${isActive ? 0.5 : 1}; cursor: ${isActive ? 'not-allowed' : 'pointer'};">
                                        删除
                                    </button>
                                </div>
                            </div>
                        `}).join('')}
                    </div>
                </div>
            ` : ''}
            </div>
            </div>
        </div>

        <!-- 学习资料标签页 -->
        <div id="trainingTab" class="tab-content ${currentTab === 'training' ? 'active' : ''}">
            <div id="loadingTasks" class="loading" style="padding:40px;text-align:center;">加载中...</div>
            <div id="emptyTasks" class="empty-state" style="display:none;padding:40px;text-align:center;color:var(--text-secondary);">暂无学习资料</div>
            <div id="trainingTaskList" class="card-grid" style="display: grid !important; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)) !important; gap: 16px !important;"></div>
        </div>

        <div id="recordsTab" class="tab-content ${currentTab === 'records' ? 'active' : ''}">
            ${myTrainingRecords.length === 0 ? '<div class="empty-state" style="padding:40px;text-align:center;color:var(--text-secondary);">暂无培训记录</div>' : `
            <div class="training-records-grid" style="display:flex;flex-direction:column;gap:20px;">
                ${myTrainingRecords.map(r => {
                    const isActive = r.is_active === 1;
                    // 检查是否已过结束时间
                    const now = new Date();
                    const endTime = r.end_time ? new Date(r.end_time) : null;
                    const isExpired = endTime && now > endTime;
                    const participationRate = r.participation_rate || 0;
                    const passRate = r.pass_rate || 0;
                    const startTime = r.start_time ? new Date(r.start_time).toLocaleString('zh-CN', {year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : '';
                    const endTimeDisplay = r.end_time ? new Date(r.end_time).toLocaleString('zh-CN', {year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : '无限制';
                    const timeDisplay = startTime ? `${startTime} ~ ${endTimeDisplay}` : `~ ${endTimeDisplay}`;
                    // 已过期的培训显示"已结束"状态，已停用显示红色
                    const displayStatus = isExpired ? '已结束' : (isActive ? '进行中' : '已停用');
                    let statusBg;
                    if (isExpired) {
                        statusBg = 'linear-gradient(135deg,#9E9E9E,#BDBDBD)';
                    } else if (isActive) {
                        statusBg = 'linear-gradient(135deg,#4CAF50,#66BB6A)';
                    } else {
                        statusBg = 'linear-gradient(135deg,#EF4444,#F87171)'; // 红色
                    }
                    return `
                    <div class="training-record-card" onclick="showTrainingRecordDetail(${r.id})" style="display:flex;align-items:stretch;background:linear-gradient(135deg,#fff 0%,#F8FCFF 100%);border-radius:20px;border:1px solid #E8F2FF;cursor:pointer;transition:all 0.4s cubic-bezier(0.16,1,0.3,1);overflow:hidden;box-shadow:0 2px 12px rgba(74,144,226,0.06);">
                        <div style="flex:1;min-width:0;padding:24px 28px;" onclick="showTrainingRecordDetail(${r.id})">
                            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;">
                                <h3 style="font-size:17px;font-weight:600;color:#1D2B5A;margin:0;line-height:1.4;flex:1;">${r.title || '未命名培训'}</h3>
                                <span style="display:inline-flex;align-items:center;gap:5px;padding:5px 14px;border-radius:20px;font-size:12px;font-weight:600;background:${statusBg};color:#fff;flex-shrink:0;margin-left:16px;">
                                    <span style="width:6px;height:6px;border-radius:50%;background:#fff;"></span>
                                    ${displayStatus}
                                </span>
                            </div>
                            <div style="display:flex;align-items:center;gap:6px;font-size:13px;color:#8B9DC3;margin-bottom:16px;">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                                ${timeDisplay}
                            </div>
                            <div style="display:flex;flex-wrap:wrap;gap:8px;">
                                ${r.learning_task_title ? `<span style="display:inline-flex;align-items:center;gap:4px;padding:5px 12px;border-radius:10px;font-size:12px;background:linear-gradient(135deg,#EEF4FF,#E8F0FF);color:#4A7FE8;border:1px solid #D6E4FF;">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>
                                    ${r.learning_task_title}</span>` : ''}
                                ${r.question_bank_title ? `<span style="display:inline-flex;align-items:center;gap:4px;padding:5px 12px;border-radius:10px;font-size:12px;background:linear-gradient(135deg,#FFF8E6,#FFF3D6);color:#D4940A;border:1px solid #FFE9A8;">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z"/></svg>
                                    ${r.question_bank_title}</span>` : ''}
                            </div>
                        </div>
                        <div style="display:flex;align-items:center;padding:0 24px;border-left:1px solid #F0F7FF;gap:20px;flex-shrink:0;">
                            <div style="text-align:center;">
                                <div style="font-size:28px;font-weight:700;color:#4A90E2;">${r.perm_count || 0}</div>
                                <div style="font-size:11px;color:#8B9DC3;margin-top:4px;letter-spacing:0.5px;">授权人数</div>
                            </div>
                            <div style="width:1px;height:40px;background:linear-gradient(180deg,transparent,#E5F0FF,transparent);"></div>
                            <div style="text-align:center;">
                                <div style="font-size:28px;font-weight:700;color:#22C58D;">${r.completed_learning_count || 0}</div>
                                <div style="font-size:11px;color:#8B9DC3;margin-top:4px;letter-spacing:0.5px;">完成学习</div>
                            </div>
                            <div style="width:1px;height:40px;background:linear-gradient(180deg,transparent,#E5F0FF,transparent);"></div>
                            <div style="text-align:center;">
                                <div style="font-size:28px;font-weight:700;color:#F59E0B;">${r.total_participated || 0}</div>
                                <div style="font-size:11px;color:#8B9DC3;margin-top:4px;letter-spacing:0.5px;">参加考试</div>
                            </div>
                            <div style="width:1px;height:40px;background:linear-gradient(180deg,transparent,#E5F0FF,transparent);"></div>
                            <div style="text-align:center;">
                                <div style="font-size:28px;font-weight:700;color:#10B981;">${r.passed_count || 0}</div>
                                <div style="font-size:11px;color:#8B9DC3;margin-top:4px;letter-spacing:0.5px;">通过考试</div>
                            </div>
                            <div style="width:1px;height:40px;background:linear-gradient(180deg,transparent,#E5F0FF,transparent);"></div>
                            <div style="text-align:center;">
                                <div style="position:relative;width:56px;height:56px;">
                                    <svg viewBox="0 0 36 36" style="width:56px;height:56px;transform:rotate(-90deg);">
                                        <circle cx="18" cy="18" r="15.5" fill="none" stroke="#F0F7FF" stroke-width="3"/>
                                        <circle cx="18" cy="18" r="15.5" fill="none" stroke="${participationRate >= 50 ? '#4A90E2' : '#F59E0B'}" stroke-width="3" stroke-dasharray="${participationRate},100" stroke-linecap="round" style="filter:drop-shadow(0 0 3px ${participationRate >= 50 ? 'rgba(74,144,226,0.3)' : 'rgba(245,158,11,0.3)'});"/>
                                    </svg>
                                    <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:12px;font-weight:700;color:#1D2B5A;">${participationRate}%</div>
                                </div>
                                <div style="font-size:11px;color:#8B9DC3;margin-top:4px;letter-spacing:0.5px;">参与率</div>
                            </div>
                            <div style="text-align:center;">
                                <div style="position:relative;width:56px;height:56px;">
                                    <svg viewBox="0 0 36 36" style="width:56px;height:56px;transform:rotate(-90deg);">
                                        <circle cx="18" cy="18" r="15.5" fill="none" stroke="#F0F7FF" stroke-width="3"/>
                                        <circle cx="18" cy="18" r="15.5" fill="none" stroke="${passRate >= 50 ? '#22C58D' : '#EF4444'}" stroke-width="3" stroke-dasharray="${passRate},100" stroke-linecap="round" style="filter:drop-shadow(0 0 3px ${passRate >= 50 ? 'rgba(34,197,141,0.3)' : 'rgba(239,68,68,0.3)'});"/>
                                    </svg>
                                    <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:12px;font-weight:700;color:#1D2B5A;">${passRate}%</div>
                                </div>
                                <div style="font-size:11px;color:#8B9DC3;margin-top:4px;letter-spacing:0.5px;">通过率</div>
                            </div>
                        </div>
                    </div>
                    `}).join('')}
            </div>
            `}
        </div>

        <!-- 培训记录详情弹窗 -->
        <div class="modal" id="trainingRecordModal" style="display:none;position:fixed;z-index:2000;left:0;top:0;width:100%;height:100%;background:rgba(0,0,0,0.5);align-items:center;justify-content:center;">
            <div style="background:white;border-radius:16px;width:90%;max-width:900px;height:80vh;display:flex;flex-direction:column;">
                <div style="padding:24px 24px 16px;border-bottom:1px solid var(--border);flex-shrink:0;">
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <h2 id="trainingRecordModalTitle" style="font-size:20px;font-weight:700;color:#1D2B5A;margin:0;">培训任务详情</h2>
                        <div style="display:flex;align-items:center;gap:12px;">
                            <div id="trainingRecordSubtitle" style="font-size:12px;"></div>
                            <button onclick="closeTrainingRecordModal()" style="width:32px;height:32px;border-radius:50%;border:none;background:#F0F7FF;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#8B9DC3;font-size:16px;">×</button>
                        </div>
                    </div>
                </div>
                <div id="trainingRecordModalContent" style="flex:1;padding:24px;overflow-y:auto;overflow-x:hidden;"></div>
            </div>
        </div>

        <div id="questionsTab" class="tab-content ${currentTab === 'questions' ? 'active' : ''}">
            ${questionBanks.length === 0 ? '<div class="empty-state" style="padding:40px;text-align:center;color:var(--text-secondary);">暂无题库题目</div>' : ''}
            <div class="card-grid" style="display: grid !important; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)) !important; gap: 16px !important;">
                ${questionBanks.map(bank => `
                    <div class="card exam-card" style="padding: 16px; position: relative; cursor: pointer; min-height: 130px; box-sizing: border-box;" onclick="previewQuestionBank(${bank.id})">
                        <div class="card-title" style="margin: 0 0 8px 0;">${bank.title || '未命名题库'}</div>
                        <p class="card-desc" style="margin-bottom: 6px;">${bank.description || '暂无描述'}</p>
                        <div style="font-size: 12px; color: var(--text-soft); margin-bottom: 8px; min-height: 18px;">📝 ${bank.question_count || 0} 题 | 💯 ${bank.total_score || 0} 分</div>
                        <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border); display: flex; gap: 6px; flex-wrap: nowrap; align-items: center;">
                            <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); editQuestionBank(${bank.id})" style="flex: 1; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.15); font-weight: 600;">
                                编辑
                            </button>
                            <button class="btn btn-danger btn-sm" onclick="event.stopPropagation(); deleteQuestionBank(${bank.id})" style="flex: 1; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.15); font-weight: 600;">
                                删除
                            </button>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>

        <!-- 学习资料弹窗 -->
        <div class="modal" id="taskModal" style="display:none;position:fixed;z-index:2000;left:0;top:0;width:100%;height:100%;background:rgba(0,0,0,0.5);align-items:center;justify-content:center;">
            <div class="modal-box" style="background:var(--bg-card);border-radius:var(--radius-lg);padding:24px;width:90%;max-width:500px;max-height:90vh;overflow-y:auto;">
                <div class="modal-title" id="taskModalTitle" style="font-size:18px;font-weight:700;margin-bottom:16px;">新建资料</div>

                <input type="hidden" id="taskId">

                <div class="form-group">
                    <label style="font-weight:600;margin-bottom:8px;display:block;">资料标题 *</label>
                    <input type="text" id="taskTitle" class="form-control" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg-input);color:var(--text-primary);" placeholder="请输入资料标题">
                </div>

                <div class="form-group">
                    <label style="font-weight:600;margin-bottom:8px;display:block;">资料描述</label>
                    <textarea id="taskDescription" class="form-control" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg-input);color:var(--text-primary);resize:vertical;min-height:60px;" placeholder="请输入资料描述（可选）"></textarea>
                </div>

                <div class="form-group">
                    <label style="font-weight:600;margin-bottom:8px;display:block;">上传视频</label>
                    <input type="file" id="taskVideoFile" accept="video/mp4,video/*" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg-input);color:var(--text-primary);">
                    <div id="videoFileInfo" style="font-size:12px;color:var(--text-secondary);margin-top:4px;display:none;"></div>
                    <div id="uploadStatus" style="font-size:14px;color:#f59e0b;margin-top:8px;font-weight:600;display:none;padding:10px;background:rgba(245,158,11,0.1);border-radius:8px;border:1px solid rgba(245,158,11,0.3);"></div>
                    <div id="uploadProgressContainer" style="margin-top:8px;display:none;">
                        <div style="font-size:12px;color:var(--text-secondary);margin-bottom:4px;">上传进度: <span id="uploadProgressPercent">0</span>%</div>
                        <div style="width:100%;height:8px;background:var(--bg-surface);border-radius:4px;overflow:hidden;">
                            <div id="uploadProgressBar" style="width:0%;height:100%;background:var(--accent);transition:width 0.3s;"></div>
                        </div>
                    </div>
                </div>

                <div style="display:flex;gap:10px;margin-top:16px;">
                    <button class="btn btn-primary btn-sm" id="taskSubmitBtn" onclick="saveTask()" style="flex:1;">保存</button>
                    <button class="btn btn-secondary btn-sm" onclick="closeTaskModal()" style="flex:1;">取消</button>
                </div>
            </div>
        </div>

        <!-- 题库导入弹窗 -->
        <div class="modal" id="questionImportModal" style="display:none;position:fixed;z-index:2000;left:0;top:0;width:100%;height:100%;background:rgba(15,25,60,0.6);backdrop-filter:blur(8px);align-items:center;justify-content:center;">
            <div style="background:#fff;border-radius:22px;padding:24px;width:90%;max-width:600px;max-height:85vh;overflow-y:auto;box-shadow:0 25px 60px rgba(15,25,60,0.15),0 8px 20px rgba(74,144,226,0.1);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
                    <div style="font-size:18px;font-weight:700;color:#1D2B5A;">导入题目</div>
                    <button onclick="closeQuestionImport()" style="width:32px;height:32px;border-radius:50%;border:none;background:#F0F7FF;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#8B9DC3;font-size:16px;">×</button>
                </div>

                <div style="margin-bottom:16px;">
                    <button onclick="downloadTemplate()" style="padding:10px 20px;background:linear-gradient(135deg,#4A90E2,#65B3FF);color:#fff;border:none;border-radius:10px;font-weight:600;cursor:pointer;box-shadow:0 4px 12px rgba(74,144,226,0.2);">下载模板</button>
                </div>

                <div style="margin-bottom:16px;">
                    <label style="font-weight:600;margin-bottom:8px;display:block;color:#1D2B5A;">题库标题 *</label>
                    <input type="text" id="importExamTitle" style="width:100%;padding:10px 12px;border:1px solid #D6E9FF;border-radius:10px;font-size:14px;outline:none;background:#fff;color:#1D2B5A;" placeholder="请输入题库标题">
                </div>

                <div style="margin-bottom:16px;">
                    <label style="font-weight:600;margin-bottom:8px;display:block;color:#1D2B5A;">题库描述</label>
                    <textarea id="importExamDesc" style="width:100%;padding:10px 12px;border:1px solid #D6E9FF;border-radius:10px;font-size:14px;resize:vertical;min-height:60px;outline:none;background:#fff;color:#1D2B5A;" placeholder="请输入题库描述（可选）"></textarea>
                </div>

                <div style="margin-bottom:16px;">
                    <label style="font-weight:600;margin-bottom:8px;display:block;color:#1D2B5A;">方式一：粘贴题目文本</label>
                    <textarea id="importText" style="width:100%;height:140px;border:1px solid #D6E9FF;border-radius:12px;padding:12px;font-size:13px;resize:vertical;outline:none;background:#F8FCFF;color:#1D2B5A;" placeholder="请粘贴题目文本，格式：1. 题目内容 A. 选项A B. 选项B 答案：A"></textarea>
                </div>

                <div style="margin-bottom:16px;">
                    <label style="font-weight:600;margin-bottom:8px;display:block;color:#1D2B5A;">方式二：上传文件（支持 docx/txt/doc）</label>
                    <input type="file" id="importFile" accept=".docx,.txt,.doc" style="margin-bottom:8px;">
                    <div id="fileInfo" style="font-size:12px;color:#8B9DC3;margin-top:5px;"></div>
                </div>

                <div style="display:flex;gap:12px;margin-top:20px;padding-top:16px;border-top:1px solid #E5F0FF;">
                    <button onclick="previewQuestions()" style="flex:1;padding:12px 24px;background:#fff;color:#5B72A9;border:1px solid #D6E9FF;border-radius:12px;font-weight:600;font-size:14px;cursor:pointer;">预览</button>
                    <button onclick="importQuestions()" style="flex:1;padding:12px 24px;background:linear-gradient(135deg,#4A90E2,#65B3FF);color:#fff;border:none;border-radius:12px;font-weight:600;font-size:14px;cursor:pointer;box-shadow:0 4px 12px rgba(74,144,226,0.2);">导入</button>
                </div>

                <div id="previewSection" style="display:none;margin-top:16px;">
                    <div style="font-weight:600;margin-bottom:10px;color:#1D2B5A;">预览（共 <span id="previewCount">0</span> 题）</div>
                    <div id="previewList" style="max-height:250px;overflow-y:auto;border:1px solid #D6E9FF;border-radius:12px;padding:12px;background:#F8FCFF;"></div>
                </div>

                <div id="importResult" style="display:none;margin-top:16px;padding:12px;border-radius:12px;font-weight:500;"></div>
            </div>
        </div>

        <style>
            .import-result.success { background: rgba(34, 197, 94, 0.1); color: #22c55e; }
            .import-result.error { background: rgba(239, 68, 68, 0.1); color: #ef4444; }
            .exam-card {
                transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
                cursor: pointer;
                border-radius: 12px;
                box-shadow: 0 2px 8px rgba(0,0,0,0.1), inset 0 1px 0 rgba(255,255,255,0.2);
                border: 1px solid rgba(0,0,0,0.05);
            }
            .exam-card:hover {
                transform: translateY(-4px);
                box-shadow: 0 8px 25px rgba(0, 0, 0, 0.15), inset 0 1px 0 rgba(255,255,255,0.2);
            }
            .exam-card:active {
                transform: translateY(-2px);
            }
            .exam-card .btn {
                display: inline-flex !important;
                justify-content: center;
                align-items: center;
                text-align: center;
            }
            /* 滚动条样式 */
            .preview-modal-content { scrollbar-width: thin; scrollbar-color: rgba(0,0,0,0.2) transparent; }
            .preview-modal-content::-webkit-scrollbar { width: 6px !important; height: 6px !important; }
            .preview-modal-content::-webkit-scrollbar-track { background: transparent !important; border-radius: 0 !important; }
            .preview-modal-content::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.2) !important; border-radius: 0 !important; }
            .preview-modal-content::-webkit-scrollbar-thumb:hover { background: rgba(0,0,0,0.35) !important; }
            .preview-modal-content::-webkit-scrollbar-corner { background: transparent !important; }
        </style>

        <!-- 学习任务选择弹窗 - Contra Light Blue主题 -->
        <div class="modal" id="taskSelectModal" style="display:none;position:fixed;z-index:1000;left:0;top:0;width:100%;height:100%;background:rgba(0,0,0,0.5);align-items:center;justify-content:center;">
            <div style="background:#ffffff;border-radius:22px;padding:32px;width:90%;max-width:480px;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(74,144,226,0.15);border:1px solid #D6E9FF;">
                <div style="font-size:20px;font-weight:700;color:#1D2B5A;margin-bottom:20px;text-align:center;">启用培训任务</div>
                <div id="examInfoSummary" style="margin-bottom:20px;padding:20px;background:#F0F7FF;border-radius:16px;font-size:15px;color:#1D2B5A;line-height:1.8;"></div>
                <div style="display:flex;gap:12px;margin-top:24px;">
                    <button onclick="confirmEnableExam()" style="flex:1;padding:14px 24px;background:linear-gradient(90deg, #4A90E2, #65B3FF);color:#fff;border:none;border-radius:16px;font-weight:600;font-size:15px;cursor:pointer;transition:all 0.3s;">确认启用</button>
                    <button onclick="closeTaskSelectModal()" style="flex:1;padding:14px 24px;background:#F0F7FF;color:#4A90E2;border:1px solid #D6E9FF;border-radius:16px;font-weight:600;font-size:15px;cursor:pointer;transition:all 0.3s;">取消</button>
                </div>
            </div>
        </div>
    `;
}

async function previewPaper(examId) {
    // 获取试卷详情
    try {
        const res = await fetch(`${API_URL}/exam-trainings/${examId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        }).then(r => r.json());

        if (res.code !== 0) {
            alert(res.msg || '获取试卷详情失败');
            return;
        }

        const { training: exam, questions } = res.data;
        showPaperPreviewModal(exam, questions);
    } catch (err) {
        alert('获取试卷详情失败');
    }
}

async function deleteExam(examId) {
    if (!confirm('确定要删除此考试吗？删除后不可恢复。')) {
        return;
    }
    try {
        const res = await fetch(`${API_URL}/exam-trainings/${examId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        }).then(r => r.json());

        if (res.code === 0) {
            loadData();
        } else {
            alert(res.msg || '删除失败');
        }
    } catch (err) {
        alert('删除失败');
    }
}

// 打开考试设置弹窗
let currentEditingExamId = null;
let isEditingDraft = false;

async function openExamSettings(examId) {
    currentEditingExamId = examId;

    // 查找培训数据（从 papers 中查找）
    const exam = papers.find(t => t.id === examId);
    if (!exam) {
        alert('考试不存在');
        return;
    }

    // 标记是否为草稿编辑
    isEditingDraft = exam.is_draft === 1;

    const form = document.getElementById('createExamForm');
    if (!form) return;

    // 刷新学习资料下拉框
    const learningTaskSelect = document.getElementById('examLearningTask');
    if (learningTaskSelect) {
        let options = '<option value="">请选择资料</option>';
        if (trainingTasks && trainingTasks.length > 0) {
            options += trainingTasks.map(t => `<option value="${t.id}">${t.title || '资料 ' + t.id}</option>`).join('');
        }
        options += '<option value="__new__">+ 创建新资料</option>';
        learningTaskSelect.innerHTML = options;
        learningTaskSelect.value = exam.learning_task_id || '';
    }

    // 刷新题库下拉框
    const questionBankSelect = document.getElementById('examQuestionBank');
    if (questionBankSelect) {
        questionBankSelect.innerHTML = '<option value="">请选择题库</option>' +
            questionBanks.map(b => `<option value="${b.id}">${b.title || '题库 ' + b.id} (${b.question_count || 0}题)</option>`).join('') +
            '<option value="__new__">+ 创建新题库</option>';
        // 只有在编辑模式下（currentEditingExamId 有值）才设置选中值
        if (currentEditingExamId && typeof exam !== 'undefined' && exam && exam.question_bank_id != null) {
            questionBankSelect.value = Number(exam.question_bank_id);
            // 保存到localStorage，以便步骤3恢复
            localStorage.setItem('pendingQuestionBankId', exam.question_bank_id);
        } else {
            questionBankSelect.value = '';
        }
    }

    // 填充表单
    document.getElementById('examTitle').value = exam.title || '';
    document.getElementById('examDescription').value = exam.description || '';
    document.getElementById('examStartTime').value = exam.start_time || '';
    document.getElementById('examEndTime').value = exam.end_time || '';
    document.getElementById('examDuration').value = exam.duration || 60;
    document.getElementById('examPassScore').value = exam.pass_score || 60;
    document.getElementById('examLearningTask').value = exam.learning_task_id ? String(exam.learning_task_id) : '';
    const participantFileEl2 = document.getElementById('examParticipantsFile');
    if (participantFileEl2) participantFileEl2.value = '';
    const participantFileInfoEl2 = document.getElementById('participantFileInfo');
    if (participantFileInfoEl2) participantFileInfoEl2.style.display = 'none';
    document.getElementById('createExamResult').style.display = 'none';

    // 设置授权方式
    const permType = exam.perm_type || 'all';
    const radioAll = document.getElementById('radioAllStaff');
    const radioManual = document.getElementById('radioManual');
    if (radioAll) radioAll.checked = (permType === 'all');
    if (radioManual) radioManual.checked = (permType === 'manual');

    // 如果是手动授权，加载该培训的授权人员
    if (permType === 'manual') {
        loadStep4StaffWithPerm(examId);
    }

    // 重置步骤
    currentStep = 1;
    updateStepUI();

    // 更新表单标题
    const formTitle = document.getElementById('examFormTitle');
    if (formTitle) {
        formTitle.textContent = isEditingDraft ? '编辑草稿' : '考试设置';
    }

    // 更改提交按钮文字
    const submitBtn = document.getElementById('submitExamBtn');
    if (submitBtn) {
        if (isEditingDraft) {
            submitBtn.textContent = '保存';
        } else if (currentEditingExamId) {
            submitBtn.textContent = '更新设置';
        } else {
            submitBtn.textContent = '完成创建';
        }
    }

    // 隐藏卡片列表，显示表单
    const papersListContainer = document.getElementById('papersListContainer');
    if (papersListContainer) papersListContainer.style.display = 'none';
    form.style.display = 'block';
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ============ 题库管理函数 ============

async function previewQuestionBank(bankId) {
    // 获取题库详情
    try {
        const res = await fetch(`${API_URL}/question-banks/${bankId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        }).then(r => r.json());

        if (res.code !== 0) {
            alert(res.msg || '获取题库详情失败');
            return;
        }

        const { bank, questions } = res.data;
        showQuestionBankPreviewModal(bank, questions);
    } catch (err) {
        alert('获取题库详情失败');
    }
}

function showQuestionBankPreviewModal(bank, questions) {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'questionBankPreviewModal';
    modal.style.cssText = 'position:fixed;z-index:1000;left:0;top:0;width:100%;height:100%;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;';

    const questionsHtml = questions.length === 0
        ? '<div style="padding:20px;text-align:center;color:#999;">暂无题目</div>'
        : questions.map((q, i) => {
            const typeMap = { 'true_false': '判断题', 'single_choice': '单选题', 'multiple_choice': '多选题' };
            const typeName = typeMap[q.type] || q.type;
            const options = q.options ? JSON.parse(q.options) : [];
            const optionsHtml = options.map((opt, idx) => {
                const letter = String.fromCharCode(65 + idx);
                return `<div style="margin:4px 0;padding:4px 8px;color:var(--text);">${letter}. ${escapeHtml(opt)}</div>`;
            }).join('');

            // 判断题格式：类型 + 序号 + 题目内容 + 分数，答案换行
            if (q.type === 'true_false') {
                return `
                    <div style="margin-bottom:20px;padding:16px;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;">
                        <div style="font-weight:600;margin-bottom:8px;">
                            ${typeName} ${i + 1}. ${escapeHtml(q.content)}（${q.score}分）
                        </div>
                        ${q.answer ? `<div style="color:#16a34a;font-weight:600;margin-top:8px;">答案：${escapeHtml(q.answer)}</div>` : ''}
                    </div>
                `;
            }

            // 单选/多选格式：与判断题一致
            return `
                <div style="margin-bottom:20px;padding:16px;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;">
                    <div style="font-weight:600;margin-bottom:8px;">
                        ${typeName} ${i + 1}. ${escapeHtml(q.content)}（${q.score}分）
                    </div>
                    <div style="padding-left:10px;margin-top:8px;">${optionsHtml}</div>
                    ${q.answer ? `<div style="color:#16a34a;font-weight:600;margin-top:8px;">答案：${escapeHtml(q.answer)}</div>` : ''}
                </div>
            `;
        }).join('');

    modal.innerHTML = `
        <div style="background:white;border-radius:16px;width:90%;max-width:700px;max-height:80vh;overflow:hidden;display:flex;flex-direction:column;">
            <div style="padding:24px 24px 16px;border-bottom:1px solid var(--border);flex-shrink:0;">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <h3 style="margin:0;">${escapeHtml(bank.title)}</h3>
                    <button onclick="this.closest('.modal').remove()" style="background:none;border:none;font-size:24px;cursor:pointer;padding:4px 8px;">&times;</button>
                </div>
                <div style="margin-top:12px;padding:10px 14px;background:var(--bg);border-radius:8px;font-size:13px;color:var(--text-secondary);">
                    题目: ${questions.length} 题 | 总分: ${bank.total_score || 0} 分
                </div>
            </div>
            <div style="flex:1;overflow-y:auto;padding:24px;padding-top:16px;border-radius:0 0 16px 16px;">
                ${questionsHtml}
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });
}

async function editQuestionBank(bankId) {
    // 获取题库详情
    try {
        const res = await fetch(`${API_URL}/question-banks/${bankId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        }).then(r => r.json());

        if (res.code !== 0) {
            alert(res.msg || '获取题库详情失败');
            return;
        }

        const { bank, questions } = res.data;
        showEditQuestionBankModal(bank, questions);
    } catch (err) {
        alert('获取题库详情失败');
    }
}

function showEditQuestionBankModal(bank, questions) {
    // 关闭预览弹窗
    const previewModal = document.getElementById('questionBankPreviewModal');
    if (previewModal) previewModal.remove();

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'editQuestionBankModal';
    modal.style.cssText = 'position:fixed;z-index:1001;left:0;top:0;width:100%;height:100%;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;';

    const renderQuestionEdit = (q, i) => {
        const typeMap = { 'true_false': '判断题', 'single_choice': '单选题', 'multiple_choice': '多选题' };
        const typeName = typeMap[q.type] || q.type;
        const options = q.options ? JSON.parse(q.options) : [];

        let optionsEditHtml = '';
        if (q.type === 'single_choice' || q.type === 'multiple_choice') {
            optionsEditHtml = `
                <div style="margin-top:12px;">
                    <label style="font-size:12px;color:var(--text-secondary);margin-bottom:6px;display:block;">选项（每行一个）</label>
                    ${options.map((opt, idx) => `
                        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                            <span style="width:20px;font-weight:600;color:var(--text);">${String.fromCharCode(65 + idx)}.</span>
                            <input type="text" class="q-opt-${q.id}-${idx}" value="${escapeHtml(opt)}" style="flex:1;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;">
                        </div>
                    `).join('')}
                </div>
            `;
        }

        return `
            <div style="margin-bottom:24px;padding:20px;background:var(--bg-card);border:1px solid var(--border);border-radius:12px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <span style="background:#e5e7eb;padding:4px 10px;border-radius:6px;font-size:12px;font-weight:600;color:var(--text-secondary);">${typeName}</span>
                        <span style="color:var(--text-secondary);font-size:13px;">第 ${i + 1} 题</span>
                        <span style="color:var(--text-secondary);font-size:13px;">分值</span>
                        <input type="number" class="q-score-${q.id}" value="${q.score || 5}" min="1" style="width:36px;padding:4px 6px;border:1px solid var(--border);border-radius:6px;font-size:13px;box-sizing:border-box;-moz-appearance:textfield;appearance:textfield;">
                        <span style="color:var(--text-secondary);font-size:13px;">分</span>
                    </div>
                    <button type="button" onclick="deleteQuestion(${bank.id}, ${q.id})" style="padding:6px 12px;background:#ef4444;color:white;border:none;border-radius:6px;cursor:pointer;font-size:12px;">删除</button>
                </div>
                <div style="margin-bottom:12px;">
                    <textarea class="q-content-${q.id}" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;resize:vertical;min-height:60px;box-sizing:border-box;">${escapeHtml(q.content)}</textarea>
                </div>
                ${optionsEditHtml}
                <div style="margin-top:12px;display:flex;gap:12px;align-items:center;">
                    <div style="flex:1;">
                        ${q.type === 'multiple_choice' ? `
                            <div style="display:flex;align-items:center;gap:8px;">
                                <span style="font-size:13px;color:var(--text-secondary);">答案</span>
                                <input type="text" class="q-answer-${q.id}" value="${escapeHtml(q.answer)}" placeholder="如: A,C" style="flex:1;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;box-sizing:border-box;">
                            </div>
                        ` : q.type === 'true_false' ? `
                            <div style="display:flex;align-items:center;gap:16px;font-size:13px;">
                                <span style="font-size:13px;color:var(--text-secondary);">答案</span>
                                <label style="display:flex;align-items:center;gap:4px;cursor:pointer;">
                                    <input type="radio" name="tf-${q.id}" value="√" ${q.answer === '√' ? 'checked' : ''} class="q-tf-${q.id}">
                                    <span>√ 正确</span>
                                </label>
                                <label style="display:flex;align-items:center;gap:4px;cursor:pointer;">
                                    <input type="radio" name="tf-${q.id}" value="×" ${q.answer === '×' ? 'checked' : ''} class="q-tf-${q.id}">
                                    <span>× 错误</span>
                                </label>
                            </div>
                        ` : `
                            <div style="display:flex;align-items:center;gap:8px;">
                                <span style="font-size:13px;color:var(--text-secondary);">答案</span>
                                <input type="text" class="q-answer-${q.id}" value="${escapeHtml(q.answer)}" placeholder="如: A" style="flex:1;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;box-sizing:border-box;">
                            </div>
                        `}
                    </div>
                </div>
            </div>
        `;
    };

    const questionsHtml = questions.length === 0
        ? '<div style="padding:40px;text-align:center;color:#999;">暂无题目，请导入题目</div>'
        : questions.map((q, i) => renderQuestionEdit(q, i)).join('');

    modal.innerHTML = `
        <div style="background:white;border-radius:16px;width:95%;max-width:800px;max-height:90vh;overflow:hidden;display:flex;flex-direction:column;">
            <div style="padding:20px 24px;border-bottom:1px solid var(--border);flex-shrink:0;">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <h3 style="margin:0;">编辑题库 - ${escapeHtml(bank.title)}</h3>
                    <button onclick="this.closest('.modal').remove()" style="background:none;border:none;font-size:24px;cursor:pointer;padding:4px 8px;">&times;</button>
                </div>
            </div>
            <div style="flex:1;overflow-y:auto;padding:24px;" id="editQuestionList">
                ${questionsHtml}
            </div>
            <div style="padding:16px 24px;border-top:1px solid var(--border);flex-shrink:0;display:flex;gap:12px;justify-content:flex-end;">
                <button onclick="this.closest('.modal').remove()" style="padding:10px 20px;border:1px solid var(--border);border-radius:8px;cursor:pointer;font-size:14px;background:white;">取消</button>
                <button onclick="saveQuestionBank(${bank.id})" style="padding:10px 20px;background:#3b82f6;color:white;border:none;border-radius:8px;cursor:pointer;font-size:14px;font-weight:600;">保存修改</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

async function saveQuestionBank(bankId) {
    const questionList = document.getElementById('editQuestionList');
    const questionDivs = questionList.querySelectorAll('[id^="editQuestionList"] > div');

    // Get all questions from the DOM
    const savePromises = [];
    const questionElements = questionList.querySelectorAll('div[style*="border-radius:12px"]');

    for (const div of questionElements) {
        const contentEl = div.querySelector('[class^="q-content-"]');
        const answerEl = div.querySelector('[class^="q-answer-"]');
        const scoreEl = div.querySelector('[class^="q-score-"]');

        if (!contentEl) continue;

        const className = contentEl.className;
        const match = className.match(/q-content-(\d+)/);
        if (!match) continue;

        const questionId = match[1];
        const content = contentEl.value.trim();
        const answer = answerEl ? answerEl.value.trim() : '';
        const score = scoreEl ? parseInt(scoreEl.value) || 5 : 5;

        // Get options for single/multiple choice
        let options = null;
        const opt0 = div.querySelector(`.q-opt-${questionId}-0`);
        if (opt0) {
            options = [];
            let idx = 0;
            while (true) {
                const optEl = div.querySelector(`.q-opt-${questionId}-${idx}`);
                if (!optEl) break;
                options.push(optEl.value);
                idx++;
            }
        }

        // Get true/false answer
        let tfAnswer = null;
        const tfRadios = div.querySelectorAll(`.q-tf-${questionId}`);
        if (tfRadios.length > 0) {
            for (const radio of tfRadios) {
                if (radio.checked) {
                    tfAnswer = radio.value;
                    break;
                }
            }
        }

        const finalAnswer = tfAnswer || answer;

        savePromises.push(fetch(`${API_URL}/question-banks/${bankId}/questions/${questionId}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ content, options, answer: finalAnswer, score })
        }).then(r => r.json()));
    }

    try {
        const results = await Promise.all(savePromises);
        const failed = results.filter(r => r.code !== 0);

        if (failed.length > 0) {
            alert(`保存失败：${failed.length} 题`);
        } else {
            alert('保存成功');
            const modal = document.getElementById('editQuestionBankModal');
            if (modal) modal.remove();
            loadData();
        }
    } catch (err) {
        alert('保存失败');
    }
}

async function deleteQuestion(bankId, questionId) {
    if (!confirm('确定要删除此题吗？')) return;

    try {
        const res = await fetch(`${API_URL}/question-banks/${bankId}/questions/${questionId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        }).then(r => r.json());

        if (res.code === 0) {
            // Remove the question element from DOM
            const questionList = document.getElementById('editQuestionList');
            const questionDivs = questionList.querySelectorAll('div[style*="border-radius:12px"]');
            for (const div of questionDivs) {
                const contentEl = div.querySelector('[class^="q-content-"]');
                if (contentEl) {
                    const className = contentEl.className;
                    const match = className.match(/q-content-(\d+)/);
                    if (match && match[1] == questionId) {
                        div.remove();
                        break;
                    }
                }
            }
        } else {
            alert(res.msg || '删除失败');
        }
    } catch (err) {
        alert('删除失败');
    }
}

async function deleteQuestionBank(bankId) {
    if (!confirm('确定要删除此题库吗？删除后不可恢复。')) {
        return;
    }
    try {
        const res = await fetch(`${API_URL}/question-banks/${bankId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        }).then(r => r.json());

        if (res.code === 0) {
            alert('删除成功');
            loadData();
        } else {
            // 如果有相关培训信息，显示详情
            if (res.data?.related_trainings?.length > 0) {
                const trainings = res.data.related_trainings.map(t => `• ${t.title || '培训' + t.id}`).join('\n');
                alert(`${res.msg}\n\n关联培训：\n${trainings}\n\n请先删除或修改这些培训的题库设置。`);
            } else {
                alert(res.msg || '删除失败');
            }
        }
    } catch (err) {
        alert('删除失败');
    }
}

let currentEditingQuestionBankId = null;

async function openQuestionBankSettings(bankId) {
    currentEditingQuestionBankId = bankId;

    // 查找题库数据
    const bank = questionBanks.find(b => b.id === bankId);
    if (!bank) {
        alert('题库不存在');
        return;
    }

    // 显示导入弹窗
    document.getElementById('importExamTitle').value = bank.title;
    document.getElementById('importExamDesc').value = bank.description || '';
    document.getElementById('questionImportModal').style.display = 'flex';
}

function showPaperPreviewModal(exam, questions) {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'paperPreviewModal';
    modal.style.cssText = 'position:fixed;z-index:1000;left:0;top:0;width:100%;height:100%;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;';

    const questionsHtml = questions.length === 0
        ? '<div style="padding:20px;text-align:center;color:#999;">暂无题目</div>'
        : questions.map((q, i) => {
            const typeMap = { 'true_false': '判断题', 'single_choice': '单选题', 'multiple_choice': '多选题' };
            const typeName = typeMap[q.type] || q.type;
            const options = q.options ? JSON.parse(q.options) : [];
            const optionsHtml = options.map((opt, idx) => {
                const letter = String.fromCharCode(65 + idx);
                return `<div style="margin:4px 0;padding:4px 8px;color:var(--text);">${letter}. ${escapeHtml(opt)}</div>`;
            }).join('');

            return `
                <div style="margin-bottom:20px;padding:16px;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;">
                    <div style="font-weight:600;margin-bottom:8px;">
                        ${typeName} ${i + 1}. ${escapeHtml(q.content)}（${q.score}分）
                    </div>
                    <div style="padding-left:10px;margin-top:8px;">${optionsHtml}</div>
                    ${q.answer ? `<div style="color:#16a34a;font-weight:600;margin-top:8px;">答案：${escapeHtml(q.answer)}</div>` : ''}
                </div>
            `;
        }).join('');

    modal.innerHTML = `
        <div style="background:white;border-radius:16px;width:90%;max-width:700px;max-height:80vh;overflow:hidden;display:flex;flex-direction:column;">
            <div style="padding:24px 24px 16px;border-bottom:1px solid var(--border);flex-shrink:0;">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <h3 style="margin:0;">${escapeHtml(exam.title)}</h3>
                    <button onclick="closePaperPreviewModal()" style="background:none;border:none;font-size:24px;cursor:pointer;padding:4px 8px;">×</button>
                </div>
                <div style="margin-top:12px;padding:10px 14px;background:var(--bg);border-radius:8px;font-size:13px;color:var(--text-secondary);">
                    时长: ${exam.duration}分钟 | 及格: ${exam.pass_score}分 | 题目: ${questions.length}题
                </div>
            </div>
            <div style="flex:1;overflow-y:auto;padding:24px;padding-top:16px;">
                ${questionsHtml}
            </div>
        </div>
    `;

    document.body.appendChild(modal);
}

function closePaperPreviewModal() {
    const modal = document.getElementById('paperPreviewModal');
    if (modal) {
        modal.remove();
    }
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

function downloadTemplate() {
    // 下载试卷模板文件
    const link = document.createElement('a');
    link.href = '/uploads/试卷模板.docx';
    link.download = '试卷模板.docx';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function onQuestionBankChange(value) {
    if (value === '__new__') {
        const title = document.getElementById('examTitle').value.trim();
        const description = document.getElementById('examDescription').value.trim();
        const duration = document.getElementById('examDuration').value || '60';
        const passScore = document.getElementById('examPassScore').value || '60';

        if (!title) {
            alert('请输入培训标题');
            document.getElementById('examQuestionBank').value = '';
            return;
        }

        // 保存当前表单状态
        pendingExamForm = {
            title: title,
            description: description,
            duration: duration,
            pass_score: passScore,
            learningTaskId: document.getElementById('examLearningTask').value
        };

        // 保存表单信息到localStorage
        localStorage.setItem('pendingExamTitle', title);
        localStorage.setItem('pendingExamDesc', description);
        localStorage.setItem('pendingExamDuration', duration);
        localStorage.setItem('pendingExamPassScore', passScore);

        // 打开导入弹窗
        document.getElementById('importExamTitle').value = title;
        document.getElementById('importExamDesc').value = description;
        document.getElementById('questionImportModal').style.display = 'flex';
    }
}

function onLearningTaskChange(value) {
    if (value === '__new__') {
        // 保存当前表单状态
        pendingExamForm = {
            title: document.getElementById('examTitle').value.trim(),
            description: document.getElementById('examDescription').value.trim(),
            duration: document.getElementById('examDuration').value || '60',
            pass_score: document.getElementById('examPassScore').value || '60',
            questionBankId: document.getElementById('examQuestionBank').value
        };
        // 关闭当前弹窗
        closeCreateExamModal();
        // 打开新建资料弹窗
        showCreateTaskModal();
    }
}

// ============ 培训管理 ============
function renderTrainingTasks() {
    const container = document.getElementById('trainingTaskList');
    const loading = document.getElementById('loadingTasks');
    const empty = document.getElementById('emptyTasks');

    console.log('renderTrainingTasks called, trainingTasks.length:', trainingTasks.length);
    console.log('trainingTasks:', trainingTasks);

    if (!container) return;

    if (trainingTasks.length === 0) {
        loading.style.display = 'none';
        empty.style.display = 'block';
        container.innerHTML = '';
        return;
    }

    loading.style.display = 'none';
    empty.style.display = 'none';

    container.innerHTML = trainingTasks.map(task => {
        // 格式化视频时长
        let durationStr = '';
        if (task.duration) {
            const mins = Math.floor(task.duration / 60);
            const secs = task.duration % 60;
            durationStr = `${mins}:${String(secs).padStart(2, '0')}`;
        }
        return `
        <div class="card exam-card" style="padding: 16px; position: relative; cursor: pointer;" onclick="previewLearningMaterial(${task.id})">
            <div class="card-title" style="margin: 0 0 8px 0;">${task.title || '未命名资料'}</div>
            <p class="card-desc" style="margin-bottom: 6px;">${task.description || '暂无描述'}</p>
            <div style="font-size: 12px; color: var(--text-soft); margin-bottom: 8px; min-height: 18px;">${durationStr ? '📹 ' + durationStr : ''}</div>
            <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border); display: flex; gap: 6px; flex-wrap: nowrap; align-items: center;">
                <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); editTask(${task.id})" style="flex: 1; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.15); font-weight: 600;">
                    编辑
                </button>
                <button class="btn btn-danger btn-sm" onclick="event.stopPropagation(); deleteTask(${task.id})" style="flex: 1; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.15); font-weight: 600;">
                    删除
                </button>
            </div>
        </div>
    `}).join('');
}

function previewLearningMaterial(taskId) {
    const task = trainingTasks.find(t => t.id === taskId);
    if (!task) return;

    if (task.file_url) {
        showVideoPreviewModal(task);
    } else {
        editTask(taskId);
    }
}

function showVideoPreviewModal(task) {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'videoPreviewModal';
    modal.style.cssText = 'position:fixed;z-index:2000;left:0;top:0;width:100%;height:100%;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;';

    modal.innerHTML = `
        <div style="background:white;border-radius:16px;width:90%;max-width:900px;max-height:80vh;overflow:hidden;display:flex;flex-direction:column;">
            <div style="padding:24px 24px 16px;border-bottom:1px solid var(--border);flex-shrink:0;">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <div style="font-size:18px;font-weight:700;">${escapeHtml(task.title || '学习资料预览')}</div>
                    <button onclick="closeVideoPreviewModal()" style="border:none;background:none;font-size:24px;cursor:pointer;padding:4px 8px;">×</button>
                </div>
                <div style="margin-top:12px;padding:10px 14px;background:var(--bg);border-radius:8px;font-size:13px;color:var(--text-secondary);">
                    ${task.description || '暂无描述'}
                </div>
            </div>
            <div style="flex:1;overflow-y:auto;padding:24px;padding-top:16px;">
                <div style="position:relative;padding-bottom:56.25%;height:0;background:#000;border-radius:12px;overflow:hidden;">
                    <video style="position:absolute;top:0;left:0;width:100%;height:100%;" controls>
                        <source src="${task.file_url}" type="video/mp4">
                        您的浏览器不支持视频播放
                    </video>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
}

function closeVideoPreviewModal() {
    const modal = document.getElementById('videoPreviewModal');
    if (modal) {
        modal.remove();
    }
}

let selectedTasks = new Set();

function toggleTask(id) {
    if (selectedTasks.has(id)) {
        selectedTasks.delete(id);
    } else {
        selectedTasks.add(id);
    }
    updateSelectedTaskCount();
}

function updateSelectedTaskCount() {
    // 更新所有任务卡片的复选框状态
    document.querySelectorAll('.task-card .task-checkbox').forEach(cb => {
        const id = parseInt(cb.onclick.toString().match(/toggleTask\((\d+)\)/)?.[1]);
        if (id) {
            cb.checked = selectedTasks.has(id);
        }
    });
}

function goToTaskDetail(id, event) {
    if (event.target.classList.contains('task-checkbox')) return;
    window.location.href = `learning-materials-detail.html?id=${id}`;
}

async function quickPublishTasks() {
    if (selectedTasks.size === 0) {
        alert('请先选择要发布的任务');
        return;
    }
    try {
        const results = await Promise.all([...selectedTasks].map(id =>
            fetch(`${API_URL}/learning-materials/${id}/publish`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            }).then(res => res.json())
        ));
        const fail = results.filter(r => r.code !== 0).length;
        alert(fail === 0 ? '发布成功' : `成功${results.length - fail}个，失败${fail}个`);
        selectedTasks.clear();
        updateSelectedTaskCount();
        loadData();
    } catch (err) {
        alert('发布失败');
    }
}

async function batchDeleteTasks() {
    if (selectedTasks.size === 0) {
        alert('请先选择要删除的任务');
        return;
    }
    if (!confirm(`确定删除 ${selectedTasks.size} 个任务？`)) return;

    try {
        const results = await Promise.all([...selectedTasks].map(id =>
            fetch(`${API_URL}/learning-materials/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            }).then(res => res.json())
        ));
        const fail = results.filter(r => r.code !== 0).length;
        alert(fail === 0 ? '删除成功' : `成功${results.length - fail}个，失败${fail}个`);
        selectedTasks.clear();
        updateSelectedTaskCount();
        loadData();
    } catch (err) {
        alert('删除失败');
    }
}

function renderQuestionBanks() {
    const container = document.getElementById('questionsTab');
    if (!container) return;

    if (questionBanks.length === 0) {
        container.innerHTML = '<div class="empty-state" style="padding:40px;text-align:center;color:var(--text-secondary);">暂无题库题目</div>';
        return;
    }

    container.innerHTML = `
        <div class="card-grid" style="display: grid !important; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)) !important; gap: 16px !important;">
            ${questionBanks.map(bank => `
                <div class="card exam-card" style="padding: 16px; position: relative; cursor: pointer; min-height: 130px; box-sizing: border-box;" onclick="previewQuestionBank(${bank.id})">
                    <div class="card-title" style="margin: 0 0 8px 0;">${bank.title || '未命名题库'}</div>
                    <p class="card-desc" style="margin-bottom: 6px;">${bank.description || '暂无描述'}</p>
                    <div style="font-size: 12px; color: var(--text-soft); margin-bottom: 8px; min-height: 18px;">📝 ${bank.question_count || 0} 题 | 💯 ${bank.total_score || 0} 分</div>
                    <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border); display: flex; gap: 6px; flex-wrap: nowrap; align-items: center;">
                        <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); editQuestionBank(${bank.id})" style="flex: 1; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.15); font-weight: 600;">
                            编辑
                        </button>
                        <button class="btn btn-danger btn-sm" onclick="event.stopPropagation(); deleteQuestionBank(${bank.id})" style="flex: 1; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.15); font-weight: 600;">
                            删除
                        </button>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

function formatTaskTime(time) {
    if (!time) return '-';
    const d = new Date(time);
    return `${d.getMonth()+1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function showCreateTaskModal() {
    document.getElementById('taskModalTitle').textContent = '新建资料';
    document.getElementById('taskId').value = '';
    document.getElementById('taskTitle').value = '';
    document.getElementById('taskDescription').value = '';
    document.getElementById('taskVideoFile').value = '';
    document.getElementById('videoFileInfo').style.display = 'none';
    document.getElementById('videoFileInfo').textContent = '';
    document.getElementById('uploadProgressContainer').style.display = 'none';
    document.getElementById('uploadProgressBar').style.width = '0%';
    document.getElementById('uploadProgressPercent').textContent = '0';
    document.getElementById('taskSubmitBtn').textContent = '保存';
    document.getElementById('taskModal').style.display = 'flex';
}

function editTask(taskId) {
    const task = trainingTasks.find(t => t.id === taskId);
    if (!task) return;

    document.getElementById('taskModalTitle').textContent = '编辑学习资料';
    document.getElementById('taskId').value = task.id;
    document.getElementById('taskTitle').value = task.title || '';
    document.getElementById('taskDescription').value = task.description || '';
    document.getElementById('taskVideoFile').value = '';
    document.getElementById('videoFileInfo').style.display = 'none';
    document.getElementById('taskSubmitBtn').textContent = '保存';
    document.getElementById('taskModal').style.display = 'flex';
}

function closeTaskModal() {
    document.getElementById('taskModal').style.display = 'none';
}

async function saveTask() {
    const taskId = document.getElementById('taskId').value;
    const title = document.getElementById('taskTitle').value.trim();
    const description = document.getElementById('taskDescription').value.trim();
    const videoFile = document.getElementById('taskVideoFile').files[0];
    const submitBtn = document.getElementById('taskSubmitBtn');

    if (!title) {
        alert('请输入资料标题');
        return;
    }

    // 禁用按钮，防止重复点击
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = '处理中...';
    }

    const data = {
        title,
        description
    };

    try {
        let res;
        let fileUrl = null;

        // 如果有视频文件，先上传
        if (videoFile) {
            try {
                // 显示转码提示
                const uploadStatus = document.getElementById('uploadStatus');
                if (uploadStatus) {
                    uploadStatus.textContent = '正在检测并转码视频，请稍候...';
                    uploadStatus.style.display = 'block';
                    uploadStatus.style.color = '#f59e0b';
                    uploadStatus.style.borderColor = 'rgba(245,158,11,0.3)';
                    uploadStatus.style.background = 'rgba(245,158,11,0.1)';
                }
                if (submitBtn) {
                    submitBtn.textContent = '转码中...';
                    submitBtn.disabled = true;
                }

                const uploadRes = await uploadWithProgress(
                    `${API_URL}/learning/upload`,
                    videoFile,
                    token
                );

                if (uploadRes.code !== 0) {
                    alert(uploadRes.msg || '文件上传失败');
                    return;
                }

                // 根据返回状态更新提示
                if (uploadRes.data) {
                    if (uploadRes.data.status === 'transcoded') {
                        if (uploadStatus) {
                            uploadStatus.textContent = '视频转码完成，正在上传...';
                            uploadStatus.style.color = '#10b981';
                            uploadStatus.style.borderColor = 'rgba(16,185,129,0.3)';
                            uploadStatus.style.background = 'rgba(16,185,129,0.1)';
                        }
                        if (submitBtn) {
                            submitBtn.textContent = '上传中...';
                        }
                    } else if (uploadRes.data.status === 'uploaded') {
                        // 不需要转码，直接上传
                        if (uploadStatus) {
                            uploadStatus.style.display = 'none';
                        }
                        if (submitBtn) {
                            submitBtn.textContent = '上传中...';
                        }
                    }
                }

                fileUrl = uploadRes.data.file_url;
                data.file_url = fileUrl;
                data.file_type = 'mp4';
                if (uploadRes.data.duration) {
                    data.duration = uploadRes.data.duration;
                }
            } catch (err) {
                alert(err.message || '文件上传失败');
                return;
            }
        }

        if (taskId) {
            // 更新
            res = await fetch(`${API_URL}/learning-materials/${taskId}`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(data)
            }).then(r => r.json());
        } else {
            // 创建
            res = await fetch(`${API_URL}/learning-materials`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(data)
            }).then(r => r.json());
        }

        if (res.code === 0) {
            // 如果有待恢复的培训表单，先恢复表单再刷新数据
            if (pendingExamForm) {
                const newTask = res.data;
                const form = pendingExamForm;
                pendingExamForm = null;

                // 将新创建的学习资料加入数组
                trainingTasks.push(newTask);

                // 关闭当前弹窗
                closeTaskModal();

                // 确保在培训任务标签页
                switchTab('papers');

                // 显示表单但不调用 showCreateExamForm（会重置 currentStep）
                const formEl = document.getElementById('createExamForm');
                const papersListContainer = document.getElementById('papersListContainer');
                if (papersListContainer) papersListContainer.style.display = 'none';
                if (formEl) formEl.style.display = 'block';

                // 设置 currentStep 为 2（学习资料）
                currentStep = 2;
                updateStepUI();
                currentEditingExamId = null;

                // 恢复表单数据
                document.getElementById('examTitle').value = form.title || '';
                document.getElementById('examDescription').value = form.description || '';
                document.getElementById('examDuration').value = form.duration || '60';
                document.getElementById('examPassScore').value = form.pass_score || '60';

                // 刷新学习资料下拉框并选中新建的资料
                const learningTaskSelect = document.getElementById('examLearningTask');
                if (learningTaskSelect) {
                    let options = '<option value="">请选择学习资料</option>';
                    if (trainingTasks && trainingTasks.length > 0) {
                        options += trainingTasks.map(t => `<option value="${t.id}">${t.title || '资料 ' + t.id}</option>`).join('');
                    }
                    options += '<option value="__new__">+ 创建新资料</option>';
                    learningTaskSelect.innerHTML = options;
                    // 选中新创建的资料
                    for (let i = 0; i < learningTaskSelect.options.length; i++) {
                        if (learningTaskSelect.options[i].value === String(newTask.id)) {
                            learningTaskSelect.options[i].selected = true;
                            break;
                        }
                    }
                }

                // 如果之前选了题库也恢复
                if (form.questionBankId) {
                    const questionBankSelect = document.getElementById('examQuestionBank');
                    if (questionBankSelect) {
                        for (let i = 0; i < questionBankSelect.options.length; i++) {
                            if (questionBankSelect.options[i].value === form.questionBankId) {
                                questionBankSelect.options[i].selected = true;
                                break;
                            }
                        }
                    }
                }
            } else {
                closeTaskModal();
                loadData();
            }
        } else {
            alert(res.msg || '操作失败');
        }
    } catch (err) {
        alert('操作失败: ' + err.message);
    } finally {
        // 重新启用按钮
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = '保存';
        }
    }
}

async function deleteTask(taskId) {
    if (!confirm('确定要删除此学习任务吗？')) return;

    try {
        const res = await fetch(`${API_URL}/learning-materials/${taskId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        }).then(r => r.json());

        if (res.code === 0) {
            loadData();
        } else {
            // 如果有相关培训信息，显示详情
            if (res.data?.related_trainings?.length > 0) {
                const trainings = res.data.related_trainings.map(t => `• ${t.title || '培训' + t.id}`).join('\n');
                alert(`${res.msg}\n\n关联培训：\n${trainings}\n\n请先删除或修改这些培训的学习资料设置。`);
            } else {
                alert(res.msg || '删除失败');
            }
        }
    } catch (err) {
        alert('删除失败');
    }
}

function closeQuestionImport() {
    document.getElementById('questionImportModal').style.display = 'none';
    // 清除pending状态
    localStorage.removeItem('pendingExamTitle');
    localStorage.removeItem('pendingExamDesc');
    localStorage.removeItem('pendingExamStartTime');
    localStorage.removeItem('pendingExamEndTime');
    localStorage.removeItem('pendingExamDuration');
    localStorage.removeItem('pendingExamPassScore');
    localStorage.removeItem('pendingExamMode');
    localStorage.removeItem('pendingQuestionTitle');
    localStorage.removeItem('pendingQuestionDesc');
    localStorage.removeItem('pendingQuestionBankId');
}

function showQuestionImport() {
    // 确保不是wizard模式
    localStorage.removeItem('pendingExamMode');
    document.getElementById('importExamTitle').value = '';
    document.getElementById('importExamDesc').value = '';
    document.getElementById('importText').value = '';
    document.getElementById('importFile').value = '';
    document.getElementById('fileInfo').textContent = '';
    document.getElementById('previewSection').style.display = 'none';
    document.getElementById('importResult').style.display = 'none';
    document.getElementById('questionImportModal').style.display = 'flex';
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
    const fileInput = document.getElementById('importFile');
    const file = fileInput?.files?.[0];

    console.log('previewQuestions called', { textLength: text.length, hasFile: !!file, fileName: file?.name });

    // 二选一：优先使用文件，其次使用文本
    if (!text && !file) {
        alert('请输入题目内容或上传文件');
        return;
    }

    try {
        let questions;
        if (file) {
            // 方式二：文件上传
            console.log('Using file:', file.name);
            const parseRes = await parseFileAPI(file);
            console.log('parseRes:', parseRes);
            if (parseRes.code !== 0) {
                alert(parseRes.msg || '文件解析失败');
                return;
            }
            // 将提取的文本存入textarea，供导入时使用
            document.getElementById('importText').value = parseRes.data.text || '';
            questions = parseRes.data.questions;
        } else {
            // 方式一：文本解析
            const res = await parseTextAPI(text);
            if (res.code !== 0) {
                alert(res.msg || '预览失败');
                return;
            }
            questions = res.data.questions;
        }

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
    } catch (err) {
        alert('预览失败');
    }
}

async function importQuestions() {
    // 检查token
    if (!token) {
        alert('请先登录');
        window.location.href = 'admin/login.html';
        return;
    }

    const examTitle = document.getElementById('importExamTitle').value.trim();
    const examDesc = document.getElementById('importExamDesc').value.trim();
    const text = document.getElementById('importText').value.trim();
    const fileInput = document.getElementById('importFile');
    const file = fileInput?.files?.[0];

    // 二选一：优先使用文件，其次使用文本
    if (!text && !file) {
        alert('请输入题目内容或上传文件');
        return;
    }

    if (!examTitle) {
        alert('请输入试卷标题');
        return;
    }

    // 检查是否是4步创建培训流程（通过pendingExamMode标记）
    const isWizardFlow = localStorage.getItem('pendingExamMode') === 'wizard';

    const resultEl = document.getElementById('importResult');

    try {
        if (isWizardFlow) {
            // 4步创建培训流程：创建题库并导入题目，然后进入第3步
            resultEl.className = 'import-result';
            resultEl.textContent = '正在创建题库...';
            resultEl.style.display = 'block';

            // 1. 创建题库
            const createRes = await fetch(`${API_URL}/question-banks`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    title: examTitle,
                    description: examDesc,
                    duration: 60,
                    pass_score: 60
                })
            }).then(r => r.json());

            if (createRes.code !== 0) {
                throw new Error(createRes.msg || '创建题库失败');
            }

            const bankId = createRes.data?.id;
            localStorage.setItem('pendingQuestionBankId', bankId);
            resultEl.textContent = '题库创建成功，正在导入题目...';

            // 2. 导入题目
            const qRes = await importQuestionsAPI(file || text, bankId);
            if (qRes.code !== 0) {
                throw new Error(qRes.msg || '导入题目失败');
            }

            // 保存到本地
            if (file) {
                pendingQuestionFile = file;
                pendingQuestionData = null;
            } else {
                pendingQuestionData = text;
                pendingQuestionFile = null;
            }
            localStorage.setItem('pendingQuestionTitle', examTitle);
            localStorage.setItem('pendingQuestionDesc', examDesc);

            // 添加新题库到数组
            questionBanks.push({
                id: bankId,
                title: examTitle,
                description: examDesc,
                question_count: qRes.data?.questionCount || 0,
                total_score: 0
            });

            resultEl.className = 'import-result success';
            resultEl.textContent = '✅ 导入成功！';
            setTimeout(() => {
                currentStep = 3;
                updateStepUI();
                closeQuestionImport();
            }, 800);
        } else {
            // 题库管理直接导入：直接创建题库并导入题目
            resultEl.className = 'import-result';
            resultEl.textContent = '正在创建题库...';
            resultEl.style.display = 'block';

            // 1. 创建题库
            const createRes = await fetch(`${API_URL}/question-banks`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    title: examTitle,
                    description: examDesc,
                    duration: 60,
                    pass_score: 60
                })
            }).then(r => r.json());

            if (createRes.code !== 0) {
                throw new Error(createRes.msg || '创建题库失败');
            }

            const bankId = createRes.data?.id;
            resultEl.textContent = '题库创建成功，正在导入题目...';

            // 调试日志
            console.log('importQuestions debug:', {
                fileExists: !!file,
                fileName: file?.name,
                textLength: text?.length,
                textPreview: text?.substring(0, 100)
            });

            // 2. 导入题目
            const qRes = await importQuestionsAPI(file || text, bankId);
            console.log('importQuestionsAPI result:', qRes);
            if (qRes.code !== 0) {
                throw new Error(qRes.msg || '导入题目失败');
            }

            resultEl.className = 'import-result success';
            resultEl.textContent = `✅ 导入成功！已创建题库《${examTitle}》`;
            setTimeout(() => {
                closeQuestionImport();
                // 刷新题库列表
                loadData();
            }, 1500);
        }
    } catch (err) {
        console.error('Import error:', err);
        resultEl.className = 'import-result error';
        resultEl.textContent = '导入失败: ' + (err?.message || String(err));
    }
}

async function importQuestionsAPI(data, paperId) {
    console.log('importQuestionsAPI called with:', { dataType: typeof data, isFile: data instanceof File, paperId });
    console.log('Token:', token ? 'exists' : 'MISSING');

    // 判断是文件还是文本
    if (data instanceof File) {
        // 文件上传
        const formData = new FormData();
        formData.append('file', data);
        formData.append('paperId', paperId);

        const res = await fetch(`${API_URL}/import/upload`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData
        });
        const result = await res.json();
        console.log('File import result:', result);
        return result;
    } else {
        // 文本上传
        console.log('Sending text import request:', { textLength: data.length, paperId });
        const res = await fetch(`${API_URL}/import/upload`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: data, paperId })
        });
        const result = await res.json();
        console.log('Text import result:', result);
        return result;
    }
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ============ 创建试卷 ============
function onQuestionBankChangeInline(value) {
    console.log('onQuestionBankChangeInline called, value=', value);
    const modal = document.getElementById('questionImportModal');
    console.log('questionImportModal element:', modal ? 'exists' : 'NOT FOUND');
    if (value === '__new__') {
        const title = document.getElementById('examTitle').value.trim();
        const description = document.getElementById('examDescription').value.trim();
        const start_time = document.getElementById('examStartTime').value;
        const end_time = document.getElementById('examEndTime').value;
        const duration = document.getElementById('examDuration').value || '60';
        const passScore = document.getElementById('examPassScore').value || '60';

        if (!title) {
            alert('请输入培训标题');
            document.getElementById('examQuestionBank').value = '';
            return;
        }

        pendingExamForm = {
            title, description, start_time, end_time, duration, pass_score: passScore,
            learningTaskId: document.getElementById('examLearningTask').value
        };

        localStorage.setItem('pendingExamTitle', title);
        localStorage.setItem('pendingExamDesc', description);
        localStorage.setItem('pendingExamStartTime', start_time);
        localStorage.setItem('pendingExamEndTime', end_time);
        localStorage.setItem('pendingExamDuration', duration);
        localStorage.setItem('pendingExamPassScore', passScore);
        localStorage.setItem('pendingExamMode', 'wizard');

        document.getElementById('importExamTitle').value = title;
        document.getElementById('importExamDesc').value = description;
        console.log('Setting questionImportModal display to flex');
        document.getElementById('questionImportModal').style.display = 'flex';
        console.log('questionImportModal display now:', document.getElementById('questionImportModal').style.display);
    } else if (value) {
        // 选择已有题库时，清除可能残留的待导入数据
        pendingQuestionFile = null;
        pendingQuestionData = null;
        localStorage.removeItem('pendingQuestionTitle');
        localStorage.removeItem('pendingQuestionDesc');
    }
}

function onLearningTaskChangeInline(value) {
    if (value === '__new__') {
        pendingExamForm = {
            title: document.getElementById('examTitle').value.trim(),
            description: document.getElementById('examDescription').value.trim(),
            start_time: document.getElementById('examStartTime').value,
            end_time: document.getElementById('examEndTime').value,
            duration: document.getElementById('examDuration').value || '60',
            pass_score: document.getElementById('examPassScore').value || '60',
            questionBankId: document.getElementById('examQuestionBank').value
        };
        hideCreateExamForm();
        showCreateTaskModal();
    }
}

let currentStep = 1;

function showCreateExamForm() {
    // 确保在培训任务标签页
    switchTab('papers');

    currentEditingExamId = null;
    currentStep = 1;
    step4SelectedIds.clear();
    const form = document.getElementById('createExamForm');
    if (!form) return;

    // 隐藏列表容器，显示表单
    const papersListContainer = document.getElementById('papersListContainer');
    if (papersListContainer) papersListContainer.style.display = 'none';
    form.style.display = 'block';

    // 刷新学习资料下拉框
    const learningTaskSelect = document.getElementById('examLearningTask');
    if (learningTaskSelect) {
        let options = '<option value="">请选择学习资料</option>';
        if (trainingTasks && trainingTasks.length > 0) {
            options += trainingTasks.map(t => `<option value="${t.id}">${t.title || '资料 ' + t.id}</option>`).join('');
        }
        options += '<option value="__new__">+ 创建新资料</option>';
        learningTaskSelect.innerHTML = options;
    }

    // 刷新题库下拉框
    const questionBankSelect = document.getElementById('examQuestionBank');
    if (questionBankSelect) {
        questionBankSelect.innerHTML = '<option value="">请选择题库</option>' +
            questionBanks.map(b => `<option value="${b.id}">${b.title || '题库 ' + b.id} (${b.question_count || 0}题)</option>`).join('') +
            '<option value="__new__">+ 创建新题库</option>';
        // 新建培训时，确保默认选中"请选择题库"
        questionBankSelect.selectedIndex = 0;
    }

    // 新建培训时清除残留的题库选择
    localStorage.removeItem('pendingQuestionBankId');

    // 重置表单（保持HTML默认值）
    document.getElementById('examLearningTask').value = '';
    document.getElementById('examQuestionBank').value = '';
    const participantFileEl = document.getElementById('examParticipantsFile');
    if (participantFileEl) participantFileEl.value = '';
    const participantFileInfoEl = document.getElementById('participantFileInfo');
    if (participantFileInfoEl) participantFileInfoEl.style.display = 'none';
    document.getElementById('createExamResult').style.display = 'none';
    document.getElementById('selectedLearningTask').style.display = 'none';
    document.getElementById('selectedQuestionBank').style.display = 'none';

    // 更新标题
    const formTitle = document.getElementById('examFormTitle');
    if (formTitle) formTitle.textContent = '新建培训';

    // 初始化步骤UI
    updateStepUI();

    // 重置权限方式为"全员授权"
    const radioAll = document.getElementById('radioAllStaff');
    const radioManual = document.getElementById('radioManual');
    if (radioAll) radioAll.checked = true;
    if (radioManual) radioManual.checked = false;

    // 初始化权限UI状态
    togglePermType();

    // 恢复暂存的内容
    // 新建培训时只恢复基本信息，不恢复学习资料和题库
    loadDraftExam(currentEditingExamId ? 'full' : 'basic');

    // 显示表单
    form.style.display = 'block';
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function updateStepUI() {
    console.log('updateStepUI called, currentStep:', currentStep);
    // 更新步骤指示器
    for (let i = 1; i <= 4; i++) {
        const stepItem = document.querySelector(`.step-item[data-step="${i}"]`);
        if (stepItem) {
            stepItem.classList.remove('active', 'completed');
            if (i < currentStep) {
                stepItem.classList.add('completed');
            } else if (i === currentStep) {
                stepItem.classList.add('active');
            }
        }
        const stepContent = document.getElementById(`step${i}`);
        if (stepContent) {
            stepContent.style.display = i === currentStep ? 'block' : 'none';
        }
    }

    // 更新按钮
    const prevBtn = document.getElementById('prevStepBtn');
    const nextBtn = document.getElementById('nextStepBtn');
    const submitBtn = document.getElementById('submitExamBtn');
    const draftBtn = document.getElementById('draftSubmitBtn');

    if (prevBtn) prevBtn.style.display = currentStep > 1 ? '' : 'none';
    if (nextBtn) nextBtn.style.display = currentStep < 4 ? '' : 'none';
    if (submitBtn) submitBtn.style.display = currentStep === 4 ? '' : 'none';
    if (draftBtn) draftBtn.style.display = currentStep === 4 ? 'none' : '';

    // 如果进入步骤3，刷新题库下拉框
    if (currentStep === 3) {
        refreshQuestionBankDropdown();
    }

    // 如果进入步骤4，初始化权限UI状态
    if (currentStep === 4) {
        togglePermType();
        if (document.getElementById('radioManual')?.checked && step4AllStaff.length === 0) {
            loadStep4StaffList();
        }
    }
}

function refreshQuestionBankDropdown() {
    const questionBankSelect = document.getElementById('examQuestionBank');
    if (questionBankSelect) {
        // 保存当前选中值
        const currentValue = questionBankSelect.value;
        questionBankSelect.innerHTML = '<option value="">请选择题库</option>' +
            questionBanks.map(b => `<option value="${b.id}">${b.title || '题库 ' + b.id} (${b.question_count || 0}题)</option>`).join('') +
            '<option value="__new__">+ 创建新题库</option>';
        // 自动选中待关联的题库（只有ID存在于questionBanks时才选中）
        const pendingBankId = localStorage.getItem('pendingQuestionBankId');
        if (pendingBankId && questionBanks.some(b => b.id == pendingBankId)) {
            questionBankSelect.value = pendingBankId;
        } else if (currentValue) {
            // 恢复之前的选中值
            questionBankSelect.value = currentValue;
        }
    }
}

let step4AllStaff = [];
let step4SelectedIds = new Set();
let step4AllDepartments = [];
let step4SelectedDepts = new Set();

// 部门排序
const DEPT_ORDER = ['总经办', '财务部', '行政部', '市场部', '项目部', '技术部', '品质部', '采购部', '生产部', '注塑部', '制品部'];
// 生产部班组排序
const TEAM_ORDER_PRODUCTION = ['生产部', '设备科', '工艺计划组', 'CNC组', '深孔钻组', '电火花组', '铣磨组', '线切割组', '钻床组', '抛光组', '钳工一组', '钳工二组', '钳工三组', '钳工四组', '钳工五组', '钳工六组', '钳工七组', '钳工八组', '钳工九组', '研配组'];

function sortDepartments(depts) {
    return depts.sort((a, b) => {
        const idxA = DEPT_ORDER.indexOf(a);
        const idxB = DEPT_ORDER.indexOf(b);
        if (idxA === -1 && idxB === -1) return a.localeCompare(b);
        if (idxA === -1) return 1;
        if (idxB === -1) return -1;
        return idxA - idxB;
    });
}

function sortTeams(teams) {
    return teams.sort((a, b) => {
        const idxA = TEAM_ORDER_PRODUCTION.indexOf(a);
        const idxB = TEAM_ORDER_PRODUCTION.indexOf(b);
        if (idxA === -1 && idxB === -1) return a.localeCompare(b);
        if (idxA === -1) return 1;
        if (idxB === -1) return -1;
        return idxA - idxB;
    });
}

async function loadStep4StaffList() {
    const container = document.getElementById('step4StaffList');
    if (!container) {
        console.log('loadStep4StaffList: container not found');
        return;
    }

    console.log('loadStep4StaffList: fetching staff data...');
    try {
        const res = await fetch(`${API_URL}/staff?all=1`, {
            headers: { 'Authorization': `Bearer ${token}` }
        }).then(r => r.json());

        console.log('loadStep4StaffList: response', res.code, 'data length:', res.data?.length);
        if (res.code === 0) {
            step4AllStaff = res.data || [];
            // 构建部门列表
            step4AllDepartments = sortDepartments([...new Set(step4AllStaff.filter(s => s.department).map(s => s.department))]);
            console.log('loadStep4StaffList: step4AllStaff set, length:', step4AllStaff.length, 'depts:', step4AllDepartments.length);
            // 默认全部不选
            step4SelectedIds.clear();
            step4SelectedDepts.clear();
            renderStep4DeptFilter();
            applyStep4Filters();
        } else {
            console.log('loadStep4StaffList: API error', res.msg);
            container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-soft);">加载失败</div>';
        }
    } catch (err) {
        console.log('loadStep4StaffList: fetch error', err);
        container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-soft);">加载失败</div>';
    }
}

async function loadStep4StaffWithPerm(examId) {
    const container = document.getElementById('step4StaffList');
    if (!container) return;

    try {
        // 获取该培训的所有员工（带权限标记）
        const res = await fetch(`${API_URL}/exam-trainings/${examId}/all-staff`, {
            headers: { 'Authorization': `Bearer ${token}` }
        }).then(r => r.json());

        if (res.code === 0) {
            step4AllStaff = res.data || [];
            // 构建部门列表
            step4AllDepartments = sortDepartments([...new Set(step4AllStaff.filter(s => s.department).map(s => s.department))]);
            // 根据 has_perm 设置选中状态
            step4SelectedIds.clear();
            step4AllStaff.forEach(s => {
                if (s.has_perm === 1) step4SelectedIds.add(s.id);
            });
            step4SelectedDepts.clear();
            renderStep4DeptFilter();
            applyStep4Filters();
        } else {
            container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-soft);">加载失败</div>';
        }
    } catch (err) {
        container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-soft);">加载失败</div>';
    }
}

function renderStep4DeptFilter() {
    const container = document.getElementById('step4DeptFilter');
    if (!container) return;

    container.innerHTML = step4AllDepartments.map(dept => {
        const isSelected = step4SelectedDepts.has(dept);
        const selectedInDept = step4AllStaff.filter(s => s.department === dept && step4SelectedIds.has(s.id)).length;
        const totalInDept = step4AllStaff.filter(s => s.department === dept).length;
        const bg = isSelected ? '#E8F0FF' : '#fff';
        const border = isSelected ? '#4A90E2' : '#D6E9FF';
        const color = isSelected ? '#4A90E2' : '#5B72A9';
        return `
            <label style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;cursor:pointer;border-radius:16px;font-size:11px;background:${bg};border:1px solid ${border};color:${color};transition:all 0.2s;white-space:nowrap;">
                <input type="checkbox" onchange="toggleStep4Dept('${dept}')" ${isSelected ? 'checked' : ''} style="display:none;">
                <span>${dept}</span>
                <span style="font-size:10px;">(${selectedInDept}/${totalInDept})</span>
            </label>
        `;
    }).join('');
}

function toggleStep4Dept(dept) {
    if (step4SelectedDepts.has(dept)) {
        step4SelectedDepts.delete(dept);
    } else {
        step4SelectedDepts.add(dept);
    }
    renderStep4DeptFilter();
    applyStep4Filters();
}

function applyStep4Filters() {
    const nameFilter = document.getElementById('step4SearchName')?.value.toLowerCase() || '';
    const empIdFilter = document.getElementById('step4SearchEmpId')?.value.toLowerCase() || '';
    const statusFilter = document.getElementById('step4SearchStatus')?.value || '';

    const filtered = step4AllStaff.filter(s => {
        // 部门筛选
        if (step4SelectedDepts.size > 0 && !step4SelectedDepts.has(s.department)) return false;
        // 姓名筛选
        if (nameFilter && !(s.name || '').toLowerCase().includes(nameFilter)) return false;
        // 工号筛选
        if (empIdFilter && !(s.employee_id || '').toLowerCase().includes(empIdFilter)) return false;
        // 状态筛选
        if (statusFilter === 'has' && !step4SelectedIds.has(s.id)) return false;
        if (statusFilter === 'no' && step4SelectedIds.has(s.id)) return false;
        return true;
    });

    renderStep4StaffList(filtered);
    document.getElementById('step4SelectedCount').textContent = step4SelectedIds.size;
}

function renderStep4StaffList(filtered) {
    const container = document.getElementById('step4StaffList');
    if (!container) return;

    if (filtered.length === 0) {
        container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-soft);">无匹配员工</div>';
        return;
    }

    // 按部门分组
    const deptMap = {};
    filtered.forEach(s => {
        const dept = s.department || '未分组';
        if (!deptMap[dept]) deptMap[dept] = [];
        deptMap[dept].push(s);
    });

    const depts = sortDepartments(Object.keys(deptMap));

    // 渲染单个分组（部门或班组）
    function renderGroup(groupName, staff, keyPrefix, isIndented = false) {
        const sortedStaff = staff.sort((a, b) => (a.employee_id || '').localeCompare(b.employee_id || '', undefined, { numeric: true }));
        const selectedCount = sortedStaff.filter(s => step4SelectedIds.has(s.id)).length;
        const allSelected = selectedCount === sortedStaff.length;

        // 分成4列
        const cols = [];
        for (let i = 0; i < 4; i++) {
            cols.push(sortedStaff.filter((_, idx) => idx % 4 === i));
        }

        const indentStyle = isIndented ? 'padding-left:20px;border-left:2px solid #E8F2FF;margin-left:8px;' : '';
        // 去掉groupName中"/"之前的内容
        const displayName = groupName.includes('/') ? groupName.split('/')[1] : groupName;

        return `
            <div style="margin-bottom:16px;${indentStyle}">
                <div style="display:flex;align-items:center;padding:6px 0;border-bottom:1px solid #E8F2FF;margin-bottom:8px;gap:8px;">
                    <input type="checkbox" onchange="toggleStep4DeptStaff('${keyPrefix}')" ${allSelected ? 'checked' : ''} style="width:16px;height:16px;cursor:pointer;accent-color:#4A90E2;flex-shrink:0;">
                    <span style="font-size:12px;font-weight:600;color:#1D2B5A;">${displayName}</span>
                    <span style="font-size:11px;color:#8B9DC3;margin-left:4px;">(${selectedCount}/${sortedStaff.length})</span>
                </div>
                <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;">
                    ${cols.map(col => `<div>${col.map(s => `
                        <div style="display:flex;align-items:center;padding:6px 8px;border-radius:6px;background:linear-gradient(135deg,#fff 0%,#F8FCFF 100%);border:1px solid #E8F2FF;margin-bottom:4px;gap:8px;transition:all 0.2s;">
                            <input type="checkbox" id="step4_staff_${s.id}" value="${s.id}"
                                ${step4SelectedIds.has(s.id) ? 'checked' : ''}
                                onchange="toggleStep4Staff(${s.id}); renderStep4DeptFilter(); applyStep4Filters();"
                                style="width:16px;height:16px;flex-shrink:0;">
                            <div style="width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#4A90E2,#65B3FF);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:600;font-size:12px;flex-shrink:0;box-shadow:0 2px 4px rgba(74,144,226,0.2);">
                                ${(s.name || '-').charAt(0)}
                            </div>
                            <div style="flex:1;min-width:0;">
                                <div style="font-size:12px;font-weight:600;color:#1D2B5A;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${s.name || '-'}</div>
                                <div style="font-size:10px;color:#8B9DC3;">${s.employee_id || ''}</div>
                            </div>
                        </div>
                    `).join('')}</div>`).join('')}
                </div>
            </div>
        `;
    }

    container.innerHTML = depts.map(dept => {
        const staff = deptMap[dept];

        // 生产部按班组细分，显示为层级结构
        if (dept === '生产部') {
            const teamMap = {};
            staff.forEach(s => {
                const team = s.team || '未分组';
                if (!teamMap[team]) teamMap[team] = [];
                teamMap[team].push(s);
            });
            const teams = sortTeams(Object.keys(teamMap));

            // 计算生产部总人数和已选人数
            const totalCount = staff.length;
            const selectedTotal = staff.filter(s => step4SelectedIds.has(s.id)).length;
            const allSelected = selectedTotal === totalCount;

            // 生产部大组header
            let html = `
                <div style="margin-bottom:16px;">
                    <div style="display:flex;align-items:center;padding:8px 12px;background:linear-gradient(135deg,#EEF4FF,#E8F0FF);border-radius:8px;margin-bottom:12px;gap:8px;">
                        <input type="checkbox" onchange="toggleStep4DeptStaff('生产部')" ${allSelected ? 'checked' : ''} style="width:18px;height:18px;cursor:pointer;accent-color:#4A90E2;flex-shrink:0;">
                        <span style="font-size:13px;font-weight:700;color:#1D2B5A;">生产部</span>
                        <span style="font-size:12px;color:#8B9DC3;margin-left:4px;">(${selectedTotal}/${totalCount})</span>
                    </div>
            `;

            // 渲染每个班组
            teams.forEach(team => {
                html += renderGroup(team, teamMap[team], `生产部:${team}`, true);
            });

            html += '</div>';
            return html;
        }

        return renderGroup(dept, staff, dept);
    }).join('');
}

function toggleStep4Staff(id) {
    if (step4SelectedIds.has(id)) {
        step4SelectedIds.delete(id);
    } else {
        step4SelectedIds.add(id);
    }
    document.getElementById('step4SelectedCount').textContent = step4SelectedIds.size;
}

function toggleStep4DeptStaff(key) {
    let staffInGroup;

    if (key === '生产部') {
        // 切换整个生产部
        staffInGroup = step4AllStaff.filter(s => s.department === '生产部');
    } else if (key.startsWith('生产部:')) {
        // 切换特定班组
        const team = key.substring(4);
        staffInGroup = step4AllStaff.filter(s => s.department === '生产部' && s.team === team);
    } else {
        staffInGroup = step4AllStaff.filter(s => s.department === key);
    }

    const allSelected = staffInGroup.every(s => step4SelectedIds.has(s.id));

    if (allSelected) {
        staffInGroup.forEach(s => step4SelectedIds.delete(s.id));
    } else {
        staffInGroup.forEach(s => step4SelectedIds.add(s.id));
    }

    renderStep4DeptFilter();
    applyStep4Filters();
}

function togglePermType() {
    const radioAll = document.getElementById('radioAllStaff');
    const radioManual = document.getElementById('radioManual');
    const manualSection = document.getElementById('manualPermSection');
    const radioAllLabel = document.getElementById('radioAllStaffLabel');
    const radioManualLabel = document.getElementById('radioManualLabel');

    // 如果元素不存在，直接返回
    if (!radioAll || !radioManual || !manualSection || !radioAllLabel || !radioManualLabel) {
        console.log('togglePermType: element not found', { radioAll: !!radioAll, radioManual: !!radioManual, manualSection: !!manualSection });
        return;
    }

    console.log('togglePermType called, isAll:', radioAll.checked, 'manualSection display before:', manualSection.style.display);
    const isAll = radioAll.checked;

    if (isAll) {
        manualSection.style.display = 'none';
        radioAllLabel.style.borderColor = 'var(--primary)';
        radioAllLabel.style.background = 'rgba(74,144,226,0.08)';
        radioManualLabel.style.borderColor = 'var(--border)';
        radioManualLabel.style.background = 'var(--bg)';
    } else {
        manualSection.style.display = 'block';
        radioManualLabel.style.borderColor = 'var(--primary)';
        radioManualLabel.style.background = 'rgba(74,144,226,0.08)';
        radioAllLabel.style.borderColor = 'var(--border)';
        radioAllLabel.style.background = 'var(--bg)';
        // 滚动到手工选择区域
        setTimeout(() => {
            manualSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
        // 加载员工列表
        console.log('togglePermType else branch: currentEditingExamId:', currentEditingExamId, 'step4AllStaff.length:', step4AllStaff.length);
        if (step4AllStaff.length === 0) {
            // 如果有正在编辑的培训，加载该培训的授权人员；否则加载全部员工
            if (currentEditingExamId) {
                loadStep4StaffWithPerm(currentEditingExamId);
            } else {
                loadStep4StaffList();
            }
        }
    }
}

// 员工列表禁止页面滚动
document.addEventListener('wheel', function(e) {
    const staffList = document.getElementById('step4StaffList');
    const manualSection = document.getElementById('manualPermSection');
    if (!staffList || !manualSection) return;
    if (manualSection.style.display === 'none') return;

    // 检查鼠标是否在员工列表内
    const rect = staffList.getBoundingClientRect();
    const isOverStaffList = e.clientX >= rect.left && e.clientX <= rect.right &&
                            e.clientY >= rect.top && e.clientY <= rect.bottom;

    if (isOverStaffList) {
        e.preventDefault();
        staffList.scrollTop += e.deltaY;
    }
}, { passive: false });

function filterStaffList(filter) {
    renderStep4StaffList(filter);
}

function selectAllStep4Staff() {
    step4AllStaff.forEach(s => step4SelectedIds.add(s.id));
    renderStep4DeptFilter();
    applyStep4Filters();
}

function deselectAllStep4Staff() {
    step4SelectedIds.clear();
    renderStep4DeptFilter();
    applyStep4Filters();
}

// 部门选择弹窗
function showDeptSelectModal() {
    const modal = document.getElementById('deptSelectModal');
    const container = document.getElementById('deptCheckboxes');

    // 获取所有部门
    const deptMap = {};
    step4AllStaff.forEach(s => {
        const dept = s.department || '未分组';
        if (!deptMap[dept]) deptMap[dept] = [];
        deptMap[dept].push(s);
    });

    const depts = sortDepartments(Object.keys(deptMap));
    container.innerHTML = depts.map(dept => `
        <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border);">
            <input type="checkbox" id="dept_${dept}" value="${dept}" onchange="toggleDeptSelect('${dept}')" style="width:16px;height:16px;">
            <label for="dept_${dept}" style="flex:1;cursor:pointer;">${dept}</label>
            <span style="font-size:11px;color:var(--text-muted);">${deptMap[dept].length}人</span>
        </div>
    `).join('');

    modal.classList.add('active');
}

function closeDeptSelectModal() {
    document.getElementById('deptSelectModal').classList.remove('active');
}

function toggleDeptSelect(dept) {
    // This is just for visual feedback, the actual selection happens in confirmDeptSelect
}

function confirmDeptSelect() {
    const checkboxes = document.querySelectorAll('#deptCheckboxes input[type="checkbox"]');
    const selectedDepts = [];
    checkboxes.forEach(cb => {
        if (cb.checked) {
            selectedDepts.push(cb.value);
        }
    });

    // 选中所有属于所选部门的员工
    step4AllStaff.forEach(s => {
        const dept = s.department || '未分组';
        if (selectedDepts.includes(dept)) {
            step4SelectedIds.add(s.id);
        }
    });

    closeDeptSelectModal();
    renderStep4StaffList(document.getElementById('staffSearchInput')?.value || '');
}

function validateStep1() {
    const title = document.getElementById('examTitle').value.trim();
    const startTime = document.getElementById('examStartTime').value;
    const endTime = document.getElementById('examEndTime').value;
    const duration = document.getElementById('examDuration').value;
    const passScore = document.getElementById('examPassScore').value;

    if (!title) { alert('请输入培训标题'); return false; }
    if (!startTime) { alert('请选择培训开始时间'); return false; }
    if (!endTime) { alert('请选择培训结束时间'); return false; }
    if (new Date(startTime) >= new Date(endTime)) { alert('培训结束时间必须晚于开始时间'); return false; }
    if (!duration || duration < 1) { alert('请输入有效的考试时长'); return false; }
    if (!passScore || passScore < 1 || passScore > 100) { alert('请输入有效的及格分数(1-100)'); return false; }
    return true;
}

function nextStep() {
    console.log('nextStep called, currentStep=', currentStep);
    if (currentStep === 1) {
        if (!validateStep1()) return;
    }
    if (currentStep < 4) {
        currentStep++;
        console.log('nextStep: after increment currentStep=', currentStep, 'step4 display=', document.getElementById('step4')?.style.display);
        updateStepUI();
        console.log('nextStep: after updateStepUI step4 display=', document.getElementById('step4')?.style.display);
    } else {
        console.log('nextStep: currentStep >= 4, not incrementing');
    }
}

function prevStep() {
    if (currentStep > 1) {
        currentStep--;
        updateStepUI();
    }
}

function hideCreateExamForm() {
    const form = document.getElementById('createExamForm');
    if (form) form.style.display = 'none';
    // 显示列表容器
    const papersListContainer = document.getElementById('papersListContainer');
    if (papersListContainer) papersListContainer.style.display = 'block';
    currentStep = 1;
    step4SelectedIds.clear();
    isEditingDraft = false;
    // 关闭时清除本地暂存
    clearDraftExam();
}

function showCreateExamModal() {
    showCreateExamForm();
}

function closeCreateExamModal() {
    hideCreateExamForm();
    currentEditingExamId = null;
}

async function draftExam() {
    const title = document.getElementById('examTitle').value.trim();
    const description = document.getElementById('examDescription').value.trim();
    const start_time = document.getElementById('examStartTime').value || null;
    const end_time = document.getElementById('examEndTime').value || null;
    const duration = parseInt(document.getElementById('examDuration').value) || 60;
    const pass_score = parseInt(document.getElementById('examPassScore').value) || 60;
    const questionBankId = document.getElementById('examQuestionBank').value;
    const learningTaskId = document.getElementById('examLearningTask').value;
    const participantFileEl = document.getElementById('examParticipantsFile');
    const participantFile = participantFileEl ? participantFileEl.files[0] : null;

    if (!title) {
        alert('请输入培训标题');
        return;
    }

    const resultEl = document.getElementById('createExamResult');

    try {
        let res;

        // 如果正在编辑（草稿或正式培训），更新现有记录
        if (currentEditingExamId) {
            res = await fetch(`${API_URL}/exam-trainings/${currentEditingExamId}`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    title,
                    description,
                    start_time,
                    end_time,
                    duration,
                    pass_score,
                    question_bank_id: questionBankId && questionBankId !== '__new__' ? parseInt(questionBankId) : null,
                    learning_task_id: learningTaskId && learningTaskId !== '__new__' ? parseInt(learningTaskId) : null
                })
            }).then(r => r.json());

            if (res.code === 0) {
                resultEl.className = 'import-result success';
                resultEl.textContent = '培训已保存！';
                resultEl.style.display = 'block';

                // 清除本地暂存
                clearDraftExam();

                // 保持编辑状态，不关闭表单
                setTimeout(() => {
                    resultEl.style.display = 'none';
                }, 1500);
            } else {
                resultEl.className = 'import-result error';
                resultEl.textContent = res.msg || '保存失败';
                resultEl.style.display = 'block';
            }
        } else {
            // 创建新草稿
            res = await fetch(`${API_URL}/exam-trainings`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    title,
                    description,
                    start_time,
                    end_time,
                    duration,
                    pass_score,
                    is_active: false,
                    is_draft: 1,
                    question_bank_id: questionBankId && questionBankId !== '__new__' ? parseInt(questionBankId) : null,
                    learning_task_id: learningTaskId && learningTaskId !== '__new__' ? parseInt(learningTaskId) : null
                })
            }).then(r => r.json());

            if (res.code === 0) {
                resultEl.className = 'import-result success';
                resultEl.textContent = '培训已保存！';
                resultEl.style.display = 'block';

                // 设置 currentEditingExamId，这样后续暂存会更新同一张草稿
                currentEditingExamId = res.data.id;
                isEditingDraft = true;

                // 清除本地暂存
                clearDraftExam();

                // 保存第四步选择的员工权限
                if (step4SelectedIds.size > 0) {
                    await fetch(`${API_URL}/exam-trainings/${res.data.id}/permissions`, {
                        method: 'PUT',
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ staff_ids: [...step4SelectedIds] })
                    });
                }

                // 如果上传了人员文件，导入人员
                if (participantFile) {
                    await importParticipants(res.data.id, participantFile);
                }

                // 保持编辑状态，不关闭表单
                setTimeout(() => {
                    resultEl.style.display = 'none';
                }, 1500);
            } else {
                resultEl.className = 'import-result error';
                resultEl.textContent = res.msg || '保存失败';
                resultEl.style.display = 'block';
            }
        }
    } catch (err) {
        alert('保存失败');
    }
}

async function createExam() {
    const title = document.getElementById('examTitle').value.trim();
    const description = document.getElementById('examDescription').value.trim();
    const start_time = document.getElementById('examStartTime').value || null;
    const end_time = document.getElementById('examEndTime').value || null;
    const duration = parseInt(document.getElementById('examDuration').value) || 60;
    const pass_score = parseInt(document.getElementById('examPassScore').value) || 60;
    const questionBankId = document.getElementById('examQuestionBank').value;
    const learningTaskId = document.getElementById('examLearningTask').value;
    const participantFileEl = document.getElementById('examParticipantsFile');
    const participantFile = participantFileEl ? participantFileEl.files[0] : null;
    const permType = document.querySelector('input[name="permType"]:checked')?.value || 'all';

    // 验证所有必填项
    if (!title) {
        alert('请输入培训标题');
        jumpToStep(1);
        return;
    }
    if (!start_time) {
        alert('请选择培训开始时间');
        jumpToStep(1);
        return;
    }
    if (!end_time) {
        alert('请选择培训结束时间');
        jumpToStep(1);
        return;
    }
    if (!duration || duration < 1) {
        alert('请输入有效的考试时长');
        jumpToStep(1);
        return;
    }
    if (!pass_score || pass_score < 1 || pass_score > 100) {
        alert('请输入有效的及格分数（1-100）');
        jumpToStep(1);
        return;
    }
    if (!learningTaskId) {
        alert('请选择关联学习资料');
        jumpToStep(2);
        return;
    }
    if (!questionBankId) {
        alert('请选择关联题库试卷');
        jumpToStep(3);
        return;
    }
    // 验证权限：如果是手动选择，必须至少选择一人
    if (permType === 'manual') {
        const selectedCount = document.getElementById('step4SelectedCount')?.textContent || '0';
        if (parseInt(selectedCount) === 0) {
            alert('请选择参与培训的人员，或选择"全员授权"');
            jumpToStep(4);
            return;
        }
    }

    // 如果选择创建新题库，先打开导入弹窗
    if (questionBankId === '__new__') {
        localStorage.setItem('pendingExamTitle', title);
        localStorage.setItem('pendingExamDesc', description);
        localStorage.setItem('pendingExamStartTime', start_time);
        localStorage.setItem('pendingExamEndTime', end_time);
        localStorage.setItem('pendingExamDuration', duration);
        localStorage.setItem('pendingExamPassScore', pass_score);
        localStorage.setItem('pendingLearningTaskId', learningTaskId);

        document.getElementById('importExamTitle').value = title;
        document.getElementById('importExamDesc').value = description;
        document.getElementById('questionImportModal').style.display = 'flex';
        return;
    }

    const resultEl = document.getElementById('createExamResult');

    try {
        let res;
        let successMsg = '';
        let newExam = null;

        // 如果是编辑模式，更新现有考试
        if (currentEditingExamId) {
            res = await fetch(`${API_URL}/exam-trainings/${currentEditingExamId}`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    title, description, start_time, end_time, duration, pass_score,
                    learning_task_id: learningTaskId && learningTaskId !== '__new__' ? parseInt(learningTaskId) : null,
                    question_bank_id: questionBankId && questionBankId !== '__new__' ? parseInt(questionBankId) : null,
                    perm_type: permType
                })
            }).then(r => r.json());

            if (res.code !== 0) {
                resultEl.className = 'import-result error';
                resultEl.textContent = res.msg || '更新失败';
                resultEl.style.display = 'block';
                return;
            }

            // 如果是在编辑草稿，发布草稿为正式培训
            if (isEditingDraft) {
                const publishRes = await fetch(`${API_URL}/exam-trainings/${currentEditingExamId}/publish`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}` }
                }).then(r => r.json());

                if (publishRes.code !== 0) {
                    resultEl.className = 'import-result error';
                    resultEl.textContent = '更新成功但发布失败: ' + (publishRes.msg || '');
                    resultEl.style.display = 'block';
                    return;
                }
                successMsg = '培训已发布！';
                isEditingDraft = false;
            } else {
                successMsg = '考试设置已保存！';
            }
        } else {
            // 创建新培训
            res = await fetch(`${API_URL}/exam-trainings`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    title, description, start_time, end_time, duration, pass_score,
                    is_active: false,
                    is_draft: 0,
                    question_bank_id: questionBankId && questionBankId !== '__new__' ? parseInt(questionBankId) : null,
                    learning_task_id: learningTaskId && learningTaskId !== '__new__' ? parseInt(learningTaskId) : null
                })
            }).then(r => r.json());

            if (res.code !== 0) {
                resultEl.className = 'import-result error';
                resultEl.textContent = res.msg || '创建失败';
                resultEl.style.display = 'block';
                return;
            }

            newExam = res.data;
            successMsg = '考试创建成功！';

            // 如果有待导入的题库，先导入题库
            if (pendingQuestionFile || pendingQuestionData) {
                const examId = newExam.id;
                let qRes;
                if (pendingQuestionFile) {
                    qRes = await importQuestionsAPI(pendingQuestionFile, examId);
                } else {
                    qRes = await importQuestionsAPI(pendingQuestionData, examId);
                }
                if (qRes.code === 0) {
                    const qCount = qRes.data?.questionCount || qRes.data?.count || 0;
                    successMsg += `，已导入 ${qCount} 题`;
                }
                // 清除待导入数据
                pendingQuestionFile = null;
                pendingQuestionData = null;
                localStorage.removeItem('pendingQuestionTitle');
                localStorage.removeItem('pendingQuestionDesc');
            }
        }

        // 如果上传了人员文件，导入人员
        if (participantFile) {
            await importParticipants(newExam ? newExam.id : currentEditingExamId, participantFile);
            successMsg += ' 已导入考试人员';
        }

        // 保存第四步选择的员工权限
        const examId = newExam ? newExam.id : currentEditingExamId;
        const isAllStaff = document.getElementById('radioAllStaff')?.checked;

        if (isAllStaff) {
            // 全员授权：保存所有员工
            if (step4AllStaff.length === 0) {
                // 如果还没加载员工列表，先获取
                const staffRes = await fetch(`${API_URL}/staff?limit=10000`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                }).then(r => r.json());
                step4AllStaff = staffRes.data || [];
            }
            const permRes = await fetch(`${API_URL}/exam-trainings/${examId}/permissions`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ staff_ids: step4AllStaff.map(s => s.id) })
            }).then(r => r.json());

            if (permRes.code !== 0) {
                resultEl.className = 'import-result error';
                resultEl.textContent = '保存权限失败: ' + (permRes.msg || '未知错误');
                resultEl.style.display = 'block';
                return;
            }
        } else if (step4SelectedIds.size > 0) {
            // 手动选择：保存选中的员工
            const permRes = await fetch(`${API_URL}/exam-trainings/${examId}/permissions`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ staff_ids: [...step4SelectedIds] })
            }).then(r => r.json());

            if (permRes.code !== 0) {
                resultEl.className = 'import-result error';
                resultEl.textContent = '保存权限失败: ' + (permRes.msg || '未知错误');
                resultEl.style.display = 'block';
                return;
            }
        }

        resultEl.className = 'import-result success';
        resultEl.textContent = successMsg;
        resultEl.style.display = 'block';

        currentEditingExamId = null;
        isEditingDraft = false;

        // 清除暂存的内容
        clearDraftExam();

        setTimeout(() => {
            closeCreateExamModal();
            loadData();
        }, 1500);
    } catch (err) {
        console.error('创建培训失败:', err);
        resultEl.className = 'import-result error';
        resultEl.textContent = '操作失败: ' + (err.message || String(err));
        resultEl.style.display = 'block';
    }
}

async function copyQuestionsFromBank(sourceExamId, targetExamId) {
    try {
        await fetch(`${API_URL}/exam-trainings/${sourceExamId}/copy-questions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ targetExamId })
        });
    } catch (err) {
        console.error('复制题目失败:', err);
    }
}

async function importParticipants(examId, file) {
    const formData = new FormData();
    formData.append('file', file);

    try {
        const res = await fetch(`${API_URL}/exam-trainings/${examId}/import-participants`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData
        });
        return res.json();
    } catch (err) {
        console.error('导入人员失败:', err);
    }
}

function downloadParticipantTemplate() {
    const link = document.createElement('a');
    link.href = '/uploads/考试人员导入模板.xlsx';
    link.download = '考试人员导入模板.xlsx';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// ============ 启用/停止考试 ============
let currentToggleExamId = null;

async function toggleExamStatus(examId, currentStatus, currentTaskId) {
    if (currentStatus === 1) {
        // 当前是启用状态，点击变为停用
        if (!confirm('确定要停用此考试吗？停用后所有考试权限将失效。')) {
            return;
        }
        try {
            const res = await fetch(`${API_URL}/exam-trainings/${examId}`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ is_active: false })
            }).then(r => r.json());

            if (res.code === 0) {
                loadData();
            } else {
                alert(res.msg || '操作失败');
            }
        } catch (err) {
            alert('操作失败');
        }
    } else {
        // 当前是停止状态，点击变为启用
        // 先检查是否绑定学习任务
        if (!currentTaskId || currentTaskId === 0) {
            alert('启用考试前请先在"设置"中绑定学习任务');
            return;
        }

        // 检查是否配置了考试人员权限
        try {
            const permRes = await fetch(`${API_URL}/exam-trainings/${examId}/permissions`, {
                headers: { 'Authorization': `Bearer ${token}` }
            }).then(r => r.json());

            const permCount = permRes.data?.length || 0;
            if (permCount === 0) {
                alert('启用考试前请先在"设置"中导入考试人员');
                return;
            }

            // 检查通过，弹出学习任务选择确认
            currentToggleExamId = examId;
            await showTaskSelectModal(examId, currentTaskId);
        } catch (err) {
            alert('检查权限失败');
        }
    }
}

// 查看考试人员权限
let currentPermExamId = null;
async function viewExamPermissions(examId) {
    const targetExamId = examId || currentEditingExamId;
    if (!targetExamId) {
        alert('无法获取考试ID');
        return;
    }

    currentPermExamId = targetExamId;
    console.log('viewExamPermissions called with examId:', targetExamId);

    try {
        const url = `${API_URL}/exam-trainings/${targetExamId}/all-staff`;
        console.log('Fetching URL:', url);
        console.log('Token:', token ? 'exists' : 'missing');

        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        console.log('Response status:', response.status);
        console.log('Response statusText:', response.statusText);

        if (!response.ok) {
            throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
        }

        const res = await response.json();
        console.log('viewExamPermissions response:', res);

        if (res.code !== 0) {
            alert(res.msg || '获取权限失败');
            return;
        }

        // 只显示有权限的人员
        const authorizedStaff = (res.data || []).filter(s => s.has_perm === 1);
        showPermissionsModal(authorizedStaff, true);
    } catch (err) {
        console.error('viewExamPermissions error:', err);
        alert('获取权限失败: ' + (err.message || '未知错误'));
    }
}

function showPermissionsModal(staffList, isReadOnly = false) {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'permissionsModal';
    modal.style.cssText = 'position:fixed;z-index:2000;left:0;top:0;width:100%;height:100%;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;';

    // 按部门分组
    const deptMap = {};
    staffList.forEach(s => {
        const dept = s.department || '未分组';
        if (!deptMap[dept]) deptMap[dept] = [];
        deptMap[dept].push(s);
    });

    const depts = sortDepartments(Object.keys(deptMap));
    const selectedCount = staffList.filter(s => s.has_perm).length;

    // 获取所有部门用于筛选
    const allDepts = sortDepartments([...new Set(staffList.map(s => s.department || '未分组'))]);

    modal.innerHTML = `
        <div style="background:#fff;border-radius:22px;padding:24px;width:90%;max-width:900px;height:80vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 25px 60px rgba(15,25,60,0.15),0 8px 20px rgba(74,144,226,0.1);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-shrink:0;">
                <div style="font-size:18px;font-weight:700;">${isReadOnly ? '授权培训人员预览' : '授权培训人员'} (<span id="permSelectedCount">${selectedCount}</span>/<span id="permTotalCount">${staffList.length}</span>)</div>
                <button onclick="closePermissionsModal()" style="border:none;background:none;font-size:24px;cursor:pointer;">×</button>
            </div>

            <div style="margin-bottom:12px;padding:12px 16px;background:#F8FCFF;border-radius:12px;flex-shrink:0;">
                <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
                    <input type="text" id="permFilterName" placeholder="姓名" oninput="filterPermStaff()" style="padding:8px 12px;border-radius:8px;border:1px solid #E5F0FF;font-size:13px;width:90px;outline:none;">
                    <input type="text" id="permFilterEmployeeId" placeholder="工号" oninput="filterPermStaff()" style="padding:8px 12px;border-radius:8px;border:1px solid #E5F0FF;font-size:13px;width:80px;outline:none;">
                    ${!isReadOnly ? `
                    <select id="permFilterAuth" onchange="filterPermStaff()" style="padding:8px 12px;border-radius:8px;border:1px solid #E5F0FF;font-size:13px;outline:none;color:#5B72A9;background:#fff;">
                        <option value="">授权状态</option>
                        <option value="authorized">已授权</option>
                        <option value="unauthorized">未授权</option>
                    </select>
                    ` : ''}
                    <div style="flex:1;"></div>
                    <div id="permParticipantCount" style="font-size:13px;color:#8B9DC3;">共 ${staffList.length} 人</div>
                </div>
                <div id="permDeptFilterArea" style="margin-top:12px;padding-top:12px;border-top:1px solid #E5F0FF;display:flex;flex-wrap:wrap;gap:8px;">
                    ${allDepts.map(d => `
                        <label style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:20px;font-size:12px;color:#5B72A9;background:#fff;border:1px solid #E5F0FF;transition:all 0.2s;">
                            <input type="checkbox" value="${d}" onchange="togglePermDeptFilter(this)" style="display:none;">
                            <span>${d}</span>
                            <span style="font-size:10px;color:#8B9DC3;">(${staffList.filter(s => (s.department || '未分组') === d).length})</span>
                        </label>
                    `).join('')}
                </div>
            </div>

            <div id="permStaffList" style="flex:1;overflow-y:auto;border-radius:12px;border:1px solid #F0F7FF;background:#fff;padding:12px;min-height:0;">
                ${staffList.length === 0 ? '<div style="text-align:center;padding:40px;color:#8B9DC3;">暂无员工数据</div>' : ''}
            </div>

            ${!isReadOnly ? `
            <div style="display:flex;gap:12px;margin-top:20px;padding:16px;background:#fff;border-radius:16px;border:1px solid #D6E9FF;flex-shrink:0;">
                <button onclick="savePermissions()" style="flex:1;padding:12px 24px;background:linear-gradient(135deg,#4A90E2,#65B3FF);color:#fff;border:none;border-radius:12px;font-weight:600;font-size:14px;cursor:pointer;box-shadow:0 4px 12px rgba(74,144,226,0.2);transition:all 0.3s;">保存</button>
                <button onclick="closePermissionsModal()" style="flex:1;padding:12px 24px;background:#fff;color:#5B72A9;border:1px solid #D6E9FF;border-radius:12px;font-weight:600;font-size:14px;cursor:pointer;transition:all 0.3s;">取消</button>
            </div>
            ` : ''}
        </div>
    `;

    document.body.appendChild(modal);

    // 存储原始数据和部门映射
    window.permAllStaff = staffList;
    window.permSelectedDepts = [];
    window.permDeptMap = deptMap;
    window.isPermModalReadOnly = isReadOnly;

    // 初始渲染
    renderPermStaffList();
}

function togglePermDeptFilter(checkbox) {
    const label = checkbox.parentElement;
    const dept = checkbox.value;
    if (checkbox.checked) {
        window.permSelectedDepts.push(dept);
        label.style.background = '#E8F0FF';
        label.style.borderColor = '#4A90E2';
        label.style.color = '#4A90E2';
    } else {
        window.permSelectedDepts = window.permSelectedDepts.filter(d => d !== dept);
        label.style.background = '#fff';
        label.style.borderColor = '#E5F0FF';
        label.style.color = '#5B72A9';
    }
    renderPermStaffList();
}

function filterPermStaff() {
    renderPermStaffList();
}

function renderPermStaffList() {
    const nameFilter = document.getElementById('permFilterName').value.toLowerCase();
    const empIdFilter = document.getElementById('permFilterEmployeeId').value.toLowerCase();
    const selectedDepts = window.permSelectedDepts || [];
    const staffList = window.permAllStaff || [];

    let filtered = staffList.filter(s => {
        // 姓名搜索支持拼音首字母
        const matchName = nameFilter && (
            s.name.toLowerCase().includes(nameFilter) ||
            (s.name_pinyin && s.name_pinyin.toLowerCase().includes(nameFilter))
        );
        if (nameFilter && !matchName) return false;

        if (empIdFilter && !(s.employee_id && s.employee_id.toLowerCase().includes(empIdFilter))) return false;
        if (selectedDepts.length > 0 && !selectedDepts.includes(s.department || '未分组')) return false;

        // 授权状态筛选
        const authFilterEl = document.getElementById('permFilterAuth');
        const authFilter = authFilterEl ? authFilterEl.value : '';
        if (authFilter === 'authorized' && !s.has_perm) return false;
        if (authFilter === 'unauthorized' && s.has_perm) return false;

        return true;
    });

    const container = document.getElementById('permStaffList');
    document.getElementById('permParticipantCount').textContent = `共 ${filtered.length} 人`;

    if (filtered.length === 0) {
        container.innerHTML = '<div style="text-align:center;padding:40px;color:#8B9DC3;">暂无匹配数据</div>';
        return;
    }

    // 按部门分组
    const deptMap = {};
    filtered.forEach(s => {
        const dept = s.department || '未分组';
        if (!deptMap[dept]) deptMap[dept] = [];
        deptMap[dept].push(s);
    });

    const depts = sortDepartments(Object.keys(deptMap));

    // 渲染单个分组
    function renderPermGroup(groupName, staff, keyPrefix, isIndented = false) {
        const sortedStaff = staff.sort((a, b) => (a.employee_id || '').localeCompare(b.employee_id || '', undefined, { numeric: true }));
        // 分成4列
        const cols = [];
        for (let i = 0; i < 4; i++) {
            cols.push(sortedStaff.filter((_, idx) => idx % 4 === i));
        }

        const renderItem = (s) => `
            <div style="display:flex;align-items:center;padding:8px 10px;border-radius:8px;background:#FAFAFA;margin-bottom:6px;gap:8px;">
                <div style="width:26px;height:26px;border-radius:50%;background:linear-gradient(135deg,#4A90E2,#65B3FF);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:600;font-size:11px;flex-shrink:0;">
                    ${s.name.charAt(0)}
                </div>
                <div style="flex:1;min-width:60px;">
                    <div style="font-size:12px;font-weight:500;color:#1D2B5A;">${s.name}</div>
                    <div style="font-size:10px;color:#8B9DC3;">${s.employee_id || ''}</div>
                </div>
            </div>
        `;

        // 去掉groupName中"/"之前的内容
        const displayName = groupName.includes('/') ? groupName.split('/')[1] : groupName;
        const indentStyle = isIndented ? 'padding-left:20px;border-left:2px solid #E8F0FF;margin-left:8px;' : '';

        return `
            <div style="margin-bottom:12px;${indentStyle}">
                <div style="display:flex;align-items:center;gap:8px;padding:6px 0 6px 12px;border-bottom:1px solid #E5F0FF;margin-bottom:10px;">
                    <span style="font-size:12px;font-weight:600;color:#4A90E2;">${displayName}</span>
                    <span style="font-size:11px;color:#8B9DC3;">(${sortedStaff.length}人)</span>
                </div>
                <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;">
                    ${cols.map(col => `<div>${col.map(s => renderItem(s)).join('')}</div>`).join('')}
                </div>
            </div>
        `;
    }

    container.innerHTML = depts.map(dept => {
        const staff = deptMap[dept];

        // 生产部按班组细分
        if (dept === '生产部') {
            const teamMap = {};
            staff.forEach(s => {
                const team = s.team || '未分组';
                if (!teamMap[team]) teamMap[team] = [];
                teamMap[team].push(s);
            });
            const teams = sortTeams(Object.keys(teamMap));

            let html = `
                <div style="margin-bottom:16px;">
                    <div style="display:flex;align-items:center;padding:8px 12px;background:linear-gradient(135deg,#EEF4FF,#E8F0FF);border-radius:8px;margin-bottom:12px;gap:8px;">
                        <span style="font-size:13px;font-weight:700;color:#1D2B5A;">生产部</span>
                        <span style="font-size:12px;color:#8B9DC3;margin-left:4px;">(${staff.length}人)</span>
                    </div>
            `;

            teams.forEach(team => {
                html += renderPermGroup(team, teamMap[team], `生产部:${team}`, true);
            });

            html += '</div>';
            return html;
        }

        return renderPermGroup(dept, staff, dept);
    }).join('');
}

function togglePermDept(dept, checked) {
    document.querySelectorAll('.perm-staff-cb').forEach(cb => {
        const staffId = parseInt(cb.dataset.staffId);
        const staff = window.permAllStaff.find(s => s.id === staffId);
        if (staff && (staff.department || '未分组') === dept) {
            cb.checked = checked;
        }
    });
    updatePermSelectedCount();
}

function updatePermDeptCheckbox(dept) {
    const staff = window.permAllStaff.filter(s => (s.department || '未分组') === dept);
    const allChecked = staff.every(s => {
        const cb = document.querySelector(`.perm-staff-cb[data-staff-id="${s.id}"]`);
        return cb && cb.checked;
    });
    const deptCheckbox = document.getElementById('perm_dept_' + dept.replace(/\s/g, '_'));
    if (deptCheckbox) deptCheckbox.checked = allChecked;
    updatePermSelectedCount();
}

function updatePermSelectedCount() {
    const checked = document.querySelectorAll('.perm-staff-cb:checked').length;
    document.getElementById('permSelectedCount').textContent = checked;
}

async function savePermissions() {
    const checkedStaffIds = [];
    document.querySelectorAll('.perm-staff-cb:checked').forEach(cb => {
        checkedStaffIds.push(parseInt(cb.dataset.staffId));
    });

    try {
        const res = await fetch(`${API_URL}/exam-trainings/${currentPermExamId}/permissions`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ staff_ids: checkedStaffIds })
        }).then(r => r.json());

        if (res.code === 0) {
            alert('权限已保存');
            closePermissionsModal();
        } else {
            alert(res.msg || '保存失败');
        }
    } catch (err) {
        alert('保存失败');
    }
}

function closePermissionsModal() {
    const modal = document.getElementById('permissionsModal');
    if (modal) modal.remove();
    window.permAllStaff = [];
    window.permSelectedDepts = [];
    currentPermExamId = null;
}

async function showTaskSelectModal(examId, currentTaskId) {
    const modal = document.getElementById('taskSelectModal');
    const examInfoSummary = document.getElementById('examInfoSummary');

    // 加载培训详情
    let currentExam = null;
    try {
        const examRes = await fetch(`${API_URL}/exam-trainings/${examId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        }).then(r => r.json());

        if (examRes.code === 0) {
            currentExam = examRes.data.training;
            const questionBank = currentExam.question_bank_title || '未关联';
            const learningTask = currentExam.learning_task_title || '未关联';
            const formatTime = (str) => str ? new Date(str).toLocaleString('zh-CN', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' }) : '未设置';
            const startTime = formatTime(currentExam.start_time);
            const endTime = formatTime(currentExam.end_time);

            let warning = '';
            if (!currentExam.learning_task_id || !currentExam.question_bank_id) {
                warning = `<div style="color:#ef4444;margin-top:12px;">请先在"设置"中关联学习资料和题库后再启用</div>`;
            }

            examInfoSummary.innerHTML = `
                <div style="margin-bottom:8px;"><strong>已关联学习资料：</strong>${learningTask}</div>
                <div style="margin-bottom:8px;"><strong>已关联题库试卷：</strong>${questionBank}</div>
                <div><strong>培训时间：</strong>${startTime} - ${endTime}</div>
                ${warning}
            `;
        }
    } catch (err) {
        console.error('加载培训详情失败:', err);
    }

    modal.style.display = 'flex';
}

function closeTaskSelectModal() {
    document.getElementById('taskSelectModal').style.display = 'none';
    currentToggleExamId = null;
}

async function confirmEnableExam() {
    try {
        const res = await fetch(`${API_URL}/exam-trainings/${currentToggleExamId}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ is_active: true })
        }).then(r => r.json());

        if (res.code === 0) {
            closeTaskSelectModal();
            loadData();
        } else {
            alert(res.msg || '启用失败');
        }
    } catch (err) {
        alert('启用失败');
    }
}

// ============ 培训记录详情 ============
let trainingDetailData = {
    staff: [],
    learningProgress: {},
    examRecords: {},
    task: null,
    selectedStaff: new Set()
};

async function showTrainingRecordDetail(trainingId) {
    const task = myTrainingRecords.find(t => t.id === trainingId);
    if (!task) return;

    trainingDetailData.task = task;
    trainingDetailData.selectedStaff = new Set(); // 清空选择
    document.getElementById('trainingRecordModalTitle').textContent = task.title || '培训任务详情';
    document.getElementById('trainingRecordModalTitle').style.display = 'block';

    const isActive = task.is_active === 1;
    // 检查是否已过结束时间
    const now = new Date();
    const endTime = task.end_time ? new Date(task.end_time) : null;
    const isExpired = endTime && now > endTime;
    const displayStatus = isExpired ? '已结束' : (isActive ? '进行中' : '已停用');
    let statusBg;
    if (isExpired) {
        statusBg = 'linear-gradient(135deg,#9E9E9E,#BDBDBD)';
    } else if (isActive) {
        statusBg = 'linear-gradient(135deg,#4CAF50,#66BB6A)';
    } else {
        statusBg = 'linear-gradient(135deg,#EF4444,#F87171)'; // 红色
    }
    document.getElementById('trainingRecordSubtitle').innerHTML = `
        <button onclick="generateTestExamRecords(${trainingId})" style="display:inline-flex;align-items:center;gap:4px;padding:4px 12px;border-radius:12px;font-size:12px;font-weight:600;background:linear-gradient(135deg,#F59E0B,#F97316);color:#fff;border:none;cursor:pointer;margin-right:8px;">
            生成测试数据
        </button>
        <button onclick="batchPrintTrainingPapers(${trainingId})" style="display:inline-flex;align-items:center;gap:4px;padding:4px 12px;border-radius:12px;font-size:12px;font-weight:600;background:linear-gradient(135deg,#4A90E2,#65B3FF);color:#fff;border:none;cursor:pointer;">
            批量打印
        </button>
        <span style="display:inline-flex;align-items:center;gap:4px;padding:4px 12px;border-radius:12px;font-size:12px;font-weight:600;background:${statusBg};color:#fff;margin-left:8px;">
            <span style="width:6px;height:6px;border-radius:50%;background:#fff;"></span>
            ${displayStatus}
        </span>
    `;

    document.getElementById('trainingRecordModalContent').innerHTML = `
        <div style="display:flex;flex-direction:column;min-height:0;">
            <div style="padding:12px 16px;background:#F8FCFF;border-radius:12px;flex-shrink:0;min-height:90px;">
                <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;min-height:34px;">
                    <input type="text" id="filterName" placeholder="姓名" oninput="filterTrainingParticipants()" style="padding:8px 12px;border-radius:8px;border:1px solid #E5F0FF;font-size:13px;width:90px;outline:none;">
                    <input type="text" id="filterEmployeeId" placeholder="工号" oninput="filterTrainingParticipants()" style="padding:8px 12px;border-radius:8px;border:1px solid #E5F0FF;font-size:13px;width:80px;outline:none;">
                    <select id="filterLearningStatus" onchange="filterTrainingParticipants()" style="padding:8px 12px;border-radius:8px;border:1px solid #E5F0FF;font-size:13px;outline:none;color:#5B72A9;background:#fff;">
                        <option value="">学习状态</option>
                        <option value="not_started">未开始</option>
                        <option value="in_progress">进行中</option>
                        <option value="completed">已完成</option>
                    </select>
                    <select id="filterExamStatus" onchange="filterTrainingParticipants()" style="padding:8px 12px;border-radius:8px;border:1px solid #E5F0FF;font-size:13px;outline:none;color:#5B72A9;background:#fff;">
                        <option value="">考试状态</option>
                        <option value="not_examined">未考试</option>
                        <option value="examining">考试中</option>
                        <option value="passed">已通过</option>
                        <option value="failed">未通过</option>
                        <option value="pending_retake">待补考</option>
                        <option value="retake_in_progress">补考中</option>
                        <option value="retaken">已补考</option>
                        <option value="missed_retake">未补考</option>
                    </select>
                    <select id="filterPrintStatus" onchange="filterTrainingParticipants()" style="padding:8px 12px;border-radius:8px;border:1px solid #E5F0FF;font-size:13px;outline:none;color:#5B72A9;background:#fff;">
                        <option value="">打印状态</option>
                        <option value="printed">已打印</option>
                        <option value="not_printed">未打印</option>
                    </select>
                    <div style="flex:1;"></div>
                    <div id="participantCount" style="font-size:13px;color:#8B9DC3;"></div>
                    <div id="selectedCountDisplay" style="font-size:13px;color:#4A90E2;font-weight:500;"></div>
                </div>
                <div id="deptFilterArea" style="margin-top:12px;padding-top:12px;border-top:1px solid #E5F0FF;min-height:40px;"></div>
            </div>
            <div id="trainingParticipantsList" style="overflow:auto;border-radius:12px;border:1px solid #F0F7FF;background:#fff;flex:1;min-height:0;max-height:400px;">
                <div style="text-align:center;padding:40px;color:#8B9DC3;">加载中...</div>
            </div>
        </div>
    `;

    document.getElementById('trainingRecordModal').style.display = 'flex';

    try {
        const [permRes, progressRes, examRes] = await Promise.all([
            fetch(`${API_URL}/exam-trainings/${trainingId}/permissions`, { headers: { 'Authorization': `Bearer ${token}` } }).then(r => r.json()),
            task.learning_task_id ? fetch(`${API_URL}/learning-materials/${task.learning_task_id}/progress?trainingId=${trainingId}`, { headers: { 'Authorization': `Bearer ${token}` } }).then(r => { if (!r.ok) return { code: 0, data: [] }; return r.json(); }).catch(() => ({ code: 0, data: [] })) : Promise.resolve({ code: 0, data: [] }),
            fetch(`${API_URL}/exam-trainings/${trainingId}/exam-records`, { headers: { 'Authorization': `Bearer ${token}` } }).then(r => r.json()).catch(() => ({ code: 0, data: [] }))
        ]);

        trainingDetailData.staff = permRes.code === 0 ? permRes.data : [];
        // 直接使用数据库中的 name_pinyin 字段
        trainingDetailData.staff.forEach(s => {
            s._pinyinInitials = s.name_pinyin || '';
        });
        trainingDetailData.learningProgress = {};
        if (progressRes.ok !== false && progressRes.code === 0 && progressRes.data) {
            progressRes.data.forEach(p => {
                const key = p.staff_id || p.user_id;
                if (key) trainingDetailData.learningProgress[key] = p;
            });
        }
        trainingDetailData.examRecords = {};  // { staffId: { formal: record, retake: record, latest: record } }
        if (examRes.code === 0 && examRes.data) {
            examRes.data.forEach(e => {
                const matchId = e.staff_id > 0 ? e.staff_id : (e.user_id > 0 ? e.user_id : null);
                if (matchId) {
                    if (!trainingDetailData.examRecords[matchId]) {
                        trainingDetailData.examRecords[matchId] = { formal: null, retake: null, latest: null };
                    }
                    if (e.is_retake === 1) {
                        // 补考
                        if (!trainingDetailData.examRecords[matchId].retake ||
                            new Date(e.submitted_at) > new Date(trainingDetailData.examRecords[matchId].retake.submitted_at || 0)) {
                            trainingDetailData.examRecords[matchId].retake = e;
                        }
                    } else {
                        // 正式考试
                        if (!trainingDetailData.examRecords[matchId].formal ||
                            new Date(e.submitted_at) > new Date(trainingDetailData.examRecords[matchId].formal.submitted_at || 0)) {
                            trainingDetailData.examRecords[matchId].formal = e;
                        }
                    }
                    // latest 始终取最新的
                    if (!trainingDetailData.examRecords[matchId].latest ||
                        new Date(e.submitted_at) > new Date(trainingDetailData.examRecords[matchId].latest.submitted_at || 0)) {
                        trainingDetailData.examRecords[matchId].latest = e;
                    }
                }
            });
        }

        const departments = [...new Set(trainingDetailData.staff.filter(s => s.department).map(s => s.department))].sort((a, b) => {
            const idxA = DEPT_ORDER.indexOf(a);
            const idxB = DEPT_ORDER.indexOf(b);
            if (idxA === -1 && idxB === -1) return a.localeCompare(b);
            if (idxA === -1) return 1;
            if (idxB === -1) return -1;
            return idxA - idxB;
        });
        trainingDetailData.allDepartments = departments;
        trainingDetailData.selectedDepartments = [];

        // 获取生产部班组列表
        const productionStaff = trainingDetailData.staff.filter(s => s.department === '生产部');
        const allTeams = [...new Set(productionStaff.map(s => s.team).filter(t => t))].sort();
        trainingDetailData.allTeams = allTeams;
        trainingDetailData.selectedTeams = [];

        const deptFilterArea = document.getElementById('deptFilterArea');
        deptFilterArea.innerHTML = `
            <div style="font-size:12px;color:#8B9DC3;margin-bottom:8px;">部门（多选）：<span onclick="toggleSelectAllDepts()" style="cursor:pointer;color:#4A90E2;font-weight:500;margin-left:4px;">全选</span></div>
            <div style="display:flex;flex-wrap:wrap;gap:8px;">
                ${departments.map(d => `
                    <span class="dept-tag" data-dept="${d}" onclick="toggleDeptFilterByDept('${d}')" style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:20px;font-size:12px;color:#5B72A9;background:#fff;border:1px solid #E5F0FF;transition:all 0.2s;">
                        <span class="dept-name">${d}</span>
                        <span class="dept-count" style="font-size:10px;color:#8B9DC3;">(0/${trainingDetailData.staff.filter(s => s.department === d).length})</span>
                    </span>
                `).join('')}
            </div>
            ${allTeams.length > 0 ? `
            <div style="font-size:12px;color:#8B9DC3;margin-top:12px;padding-top:12px;border-top:1px solid #E5F0FF;">生产部班组（多选）：<span onclick="toggleSelectAllTeams()" style="cursor:pointer;color:#4A90E2;font-weight:500;margin-left:4px;">全选</span></div>
            <div style="display:flex;flex-wrap:wrap;gap:8px;">
                ${allTeams.map(t => `
                    <span class="team-tag" data-team="${t}" onclick="toggleTeamFilterByTeam('${t}')" style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:20px;font-size:12px;color:#5B72A9;background:#fff;border:1px solid #E5F0FF;transition:all 0.2s;cursor:pointer;">
                        <span class="team-name">${t}</span>
                        <span class="team-count" style="font-size:10px;color:#8B9DC3;">(0/${productionStaff.filter(s => s.team === t).length})</span>
                    </span>
                `).join('')}
            </div>
            ` : ''}
        `;

        renderTrainingParticipants();
    } catch (err) {
        console.error('获取培训详情失败:', err);
        document.getElementById('trainingParticipantsList').innerHTML = '<div style="text-align:center;padding:40px;color:#EF4444;">加载失败</div>';
    }
}

function toggleDeptFilter(checkbox) {
    const label = checkbox.parentElement;
    const dept = checkbox.value;
    if (checkbox.checked) {
        trainingDetailData.selectedDepartments.push(dept);
        label.style.background = '#E8F0FF';
        label.style.borderColor = '#4A90E2';
        label.style.color = '#4A90E2';
    } else {
        trainingDetailData.selectedDepartments = trainingDetailData.selectedDepartments.filter(d => d !== dept);
        label.style.background = '#fff';
        label.style.borderColor = '#E5F0FF';
        label.style.color = '#5B72A9';
    }
    filterTrainingParticipants();
}

function updateDeptTagCounts() {
    // 更新所有部门标签的选中数量
    document.querySelectorAll('.dept-tag').forEach(tag => {
        const dept = tag.dataset.dept;
        const totalCount = trainingDetailData.staff.filter(s => s.department === dept).length;
        const selectedCount = trainingDetailData.staff.filter(s => s.department === dept && trainingDetailData.selectedStaff.has(s.id)).length;
        const countSpan = tag.querySelector('.dept-count');
        if (countSpan) {
            countSpan.textContent = `(${selectedCount}/${totalCount})`;
        }
    });
    // 更新底部已选人数
    updateSelectedCountDisplay();
}

function updateSelectedCountDisplay() {
    const count = trainingDetailData.selectedStaff.size;
    let countDisplay = document.getElementById('selectedCountDisplay');
    if (countDisplay) {
        countDisplay.textContent = `已选 ${count} 人`;
    }
}

function toggleSelectAllDepts() {
    const allDepts = trainingDetailData.allDepartments || [];
    if (allDepts.length === 0) return;

    const allSelected = trainingDetailData.selectedDepartments.length === allDepts.length;

    if (allSelected) {
        // 取消全选
        trainingDetailData.selectedDepartments = [];
        trainingDetailData.selectedStaff.clear();
        document.querySelectorAll('.dept-tag').forEach(tag => {
            tag.style.background = '#fff';
            tag.style.borderColor = '#E5F0FF';
            tag.style.color = '#5B72A9';
        });
    } else {
        // 全选
        trainingDetailData.selectedDepartments = [...allDepts];
        trainingDetailData.selectedStaff.clear();
        trainingDetailData.staff.forEach(s => {
            if (s.department && allDepts.includes(s.department)) {
                trainingDetailData.selectedStaff.add(s.id);
            }
        });
        document.querySelectorAll('.dept-tag').forEach(tag => {
            tag.style.background = '#E8F0FF';
            tag.style.borderColor = '#4A90E2';
            tag.style.color = '#4A90E2';
        });
    }
    updateDeptTagCounts();
    filterTrainingParticipants();
}

function toggleDeptFilterByDept(dept) {
    const tag = document.querySelector(`.dept-tag[data-dept="${dept}"]`);
    if (!tag) return;

    if (trainingDetailData.selectedDepartments.includes(dept)) {
        trainingDetailData.selectedDepartments = trainingDetailData.selectedDepartments.filter(d => d !== dept);
        tag.style.background = '#fff';
        tag.style.borderColor = '#E5F0FF';
        tag.style.color = '#5B72A9';
        // 取消该部门下所有人员选中
        trainingDetailData.staff.forEach(s => {
            if (s.department === dept) {
                trainingDetailData.selectedStaff.delete(s.id);
            }
        });
        updateDeptTagCounts();
    } else {
        trainingDetailData.selectedDepartments.push(dept);
        tag.style.background = '#E8F0FF';
        tag.style.borderColor = '#4A90E2';
        tag.style.color = '#4A90E2';
        // 选中该部门下所有人员
        trainingDetailData.staff.forEach(s => {
            if (s.department === dept) {
                trainingDetailData.selectedStaff.add(s.id);
            }
        });
        updateDeptTagCounts();
    }
    filterTrainingParticipants();
}

function toggleSelectAllTeams() {
    const allTeams = trainingDetailData.allTeams || [];
    if (allTeams.length === 0) return;

    const allSelected = trainingDetailData.selectedTeams.length === allTeams.length;

    if (allSelected) {
        // 取消全选
        trainingDetailData.selectedTeams = [];
        trainingDetailData.selectedStaff.clear();
        document.querySelectorAll('.team-tag').forEach(tag => {
            tag.style.background = '#fff';
            tag.style.borderColor = '#E5F0FF';
            tag.style.color = '#5B72A9';
        });
    } else {
        // 全选
        trainingDetailData.selectedTeams = [...allTeams];
        trainingDetailData.staff.forEach(s => {
            if (s.department === '生产部' && s.team && allTeams.includes(s.team)) {
                trainingDetailData.selectedStaff.add(s.id);
            }
        });
        document.querySelectorAll('.team-tag').forEach(tag => {
            tag.style.background = '#E8F0FF';
            tag.style.borderColor = '#4A90E2';
            tag.style.color = '#4A90E2';
        });
    }
    updateTeamTagCounts();
    filterTrainingParticipants();
}

function toggleTeamFilterByTeam(team) {
    const tag = document.querySelector(`.team-tag[data-team="${team}"]`);
    if (!tag) return;

    if (trainingDetailData.selectedTeams.includes(team)) {
        trainingDetailData.selectedTeams = trainingDetailData.selectedTeams.filter(t => t !== team);
        tag.style.background = '#fff';
        tag.style.borderColor = '#E5F0FF';
        tag.style.color = '#5B72A9';
        // 取消该班组下所有人员选中
        trainingDetailData.staff.forEach(s => {
            if (s.department === '生产部' && s.team === team) {
                trainingDetailData.selectedStaff.delete(s.id);
            }
        });
        updateTeamTagCounts();
    } else {
        trainingDetailData.selectedTeams.push(team);
        tag.style.background = '#E8F0FF';
        tag.style.borderColor = '#4A90E2';
        tag.style.color = '#4A90E2';
        // 选中该班组下所有人员
        trainingDetailData.staff.forEach(s => {
            if (s.department === '生产部' && s.team === team) {
                trainingDetailData.selectedStaff.add(s.id);
            }
        });
        updateTeamTagCounts();
    }
    filterTrainingParticipants();
}

function updateTeamTagCounts() {
    const allTeams = trainingDetailData.allTeams || [];
    allTeams.forEach(team => {
        const tag = document.querySelector(`.team-tag[data-team="${team}"]`);
        if (!tag) return;
        const totalCount = trainingDetailData.staff.filter(s => s.department === '生产部' && s.team === team).length;
        const selectedCount = trainingDetailData.staff.filter(s => s.department === '生产部' && s.team === team && trainingDetailData.selectedStaff.has(s.id)).length;
        const countSpan = tag.querySelector('.team-count');
        if (countSpan) {
            countSpan.textContent = `(${selectedCount}/${totalCount})`;
        }
    });
    updateDeptTagCounts();
}

// 切换班组选择（在员工列表分组标题点击）
function toggleTeamSelection(teamName) {
    const teamMembers = trainingDetailData.staff.filter(s => s.department === '生产部' && s.team === teamName);
    const allSelected = teamMembers.every(s => trainingDetailData.selectedStaff.has(s.id));

    if (allSelected) {
        // 取消全选
        teamMembers.forEach(s => trainingDetailData.selectedStaff.delete(s.id));
    } else {
        // 全选
        teamMembers.forEach(s => trainingDetailData.selectedStaff.add(s.id));
    }

    // 更新筛选区域的班组计数
    updateTeamTagCounts();
    updateSelectedCountDisplay();

    // 重新渲染列表
    renderTrainingParticipants();
}

function filterTrainingParticipants() {
    renderTrainingParticipants();
}

function renderTrainingParticipants() {
    const nameFilter = document.getElementById('filterName').value.toLowerCase();
    const empIdFilter = document.getElementById('filterEmployeeId').value.toLowerCase();
    const selectedDepts = trainingDetailData.selectedDepartments || [];
    const selectedTeams = trainingDetailData.selectedTeams || [];
    const learningFilter = document.getElementById('filterLearningStatus').value;
    const examFilter = document.getElementById('filterExamStatus').value;
    const printFilter = document.getElementById('filterPrintStatus').value;

    let filtered = trainingDetailData.staff.filter(s => {
        if (nameFilter && !matchName(nameFilter, s)) return false;
        if (empIdFilter && !s.employee_id.toLowerCase().includes(empIdFilter)) return false;
        // 部门筛选
        if (selectedDepts.length > 0 && !selectedDepts.includes(s.department)) return false;
        // 班组筛选（只对生产部有效）
        if (s.department === '生产部' && selectedTeams.length > 0) {
            if (!s.team || !selectedTeams.includes(s.team)) return false;
        }
        return true;
    });

    const passScore = trainingDetailData.task?.pass_score || 60;

    if (learningFilter || examFilter) {
        filtered = filtered.filter(s => {
            const lp = trainingDetailData.learningProgress[s.id];
            const records = trainingDetailData.examRecords[s.id] || { formal: null, retake: null, latest: null };
            const formalRecord = records.formal;
            const retakeRecord = records.retake;

            if (learningFilter) {
                const learningStatus = !lp ? 'not_started' : lp.status;
                if (learningFilter !== learningStatus) return false;
            }
            if (examFilter) {
                let match = false;
                const formalScore = formalRecord ? (formalRecord.total_score ?? formalRecord.score ?? 0) : 0;
                const hasFormalSubmitted = formalRecord && formalRecord.submitted_at;
                const hasFormalPassed = hasFormalSubmitted && formalScore >= passScore;
                const hasRetake = retakeRecord && retakeRecord.submitted_at;
                const hasRetakeInProgress = retakeRecord && !retakeRecord.submitted_at;

                if (examFilter === 'not_examined') {
                    match = !formalRecord && !retakeRecord;
                } else if (examFilter === 'examining') {
                    match = formalRecord && !formalRecord.submitted_at;
                } else if (examFilter === 'passed') {
                    match = hasFormalPassed || (hasRetake && (retakeRecord.total_score ?? 0) >= passScore);
                } else if (examFilter === 'failed') {
                    // 未通过：正式考试未通过（不管有没有补考）
                    match = hasFormalSubmitted && !hasFormalPassed;
                } else if (examFilter === 'pending_retake') {
                    // 待补考：正式未通过且未补考
                    match = hasFormalSubmitted && !hasFormalPassed && !retakeRecord;
                } else if (examFilter === 'retake_in_progress') {
                    // 补考中
                    match = hasRetakeInProgress;
                } else if (examFilter === 'retaken') {
                    // 已补考
                    match = hasRetake;
                } else if (examFilter === 'missed_retake') {
                    // 未补考
                    const now = new Date();
                    const endTime = trainingDetailData.task?.end_time ? new Date(trainingDetailData.task.end_time) : null;
                    match = hasFormalSubmitted && !hasFormalPassed && !retakeRecord && endTime && now > endTime;
                }

                if (!match) return false;
            }
            return true;
        });
    }

    // 打印状态筛选
    if (printFilter) {
        filtered = filtered.filter(s => {
            const records = trainingDetailData.examRecords[s.id] || { formal: null, retake: null, latest: null };
            const latestRecord = records.latest;
            if (!latestRecord || !latestRecord.submitted_at) return false;
            const isPrinted = isRecordPrinted(latestRecord.id);
            if (printFilter === 'printed') return isPrinted;
            if (printFilter === 'not_printed') return !isPrinted;
            return true;
        });
    }

    const container = document.getElementById('trainingParticipantsList');
    document.getElementById('participantCount').textContent = `共 ${filtered.length} 人`;
    updateDeptTagCounts();

    if (filtered.length === 0) {
        container.innerHTML = '<div style="text-align:center;padding:40px;color:#8B9DC3;">暂无匹配数据</div>';
        return;
    }

    // 按部门分组
    const grouped = {};
    filtered.forEach(s => {
        const dept = s.department || '未分配';
        if (!grouped[dept]) grouped[dept] = [];
        grouped[dept].push(s);
    });

    const sortedDepts = Object.keys(grouped).sort((a, b) => {
        const idxA = DEPT_ORDER.indexOf(a);
        const idxB = DEPT_ORDER.indexOf(b);
        if (idxA === -1 && idxB === -1) return a.localeCompare(b);
        if (idxA === -1) return 1;
        if (idxB === -1) return -1;
        return idxA - idxB;
    });

    const renderItem = (s) => {
        const lp = trainingDetailData.learningProgress[s.id];
        const records = trainingDetailData.examRecords[s.id] || { formal: null, retake: null, latest: null };
        const formalRecord = records.formal;
        const retakeRecord = records.retake;
        const latestRecord = records.latest;  // 用于打印

        let learningLabel = '未开始';
        let learningBg = '#F5F5F5';
        let learningColor = '#9E9E9E';
        if (lp) {
            if (lp.status === 'completed') { learningLabel = '已完成'; learningBg = '#ECFDF5'; learningColor = '#22C58D'; }
            else if (lp.status === 'in_progress') {
                // 培训时间已过，仍显示进行中但标灰
                if (trainingDetailData.task && trainingDetailData.task.end_time) {
                    const taskEndTime = new Date(trainingDetailData.task.end_time);
                    if (new Date() > taskEndTime) {
                        learningLabel = '已超时';
                        learningBg = '#FEF2F2';
                        learningColor = '#EF4444';
                    } else {
                        learningLabel = '进行中';
                        learningBg = '#FFFBEB';
                        learningColor = '#F59E0B';
                    }
                } else {
                    learningLabel = '进行中';
                    learningBg = '#FFFBEB';
                    learningColor = '#F59E0B';
                }
            }
        }

        let formalLabel = '';
        let formalBg = '';
        let formalColor = '';
        let retakeLabel = '';
        let retakeBg = '';
        let retakeColor = '';

        if (formalRecord && formalRecord.submitted_at) {
            const formalScore = formalRecord.total_score ?? formalRecord.score ?? 0;
            if (formalScore >= passScore) {
                formalLabel = '已通过 ' + formalScore + '分';
                formalBg = '#ECFDF5';
                formalColor = '#22C58D';
            } else {
                formalLabel = '未通过 ' + formalScore + '分';
                formalBg = '#FEF2F2';
                formalColor = '#EF4444';
            }
        } else if (formalRecord && !formalRecord.submitted_at) {
            formalLabel = '考试中';
            formalBg = '#EEF2FF';
            formalColor = '#4A90E2';
        }

        if (retakeRecord && retakeRecord.submitted_at) {
            const retakeScore = retakeRecord.total_score ?? retakeRecord.score ?? 0;
            if (retakeScore >= passScore) {
                retakeLabel = '已补考 ' + retakeScore + '分';
                retakeBg = '#ECFDF5';
                retakeColor = '#22C58D';
            } else {
                retakeLabel = '已补考 ' + retakeScore + '分';
                retakeBg = '#FEF2F2';
                retakeColor = '#EF4444';
            }
        } else if (retakeRecord && !retakeRecord.submitted_at) {
            retakeLabel = '补考中';
            retakeBg = '#FFFBEB';
            retakeColor = '#F59E0B';
        }

        const isSelected = trainingDetailData.selectedStaff.has(s.id);

        const examBadges = [];
        if (formalLabel) {
            examBadges.push(`<span style="padding:2px 6px;border-radius:4px;font-size:10px;font-weight:500;background:${isSelected ? '#fff' : formalBg};color:${formalColor};white-space:nowrap;">${formalLabel}</span>`);
        }
        if (retakeLabel) {
            examBadges.push(`<span style="padding:2px 6px;border-radius:4px;font-size:10px;font-weight:500;background:${isSelected ? '#fff' : retakeBg};color:${retakeColor};white-space:nowrap;">${retakeLabel}</span>`);
        }
        if (examBadges.length === 0) {
            examBadges.push(`<span style="padding:2px 6px;border-radius:4px;font-size:10px;font-weight:500;background:${isSelected ? '#fff' : '#F5F5F5'};color:#9E9E9E;white-space:nowrap;">未考试</span>`);
        }

        // 打印按钮使用 latest 记录
        let printBtn = '';
        if (latestRecord && latestRecord.submitted_at) {
            const printed = isRecordPrinted(latestRecord.id);
            if (printed) {
                printBtn = `<button onclick="printExamPaper(${latestRecord.id})" style="padding:2px 6px;background:#22C58D;color:white;border:none;border-radius:4px;font-size:10px;cursor:pointer;white-space:nowrap;">已打印</button>`;
            } else {
                printBtn = `<button onclick="printExamPaper(${latestRecord.id})" style="padding:2px 6px;background:#4A90E2;color:white;border:none;border-radius:4px;font-size:10px;cursor:pointer;white-space:nowrap;">打印</button>`;
            }
        }

        return `
            <div class="staff-card ${isSelected ? 'selected' : ''}" style="display:flex;align-items:center;padding:8px 10px;border-radius:8px;background:${isSelected ? '#E8F0FF' : '#FAFAFA'};margin-bottom:6px;gap:4px;flex-wrap:nowrap;overflow:visible;transition:background 0.2s;" onclick="toggleStaffSelect(${s.id}, event)">
                <div style="width:26px;height:26px;border-radius:50%;background:linear-gradient(135deg,#4A90E2,#65B3FF);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:600;font-size:11px;flex-shrink:0;">
                    ${s.name.charAt(0)}
                </div>
                <div style="flex:1;min-width:60px;">
                    <div style="font-size:12px;font-weight:500;color:#1D2B5A;">${s.name}</div>
                    <div style="font-size:10px;color:#8B9DC3;">${s.employee_id || ''}</div>
                </div>
                <div style="display:flex;gap:0;align-items:center;flex-wrap:nowrap;">
                    <span style="padding:2px 6px;border-radius:4px;font-size:10px;font-weight:500;background:${isSelected ? '#fff' : learningBg};color:${learningColor};white-space:nowrap;">${learningLabel}</span>
                    ${examBadges.join('')}
                    ${printBtn}
                </div>
            </div>
        `;
    };

    // 3列布局辅助函数
    const render3Col = (members) => {
        const cols = [[], [], []];
        members.forEach((s, i) => cols[i % 3].push(s));
        return `
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;">
                ${cols.map(col => `<div>${col.map(s => renderItem(s)).join('')}</div>`).join('')}
            </div>
        `;
    };

    container.innerHTML = sortedDepts.map(dept => {
        const members = grouped[dept].sort((a, b) => (a.employee_id || '').localeCompare(b.employee_id || ''));

        // 生产部按班组分组
        if (dept === '生产部') {
            const byTeam = {};
            members.forEach(s => {
                const team = s.team || '未分组';
                if (!byTeam[team]) byTeam[team] = [];
                byTeam[team].push(s);
            });

            const sortedTeams = Object.keys(byTeam).sort((a, b) => {
                const idxA = TEAM_ORDER_PRODUCTION.indexOf(a);
                const idxB = TEAM_ORDER_PRODUCTION.indexOf(b);
                if (idxA === -1 && idxB === -1) return a.localeCompare(b);
                if (idxA === -1) return 1;
                if (idxB === -1) return -1;
                return idxA - idxB;
            });

            return `
                <div style="margin-bottom:16px;">
                    <div style="display:flex;align-items:center;gap:8px;padding:6px 0 6px 12px;border-bottom:1px solid #E5F0FF;margin-bottom:10px;">
                        <span style="font-size:12px;font-weight:600;color:#4A90E2;">${dept}</span>
                        <span style="font-size:11px;color:#8B9DC3;">(${members.length}人)</span>
                    </div>
                    ${sortedTeams.map(team => {
                        const teamSelectedCount = byTeam[team].filter(s => trainingDetailData.selectedStaff.has(s.id)).length;
                        const isAllSelected = teamSelectedCount === byTeam[team].length;
                        return `
                        <div style="margin-bottom:12px;">
                            <div onclick="toggleTeamSelection('${team}')" style="font-size:11px;color:#5B72A9;padding:4px 0 6px 20px;font-weight:500;cursor:pointer;display:flex;align-items:center;gap:4px;">${isAllSelected ? '✓ ' : ''}${team.split('/')[1] || team} (${teamSelectedCount}/${byTeam[team].length}人)</div>
                            ${render3Col(byTeam[team])}
                        </div>
                    `}).join('')}
                </div>
            `;
        }

        return `
            <div style="margin-bottom:16px;">
                <div style="display:flex;align-items:center;gap:8px;padding:6px 0 6px 12px;border-bottom:1px solid #E5F0FF;margin-bottom:10px;">
                    <span style="font-size:12px;font-weight:600;color:#4A90E2;">${dept}</span>
                    <span style="font-size:11px;color:#8B9DC3;">(${members.length}人)</span>
                </div>
                ${render3Col(members)}
            </div>
        `;
    }).join('');
}

function closeTrainingRecordModal() {
    document.getElementById('trainingRecordModal').style.display = 'none';
}

// 打印试卷
function printExamPaper(recordId) {
    markRecordsPrinted([recordId]);
    window.open('exam-print.html?id=' + recordId, '_blank');
}

// 生成测试考试记录
async function generateTestExamRecords(trainingId) {
    if (!confirm('将为所有未参加考试的员工生成随机考试记录（仅测试用）？')) return;

    try {
        const res = await fetch(`${API_URL}/exam/admin/${trainingId}/generate-test`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (data.code === 0) {
            alert(data.msg);
            // 刷新详情数据
            showTrainingRecordDetail(trainingId);
        } else {
            alert(data.msg || '生成失败');
        }
    } catch (err) {
        console.error('生成测试数据失败:', err);
        alert('生成失败');
    }
}

function batchPrintTrainingPapers(trainingId) {
    // 只打印选中的学员
    const selectedIds = Array.from(trainingDetailData.selectedStaff);

    if (selectedIds.length === 0) {
        alert('请先选择要打印的人员');
        return;
    }

    // 构建打印队列（过滤掉没有提交记录的）
    const queue = [];
    selectedIds.forEach(staffId => {
        const records = trainingDetailData.examRecords[staffId];
        if (records && records.latest && records.latest.submitted_at) {
            queue.push(records.latest.id);
        }
    });

    if (queue.length === 0) {
        alert('所选人员中没有可打印的考试记录');
        return;
    }

    // 打开批量打印页面，传递recordIds
    const url = 'exam-print-batch.html?ids=' + queue.join(',');
    window.open(url, '_blank');
}

function toggleStaffSelect(staffId, event) {
    if (event) {
        // 点击打印按钮时不切换选择
        if (event.target.closest('button')) return;
    }

    const card = event?.target?.closest('.staff-card');
    if (trainingDetailData.selectedStaff.has(staffId)) {
        trainingDetailData.selectedStaff.delete(staffId);
        if (card) {
            card.classList.remove('selected');
            card.style.background = '#FAFAFA';
        }
    } else {
        trainingDetailData.selectedStaff.add(staffId);
        if (card) {
            card.classList.add('selected');
            card.style.background = '#E8F0FF';
        }
    }
    updateDeptTagCounts();
}
