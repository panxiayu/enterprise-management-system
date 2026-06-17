// js/voting-list.js - 投票列表
const API_URL = window.location.origin + '/api';
let token = '';
let votings = [];

document.addEventListener('DOMContentLoaded', () => {
    token = window.AdminSession && window.AdminSession.requireValid
        ? window.AdminSession.requireValid()
        : (localStorage.getItem('token') || localStorage.getItem('adminToken') || '');
    if (!token) {
        return;
    }
    // 权限检查
    const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
    if (!currentUser.can_manage_voting) { alert('无权限访问投票系统'); window.location.href = 'dashboard.html'; return; }
    loadVotings();
});

function loadVotings() {
    document.getElementById('loading').style.display = 'block';
    document.getElementById('votingGrid').innerHTML = '';

    fetch(`${API_URL}/voting/list`, {
        headers: { 'Authorization': `Bearer ${token}` }
    })
    .then(res => res.json())
    .then(data => {
        document.getElementById('loading').style.display = 'none';
        if (data.code === 0) {
            votings = data.data || [];
            if (votings.length > 0) {
                renderVotings();
            }
        } else {
            alert(data.msg || '加载失败');
        }
    })
    .catch(err => {
        document.getElementById('loading').style.display = 'none';
        alert('加载失败，请检查网络');
    });
}

function renderVotings() {
    const grid = document.getElementById('votingGrid');
    const formatDateTime = (dt) => {
        if (!dt) return '-';
        // 支持 YYYY-MM-DDTHH:mm 和 YYYY-MM-DD HH:mm:ss 格式
        let datePart, timePart;
        if (dt.includes('T')) {
            [datePart, timePart] = dt.split('T');
        } else if (dt.includes(' ')) {
            [datePart, timePart] = dt.split(' ');
        } else {
            return dt;
        }
        const dateParts = datePart.split('-');
        const timeParts = timePart.split(':');
        if (dateParts.length >= 3 && timeParts.length >= 2) {
            return `${dateParts[0]}-${dateParts[1]}-${dateParts[2]} ${timeParts[0]}:${timeParts[1]}`;
        }
        return dt;
    };
    // 解析日期字符串为本地时间（处理 ISO 格式时区问题）
    const parseLocalDateTime = (dtStr) => {
        if (!dtStr) return null;
        // ISO 格式如 2026-04-15T10:00:00.000Z 需要单独处理
        if (dtStr.endsWith('Z')) {
            return new Date(dtStr);
        }
        // datetime-local 格式 YYYY-MM-DDTHH:mm 或 SQLite 格式 YYYY-MM-DD HH:mm:ss
        // 统一替换空格和T为分隔符
        const normalized = dtStr.replace(/[T\s]/g, '-');
        const parts = normalized.split('-');
        if (parts.length >= 5) {
            return new Date(parts[0], parts[1] - 1, parts[2], parts[3], parts[4]);
        }
        return new Date(dtStr);
    };
    const now = new Date();
    grid.innerHTML = votings.map(v => {
        const startDate = parseLocalDateTime(v.startDate);
        const endDate = parseLocalDateTime(v.endDate);
        const isEnded = endDate && endDate < now;
        const notStarted = startDate && startDate > now;
        const statusClass = isEnded ? 'badge-danger' : (notStarted ? 'badge-warning' : 'badge-success');
        const statusText = isEnded ? '已结束' : (notStarted ? '未开始' : '进行中');
        return `
            <div class="card voting-card" style="padding: 16px; position: relative; cursor: pointer;" onclick="goToDetail(${v.id}); event.stopPropagation();">
                <div style="position: absolute; top: 12px; left: 12px; z-index: 1;" onclick="event.stopPropagation()">
                    <input type="checkbox" class="voting-checkbox" value="${v.id}" onclick="event.stopPropagation()">
                </div>
                <div style="position: absolute; top: 12px; right: 12px; display: flex; gap: 6px; align-items: center;" onclick="event.stopPropagation()">
                    ${v.isAnonymous ? '<span class="badge badge-warning">匿名</span>' : ''}
                    ${v.multipleChoice ? '<span class="badge badge-secondary">多选</span>' : ''}
                </div>
                <div class="card-title" style="margin: 0 0 8px 40px; padding-right: 200px;">${v.title || '未命名投票'}</div>
                <p class="card-desc" style="margin-bottom: 10px; margin-left: 40px;">${v.description || '暂无描述'}</p>
                <div class="card-meta" style="flex-wrap: wrap; gap: 8px; margin-left: 40px;">
                    <span>${formatDateTime(v.startDate)} ~ ${formatDateTime(v.endDate)}</span>
                </div>
                ${v.anonymousUrl ? `<div style="margin-left: 40px; margin-top: 8px; display: flex; justify-content: space-between; align-items: center;">
                        <span class="badge ${statusClass}">${statusText}</span>
                        <span style="display: flex; gap: 6px;">
                            ${!isEnded ? `<span style="background: rgba(255,255,255,0.9); color: var(--text-primary); border: 1px solid rgba(0,0,0,0.1); padding: 4px 10px; border-radius: var(--radius-sm); font-size: 12px; font-weight: 500; cursor: pointer;" onclick="event.stopPropagation(); goToEdit(${v.id})" title="编辑投票">✏️ 编辑</span>` : ''}
                            <span style="background: rgba(255,255,255,0.9); color: var(--text-primary); border: 1px solid rgba(0,0,0,0.1); padding: 4px 10px; border-radius: var(--radius-sm); font-size: 12px; font-weight: 500; cursor: pointer;" onclick="event.stopPropagation(); copyAnonymousUrl('${v.anonymousUrl}', this)" title="点击复制链接">🔗 复制链接</span>
                        </span>
                    </div>` : `<div style="margin-left: 40px; margin-top: 8px; display: flex; justify-content: space-between; align-items: center;">
                        <span class="badge ${statusClass}">${statusText}</span>
                        ${!isEnded ? `<span style="background: rgba(255,255,255,0.9); color: var(--text-primary); border: 1px solid rgba(0,0,0,0.1); padding: 4px 10px; border-radius: var(--radius-sm); font-size: 12px; font-weight: 500; cursor: pointer;" onclick="event.stopPropagation(); goToEdit(${v.id})" title="编辑投票">✏️ 编辑</span>` : ''}
                    </div>`}
            </div>
        `;
    }).join('');
}

