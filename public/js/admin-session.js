(() => {
    const SESSION_KEY = 'adminSession';
    const LOGIN_PATH = '/admin/login.html';

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

    function hasAdminSessionRecord() {
        return !!(readSession() || localStorage.getItem('adminToken') || localStorage.getItem('currentUser'));
    }

    function clearAdminSession() {
        localStorage.removeItem('token');
        localStorage.removeItem('adminToken');
        localStorage.removeItem('currentUser');
        localStorage.removeItem('user');
        localStorage.removeItem(SESSION_KEY);
    }

    function buildLoginUrl() {
        return window.location.origin + LOGIN_PATH;
    }

    function saveAdminSession(user, token) {
        const expiresAt = getEndOfTodayTimestamp();
        localStorage.setItem('token', token);
        localStorage.setItem('adminToken', token);
        localStorage.setItem('currentUser', JSON.stringify(user || {}));
        localStorage.setItem('user', JSON.stringify(user || {}));
        localStorage.setItem(SESSION_KEY, JSON.stringify({
            username: user?.username || '',
            expiresAt
        }));
        return expiresAt;
    }

    function isAdminSessionValid() {
        const token = localStorage.getItem('token') || localStorage.getItem('adminToken');
        const session = readSession();
        if (!token || !session || !session.expiresAt) {
            return false;
        }
        return Date.now() <= Number(session.expiresAt);
    }

    function ensureAdminSession() {
        if (isAdminSessionValid()) {
            return true;
        }
        clearAdminSession();
        return false;
    }

    function getAdminToken() {
        if (!ensureAdminSession()) {
            return '';
        }
        return localStorage.getItem('token') || localStorage.getItem('adminToken') || '';
    }

    function redirectToLogin() {
        clearAdminSession();
        const loginUrl = buildLoginUrl();
        if (window.location.pathname !== LOGIN_PATH) {
            window.location.replace(loginUrl);
        }
        return false;
    }

    function requireAdminSession() {
        const token = getAdminToken();
        if (token) {
            return token;
        }
        redirectToLogin();
        return '';
    }

    window.AdminSession = {
        clear: clearAdminSession,
        ensureValid: ensureAdminSession,
        getToken: getAdminToken,
        getExpiresAt: () => readSession()?.expiresAt || null,
        hasSessionRecord: hasAdminSessionRecord,
        isValid: isAdminSessionValid,
        redirectToLogin,
        requireValid: requireAdminSession,
        save: saveAdminSession
    };
})();
