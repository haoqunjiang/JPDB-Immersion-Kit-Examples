(() => {
    const root = document.documentElement;
    const configKey = 'JPDBImmersionKitExamples-CONFIG.DICTATION_MODE';
    const legacyConfigKey = 'CONFIG.DICTATION_MODE';
    const reviewPage = window.location.pathname.startsWith('/review');
    const sharedSettings = globalThis.JPDBIKSettings || {};
    const configStorageKey = sharedSettings.CONFIG_STORAGE_KEY || 'configSettings';

    function applyDictationModeClass(dictationModeEnabled) {
        if (dictationModeEnabled && reviewPage) {
            root.classList.remove('jpdb-dictation-mode-inactive', 'jpdb-dictation-revealing', 'jpdb-dictation-revealed');
            root.classList.add('jpdb-dictation-mode-active');
            return;
        }

        root.classList.remove('jpdb-dictation-mode-active', 'jpdb-dictation-revealing', 'jpdb-dictation-revealed');
        root.classList.add('jpdb-dictation-mode-inactive');
    }

    const savedValue = localStorage.getItem(configKey) ?? localStorage.getItem(legacyConfigKey);
    if (savedValue !== null) {
        applyDictationModeClass(savedValue === 'true');
        return;
    }

    const promiseStorage = globalThis.browser?.storage?.local;
    const callbackStorage = globalThis.chrome?.storage?.local;

    if (promiseStorage?.get) {
        promiseStorage.get(configStorageKey)
            .then(result => {
                applyDictationModeClass(Boolean(result?.[configStorageKey]?.DICTATION_MODE));
            })
            .catch(() => applyDictationModeClass(false));
        return;
    }

    if (callbackStorage?.get) {
        callbackStorage.get(configStorageKey, result => {
            if (globalThis.chrome?.runtime?.lastError) {
                applyDictationModeClass(false);
                return;
            }
            applyDictationModeClass(Boolean(result?.[configStorageKey]?.DICTATION_MODE));
        });
        return;
    }

    if (reviewPage) {
        root.classList.remove('jpdb-dictation-mode-inactive', 'jpdb-dictation-revealing', 'jpdb-dictation-revealed');
    }
    applyDictationModeClass(false);
})();