// ============ 创建投票 ============
function goToCreate() {
    // 重置表单
    document.getElementById('votingTitle').value = '';
    document.getElementById('votingDesc').value = '';
    document.getElementById('votingDuration').value = '';
    document.getElementById('votingLimit').value = 'once';
    // 默认使用系统时间（中国时区）
    const now = new Date();
    const formatDateTimeLocal = (d) => {
        const utc8 = new Date(d.getTime() + 8 * 60 * 60 * 1000);
        const year = utc8.getUTCFullYear();
        const month = String(utc8.getUTCMonth() + 1).padStart(2, '0');
        const day = String(utc8.getUTCDate()).padStart(2, '0');
        const hours = String(utc8.getUTCHours()).padStart(2, '0');
        const minutes = String(utc8.getUTCMinutes()).padStart(2, '0');
        return `${year}-${month}-${day}T${hours}:${minutes}`;
    };
    document.getElementById('votingStartDate').value = formatDateTimeLocal(now);
    document.getElementById('votingEndDate').value = '';
    document.getElementById('votingMultiple').checked = false;
    document.getElementById('votingAnonymous').checked = true;
    // 重置选项为两个空输入框
    const container = document.getElementById('votingOptionsContainer');
    container.innerHTML = `
        <div class="option-input-row" style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
            <button type="button" class="option-remove-btn" onclick="removeOption(this)">−</button>
            <input type="text" class="form-control option-input" placeholder="请输入选项内容">
        </div>
        <div class="option-input-row" style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
            <button type="button" class="option-remove-btn" onclick="removeOption(this)">−</button>
            <input type="text" class="form-control option-input" placeholder="请输入选项内容">
        </div>
    `;
    document.getElementById('createModal').classList.add('active');
}

