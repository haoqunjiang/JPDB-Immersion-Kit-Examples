(function(global) {
    'use strict';

    const CONFIG_STORAGE_KEY = 'configSettings';
    const CUSTOM_AUDIO_SETTINGS_KEY = 'customAudioSettings';

    const DEFAULT_CONFIG = {
        IMAGE_WIDTH: '400px',
        SHOW_EXAMPLE_IMAGES: true,
        WIDE_MODE: true,
        DEFINITIONS_ON_RIGHT_IN_WIDE_MODE: false,
        ARROW_WIDTH: '75px',
        ARROW_HEIGHT: '45px',
        PAGE_WIDTH: '75rem',
        SOUND_VOLUME: 80,
        ENABLE_EXAMPLE_TRANSLATION: true,
        SENTENCE_FONT_SIZE: '120%',
        TRANSLATION_FONT_SIZE: '85%',
        COLORED_SENTENCE_TEXT: true,
        AUTO_PLAY_SOUND: true,
        NUMBER_OF_PRELOADS: 1,
        VOCAB_SIZE: '250%',
        MINIMUM_EXAMPLE_LENGTH: 0,
        HOTKEYS: ['None'],
        DEFAULT_TO_EXACT_SEARCH: true,
        DICTATION_MODE: false
    };

    const HOTKEY_OPTIONS = ['None', 'ArrowLeft ArrowRight', ', .', '[ ]', 'Q W'];

    const CUSTOM_AUDIO_DEFAULTS = {
        workerUrl: '',
        authToken: '',
        cacheMaxMB: 250,
        syncFavorites: false
    };

    function cloneConfigValue(value) {
        return Array.isArray(value) ? [...value] : value;
    }

    function createDefaultConfig() {
        return Object.fromEntries(
            Object.entries(DEFAULT_CONFIG).map(([key, value]) => [key, cloneConfigValue(value)])
        );
    }

    function createDefaultCustomAudioSettings() {
        return { ...CUSTOM_AUDIO_DEFAULTS };
    }

    function normalizeCustomAudioWorkerUrl(value) {
        return (value || '').trim().replace(/\/+$/, '');
    }

    function normalizeHotkeys(value) {
        const joined = Array.isArray(value)
            ? value.join(' ')
            : String(value || HOTKEY_OPTIONS[0]).trim();

        return HOTKEY_OPTIONS.includes(joined)
            ? joined.split(' ')
            : [...DEFAULT_CONFIG.HOTKEYS];
    }

    function normalizeConfigValue(key, value, defaultValue) {
        if (key === 'HOTKEYS') {
            return normalizeHotkeys(value);
        }

        switch (typeof defaultValue) {
            case 'boolean':
                if (typeof value === 'string') {
                    return value === 'true';
                }
                return Boolean(value);
            case 'number': {
                const numberValue = Number(value);
                return Number.isFinite(numberValue) ? numberValue : defaultValue;
            }
            case 'string': {
                const stringValue = String(value ?? '').trim();
                return stringValue || defaultValue;
            }
            default:
                return cloneConfigValue(defaultValue);
        }
    }

    function normalizeConfig(config) {
        const normalized = createDefaultConfig();
        if (!config || typeof config !== 'object') {
            return normalized;
        }

        Object.entries(config).forEach(([key, value]) => {
            if (!Object.prototype.hasOwnProperty.call(DEFAULT_CONFIG, key)) {
                return;
            }
            normalized[key] = normalizeConfigValue(key, value, DEFAULT_CONFIG[key]);
        });

        return normalized;
    }

    function normalizeCustomAudioSettings(settings) {
        const nextSettings = {
            ...CUSTOM_AUDIO_DEFAULTS,
            ...(settings || {})
        };

        nextSettings.workerUrl = normalizeCustomAudioWorkerUrl(nextSettings.workerUrl);
        nextSettings.authToken = (nextSettings.authToken || '').trim();
        nextSettings.cacheMaxMB = Math.max(1, Number(nextSettings.cacheMaxMB) || CUSTOM_AUDIO_DEFAULTS.cacheMaxMB);
        nextSettings.syncFavorites = Boolean(nextSettings.syncFavorites);

        return nextSettings;
    }

    function serializeConfigValue(key, value) {
        return key === 'HOTKEYS' && Array.isArray(value) ? value.join(' ') : String(value);
    }

    function formatConfigLabel(key) {
        return key.replace(/_/g, ' ')
            .split(' ')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join(' ');
    }

    global.JPDBIKSettings = {
        CONFIG_STORAGE_KEY,
        CUSTOM_AUDIO_SETTINGS_KEY,
        DEFAULT_CONFIG,
        HOTKEY_OPTIONS,
        CUSTOM_AUDIO_DEFAULTS,
        createDefaultConfig,
        createDefaultCustomAudioSettings,
        normalizeCustomAudioWorkerUrl,
        normalizeConfig,
        normalizeCustomAudioSettings,
        serializeConfigValue,
        formatConfigLabel
    };
})(globalThis);
