(() => {
    const STORAGE_KEY = 'employeeModuleAccess';

    function endOfToday() {
        const now = new Date();
        now.setHours(23, 59, 59, 999);
        return now.getTime();
    }

    function readStore() {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
        } catch (err) {
            return {};
        }
    }

    function writeStore(store) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    }

    function getEmployeeId() {
        try {
            return JSON.parse(localStorage.getItem('employee_info') || '{}')?.employee_id || '';
        } catch (err) {
            return '';
        }
    }

    function clear() {
        localStorage.removeItem(STORAGE_KEY);
    }

    function has(scope) {
        const store = readStore();
        const row = store[scope];
        if (!row || !row.expiresAt || !row.employee_id) {
            return false;
        }
        if (row.employee_id !== getEmployeeId()) {
            clear();
            return false;
        }
        if (Date.now() > Number(row.expiresAt)) {
            delete store[scope];
            writeStore(store);
            return false;
        }
        return true;
    }

    function grant(scope) {
        const employeeId = getEmployeeId();
        if (!employeeId) {
            return;
        }
        const store = readStore();
        store[scope] = {
            employee_id: employeeId,
            expiresAt: endOfToday()
        };
        writeStore(store);
    }

    function buildAuthUrl(target, scope, title) {
        const params = new URLSearchParams({
            target,
            scope,
            title: title || ''
        });
        return `${window.location.origin}/employee-module-auth.html?${params.toString()}`;
    }

    function redirectToAuth(target, scope, title) {
        window.location.href = buildAuthUrl(target, scope, title);
    }

    function guard(scope, target, title) {
        if (has(scope)) {
            return true;
        }
        redirectToAuth(target || window.location.pathname + window.location.search, scope, title);
        return false;
    }

    window.ModuleAccess = {
        buildAuthUrl,
        clear,
        grant,
        guard,
        has,
        redirectToAuth
    };
})();