// 根据投票时长自动计算开始和结束时间
function updateVotingTimes() {
    const durationSelect = document.getElementById('votingDuration');
    const duration = parseInt(durationSelect.value);
    const startDateInput = document.getElementById('votingStartDate');
    const endDateInput = document.getElementById('votingEndDate');

    if (!duration) {
        return;
    }

    const now = new Date();
    const endTime = new Date(now.getTime() + duration * 60 * 60 * 1000);

    // 格式化日期时间为 YYYY-MM-DDTHH:mm（中国时区）
    const formatDateTimeUTC8 = (d) => {
        const utc8 = new Date(d.getTime() + 8 * 60 * 60 * 1000);
        const year = utc8.getUTCFullYear();
        const month = String(utc8.getUTCMonth() + 1).padStart(2, '0');
        const day = String(utc8.getUTCDate()).padStart(2, '0');
        const hours = String(utc8.getUTCHours()).padStart(2, '0');
        const minutes = String(utc8.getUTCMinutes()).padStart(2, '0');
        return `${year}-${month}-${day}T${hours}:${minutes}`;
    };

    startDateInput.value = formatDateTimeUTC8(now);
    endDateInput.value = formatDateTimeUTC8(endTime);
}

// 当手动修改开始时间时，清空时长选择
function onStartDateChange() {
    document.getElementById('votingDuration').value = '';
}

function closeCreateModal() {
    document.getElementById('createModal').classList.remove('active');
    // 清空投票人员选择
    selectedStaffIds = [];
    allStaff = [];
    document.getElementById('staffSearchInput').value = '';
    document.getElementById('staffListContainer').innerHTML = '';
    document.getElementById('selectedStaffList').innerHTML = '';
    document.getElementById('staffSelectionSection').style.display = 'none';
}

