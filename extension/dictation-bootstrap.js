(() => {
    const root = document.documentElement;
    const configKey = 'JPDBImmersionKitExamples-CONFIG.DICTATION_MODE';
    const legacyConfigKey = 'CONFIG.DICTATION_MODE';
    const savedValue = localStorage.getItem(configKey) ?? localStorage.getItem(legacyConfigKey);
    const dictationModeEnabled = savedValue === 'true';
    const reviewPage = window.location.pathname.startsWith('/review');

    if (dictationModeEnabled && reviewPage) {
        root.classList.remove('jpdb-dictation-mode-inactive', 'jpdb-dictation-revealing', 'jpdb-dictation-revealed');
        root.classList.add('jpdb-dictation-mode-active');
        return;
    }

    root.classList.remove('jpdb-dictation-mode-active', 'jpdb-dictation-revealing', 'jpdb-dictation-revealed');
    root.classList.add('jpdb-dictation-mode-inactive');
})();
