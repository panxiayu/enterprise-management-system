/**
 * 权限检查工具
 * 用于在各个管理页面检查用户权限
 */

// 管理页面权限配置
const PERMISSION_CONFIG = {
    'voting-list.html': 'can_manage_voting',
    'exam-list.html': 'can_manage_exam',
    'meal-list.html': 'can_manage_meal',
    'staff-list.html': 'can_manage_staff',
    'permission-list.html': 'admin_only'
};

// 员工页面权限配置（旧字段名 -> 粒化权限字段映射）
const EMPLOYEE_PERMISSION_CONFIG = {
    'mobile-learning-materials-list.html': 'hasLearning',
    'mobile-learning-materials-detail.html': 'hasLearning',
    'mobile-exam-list.html': 'hasExam',
    'mobile-exam-doing.html': 'hasExam',
    'mobile-result.html': 'hasExam',
    'mobile-6s-list.html': 'has6S',
    'mobile-6s-detail.html': 'has6S',
    'mobile-6s-add.html': 'has6S',
    'mobile-meal-list.html': 'hasMeal'
};

/**
 * 检查当前用户是否有权限访问当前页面
 * 如果没有权限，重定向到 dashboard 并显示提示
 */
function checkPermission() {
    const currentPage = window.location.pathname.split('/').pop() || 'dashboard.html';

    // 检查是否为员工页面
    const employeePermission = EMPLOYEE_PERMISSION_CONFIG[currentPage];
    if (employeePermission) {
        return checkEmployeePermission(employeePermission);
    }

    // 管理页面权限检查
    const token = window.AdminSession && window.AdminSession.getToken
        ? window.AdminSession.getToken()
        : (localStorage.getItem('token') || localStorage.getItem('adminToken') || '');
    if (!token) {
        if (window.AdminSession && window.AdminSession.redirectToLogin) {
            window.AdminSession.redirectToLogin();
        } else {
            window.location.href = 'admin/login.html';
        }
        return false;
    }

    const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');

    // dashboard.html 不需要权限检查
    if (currentPage === 'dashboard.html' || currentPage === 'index.html' || currentPage === '') {
        return true;
    }

    // 获取当前页面需要的权限
    const requiredPermission = PERMISSION_CONFIG[currentPage];

    // 如果页面不需要特定权限，允许访问
    if (!requiredPermission) {
        return true;
    }

    // 管理员管理页面 - 需要是管理员且拥有所有权限
    if (requiredPermission === 'admin_only') {
        const isSuperAdmin = currentUser.role === 'admin' &&
            currentUser.can_manage_voting &&
            currentUser.can_manage_exam &&
            currentUser.can_manage_meal &&
            currentUser.can_manage_staff &&
            currentUser.can_manage_task;

        if (!isSuperAdmin) {
            redirectToDashboard('您没有管理员管理权限');
            return false;
        }
        return true;
    }

    // 检查用户是否拥有所需权限
    const hasPermission = currentUser[requiredPermission] === 1;

    if (!hasPermission) {
        // 获取权限对应的中文描述
        const permissionNames = {
            can_manage_voting: '投票管理',
            can_manage_exam: '考试管理',
            can_manage_meal: '报餐管理',
            can_manage_staff: '员工管理',
            can_manage_task: '学习资料管理'
        };

        const permissionName = permissionNames[requiredPermission] || requiredPermission;
        redirectToDashboard(`您没有${permissionName}权限`);
        return false;
    }

    return true;
}

/**
 * 检查员工权限（使用粒化权限）
 */
function checkEmployeePermission(requiredPermission) {
    const employeeToken = localStorage.getItem('employee_token');
    if (!employeeToken) {
        // 未登录，跳转到员工登录页
        window.location.href = 'index.html';
        return false;
    }

    // 从localStorage读取粒化权限
    const granularPerms = JSON.parse(localStorage.getItem('granular_permissions') || '{}');

    // 检查员工是否有该权限
    const hasPermission = granularPerms[requiredPermission] === 1;

    if (!hasPermission) {
        // 获取权限对应的中文描述
        const permissionNames = {
            hasExam: '在线考试',
            hasMeal: '报餐系统',
            hasLearning: '学习资料',
            has6S: '6S管理'
        };

        const permissionName = permissionNames[requiredPermission] || requiredPermission;
        redirectToEmployee(`您没有${permissionName}权限`);
        return false;
    }

    return true;
}

/**
 * 重定向到员工首页并显示提示信息
 */
function redirectToEmployee(message) {
    sessionStorage.setItem('permissionError', message);
    window.location.href = 'employee.html';
}

/**
 * 重定向到 dashboard 并显示提示信息
 */
function redirectToDashboard(message) {
    // 将错误信息存储到 sessionStorage
    sessionStorage.setItem('permissionError', message);
    window.location.href = 'dashboard.html';
}

/**
 * 显示权限错误提示
 */
function showPermissionError() {
    const error = sessionStorage.getItem('permissionError');
    if (error) {
        sessionStorage.removeItem('permissionError');
        
        // 创建提示框
        const toast = document.createElement('div');
        toast.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 15px 25px;
            border-radius: 4px;
            background: #dc3545;
            color: white;
            font-weight: 500;
            z-index: 1001;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            animation: slideIn 0.3s ease;
        `;
        toast.textContent = error;
        document.body.appendChild(toast);

        // 添加动画样式
        if (!document.getElementById('permission-check-styles')) {
            const style = document.createElement('style');
            style.id = 'permission-check-styles';
            style.textContent = `
                @keyframes slideIn {
                    from { transform: translateX(100%); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }
            `;
            document.head.appendChild(style);
        }

        // 3秒后自动消失
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(100%)';
            toast.style.transition = 'all 0.3s ease';
            setTimeout(() => {
                document.body.removeChild(toast);
            }, 300);
        }, 3000);
    }
}

/**
 * 获取当前用户
 */
function getCurrentUser() {
    return JSON.parse(localStorage.getItem('currentUser') || '{}');
}

/**
 * 检查用户是否拥有指定权限（支持管理员和员工）
 */
function hasPermission(permissionName) {
    // 先检查管理员权限
    const currentUser = getCurrentUser();
    if (currentUser[permissionName] === 1) {
        return true;
    }

    // 再检查员工权限
    const employeeInfo = getEmployeeInfo();
    if (employeeInfo[permissionName] === 1) {
        return true;
    }

    return false;
}

/**
 * 获取员工信息
 */
function getEmployeeInfo() {
    return JSON.parse(localStorage.getItem('employee_info') || '{}');
}

/**
 * 检查用户是否是超级管理员
 */
function isSuperAdmin() {
    const currentUser = getCurrentUser();
    return currentUser.role === 'admin' && 
        currentUser.can_manage_voting && 
        currentUser.can_manage_exam && 
        currentUser.can_manage_meal && 
        currentUser.can_manage_staff && 
        currentUser.can_manage_task;
}

// 自动执行权限检查（如果在页面加载时调用）
if (typeof module === 'undefined') {
    // 浏览器环境
    document.addEventListener('DOMContentLoaded', () => {
        showPermissionError();
    });
}

// 导出模块（如果在 Node.js 环境中使用）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        checkPermission,
        hasPermission,
        isSuperAdmin,
        getCurrentUser,
        PERMISSION_CONFIG
    };
}
