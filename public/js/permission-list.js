// js/permission-list.js - 权限管理
const API_URL = window.location.origin + '/api';
let token = '';
let permissions = [];
let editingId = null;

document.addEventListener('DOMContentLoaded', () => {
    token = window.AdminSession && window.AdminSession.requireValid
        ? window.AdminSession.requireValid()
        : (localStorage.getItem('token') || localStorage.getItem('adminToken') || '');
    if (!token) {
        return;
    }
    loadPermissions();
});

function loadPermissions() {
    document.getElementById('loading').style.display = 'block';
    document.getElementById('permissionList').innerHTML = '';
    document.getElementById('emptyState').style.display = 'none';

    fetch(`${API_URL}/admin/permissions`, {
        headers: { 'Authorization': `Bearer ${token}` }
    })
    .then(res => res.json())
    .then(data => {
        document.getElementById('loading').style.display = 'none';
        if (data.code === 0) {
            permissions = data.data || [];
            if (permissions.length === 0) {
                document.getElementById('emptyState').style.display = 'block';
            } else {
                renderPermissions();
            }
        }
    })
    .catch(err => {
        document.getElementById('loading').style.display = 'none';
        alert('加载失败');
    });
}

function renderPermissions() {
    const list = document.getElementById('permissionList');
    list.innerHTML = permissions.map(p => `
        <div class="card">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px;">
                <div class="card-title" style="margin: 0;">${p.name}</div>
                <span class="badge ${p.type === 'admin' ? 'badge-warning' : 'badge-success'}">${p.type === 'admin' ? '管理员' : '用户'}</span>
            </div>
            <p class="card-desc">${p.description || '暂无描述'}</p>
            <div class="card-meta">
                <code style="background: var(--bg-hover); padding: 2px 6px; border-radius: 4px; font-size: 12px;">${p.key}</code>
            </div>
            <div style="display: flex; gap: 8px; margin-top: 12px;">
                <button class="btn btn-secondary btn-sm" onclick="showEditModal(${p.id})">编辑</button>
                <button class="btn btn-danger btn-sm" onclick="deletePermission(${p.id})">删除</button>
            </div>
        </div>
    `).join('');
}

function showAddModal() {
    editingId = null;
    document.getElementById('modalTitle').textContent = '添加权限';
    document.getElementById('permissionId').value = '';
    document.getElementById('permName').value = '';
    document.getElementById('permKey').value = '';
    document.getElementById('permDesc').value = '';
    document.getElementById('permType').value = 'user';
    document.getElementById('editResult').style.display = 'none';
    document.getElementById('saveBtn').style.display = '';
    document.getElementById('saveBtn').textContent = '保存';
    document.getElementById('cancelBtn').textContent = '取消';
    document.getElementById('cancelBtn').disabled = false;
    document.getElementById('permissionModal').classList.add('active');
}

function showEditModal(id) {
    const p = permissions.find(x => x.id === id);
    if (!p) return;

    editingId = id;
    document.getElementById('modalTitle').textContent = '编辑权限';
    document.getElementById('permissionId').value = p.id;
    document.getElementById('permName').value = p.name;
    document.getElementById('permKey').value = p.key;
    document.getElementById('permDesc').value = p.description || '';
    document.getElementById('permType').value = p.type || 'user';
    document.getElementById('editResult').style.display = 'none';
    document.getElementById('saveBtn').style.display = '';
    document.getElementById('saveBtn').textContent = '保存';
    document.getElementById('cancelBtn').textContent = '取消';
    document.getElementById('cancelBtn').disabled = false;
    document.getElementById('permissionModal').classList.add('active');
}

function closeModal() {
    document.getElementById('permissionModal').classList.remove('active');
}

function handleSave(e) {
    e.preventDefault();

    const data = {
        name: document.getElementById('permName').value,
        key: document.getElementById('permKey').value,
        description: document.getElementById('permDesc').value,
        type: document.getElementById('permType').value
    };

    if (!data.name || !data.key) {
        document.getElementById('editResult').innerHTML = '<div style="color: var(--danger);">名称和标识不能为空</div>';
        document.getElementById('editResult').style.display = 'block';
        return;
    }

    const btn = document.getElementById('saveBtn');
    const cancelBtn = document.getElementById('cancelBtn');
    btn.textContent = '保存中...';
    btn.disabled = true;
    cancelBtn.disabled = true;

    const url = editingId ? `${API_URL}/admin/permissions/${editingId}` : `${API_URL}/admin/permissions`;
    const method = editingId ? 'PUT' : 'POST';

    fetch(url, {
        method,
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
    })
    .then(res => res.json())
    .then(res => {
        if (res.code === 0) {
            document.getElementById('editResult').innerHTML = '<div style="color: var(--success);">✓ 保存成功</div>';
            document.getElementById('editResult').style.display = 'block';
            document.getElementById('editResult').style.background = 'rgba(35,165,89,0.1)';
            btn.style.display = 'none';
            cancelBtn.textContent = '关闭';
            cancelBtn.disabled = false;
            loadPermissions();
        } else {
            document.getElementById('editResult').innerHTML = `<div style="color: var(--danger);">✗ ${res.msg || '保存失败'}</div>`;
            document.getElementById('editResult').style.display = 'block';
            btn.textContent = '重试';
            btn.disabled = false;
            cancelBtn.disabled = false;
        }
    })
    .catch(err => {
        document.getElementById('editResult').innerHTML = '<div style="color: var(--danger);">✗ 网络错误</div>';
        document.getElementById('editResult').style.display = 'block';
        btn.textContent = '重试';
        btn.disabled = false;
        cancelBtn.disabled = false;
    });
}

function deletePermission(id) {
    if (!confirm('确定删除此权限？')) return;

    fetch(`${API_URL}/admin/permissions/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
    })
    .then(res => res.json())
    .then(res => {
        if (res.code === 0) {
            alert('删除成功');
            loadPermissions();
        } else {
            alert(res.msg || '删除失败');
        }
    })
    .catch(() => alert('删除失败'));
}