// ============ 编辑投票 ============
function goToEdit(id) {
    fetch(`${API_URL}/voting/${id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    })
    .then(res => res.json())
    .then(data => {
        if (data.code === 0) {
            const voting = data.data;
            document.getElementById('editVotingId').value = id;
            document.getElementById('editVotingTitle').value = voting.title;
            document.getElementById('editVotingDesc').value = voting.description || '';
            document.getElementById('editVotingAnonymous').checked = voting.isAnonymous;
            document.getElementById('editVotingMultiple').checked = voting.multipleChoice;
            document.getElementById('editVotingLimit').value = voting.voteLimit || 'once';

            // 格式化日期时间
            const formatDateTimeLocal = (dt) => {
                if (!dt) return '';
                const d = new Date(dt);
                const pad = (n) => String(n).padStart(2, '0');
                return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
            };
            document.getElementById('editVotingStartDate').value = formatDateTimeLocal(voting.startDate);
            document.getElementById('editVotingEndDate').value = formatDateTimeLocal(voting.endDate);

            // 渲染选项
            const container = document.getElementById('editVotingOptionsContainer');
            container.innerHTML = (voting.options || []).map((opt, idx) => `
                <div class="option-input-row" style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                    <button type="button" class="option-remove-btn" onclick="removeEditOption(this)">−</button>
                    <input type="text" class="form-control option-input" placeholder="请输入选项内容" value="${opt.text || opt.option_text}">
                </div>
            `).join('');

            document.getElementById('editModal').classList.add('active');
        } else {
            alert(data.msg || '获取投票信息失败');
        }
    })
    .catch(() => alert('获取投票信息失败'));
}

function closeEditModal() {
    document.getElementById('editModal').classList.remove('active');
}

function addEditOption() {
    const container = document.getElementById('editVotingOptionsContainer');
    const newRow = document.createElement('div');
    newRow.className = 'option-input-row';
    newRow.style = 'display:flex;align-items:center;gap:8px;margin-bottom:8px;';
    newRow.innerHTML = `
        <button type="button" class="option-remove-btn" onclick="removeEditOption(this)">−</button>
        <input type="text" class="form-control option-input" placeholder="请输入选项内容">
    `;
    container.appendChild(newRow);
}

function removeEditOption(btn) {
    const rows = document.querySelectorAll('#editVotingOptionsContainer .option-input-row');
    if (rows.length <= 2) {
        alert('至少需要2个选项');
        return;
    }
    btn.parentElement.remove();
}

function getEditOptionsFromContainer() {
    const container = document.getElementById('editVotingOptionsContainer');
    const inputs = container.querySelectorAll('.option-input');
    const options = [];
    inputs.forEach(input => {
        if (input.value.trim()) {
            options.push(input.value.trim());
        }
    });
    return options;
}

function handleEdit(e) {
    e.preventDefault();
    const id = document.getElementById('editVotingId').value;
    const title = document.getElementById('editVotingTitle').value;
    const description = document.getElementById('editVotingDesc').value;
    const startDate = document.getElementById('editVotingStartDate').value;
    const endDate = document.getElementById('editVotingEndDate').value;
    const multipleChoice = document.getElementById('editVotingMultiple').checked;
    const isAnonymous = document.getElementById('editVotingAnonymous').checked;
    const voteLimit = document.getElementById('editVotingLimit').value;
    const options = getEditOptionsFromContainer();

    if (!title) {
        alert('请输入投票标题');
        return;
    }

    if (!startDate || !endDate) {
        alert('请选择开始和结束时间');
        return;
    }

    if (new Date(endDate) <= new Date(startDate)) {
        alert('结束时间必须晚于开始时间');
        return;
    }

    if (options.length < 2) {
        alert('请至少添加2个选项');
        return;
    }

    const submitBtn = document.getElementById('editSubmitBtn');
    submitBtn.disabled = true;
    submitBtn.textContent = '保存中...';

    fetch(`${API_URL}/voting/${id}`, {
        method: 'PUT',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ title, description, startDate, endDate, options, multipleChoice, isAnonymous, voteLimit })
    })
    .then(res => res.json())
    .then(data => {
        submitBtn.disabled = false;
        submitBtn.textContent = '保存';
        if (data.code === 0) {
            closeEditModal();
            loadVotings();
        } else {
            alert(data.msg || '保存失败');
        }
    })
    .catch(() => {
        submitBtn.disabled = false;
        submitBtn.textContent = '保存';
        alert('保存失败');
    });
}

// 增加选项
function addOption() {
    const container = document.getElementById('votingOptionsContainer');
    const newRow = document.createElement('div');
    newRow.className = 'option-input-row';
    newRow.style = 'display:flex;align-items:center;gap:8px;margin-bottom:8px;';
    newRow.innerHTML = `
        <button type="button" class="option-remove-btn" onclick="removeOption(this)">−</button>
        <input type="text" class="form-control option-input" placeholder="请输入选项内容">
    `;
    container.appendChild(newRow);
}

// 删除选项
function removeOption(btn) {
    const rows = document.querySelectorAll('#votingOptionsContainer .option-input-row');
    if (rows.length <= 2) {
        alert('至少需要2个选项');
        return;
    }
    btn.parentElement.remove();
}

// 获取选项值
function getOptionsFromContainer(containerId) {
    const container = document.getElementById(containerId);
    const inputs = container.querySelectorAll('.option-input');
    const options = [];
    inputs.forEach(input => {
        if (input.value.trim()) {
            options.push(input.value.trim());
        }
    });
    return options;
}

// 投票人员选择
let allStaff = [];
let selectedStaffIds = [];

function toggleStaffSelection() {
    const isAnonymous = document.getElementById('votingAnonymous').checked;
    const section = document.getElementById('staffSelectionSection');
    section.style.display = isAnonymous ? 'none' : 'block';
    if (!isAnonymous && allStaff.length === 0) {
        loadStaffForSelection();
    }
}

function loadStaffForSelection() {
    fetch(`${API_URL}/staff?status=active`, {
        headers: { 'Authorization': `Bearer ${token}` }
    })
    .then(res => res.json())
    .then(data => {
        if (data.code === 0) {
            allStaff = data.data || [];
            renderStaffList(allStaff);
        }
    })
    .catch(() => {});
}

function searchStaff() {
    const keyword = document.getElementById('staffSearchInput').value.toLowerCase();
    if (!keyword) {
        renderStaffList(allStaff);
        return;
    }
    const filtered = allStaff.filter(s =>
        (s.name || '').toLowerCase().includes(keyword) ||
        (s.employee_id || '').toLowerCase().includes(keyword)
    );
    renderStaffList(filtered);
}

function renderStaffList(staffList) {
    const container = document.getElementById('staffListContainer');
    const alreadySelected = new Set(selectedStaffIds);
    container.innerHTML = staffList.map(s => {
        const isSelected = alreadySelected.has(s.id);
        return `<label style="display:flex;align-items:center;gap:4px;padding:4px 8px;background:${isSelected ? 'var(--primary)' : 'var(--bg-hover)'};color:${isSelected ? '#fff' : 'inherit'};border-radius:14px;font-size:12px;cursor:pointer;">
            <input type="checkbox" ${isSelected ? 'checked' : ''} onchange="toggleStaffItem(${s.id})" style="display:none;">
            <span>${s.employee_id}</span>
            <span>${s.name}</span>
        </label>`;
    }).join('');
}

function toggleStaffItem(staffId) {
    const idx = selectedStaffIds.indexOf(staffId);
    if (idx > -1) {
        selectedStaffIds.splice(idx, 1);
    } else {
        selectedStaffIds.push(staffId);
    }
    renderSelectedStaff();
    renderStaffList(allStaff.filter(s => {
        const kw = document.getElementById('staffSearchInput').value.toLowerCase();
        if (!kw) return true;
        return (s.name || '').toLowerCase().includes(kw) || (s.employee_id || '').toLowerCase().includes(kw);
    }));
}

function renderSelectedStaff() {
    const container = document.getElementById('selectedStaffList');
    container.innerHTML = selectedStaffIds.map(id => {
        const s = allStaff.find(a => a.id === id);
        if (!s) return '';
        return `<span style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;background:var(--primary);color:#fff;border-radius:14px;font-size:12px;">
            ${s.employee_id} ${s.name}
            <span onclick="removeSelectedStaff(${id})" style="cursor:pointer;margin-left:4px;">×</span>
        </span>`;
    }).join('');
}

function removeSelectedStaff(staffId) {
    selectedStaffIds = selectedStaffIds.filter(id => id !== staffId);
    renderSelectedStaff();
    renderStaffList(allStaff.filter(s => {
        const kw = document.getElementById('staffSearchInput').value.toLowerCase();
        if (!kw) return true;
        return (s.name || '').toLowerCase().includes(kw) || (s.employee_id || '').toLowerCase().includes(kw);
    }));
}

function clearStaffSelection() {
    selectedStaffIds = [];
    renderSelectedStaff();
    renderStaffList(allStaff);
    document.getElementById('staffSearchInput').value = '';
}

function handleCreate(e) {
    e.preventDefault();
    const title = document.getElementById('votingTitle').value;
    const description = document.getElementById('votingDesc').value;
    const startDate = document.getElementById('votingStartDate').value;
    const endDate = document.getElementById('votingEndDate').value;
    const multipleChoice = document.getElementById('votingMultiple').checked;
    const isAnonymous = document.getElementById('votingAnonymous').checked;
    const voteLimit = document.getElementById('votingLimit').value;
    const options = getOptionsFromContainer('votingOptionsContainer');

    if (!title) {
        alert('请输入投票标题');
        return;
    }

    if (!startDate || !endDate) {
        alert('请选择开始和结束时间');
        return;
    }

    if (new Date(endDate) <= new Date(startDate)) {
        alert('结束时间必须晚于开始时间');
        return;
    }

    if (options.length < 2) {
        alert('请至少添加2个选项');
        return;
    }

    const submitBtn = document.getElementById('createSubmitBtn');
    submitBtn.disabled = true;
    submitBtn.textContent = '创建中...';

    // 只有非匿名投票才传 allowedStaffIds
    const allowedStaffIds = isAnonymous ? undefined : (selectedStaffIds.length > 0 ? selectedStaffIds : undefined);

    fetch(`${API_URL}/voting/create`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ title, description, startDate, endDate, options, multipleChoice, isAnonymous, voteLimit, allowedStaffIds })
    })
    .then(res => res.json())
    .then(data => {
        submitBtn.disabled = false;
        submitBtn.textContent = '创建';
        if (data.code === 0) {
            closeCreateModal();
            // 如果是匿名投票，显示匿名链接
            if (data.data.anonymousUrl) {
                showAnonymousModal(data.data.anonymousUrl);
            }
            selectedStaffIds = [];
            loadVotings();
        } else {
            alert(data.msg || '创建失败');
        }
    })
    .catch(() => {
        submitBtn.disabled = false;
        submitBtn.textContent = '创建';
        alert('创建失败');
    });
}

// ============ 投票详情弹窗 ============
let detailVotingId = null;
let detailPollInterval = null;
let detailShowingResults = false;

function goToDetail(id) {
    detailVotingId = id;
    detailShowingResults = false;
    document.getElementById('detailResults').style.display = 'none';
    document.getElementById('detailResultsBtn').textContent = '投票结果';
    document.getElementById('detailLoading').style.display = 'block';
    document.getElementById('detailContent').style.display = 'none';
    document.getElementById('detailModal').classList.add('active');
    loadVotingDetail();
    // 开始轮询
    if (detailPollInterval) clearInterval(detailPollInterval);
    detailPollInterval = setInterval(loadVotingDetail, 3000);
}

function loadVotingDetail() {
    fetch(`${API_URL}/voting/${detailVotingId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    })
    .then(res => res.json())
    .then(data => {
        if (data.code === 0) {
            const voting = data.data;
            document.getElementById('detailLoading').style.display = 'none';
            document.getElementById('detailContent').style.display = 'block';
            document.getElementById('detailModalTitle').textContent = voting.title;
            document.getElementById('detailDesc').textContent = voting.description || '暂无描述';
            document.getElementById('detailDeadline').textContent = '时间: ' + (voting.startDate ? new Date(voting.startDate).toLocaleString('zh-CN') : '') + ' ~ ' + (voting.endDate ? new Date(voting.endDate).toLocaleString('zh-CN') : '-');
            document.getElementById('detailAnonymousTip').style.display = voting.isAnonymous ? 'block' : 'none';
            // 实时更新总投票人数
            document.getElementById('detailTotalVotes').textContent = voting.options ? voting.options.reduce((sum, o) => sum + (o.votes || 0), 0) : 0;
            // 如果当前显示结果，也更新结果列表
            if (detailShowingResults) {
                renderDetailResults(voting.options || []);
            }
        }
    })
    .catch(err => console.error('加载投票详情失败:', err));
}

