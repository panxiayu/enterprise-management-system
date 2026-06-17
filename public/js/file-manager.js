// js/file-manager.js - 文件管理
const API_URL = window.location.origin + '/api';
let token = '';

document.addEventListener('DOMContentLoaded', () => {
    token = window.AdminSession && window.AdminSession.requireValid
        ? window.AdminSession.requireValid()
        : (localStorage.getItem('token') || localStorage.getItem('adminToken') || '');
    if (!token) {
        return;
    }
    // 权限检查
    const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
    if (!currentUser.can_manage_file) { alert('无权限访问文件管理'); window.location.href = 'dashboard.html'; return; }
    loadFiles();
});

function loadFiles() {
    document.getElementById('content').innerHTML = '<div class="loading">加载中...</div>';

    fetch(`${API_URL}/files/list`, {
        headers: { 'Authorization': `Bearer ${token}` }
    })
    .then(res => res.json())
    .then(data => {
        if (data.code === 0) {
            renderFiles(data.data || []);
        } else {
            document.getElementById('content').innerHTML = '<div class="empty-state">加载失败</div>';
        }
    })
    .catch(err => {
        document.getElementById('content').innerHTML = '<div class="empty-state">加载失败</div>';
    });
}

function renderFiles(files) {
    if (files.length === 0) {
        document.getElementById('content').innerHTML = '<div class="empty-state">暂无文件</div>';
        return;
    }

    const html = `
        <div class="table-container">
            <table>
                <thead>
                    <tr>
                        <th>文件名</th>
                        <th>大小</th>
                        <th>上传时间</th>
                        <th>操作</th>
                    </tr>
                </thead>
                <tbody>
                    ${files.map(file => `
                        <tr>
                            <td>${file.originalName || file.filename}</td>
                            <td>${formatSize(file.size)}</td>
                            <td>${file.date ? new Date(file.date).toLocaleString('zh-CN') : '-'}</td>
                            <td>
                                <button class="btn btn-secondary btn-sm" onclick="downloadFile('${file.filename}')">下载</button>
                                <button class="btn btn-danger btn-sm" onclick="deleteFile('${file.filename}')">删除</button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
    document.getElementById('content').innerHTML = html;
}

function formatSize(bytes) {
    if (!bytes) return '-';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function uploadFile() {
    const fileInput = document.getElementById('fileInput');
    const files = fileInput.files;
    if (files.length === 0) {
        alert('请选择文件');
        return;
    }

    const progress = document.getElementById('progress');
    const progressBar = document.getElementById('progressBar');
    const statusEl = document.getElementById('uploadStatus');

    progress.style.display = 'block';
    progressBar.style.width = '0%';

    // 显示待上传的文件名
    const fileNames = Array.from(files).map(f => f.name).join('、');
    statusEl.textContent = `准备上传：${fileNames}`;

    let completed = 0;
    let successCount = 0;
    let failCount = 0;
    let currentFileName = '';

    Array.from(files).forEach((file, index) => {
        const formData = new FormData();
        formData.append('file', file);

        const xhr = new XMLHttpRequest();

        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
                const filePercent = Math.round((e.loaded / e.total) * 100);
                const totalPercent = Math.round(((completed * 100 + filePercent) / files.length));
                progressBar.style.width = totalPercent + '%';
                statusEl.textContent = `正在上传：${file.name} (${filePercent}%)`;
            }
        };

        xhr.onload = () => {
            completed++;
            const data = JSON.parse(xhr.responseText);
            if (data.code === 0) {
                successCount++;
            } else {
                failCount++;
            }

            if (completed === files.length) {
                progress.style.display = 'none';
                fileInput.value = '';
                statusEl.textContent = `上传完成：成功 ${successCount} 个${failCount > 0 ? '，失败 ' + failCount + ' 个' : ''}`;
                setTimeout(() => { statusEl.textContent = ''; }, 3000);
                loadFiles();
            }
        };

        xhr.onerror = () => {
            completed++;
            failCount++;
            if (completed === files.length) {
                progress.style.display = 'none';
                fileInput.value = '';
                statusEl.textContent = `上传完成：成功 ${successCount} 个${failCount > 0 ? '，失败 ' + failCount + ' 个' : ''}`;
                setTimeout(() => { statusEl.textContent = ''; }, 3000);
                loadFiles();
            }
        };

        xhr.open('POST', `${API_URL}/files/upload`);
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr.send(formData);
    });
}

function downloadFile(filename) {
    window.location.href = `${API_URL}/files/download/${encodeURIComponent(filename)}?token=${token}`;
}

function deleteFile(filename) {
    if (!confirm('确定删除此文件？')) return;

    fetch(`${API_URL}/files/delete/${encodeURIComponent(filename)}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
    })
    .then(res => res.json())
    .then(data => {
        if (data.code === 0) {
            loadFiles();
        } else {
            alert(data.msg || '删除失败');
        }
    })
    .catch(() => alert('删除失败'));
}

function showDevLog() {
    document.getElementById('devLogModal').classList.add('active');
}

function closeDevLog() {
    document.getElementById('devLogModal').classList.remove('active');
}
