(function() {
    'use strict';

    const settings = globalThis.JPDBIKSettings;
    const promiseStorage = globalThis.browser?.storage?.local;
    const callbackStorage = globalThis.chrome?.storage?.local;
    const callbackRuntime = globalThis.chrome?.runtime;

    const DISPLAY_KEYS = [
        'IMAGE_WIDTH',
        'SHOW_EXAMPLE_IMAGES',
        'WIDE_MODE',
        'DEFINITIONS_ON_RIGHT_IN_WIDE_MODE',
        'ARROW_WIDTH',
        'ARROW_HEIGHT',
        'PAGE_WIDTH',
        'SENTENCE_FONT_SIZE',
        'TRANSLATION_FONT_SIZE',
        'COLORED_SENTENCE_TEXT',
        'VOCAB_SIZE'
    ];

    const BEHAVIOR_KEYS = [
        'SOUND_VOLUME',
        'ENABLE_EXAMPLE_TRANSLATION',
        'AUTO_PLAY_SOUND',
        'NUMBER_OF_PRELOADS',
        'MINIMUM_EXAMPLE_LENGTH',
        'HOTKEYS',
        'DEFAULT_TO_EXACT_SEARCH',
        'DICTATION_MODE'
    ];

    const FIELD_LIMITS = {
        SOUND_VOLUME: { min: 0, max: 100, step: 1 },
        NUMBER_OF_PRELOADS: { min: 0, step: 1 },
        MINIMUM_EXAMPLE_LENGTH: { min: 0, step: 1 }
    };

    let currentConfig = settings.createDefaultConfig();
    let currentCustomAudioSettings = settings.createDefaultCustomAudioSettings();

    function storageGet(keys) {
        if (promiseStorage?.get) {
            return promiseStorage.get(keys);
        }

        if (!callbackStorage?.get) {
            return Promise.resolve({});
        }

        return new Promise((resolve, reject) => {
            callbackStorage.get(keys, result => {
                const runtimeError = callbackRuntime?.lastError;
                if (runtimeError) {
                    reject(new Error(runtimeError.message));
                    return;
                }
                resolve(result);
            });
        });
    }

    function storageSet(values) {
        if (promiseStorage?.set) {
            return promiseStorage.set(values);
        }

        if (!callbackStorage?.set) {
            return Promise.resolve();
        }

        return new Promise((resolve, reject) => {
            callbackStorage.set(values, () => {
                const runtimeError = callbackRuntime?.lastError;
                if (runtimeError) {
                    reject(new Error(runtimeError.message));
                    return;
                }
                resolve();
            });
        });
    }

    function setStatus(message, isError = false) {
        const status = document.getElementById('save-status');
        status.textContent = message;
        status.style.color = isError ? 'var(--danger)' : '';
    }

    function parseNumberAndUnit(value) {
        const match = String(value).trim().match(/^(-?\d+(?:\.\d+)?)(.*)$/);
        if (!match) {
            return { number: '', unit: '' };
        }
        return {
            number: match[1],
            unit: match[2] || ''
        };
    }

    function createRow(key) {
        const defaultValue = settings.DEFAULT_CONFIG[key];
        const value = currentConfig[key];
        const row = document.createElement('div');
        row.className = 'setting-row';
        row.dataset.settingKey = key;

        const label = document.createElement('label');
        label.textContent = settings.formatConfigLabel(key);
        label.htmlFor = `config-${key.toLowerCase().replace(/_/g, '-')}`;

        const controls = document.createElement('div');
        controls.className = 'control-group';

        if (key === 'HOTKEYS') {
            const select = document.createElement('select');
            select.id = label.htmlFor;
            select.dataset.key = key;
            settings.HOTKEY_OPTIONS.forEach(option => {
                const optionElement = document.createElement('option');
                optionElement.value = option;
                optionElement.textContent = option;
                select.appendChild(optionElement);
            });
            select.value = Array.isArray(value) ? value.join(' ') : String(value);
            controls.appendChild(select);
        } else if (typeof defaultValue === 'boolean') {
            const checkbox = document.createElement('input');
            checkbox.id = label.htmlFor;
            checkbox.type = 'checkbox';
            checkbox.dataset.key = key;
            checkbox.checked = Boolean(value);
            controls.appendChild(checkbox);
        } else if (typeof defaultValue === 'number') {
            const input = document.createElement('input');
            input.id = label.htmlFor;
            input.type = 'number';
            input.dataset.key = key;
            input.value = String(value);
            input.inputMode = 'decimal';
            input.required = true;
            const limits = FIELD_LIMITS[key] || {};
            Object.entries(limits).forEach(([limitKey, limitValue]) => {
                input.setAttribute(limitKey, String(limitValue));
            });
            controls.appendChild(input);
        } else {
            const parsed = parseNumberAndUnit(value);
            const input = document.createElement('input');
            input.id = label.htmlFor;
            input.type = 'number';
            input.dataset.key = key;
            input.dataset.unit = parsed.unit;
            input.value = parsed.number;
            input.inputMode = 'decimal';
            input.min = '0';
            input.required = true;

            const unit = document.createElement('span');
            unit.className = 'unit';
            unit.textContent = parsed.unit;

            controls.append(input, unit);
        }

        row.append(label, controls);
        return row;
    }

    function createCustomAudioRow(labelText, inputId, value, type = 'text') {
        const row = document.createElement('div');
        row.className = 'setting-row';

        const label = document.createElement('label');
        label.htmlFor = inputId;
        label.textContent = labelText;

        const controls = document.createElement('div');
        controls.className = 'control-group';

        const input = document.createElement('input');
        input.id = inputId;
        input.type = type;
        if (type === 'checkbox') {
            input.checked = Boolean(value);
        } else {
            input.value = String(value ?? '');
        }
        if (type === 'number') {
            input.min = '1';
            input.step = '1';
            input.inputMode = 'numeric';
        }

        controls.appendChild(input);
        row.append(label, controls);
        return row;
    }

    function renderConfigRows(keys, containerId) {
        const container = document.getElementById(containerId);
        container.replaceChildren(...keys.map(createRow));
    }

    function renderCustomAudioRows() {
        const container = document.getElementById('custom-audio-settings');
        container.replaceChildren(
            createCustomAudioRow('Worker URL', 'custom-audio-worker-url', currentCustomAudioSettings.workerUrl),
            createCustomAudioRow('Auth Token', 'custom-audio-auth-token', currentCustomAudioSettings.authToken, 'password'),
            createCustomAudioRow('Cache Max MB', 'custom-audio-cache-max-mb', currentCustomAudioSettings.cacheMaxMB, 'number'),
            createCustomAudioRow('Sync Favorites', 'custom-audio-sync-favorites', currentCustomAudioSettings.syncFavorites, 'checkbox')
        );
    }

    function render() {
        renderConfigRows(DISPLAY_KEYS, 'display-settings');
        renderConfigRows(BEHAVIOR_KEYS, 'behavior-settings');
        renderCustomAudioRows();
    }

    function collectConfig() {
        const nextConfig = settings.createDefaultConfig();

        Object.keys(nextConfig).forEach(key => {
            const control = document.querySelector(`input[data-key="${key}"], select[data-key="${key}"]`);
            if (!control) return;

            if (key === 'HOTKEYS') {
                nextConfig[key] = control.value.split(' ');
            } else if (typeof settings.DEFAULT_CONFIG[key] === 'boolean') {
                nextConfig[key] = control.checked;
            } else if (typeof settings.DEFAULT_CONFIG[key] === 'number') {
                nextConfig[key] = control.value === '' ? settings.DEFAULT_CONFIG[key] : Number(control.value);
            } else {
                nextConfig[key] = control.value === ''
                    ? settings.DEFAULT_CONFIG[key]
                    : `${control.value}${control.dataset.unit || ''}`;
            }
        });

        return settings.normalizeConfig(nextConfig);
    }

    function collectCustomAudioSettings() {
        return settings.normalizeCustomAudioSettings({
            workerUrl: document.getElementById('custom-audio-worker-url').value,
            authToken: document.getElementById('custom-audio-auth-token').value,
            cacheMaxMB: document.getElementById('custom-audio-cache-max-mb').value,
            syncFavorites: document.getElementById('custom-audio-sync-favorites').checked
        });
    }

    async function loadOptions() {
        const stored = await storageGet([
            settings.CONFIG_STORAGE_KEY,
            settings.CUSTOM_AUDIO_SETTINGS_KEY
        ]);

        currentConfig = settings.normalizeConfig(stored[settings.CONFIG_STORAGE_KEY]);
        currentCustomAudioSettings = settings.normalizeCustomAudioSettings(stored[settings.CUSTOM_AUDIO_SETTINGS_KEY]);
        render();
    }

    async function saveOptions(event) {
        event.preventDefault();
        setStatus('Saving...');

        try {
            currentConfig = collectConfig();
            currentCustomAudioSettings = collectCustomAudioSettings();
            await storageSet({
                [settings.CONFIG_STORAGE_KEY]: currentConfig,
                [settings.CUSTOM_AUDIO_SETTINGS_KEY]: currentCustomAudioSettings
            });
            setStatus('Saved');
        } catch (error) {
            console.error('Failed to save options:', error);
            setStatus(`Save failed: ${error instanceof Error ? error.message : error}`, true);
        }
    }

    async function resetOptions() {
        if (!confirm('Reset all extension options to defaults?')) {
            return;
        }

        currentConfig = settings.createDefaultConfig();
        currentCustomAudioSettings = settings.createDefaultCustomAudioSettings();
        await storageSet({
            [settings.CONFIG_STORAGE_KEY]: currentConfig,
            [settings.CUSTOM_AUDIO_SETTINGS_KEY]: currentCustomAudioSettings
        });
        render();
        setStatus('Reset');
    }

    document.getElementById('options-form').addEventListener('submit', saveOptions);
    document.getElementById('reset-button').addEventListener('click', () => {
        resetOptions().catch(error => {
            console.error('Failed to reset options:', error);
            setStatus(`Reset failed: ${error instanceof Error ? error.message : error}`, true);
        });
    });

    loadOptions().catch(error => {
        console.error('Failed to load options:', error);
        setStatus(`Load failed: ${error instanceof Error ? error.message : error}`, true);
        render();
    });
})();