function toggleDetailResults() {
    detailShowingResults = !detailShowingResults;
    const resultsDiv = document.getElementById('detailResults');
    const btn = document.getElementById('detailResultsBtn');

    if (detailShowingResults) {
        resultsDiv.style.display = 'block';
        btn.textContent = '收起结果';
        // 获取最新数据渲染结果
        fetch(`${API_URL}/voting/${detailVotingId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        })
        .then(res => res.json())
        .then(data => {
            if (data.code === 0) {
                renderDetailResults(data.data.options || []);
            }
        });
    } else {
        resultsDiv.style.display = 'none';
        btn.textContent = '投票结果';
    }
}

function renderDetailResults(options) {
    const totalVotes = options.reduce((sum, o) => sum + (o.votes || 0), 0);
    document.getElementById('detailResultsList').innerHTML = options.map(opt => {
        const percentage = totalVotes > 0 ? Math.round((opt.votes || 0) / totalVotes * 100) : 0;
        return `
            <div style="padding: 12px 0; border-bottom: 1px solid var(--border);">
                <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                    <span>${opt.text}</span>
                    <span style="font-weight: 600;">${opt.votes || 0} 票 (${percentage}%)</span>
                </div>
                <div style="height: 8px; background: var(--border); border-radius: 4px; overflow: hidden;">
                    <div style="height: 100%; width: ${percentage}%; background: var(--accent); border-radius: 4px;"></div>
                </div>
            </div>
        `;
    }).join('');
}

function closeDetailModal() {
    document.getElementById('detailModal').classList.remove('active');
    if (detailPollInterval) {
        clearInterval(detailPollInterval);
        detailPollInterval = null;
    }
}

function deleteVoting(id, e) {
    e.stopPropagation();
    if (!confirm('确定要删除这个投票吗？')) return;
    fetch(`${API_URL}/voting/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
    })
    .then(res => res.json())
    .then(data => {
        if (data.code === 0) {
            loadVotings();
        } else {
            alert(data.msg || '删除失败');
        }
    })
    .catch(() => alert('删除失败'));
}

