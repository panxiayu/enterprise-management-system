(() => {
    const SESSION_KEY = 'employeeSession';
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

    function getEndOfTodayTimestamp() {
        const now = new Date();
        now.setHours(23, 59, 59, 999);
        return now.getTime();
    }

    function readSession() {
        try {
            const raw = localStorage.getItem(SESSION_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (err) {
            return null;
        }
    }

    function clearEmployeeSession() {
        localStorage.removeItem('employee_token');
        localStorage.removeItem('employee_info');
        localStorage.removeItem('granular_permissions');
        localStorage.removeItem('employeeModuleAccess');
        localStorage.removeItem(SESSION_KEY);
    }

    function saveEmployeeSession(staff, token) {
        const expiresAt = Date.now() + SEVEN_DAYS_MS;
        const dailyExpiresAt = getEndOfTodayTimestamp();
        localStorage.setItem('employee_token', token);
        localStorage.setItem('employee_info', JSON.stringify(staff || {}));
        localStorage.setItem(SESSION_KEY, JSON.stringify({
            employee_id: staff?.employee_id || '',
            expiresAt,
            dailyExpiresAt
        }));
        return expiresAt;
    }

    function isEmployeeSessionValid(scope) {
        const token = localStorage.getItem('employee_token');
        const session = readSession();
        if (!token || !session || !session.expiresAt) {
            return false;
        }
        const now = Date.now();
        if (now > Number(session.expiresAt)) {
            return false;
        }
        if (scope === 'daily') {
            if (!session.dailyExpiresAt) {
                return false;
            }
            return now <= Number(session.dailyExpiresAt);
        }
        return true;
    }

    function ensureEmployeeSession(scope) {
        if (isEmployeeSessionValid(scope)) {
            return true;
        }
        clearEmployeeSession();
        return false;
    }

    function redirectToLogin() {
        window.location.href = window.location.origin + '/index.html?expired=1';
    }

    window.EmployeeSession = {
        clear: clearEmployeeSession,
        ensureValid: ensureEmployeeSession,
        getExpiresAt: (scope) => {
            const session = readSession();
            if (!session) return null;
            return scope === 'daily' ? (session.dailyExpiresAt || null) : (session.expiresAt || null);
        },
        isValid: isEmployeeSessionValid,
        redirectToLogin,
        save: saveEmployeeSession
    };
})();