function deleteSelectedVotings() {
    const checkboxes = document.querySelectorAll('.voting-checkbox:checked');
    if (checkboxes.length === 0) {
        alert('请先选择要删除的投票');
        return;
    }
    if (!confirm(`确定要删除选中的 ${checkboxes.length} 个投票吗？`)) return;
    const ids = Array.from(checkboxes).map(cb => cb.value);
    Promise.all(ids.map(id =>
        fetch(`${API_URL}/voting/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        }).then(res => res.json())
    )).then(results => {
        loadVotings();
    }).catch(() => alert('删除失败'));
}

// 显示匿名链接弹窗
function showAnonymousModal(url) {
    document.getElementById('anonymousUrlInput').value = url;
    document.getElementById('copySuccessTip').style.display = 'none';
    document.getElementById('anonymousModal').classList.add('active');
}

function closeAnonymousModal() {
    document.getElementById('anonymousModal').classList.remove('active');
}

// 复制匿名投票链接
function copyAnonymousUrl(url, element) {
    // 模态框调用（无参数）：从 input 获取 URL
    if (url === undefined) {
        const input = document.getElementById('anonymousUrlInput');
        url = input.value;
        copyToClipboard(url, null, true);
        return;
    }
    // 卡片调用（有参数）：直接使用 URL 和元素
    copyToClipboard(url, element, false);
}

function copyToClipboard(text, element, showTip) {
    // 先尝试 clipboard API
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
            if (showTip) {
                const tip = document.getElementById('copySuccessTip');
                if (tip) { tip.style.display = 'block'; setTimeout(() => { tip.style.display = 'none'; }, 2000); }
            } else {
                showToast('链接已复制');
            }
        }).catch(() => {
            // API 失败，使用 textarea 方式
            fallbackCopy(text, showTip);
        });
    } else {
        fallbackCopy(text, showTip);
    }
}

function fallbackCopy(text, showTip) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;width:1px;height:1px;';
    document.body.appendChild(textarea);
    textarea.select();
    try {
        const success = document.execCommand('copy');
        if (success) {
            if (showTip) {
                const tip = document.getElementById('copySuccessTip');
                if (tip) { tip.style.display = 'block'; setTimeout(() => { tip.style.display = 'none'; }, 2000); }
            } else {
                showToast('链接已复制');
            }
        } else {
            showToast('复制失败，请长按链接手动复制');
        }
    } catch (err) {
        showToast('复制失败，请长按链接手动复制');
    }
    document.body.removeChild(textarea);
}

function showToast(msg) {
    let toast = document.getElementById('copyToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'copyToast';
        toast.style.cssText = 'position:fixed;top:80px;left:50%;transform:translateX(-50%);background:rgba(26,26,46,0.9);color:#fff;padding:10px 20px;border-radius:8px;font-size:14px;z-index:9999;opacity:0;transition:opacity 0.3s;';
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = '1';
    setTimeout(() => { toast.style.opacity = '0'; }, 1500);
}

// 点击投票卡片的匿名链接图标显示链接
function showVotingAnonymousUrl(votingId, e) {
    e.stopPropagation();
    fetch(`${API_URL}/voting/${votingId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    })
    .then(res => res.json())
    .then(data => {
        if (data.code === 0 && data.data.anonymousUrl) {
            showAnonymousModal(data.data.anonymousUrl);
        } else {
            alert('该投票暂无匿名链接');
        }
    })
    .catch(() => alert('获取链接失败'));
}
