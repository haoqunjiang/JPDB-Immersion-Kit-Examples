(function() {
    'use strict';

    if (window.__jpdbImmersionKitExamplesExtensionLoaded) {
        return;
    }
    window.__jpdbImmersionKitExamplesExtensionLoaded = true;

    const EXTENSION_FETCH_MESSAGE = 'JPDB_IK_FETCH';
    const promiseRuntime = globalThis.browser?.runtime;
    const callbackRuntime = globalThis.chrome?.runtime;
    const promiseStorage = globalThis.browser?.storage?.local;
    const callbackStorage = globalThis.chrome?.storage?.local;
    const sharedSettings = globalThis.JPDBIKSettings || {};
    const CONFIG_STORAGE_KEY = sharedSettings.CONFIG_STORAGE_KEY || 'configSettings';

    function getCallbackRuntimeLastError() {
        return callbackRuntime?.lastError || null;
    }

    function sendRuntimeMessage(message) {
        if (promiseRuntime?.sendMessage) {
            return promiseRuntime.sendMessage(message);
        }

        if (!callbackRuntime?.sendMessage) {
            return Promise.reject(new Error('Extension runtime messaging is unavailable.'));
        }

        return new Promise((resolve, reject) => {
            callbackRuntime.sendMessage(message, response => {
                const runtimeError = getCallbackRuntimeLastError();
                if (runtimeError) {
                    reject(new Error(runtimeError.message));
                    return;
                }
                resolve(response);
            });
        });
    }

    function openExtensionOptionsPage() {
        if (promiseRuntime?.openOptionsPage) {
            return promiseRuntime.openOptionsPage()
                .then(() => true)
                .catch(error => {
                    const optionsUrl = promiseRuntime.getURL?.('options.html') || callbackRuntime?.getURL?.('options.html');
                    if (optionsUrl) {
                        window.open(optionsUrl, '_blank', 'noopener');
                        return true;
                    }
                    console.warn('Failed to open extension options page:', error);
                    return false;
                });
        }

        if (!callbackRuntime?.openOptionsPage) {
            const optionsUrl = promiseRuntime?.getURL?.('options.html') || callbackRuntime?.getURL?.('options.html');
            if (optionsUrl) {
                window.open(optionsUrl, '_blank', 'noopener');
                return Promise.resolve(true);
            }
            return Promise.resolve(false);
        }

        return new Promise(resolve => {
            callbackRuntime.openOptionsPage(() => {
                const runtimeError = getCallbackRuntimeLastError();
                if (runtimeError) {
                    const optionsUrl = callbackRuntime.getURL?.('options.html');
                    if (optionsUrl) {
                        window.open(optionsUrl, '_blank', 'noopener');
                        resolve(true);
                        return;
                    }
                    console.warn('Failed to open extension options page:', runtimeError.message);
                    resolve(false);
                    return;
                }
                resolve(true);
            });
        });
    }

    function GM_addElement(parent, tagName, attributes = {}) {
        const element = document.createElement(tagName);
        Object.entries(attributes).forEach(([key, value]) => {
            if (key === 'style') {
                element.style.cssText = value;
                return;
            }
            if (key in element) {
                try {
                    element[key] = value;
                    return;
                } catch (error) {
                    console.warn(`Falling back to setAttribute for ${key}:`, error);
                }
            }
            element.setAttribute(key, value);
        });
        parent.appendChild(element);
        return element;
    }

    function base64ToArrayBuffer(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes.buffer;
    }

    function base64ToBlob(base64, contentType) {
        return new Blob([base64ToArrayBuffer(base64)], {
            type: contentType || 'application/octet-stream'
        });
    }

    function GM_xmlhttpRequest(details) {
        sendRuntimeMessage({
            type: EXTENSION_FETCH_MESSAGE,
            request: {
                method: details.method || 'GET',
                url: details.url,
                responseType: details.responseType || '',
                headers: details.headers || {},
                body: details.data ?? null
            }
        }).then(response => {
            if (!response || !response.transportOk) {
                details.onerror?.(new Error(response?.error || 'Extension fetch bridge failed'));
                return;
            }

            const result = {
                status: response.status,
                statusText: response.statusText,
                responseHeaders: Object.entries(response.headers || {})
                    .map(([key, value]) => `${key}: ${value}`)
                    .join('\r\n')
            };

            if (details.responseType === 'arraybuffer') {
                result.response = base64ToArrayBuffer(response.bodyBase64 || '');
            } else if (details.responseType === 'blob') {
                result.response = base64ToBlob(response.bodyBase64 || '', response.contentType);
            } else {
                result.responseText = response.responseText || '';
            }

            details.onload?.(result);
        }).catch(error => {
            details.onerror?.(error instanceof Error ? error : new Error(String(error)));
        });
    }

    // to use custom hotkeys just add them into this array following the same format. Any single keys except space
    // should work. If you want to use special keys, check the linked page for how to represent them in the array
    // (link leads to the arrow keys part so you can compare with the array and be sure which part to write):
    // https://developer.mozilla.org/en-US/docs/Web/API/UI_Events/Keyboard_event_key_values#navigation_keys
    const hotkeyOptions = sharedSettings.HOTKEY_OPTIONS || ['None', 'ArrowLeft ArrowRight', ', .', '[ ]', 'Q W'];

    const CONFIG = sharedSettings.createDefaultConfig ? sharedSettings.createDefaultConfig() : {
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
        // On changing this config option, the icons change but the sentences don't, so you
        // have to click once to match up the icons and again to actually change the sentences
    };

    const backupSchemaVersion = 1;
    const state = {
        currentExampleIndex: 0,
        examples: [],
        apiDataFetched: false,
        vocab: '',
        embedAboveSubsectionMeanings: false,
        preloadedIndices: new Set(),
        currentAudio: null,
        exactSearch: true,
        error: false,
        currentlyPlayingAudio: false,
        sharedAudioContext:  new (window.AudioContext || window.webkitAudioContext)(),
        currentSource: null,
        lastPlayId: 0,
        dictationRevealed: false,
        dictationVocab: '',
        dictationSignature: '',
    };

    const CUSTOM_AUDIO_SETTINGS_KEY = sharedSettings.CUSTOM_AUDIO_SETTINGS_KEY || 'customAudioSettings';
    const CUSTOM_AUDIO_DEFAULTS = sharedSettings.createDefaultCustomAudioSettings ? sharedSettings.createDefaultCustomAudioSettings() : {
        workerUrl: '',
        authToken: '',
        cacheMaxMB: 250,
        syncFavorites: false
    };
    const FAVORITES_SYNC_STORAGE_KEY = 'favoritesSyncState';
    const FAVORITES_SYNC_SCHEMA_VERSION = 1;
    const FAVORITES_SYNC_REMOTE_PATH = '/favorites';
    const FAVORITES_SYNC_DEBOUNCE_MS = 1500;
    const customAudioSettings = { ...CUSTOM_AUDIO_DEFAULTS };
    let customAudioSettingsPromise = null;
    let customAudioEnhanceTimer = null;
    let favoritesSyncTimer = null;
    let favoritesSyncInFlight = false;
    let favoritesSyncApplyingRemote = false;
    let favoritesSyncLocalRevision = 0;
    let favoritesSyncStateQueue = Promise.resolve();
    let dictationMaskTimer = null;
    let dictationParticleRefreshTimer = null;
    let dictationStyleElement = null;
    let reviewLayoutStyleElement = null;
    let dictationMaskElementId = 0;

    const chromeStorage = {
        get(keys) {
            if (promiseStorage?.get) {
                return promiseStorage.get(keys);
            }
            if (!callbackStorage?.get) {
                return Promise.resolve({});
            }
            return new Promise((resolve, reject) => {
                callbackStorage.get(keys, result => {
                    const runtimeError = getCallbackRuntimeLastError();
                    if (runtimeError) {
                        reject(new Error(runtimeError.message));
                        return;
                    }
                    resolve(result);
                });
            });
        },

        set(values) {
            if (promiseStorage?.set) {
                return promiseStorage.set(values);
            }
            if (!callbackStorage?.set) {
                return Promise.resolve();
            }
            return new Promise((resolve, reject) => {
                callbackStorage.set(values, () => {
                    const runtimeError = getCallbackRuntimeLastError();
                    if (runtimeError) {
                        reject(new Error(runtimeError.message));
                        return;
                    }
                    resolve();
                });
            });
        },

        remove(keys) {
            if (promiseStorage?.remove) {
                return promiseStorage.remove(keys);
            }
            if (!callbackStorage?.remove) {
                return Promise.resolve();
            }
            return new Promise((resolve, reject) => {
                callbackStorage.remove(keys, () => {
                    const runtimeError = getCallbackRuntimeLastError();
                    if (runtimeError) {
                        reject(new Error(runtimeError.message));
                        return;
                    }
                    resolve();
                });
            });
        }
    };

    function normalizeCustomAudioWorkerUrl(value) {
        return (value || '').trim().replace(/\/+$/, '');
    }

    async function ensureCustomAudioSettingsLoaded(forceReload = false) {
        if (!forceReload && customAudioSettingsPromise) {
            await customAudioSettingsPromise;
            return customAudioSettings;
        }

        customAudioSettingsPromise = (async () => {
            const stored = await chromeStorage.get(CUSTOM_AUDIO_SETTINGS_KEY);
            const nextSettings = {
                ...CUSTOM_AUDIO_DEFAULTS,
                ...(stored[CUSTOM_AUDIO_SETTINGS_KEY] || {})
            };

            nextSettings.workerUrl = normalizeCustomAudioWorkerUrl(nextSettings.workerUrl);
            nextSettings.cacheMaxMB = Math.max(1, Number(nextSettings.cacheMaxMB) || CUSTOM_AUDIO_DEFAULTS.cacheMaxMB);
            nextSettings.syncFavorites = Boolean(nextSettings.syncFavorites);

            Object.assign(customAudioSettings, nextSettings);
            return customAudioSettings;
        })();

        await customAudioSettingsPromise;
        return customAudioSettings;
    }

    async function saveCustomAudioSettings(nextSettings) {
        const settingsToSave = {
            workerUrl: normalizeCustomAudioWorkerUrl(nextSettings.workerUrl),
            authToken: (nextSettings.authToken || '').trim(),
            cacheMaxMB: Math.max(1, Number(nextSettings.cacheMaxMB) || CUSTOM_AUDIO_DEFAULTS.cacheMaxMB),
            syncFavorites: Boolean(nextSettings.syncFavorites)
        };

        await chromeStorage.set({
            [CUSTOM_AUDIO_SETTINGS_KEY]: settingsToSave
        });

        Object.assign(customAudioSettings, settingsToSave);
        customAudioSettingsPromise = Promise.resolve(customAudioSettings);
        return customAudioSettings;
    }

    async function resetCustomAudioSettings() {
        await chromeStorage.remove(CUSTOM_AUDIO_SETTINGS_KEY);
        Object.assign(customAudioSettings, CUSTOM_AUDIO_DEFAULTS);
        customAudioSettingsPromise = Promise.resolve(customAudioSettings);
    }

    function getCustomAudioCacheMaxBytes() {
        const sizeMB = Math.max(1, Number(customAudioSettings.cacheMaxMB) || CUSTOM_AUDIO_DEFAULTS.cacheMaxMB);
        return sizeMB * 1024 * 1024;
    }

    const CustomAudioCache = {
        DB_NAME: 'JPDBImmersionKitExamplesCustomAudio',
        DB_VERSION: 1,
        AUDIO_STORE: 'audioStore',

        open() {
            return new Promise((resolve, reject) => {
                const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

                request.onupgradeneeded = event => {
                    const db = event.target.result;
                    if (!db.objectStoreNames.contains(this.AUDIO_STORE)) {
                        db.createObjectStore(this.AUDIO_STORE, { keyPath: 'key' });
                    }
                };

                request.onsuccess = event => resolve(event.target.result);
                request.onerror = event => reject(new Error(`IndexedDB error: ${event.target.errorCode}`));
            });
        },

        getRecord(db, key) {
            return new Promise((resolve, reject) => {
                const tx = db.transaction([this.AUDIO_STORE], 'readonly');
                const store = tx.objectStore(this.AUDIO_STORE);
                const request = store.get(key);

                request.onsuccess = event => resolve(event.target.result || null);
                request.onerror = event => reject(new Error(`Failed to read custom audio: ${event.target.errorCode}`));
            });
        },

        putRecord(db, record) {
            return new Promise((resolve, reject) => {
                const tx = db.transaction([this.AUDIO_STORE], 'readwrite');
                const store = tx.objectStore(this.AUDIO_STORE);
                const request = store.put(record);

                request.onsuccess = () => resolve();
                request.onerror = event => reject(new Error(`Failed to save custom audio: ${event.target.errorCode}`));
            });
        },

        deleteRecord(db, key) {
            return new Promise((resolve, reject) => {
                const tx = db.transaction([this.AUDIO_STORE], 'readwrite');
                const store = tx.objectStore(this.AUDIO_STORE);
                const request = store.delete(key);

                request.onsuccess = () => resolve();
                request.onerror = event => reject(new Error(`Failed to delete custom audio: ${event.target.errorCode}`));
            });
        },

        getAllRecords(db) {
            return new Promise((resolve, reject) => {
                const tx = db.transaction([this.AUDIO_STORE], 'readonly');
                const store = tx.objectStore(this.AUDIO_STORE);
                const records = [];
                const request = store.openCursor();

                request.onsuccess = event => {
                    const cursor = event.target.result;
                    if (cursor) {
                        records.push(cursor.value);
                        cursor.continue();
                    } else {
                        resolve(records);
                    }
                };
                request.onerror = event => reject(new Error(`Failed to scan custom audio cache: ${event.target.errorCode}`));
            });
        },

        async get(key) {
            const db = await this.open();
            try {
                const record = await this.getRecord(db, key);
                if (!record) return null;

                record.lastAccessedAt = Date.now();
                await this.putRecord(db, record);
                return record;
            } finally {
                db.close();
            }
        },

        async peek(key) {
            const db = await this.open();
            try {
                return await this.getRecord(db, key);
            } finally {
                db.close();
            }
        },

        async save(key, blob, metadata = {}) {
            const db = await this.open();
            try {
                const now = Date.now();
                const record = {
                    key,
                    blob,
                    size: blob.size,
                    contentType: blob.type || 'audio/mpeg',
                    updatedAt: now,
                    lastAccessedAt: now,
                    ...metadata
                };

                await this.putRecord(db, record);
                await this.prune(db, getCustomAudioCacheMaxBytes());
                return record;
            } finally {
                db.close();
            }
        },

        async prune(db, maxBytes) {
            const records = await this.getAllRecords(db);
            let totalBytes = records.reduce((sum, record) => sum + (record.size || 0), 0);

            if (totalBytes <= maxBytes) {
                return;
            }

            records
                .sort((left, right) => (left.lastAccessedAt || left.updatedAt || 0) - (right.lastAccessedAt || right.updatedAt || 0));

            for (const record of records) {
                if (totalBytes <= maxBytes) {
                    break;
                }

                await this.deleteRecord(db, record.key);
                totalBytes -= record.size || 0;
            }
        },

        async clear() {
            const db = await this.open();
            try {
                return await new Promise((resolve, reject) => {
                    const tx = db.transaction([this.AUDIO_STORE], 'readwrite');
                    const store = tx.objectStore(this.AUDIO_STORE);
                    const request = store.clear();
                    request.onsuccess = () => resolve();
                    request.onerror = event => reject(new Error(`Failed to clear custom audio cache: ${event.target.errorCode}`));
                });
            } finally {
                db.close();
            }
        },

        async delete() {
            return new Promise((resolve, reject) => {
                const request = indexedDB.deleteDatabase(this.DB_NAME);
                request.onsuccess = () => resolve();
                request.onerror = event => reject(new Error(`Failed to delete custom audio cache: ${event.target.errorCode}`));
                request.onblocked = () => reject(new Error('Delete blocked; close all other tabs'));
            });
        }
    };

    function getVisibleTextWithoutRuby(node) {
        if (!node) return '';

        const clone = node.cloneNode(true);
        clone.querySelectorAll('rt').forEach(element => element.remove());
        return clone.textContent.replace(/\s+/g, ' ').trim();
    }

    function stripSentenceNodeText(sentenceElement) {
        const clone = sentenceElement.cloneNode(true);
        clone.querySelectorAll('rt, .jpdb-custom-audio-controls, a, button').forEach(element => element.remove());
        return clone.textContent.replace(/\s+/g, ' ').trim();
    }

    function resolveCurrentHeadword() {
        if (state.vocab) {
            return state.vocab.trim();
        }

        const vocabAnchor = document.querySelector('.review-reveal a.plain[href*="/vocabulary/"], .result.vocabulary a.plain[href*="/vocabulary/"], a.plain[href*="/kanji/"]');
        if (vocabAnchor) {
            return getVisibleTextWithoutRuby(vocabAnchor);
        }

        const vocabFromPath = window.location.pathname.match(/^\/(?:vocabulary|kanji)\/\d+\/([^/#?]+)/);
        if (vocabFromPath) {
            return decodeURIComponent(vocabFromPath[1]);
        }

        return '';
    }

    async function computeCustomAudioKey(payload) {
        const digest = await crypto.subtle.digest(
            'SHA-256',
            new TextEncoder().encode(JSON.stringify(payload))
        );
        return Array.from(new Uint8Array(digest))
            .map(byte => byte.toString(16).padStart(2, '0'))
            .join('');
    }

    async function getCustomAudioDescriptor(sentenceElement) {
        if (sentenceElement.dataset.jpdbCustomAudioKey) {
            return {
                key: sentenceElement.dataset.jpdbCustomAudioKey,
                sentenceText: sentenceElement.dataset.jpdbCustomAudioSentenceText || '',
                headword: sentenceElement.dataset.jpdbCustomAudioHeadword || ''
            };
        }

        const sentenceText = stripSentenceNodeText(sentenceElement);
        const headword = resolveCurrentHeadword();
        const key = await computeCustomAudioKey({
            headword,
            sentenceText
        });

        sentenceElement.dataset.jpdbCustomAudioKey = key;
        sentenceElement.dataset.jpdbCustomAudioSentenceText = sentenceText;
        sentenceElement.dataset.jpdbCustomAudioHeadword = headword;

        return { key, sentenceText, headword };
    }

    async function blobToArrayBuffer(blob) {
        return await blob.arrayBuffer();
    }

    function buildCustomAudioRemoteUrl(key) {
        return `${normalizeCustomAudioWorkerUrl(customAudioSettings.workerUrl)}/audio/${key}`;
    }

    function createCustomAudioRequestHeaders(initialHeaders = {}) {
        const headers = new Headers(initialHeaders);
        if (customAudioSettings.authToken) {
            headers.set('Authorization', `Bearer ${customAudioSettings.authToken}`);
        }
        return headers;
    }

    async function fetchRemoteCustomAudioBlob(descriptor) {
        await ensureCustomAudioSettingsLoaded();
        if (!customAudioSettings.workerUrl) {
            return null;
        }

        const response = await fetch(buildCustomAudioRemoteUrl(descriptor.key), {
            method: 'GET',
            headers: createCustomAudioRequestHeaders()
        });

        if (response.status === 404) {
            return null;
        }

        if (!response.ok) {
            throw new Error(`Remote audio fetch failed: HTTP ${response.status}`);
        }

        return await response.blob();
    }

    async function uploadRemoteCustomAudio(descriptor, file) {
        await ensureCustomAudioSettingsLoaded();
        if (!customAudioSettings.workerUrl) {
            return { remoteStored: false, localOnly: true };
        }

        const response = await fetch(buildCustomAudioRemoteUrl(descriptor.key), {
            method: 'PUT',
            headers: createCustomAudioRequestHeaders({
                'Content-Type': file.type || 'audio/mpeg',
                'X-JPDB-Headword': encodeURIComponent(descriptor.headword || ''),
                'X-JPDB-Sentence': encodeURIComponent(descriptor.sentenceText || '')
            }),
            body: file
        });

        if (!response.ok) {
            throw new Error(`Remote audio upload failed: HTTP ${response.status}`);
        }

        return { remoteStored: true, localOnly: false };
    }

    // Prefixing
    const scriptPrefix = 'JPDBImmersionKitExamples-';
    const configPrefix = 'CONFIG.'; // additional prefix for config variables to go after the scriptPrefix
    // do not change either of the above without adding code to handle the change

    const setItem = (key, value, options = {}) => {
        const { trackFavoriteSync = true } = options;
        localStorage.setItem(scriptPrefix + key, value);
        if (trackFavoriteSync) {
            trackFavoriteLocalSet(key, value);
        }
    }
    const getItem = (key) => {
        const prefixedValue = localStorage.getItem(scriptPrefix + key);
        if (prefixedValue !== null) { return prefixedValue }
        const nonPrefixedValue = localStorage.getItem(key);
        // to move away from non-prefixed values as fast as possible
        if (nonPrefixedValue !== null) { setItem(key, nonPrefixedValue, { trackFavoriteSync: false }) }
        return nonPrefixedValue
    }
    const removeItem = (key) => {
        localStorage.removeItem(scriptPrefix + key);
        localStorage.removeItem(key);
        trackFavoriteLocalDelete(key);
    }

    function getLocalStorageKeys() {
        const keys = [];
        for (let index = 0; index < localStorage.length; index++) {
            const key = localStorage.key(index);
            if (key) keys.push(key);
        }
        return keys;
    }

    let configStorageReady = false;
    let configStoragePromise = null;

    function getDefaultConfigValues() {
        return sharedSettings.createDefaultConfig ? sharedSettings.createDefaultConfig() : { ...CONFIG };
    }

    function applyConfigValue(target, configKey, savedValue) {
        if (!Object.prototype.hasOwnProperty.call(target, configKey)) return;

        if (configKey === 'HOTKEYS') {
            const normalized = sharedSettings.normalizeConfig
                ? sharedSettings.normalizeConfig({ HOTKEYS: savedValue }).HOTKEYS
                : String(savedValue).split(' ');
            target[configKey] = normalized;
            return;
        }

        const valueType = typeof target[configKey];
        if (valueType === 'boolean') {
            target[configKey] = savedValue === true || savedValue === 'true';
        } else if (valueType === 'number') {
            const numberValue = Number(savedValue);
            if (Number.isFinite(numberValue)) {
                target[configKey] = numberValue;
            }
        } else if (valueType === 'string') {
            const stringValue = String(savedValue ?? '').trim();
            if (stringValue) {
                target[configKey] = stringValue;
            }
        }
    }

    function readLocalStorageConfig(target = getDefaultConfigValues()) {
        for (let index = 0; index < localStorage.length; index++) {
            const key = localStorage.key(index);
            if (!key || !key.startsWith(scriptPrefix + configPrefix)) {
                continue;
            }

            const configKey = key.substring((scriptPrefix + configPrefix).length);
            if (!Object.prototype.hasOwnProperty.call(target, configKey)) {
                continue;
            }

            const savedValue = localStorage.getItem(key);
            if (savedValue !== null) {
                applyConfigValue(target, configKey, savedValue);
            }
        }

        return target;
    }

    function applyConfigObject(configObject) {
        const normalizedConfig = sharedSettings.normalizeConfig
            ? sharedSettings.normalizeConfig(configObject)
            : { ...getDefaultConfigValues(), ...(configObject || {}) };

        Object.keys(CONFIG).forEach(key => {
            CONFIG[key] = Array.isArray(normalizedConfig[key])
                ? [...normalizedConfig[key]]
                : normalizedConfig[key];
        });

        state.exactSearch = CONFIG.DEFAULT_TO_EXACT_SEARCH;
    }

    function buildSerializableConfig(configValues = CONFIG) {
        const serializableConfig = {};
        Object.keys(CONFIG).forEach(key => {
            serializableConfig[key] = Array.isArray(configValues[key])
                ? [...configValues[key]]
                : configValues[key];
        });
        return serializableConfig;
    }

    function writeConfigToLocalStorage(configValues = CONFIG) {
        Object.entries(configValues).forEach(([key, value]) => {
            if (!Object.prototype.hasOwnProperty.call(CONFIG, key)) return;
            const serializedValue = sharedSettings.serializeConfigValue
                ? sharedSettings.serializeConfigValue(key, value)
                : (Array.isArray(value) ? value.join(' ') : String(value));
            setItem(configPrefix + key, serializedValue, { trackFavoriteSync: false });
        });
    }

    async function saveConfigToExtensionStorage(configValues = CONFIG) {
        await chromeStorage.set({
            [CONFIG_STORAGE_KEY]: buildSerializableConfig(configValues)
        });
    }

    function loadConfig() {
        applyConfigObject(readLocalStorageConfig());
    }

    function refreshAfterExternalConfigChange() {
        writeConfigToLocalStorage(CONFIG);
        setPageWidth();
        setVocabSize();
        updateDictationModeClass();
        scheduleDictationMasking();
        if (state.vocab) {
            window.removeEventListener('keydown', hotkeysListener);
            renderImageAndPlayAudio(state.vocab, false);
            scheduleCustomAudioEnhancement();
        }
    }

    function registerExtensionStorageListener() {
        const storageChangeApi = globalThis.browser?.storage?.onChanged || globalThis.chrome?.storage?.onChanged;
        if (!storageChangeApi?.addListener) return;

        storageChangeApi.addListener((changes, areaName) => {
            if (areaName && areaName !== 'local') return;

            const configChange = changes[CONFIG_STORAGE_KEY];
            if (configChange?.newValue) {
                applyConfigObject(configChange.newValue);
                refreshAfterExternalConfigChange();
            }

            const customAudioChange = changes[CUSTOM_AUDIO_SETTINGS_KEY];
            if (customAudioChange?.newValue) {
                ensureCustomAudioSettingsLoaded(true)
                    .then(() => {
                        scheduleCustomAudioEnhancement();
                        if (customAudioSettings.syncFavorites && customAudioSettings.workerUrl) {
                            return runFavoritesSync('sync', { silent: true });
                        }
                    })
                    .catch(error => {
                        console.error('Failed to apply updated custom-audio settings:', error);
                    });
            }
        });
    }

    async function ensureConfigLoaded(forceReload = false) {
        if (!forceReload && configStoragePromise) {
            await configStoragePromise;
            return CONFIG;
        }

        configStoragePromise = (async () => {
            const localStorageConfig = readLocalStorageConfig();
            applyConfigObject(localStorageConfig);

            const stored = await chromeStorage.get(CONFIG_STORAGE_KEY);
            if (stored[CONFIG_STORAGE_KEY]) {
                applyConfigObject(stored[CONFIG_STORAGE_KEY]);
                writeConfigToLocalStorage(CONFIG);
            } else {
                await saveConfigToExtensionStorage(localStorageConfig);
            }

            configStorageReady = true;
            return CONFIG;
        })().catch(error => {
            configStorageReady = true;
            console.error('Failed to load extension settings; using page-local settings:', error);
            return CONFIG;
        });

        await configStoragePromise;
        return CONFIG;
    }

    // Helper for transitioning to fully script-prefixed config state
    // Deletes all localStorage variables starting with configPrefix and re-adds them with scriptPrefix and configPrefix
    // Danger of other scripts also having localStorage variables starting with configPrefix, so we add a flag showing that
    // we have run this function and make sure it is not set when running it

    // Check for Prefixed flag
    if (localStorage.getItem(`JPDBImmersionKit*Examples-CONFIG_VARIABLES_PREFIXED`) !== 'true') {
        const keysToModify = [];

        // Collect keys that need to be modified
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key.startsWith(configPrefix)) {
                keysToModify.push(key);
            }
        }

        // Modify the collected keys
        keysToModify.forEach((key) => {
            const value = localStorage.getItem(key);
            localStorage.removeItem(key);
            const newKey = scriptPrefix + key;
            localStorage.setItem(newKey, value);
        });
        // Set flag so this only runs once
        // Flag has * in name to place at top in alphabetical sorting,
        // and most importantly, to ensure the flag is never removed or modified
        // by the other script functions that check for the script prefix
        localStorage.setItem(`JPDBImmersionKit*Examples-CONFIG_VARIABLES_PREFIXED`, 'true');
    }

    // Favorite Sync
    function isFavoriteSyncKey(key) {
        return typeof key === 'string' && key.length > 0 && !key.startsWith(configPrefix);
    }

    function normalizeFavoriteSyncTimestamp(value) {
        const timestamp = Number(value);
        return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0;
    }

    function normalizeFavoritesSyncDocument(documentValue) {
        const normalized = {
            schemaVersion: FAVORITES_SYNC_SCHEMA_VERSION,
            updatedAt: normalizeFavoriteSyncTimestamp(documentValue?.updatedAt),
            entries: {},
            deleted: {}
        };

        const sourceEntries = documentValue?.entries || {};
        Object.entries(sourceEntries).forEach(([key, record]) => {
            if (!isFavoriteSyncKey(key) || record?.value === undefined || record?.value === null) return;

            const updatedAt = normalizeFavoriteSyncTimestamp(record.updatedAt);
            if (!updatedAt) return;

            normalized.entries[key] = {
                value: String(record.value),
                updatedAt
            };
            normalized.updatedAt = Math.max(normalized.updatedAt, updatedAt);
        });

        const sourceDeleted = documentValue?.deleted || {};
        Object.entries(sourceDeleted).forEach(([key, record]) => {
            if (!isFavoriteSyncKey(key)) return;

            const updatedAt = normalizeFavoriteSyncTimestamp(record?.updatedAt);
            if (!updatedAt) return;

            normalized.deleted[key] = { updatedAt };
            normalized.updatedAt = Math.max(normalized.updatedAt, updatedAt);
        });

        return normalized;
    }

    async function loadFavoritesSyncState() {
        const stored = await chromeStorage.get(FAVORITES_SYNC_STORAGE_KEY);
        return normalizeFavoritesSyncDocument(stored[FAVORITES_SYNC_STORAGE_KEY]);
    }

    async function saveFavoritesSyncState(documentValue) {
        const normalized = normalizeFavoritesSyncDocument(documentValue);
        await chromeStorage.set({
            [FAVORITES_SYNC_STORAGE_KEY]: normalized
        });
        return normalized;
    }

    function collectLocalFavoriteEntries() {
        const entries = {};

        for (let i = 0; i < localStorage.length; i++) {
            const storageKey = localStorage.key(i);
            if (!storageKey?.startsWith(scriptPrefix)) continue;

            const key = storageKey.substring(scriptPrefix.length);
            if (!isFavoriteSyncKey(key)) continue;

            const value = localStorage.getItem(storageKey);
            if (value !== null) {
                entries[key] = value;
            }
        }

        return entries;
    }

    function queueFavoritesSyncStateUpdate(updater) {
        favoritesSyncStateQueue = favoritesSyncStateQueue
            .catch(() => {})
            .then(async () => {
                const documentValue = await loadFavoritesSyncState();
                const updatedDocument = normalizeFavoritesSyncDocument(updater(documentValue) || documentValue);
                return await saveFavoritesSyncState(updatedDocument);
            })
            .catch(error => {
                console.warn('Failed to update favorite sync metadata:', error);
            });

        return favoritesSyncStateQueue;
    }

    function queueFavoritesSyncStateReplacement(documentValue) {
        favoritesSyncStateQueue = favoritesSyncStateQueue
            .catch(() => {})
            .then(() => saveFavoritesSyncState(documentValue));

        return favoritesSyncStateQueue;
    }

    function trackFavoriteLocalSet(key, value) {
        if (favoritesSyncApplyingRemote || !isFavoriteSyncKey(key)) return;

        favoritesSyncLocalRevision += 1;
        const updatedAt = Date.now();
        queueFavoritesSyncStateUpdate(documentValue => {
            documentValue.entries[key] = {
                value: String(value),
                updatedAt
            };
            delete documentValue.deleted[key];
            documentValue.updatedAt = Math.max(documentValue.updatedAt, updatedAt);
            return documentValue;
        }).then(scheduleFavoritesAutoSync);
    }

    function trackFavoriteLocalDelete(key) {
        if (favoritesSyncApplyingRemote || !isFavoriteSyncKey(key)) return;

        favoritesSyncLocalRevision += 1;
        const updatedAt = Date.now();
        queueFavoritesSyncStateUpdate(documentValue => {
            delete documentValue.entries[key];
            documentValue.deleted[key] = { updatedAt };
            documentValue.updatedAt = Math.max(documentValue.updatedAt, updatedAt);
            return documentValue;
        }).then(scheduleFavoritesAutoSync);
    }

    async function buildLocalFavoritesSyncDocument(remoteContext = null) {
        await favoritesSyncStateQueue.catch(() => {});

        const now = Date.now();
        const storedDocument = await loadFavoritesSyncState();
        const remoteDocument = normalizeFavoritesSyncDocument(remoteContext);
        const localEntries = collectLocalFavoriteEntries();
        const nextDocument = {
            schemaVersion: FAVORITES_SYNC_SCHEMA_VERSION,
            updatedAt: storedDocument.updatedAt,
            entries: {},
            deleted: { ...storedDocument.deleted }
        };

        Object.entries(localEntries).forEach(([key, value]) => {
            const existing = storedDocument.entries[key];
            const remoteEntry = remoteDocument.entries[key];
            const remoteDeletedAt = remoteDocument.deleted[key]?.updatedAt || 0;
            const remoteEntryAt = remoteEntry?.updatedAt || 0;
            let updatedAt;

            if (existing?.value === value) {
                updatedAt = existing.updatedAt;
            } else if (existing) {
                updatedAt = now;
            } else if (remoteEntry?.value === value) {
                updatedAt = remoteEntryAt;
            } else if (remoteDeletedAt || remoteEntryAt) {
                // Metadata-less entries are legacy local data. Do not let them
                // resurrect a remote deletion or overwrite an established remote choice.
                updatedAt = 1;
            } else {
                updatedAt = now;
            }

            nextDocument.entries[key] = {
                value,
                updatedAt
            };

            const deletedAt = nextDocument.deleted[key]?.updatedAt || 0;
            if (deletedAt <= updatedAt) {
                delete nextDocument.deleted[key];
            }

            nextDocument.updatedAt = Math.max(nextDocument.updatedAt, updatedAt);
        });

        Object.entries(storedDocument.entries).forEach(([key, record]) => {
            if (Object.prototype.hasOwnProperty.call(localEntries, key)) return;

            const deletedAt = nextDocument.deleted[key]?.updatedAt || 0;
            if (deletedAt < record.updatedAt) {
                nextDocument.deleted[key] = { updatedAt: now };
                nextDocument.updatedAt = Math.max(nextDocument.updatedAt, now);
            }
        });

        return normalizeFavoritesSyncDocument(nextDocument);
    }

    async function mergeLatestLocalFavoritesIfChanged(remoteDocument, localRevisionAtStart) {
        let mergedDocument = normalizeFavoritesSyncDocument(remoteDocument);
        let observedLocalRevision = localRevisionAtStart;

        while (favoritesSyncLocalRevision !== observedLocalRevision) {
            observedLocalRevision = favoritesSyncLocalRevision;
            const latestLocalDocument = await buildLocalFavoritesSyncDocument(mergedDocument);
            mergedDocument = mergeFavoritesSyncDocuments(mergedDocument, latestLocalDocument);
        }

        return mergedDocument;
    }

    function mergeFavoritesSyncDocuments(...documents) {
        const normalizedDocuments = documents.map(normalizeFavoritesSyncDocument);
        const keys = new Set();

        normalizedDocuments.forEach(documentValue => {
            Object.keys(documentValue.entries).forEach(key => keys.add(key));
            Object.keys(documentValue.deleted).forEach(key => keys.add(key));
        });

        const merged = {
            schemaVersion: FAVORITES_SYNC_SCHEMA_VERSION,
            updatedAt: 0,
            entries: {},
            deleted: {}
        };

        keys.forEach(key => {
            let newestEntry = null;
            let newestDeleted = null;

            normalizedDocuments.forEach(documentValue => {
                const entry = documentValue.entries[key];
                if (entry && (!newestEntry || entry.updatedAt > newestEntry.updatedAt)) {
                    newestEntry = entry;
                }

                const deleted = documentValue.deleted[key];
                if (deleted && (!newestDeleted || deleted.updatedAt > newestDeleted.updatedAt)) {
                    newestDeleted = deleted;
                }
            });

            if (newestEntry && (!newestDeleted || newestEntry.updatedAt >= newestDeleted.updatedAt)) {
                merged.entries[key] = { ...newestEntry };
                merged.updatedAt = Math.max(merged.updatedAt, newestEntry.updatedAt);
            } else if (newestDeleted) {
                merged.deleted[key] = { ...newestDeleted };
                merged.updatedAt = Math.max(merged.updatedAt, newestDeleted.updatedAt);
            }
        });

        return merged;
    }

    function applyFavoritesSyncDocumentToLocalStorage(documentValue) {
        const normalized = normalizeFavoritesSyncDocument(documentValue);
        const localEntries = collectLocalFavoriteEntries();
        let changed = false;

        favoritesSyncApplyingRemote = true;
        try {
            Object.keys(localEntries).forEach(key => {
                if (normalized.entries[key]) return;

                localStorage.removeItem(scriptPrefix + key);
                localStorage.removeItem(key);
                changed = true;
            });

            Object.entries(normalized.entries).forEach(([key, record]) => {
                if (localEntries[key] !== record.value) {
                    localStorage.setItem(scriptPrefix + key, record.value);
                    changed = true;
                }

                localStorage.removeItem(key);
            });

            Object.keys(normalized.deleted).forEach(key => {
                localStorage.removeItem(scriptPrefix + key);
                localStorage.removeItem(key);
            });
        } finally {
            favoritesSyncApplyingRemote = false;
        }

        return changed;
    }

    function buildFavoritesSyncRemoteUrl() {
        return `${normalizeCustomAudioWorkerUrl(customAudioSettings.workerUrl)}${FAVORITES_SYNC_REMOTE_PATH}`;
    }

    async function fetchRemoteFavoritesSyncDocument() {
        await ensureCustomAudioSettingsLoaded();
        if (!customAudioSettings.workerUrl) {
            throw new Error('Set a Worker URL before syncing favorites.');
        }

        const response = await fetch(buildFavoritesSyncRemoteUrl(), {
            method: 'GET',
            headers: createCustomAudioRequestHeaders()
        });

        if (!response.ok) {
            throw new Error(`Remote favorites fetch failed: HTTP ${response.status}`);
        }

        return normalizeFavoritesSyncDocument(await response.json());
    }

    async function putRemoteFavoritesSyncDocument(documentValue) {
        await ensureCustomAudioSettingsLoaded();
        if (!customAudioSettings.workerUrl) {
            throw new Error('Set a Worker URL before syncing favorites.');
        }

        const response = await fetch(buildFavoritesSyncRemoteUrl(), {
            method: 'PUT',
            headers: createCustomAudioRequestHeaders({
                'Content-Type': 'application/json'
            }),
            body: JSON.stringify(normalizeFavoritesSyncDocument(documentValue))
        });

        if (!response.ok) {
            throw new Error(`Remote favorites upload failed: HTTP ${response.status}`);
        }

        return normalizeFavoritesSyncDocument(await response.json());
    }

    async function refreshCurrentPageAfterFavoritesSync(previousCurrentValue) {
        if (!state.vocab) return;

        const nextCurrentValue = getItem(state.vocab);
        if (nextCurrentValue === previousCurrentValue) return;

        const { index, exactState } = getStoredData(state.vocab);
        state.currentExampleIndex = index;
        state.exactSearch = exactState;
        state.apiDataFetched = false;

        renderImageAndPlayAudio(state.vocab, false);

        try {
            await getImmersionKitData(state.vocab, state.exactSearch);
            preloadImages();
            embedImageAndPlayAudio();
            scheduleCustomAudioEnhancement();
            scheduleDictationMasking();
        } catch (error) {
            console.warn('Failed to refresh page after favorites sync:', error);
        }
    }

    async function runFavoritesSync(mode = 'sync', options = {}) {
        const { silent = false, refreshCurrentPage = true } = options;

        if (favoritesSyncInFlight) {
            return { skipped: true };
        }

        favoritesSyncInFlight = true;
        const localRevisionAtStart = favoritesSyncLocalRevision;
        const previousCurrentValue = state.vocab ? getItem(state.vocab) : null;

        try {
            await ensureCustomAudioSettingsLoaded();
            const remoteBeforeDocument = await fetchRemoteFavoritesSyncDocument();
            let mergedDocument = remoteBeforeDocument;

            if (mode !== 'pull') {
                const localDocument = await buildLocalFavoritesSyncDocument(remoteBeforeDocument);
                const locallyMergedDocument = mergeFavoritesSyncDocuments(localDocument, remoteBeforeDocument);
                const remoteAfterDocument = await putRemoteFavoritesSyncDocument(locallyMergedDocument);
                mergedDocument = mergeFavoritesSyncDocuments(locallyMergedDocument, remoteAfterDocument);
            }

            mergedDocument = await mergeLatestLocalFavoritesIfChanged(mergedDocument, localRevisionAtStart);
            const changed = applyFavoritesSyncDocumentToLocalStorage(mergedDocument);
            const savedDocument = await queueFavoritesSyncStateReplacement(mergedDocument);

            if (refreshCurrentPage && changed) {
                await refreshCurrentPageAfterFavoritesSync(previousCurrentValue);
            }

            return {
                skipped: false,
                changed,
                favoriteCount: Object.keys(savedDocument.entries).length,
                deletedCount: Object.keys(savedDocument.deleted).length
            };
        } catch (error) {
            if (!silent) {
                alert(`Favorites sync failed: ${error instanceof Error ? error.message : error}`);
            }
            throw error;
        } finally {
            favoritesSyncInFlight = false;
        }
    }

    function scheduleFavoritesAutoSync() {
        clearTimeout(favoritesSyncTimer);

        favoritesSyncTimer = setTimeout(async () => {
            try {
                await ensureCustomAudioSettingsLoaded();
                if (!customAudioSettings.syncFavorites || !customAudioSettings.workerUrl) return;

                await runFavoritesSync('sync', { silent: true });
            } catch (error) {
                console.warn('Automatic favorites sync failed:', error);
            }
        }, FAVORITES_SYNC_DEBOUNCE_MS);
    }

    async function handleFavoritesSyncButtonClick(mode) {
        try {
            const overlay = document.getElementById('overlayMenu');
            if (overlay) {
                await saveCustomAudioSettingsFromOverlay(overlay);
            }

            const result = await runFavoritesSync(mode, { silent: false });
            if (result?.skipped) {
                alert('Favorites sync is already running.');
                return;
            }

            alert(`Favorites sync complete. ${result.favoriteCount} saved, ${result.deletedCount} deleted markers retained.`);
        } catch (error) {
            console.error('Favorites sync failed:', error);
        }
    }

    // IndexedDB Manager
    const IndexedDBManager = {
        DB_NAME: 'ImmersionKitDB',
        DB_VERSION: 2, // bump version to create metaStore
        DATA_STORE: 'dataStore',
        META_STORE: 'metaStore',
        META_KEY: 'index_meta',
        MAX_ENTRIES: 100000000,
        EXPIRATION_TIME: 30 * 24 * 60 * 60 * 1000 * 12 * 10000, // 10000 years

        open() {
            return new Promise((resolve, reject) => {
                const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

                request.onupgradeneeded = event => {
                    const db = event.target.result;
                    if (!db.objectStoreNames.contains(this.DATA_STORE)) {
                        db.createObjectStore(this.DATA_STORE, { keyPath: 'keyword' });
                    }
                    if (!db.objectStoreNames.contains(this.META_STORE)) {
                        db.createObjectStore(this.META_STORE, { keyPath: 'key' });
                    }
                };

                request.onsuccess = event => resolve(event.target.result);
                request.onerror = event => reject('IndexedDB error: ' + event.target.errorCode);
            });
        },

        // ---------- META STORE ----------
        getMetadata(db) {
            return new Promise((resolve, reject) => {
                const tx = db.transaction([this.META_STORE], 'readonly');
                const store = tx.objectStore(this.META_STORE);
                const req = store.get(this.META_KEY);

                req.onsuccess = e => {
                    const rec = e.target.result;
                    resolve(rec ? rec.data : null);
                };
                req.onerror = e => reject('Failed to read metadata: ' + e.target.errorCode);
            });
        },

        saveMetadata(db, metadata) {
            return new Promise((resolve, reject) => {
                const tx = db.transaction([this.META_STORE], 'readwrite');
                const store = tx.objectStore(this.META_STORE);
                const rec = { key: this.META_KEY, data: metadata, timestamp: Date.now() };
                const req = store.put(rec);
                req.onsuccess = () => resolve();
                req.onerror = e => reject('Failed to save metadata: ' + e.target.errorCode);
            });
        },

        // ---------- DATA STORE ----------
        get(db, keyword) {
            return new Promise((resolve, reject) => {
                const tx = db.transaction([this.DATA_STORE], 'readonly');
                const store = tx.objectStore(this.DATA_STORE);
                const req = store.get(keyword);

                req.onsuccess = async e => {
                    const result = e.target.result;
                    if (!result) return resolve(null);

                    // Return the data field directly
                    resolve(result.data ? result.data : result);
                };

                req.onerror = e => reject('IndexedDB get error: ' + e.target.errorCode);
            });
        },

        deleteEntry(db, keyword) {
            return new Promise((resolve, reject) => {
                const tx = db.transaction([this.DATA_STORE], 'readwrite');
                const store = tx.objectStore(this.DATA_STORE);
                const req = store.delete(keyword);
                req.onsuccess = () => resolve();
                req.onerror = e => reject('IndexedDB delete error: ' + e.target.errorCode);
            });
        },

        getAll(db) {
            return new Promise((resolve, reject) => {
                const tx = db.transaction([this.DATA_STORE], 'readonly');
                const store = tx.objectStore(this.DATA_STORE);
                const entries = [];
                store.openCursor().onsuccess = e => {
                    const cursor = e.target.result;
                    if (cursor) {
                        entries.push(cursor.value);
                        cursor.continue();
                    } else {
                        resolve(entries);
                    }
                };
                store.openCursor().onerror = e => reject('Cursor error: ' + e.target.errorCode);
            });
        },

        // Fallback network fetch
        fetchMetadata() {
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: "GET",
                    url: "https://apiv2.immersionkit.com/index_meta",
                    onload: res => {
                        if (res.status === 200) {
                            try {
                                resolve(JSON.parse(res.responseText));
                            } catch (err) {
                                reject('Invalid JSON: ' + err);
                            }
                        } else {
                            reject('HTTP ' + res.status);
                        }
                    },
                    onerror: err => reject('Network error: ' + err)
                });
            });
        },

        save(db, keyword, data) {
            return new Promise(async (resolve, reject) => {
                try {
                    const validationError = validateApiResponse(data);
                    if (validationError) {
                        console.warn(`Invalid data: ${validationError}`);
                        return resolve();
                    }

                    // 1) load metadata from DB (or fetch & save if missing)
                    let metadata = await this.getMetadata(db);
                    if (!metadata) {
                        metadata = await this.fetchMetadata();
                        await this.saveMetadata(db, metadata);
                    }

                    // 2) slim down
                    const slimData = {};
                    if (data.category_count) slimData.category_count = data.category_count;
                    if (!Array.isArray(data.examples)) {
                        console.error('Unexpected examples format');
                        return resolve();
                    }

                    // 3) map & patch titles
                    const categoryOrder = ['anime', 'drama', 'games', 'literature', 'news'];
                    let slimExamples = await Promise.all(data.examples.map(async ex => {
                        const slim = {
                            image: ex.image,
                            sound: ex.sound,
                            sentence: ex.sentence,
                            translation: ex.translation,
                            title: ex.title,
                            media: ex.id ? ex.id.split('_')[0] : undefined
                        };

                        // if title not in our local metadata, re-fetch & update
                        if (!metadata.data[slim.title]) {
                            metadata = await this.fetchMetadata();
                            await this.saveMetadata(db, metadata);
                        }

                        const entry = metadata.data[slim.title];
                        if (entry) slim.title = entry.title;
                        return slim;
                    }));

                    // Check state.exactSearch and filter examples
                    console.log('State exactSearch:', state.exactSearch);
                    console.log('State vocab:', state.vocab);

                    const totalExamplesBefore = slimExamples.length;
                    console.log('Total examples before filtering:', totalExamplesBefore);

                    if (state.exactSearch) {
                        const initialCount = slimExamples.length;
                        slimExamples = slimExamples.filter(ex => ex.sentence.includes(state.vocab));
                        const removedCount = initialCount - slimExamples.length;
                        console.log('Number of examples removed:', removedCount);
                    }

                    const totalExamplesAfter = slimExamples.length;
                    console.log('Total examples after filtering:', totalExamplesAfter);

                    // 4) sort
                    slimExamples.sort((a, b) => {
                        const ca = categoryOrder.indexOf(a.media);
                        const cb = categoryOrder.indexOf(b.media);
                        if (ca !== cb) return ca - cb;
                        return a.sentence.length - b.sentence.length;
                    });
                    slimData.examples = slimExamples;

                    // 5) enforce MAX_ENTRIES
                    const all = await this.getAll(db);
                    const tx = db.transaction([this.DATA_STORE], 'readwrite');
                    const store = tx.objectStore(this.DATA_STORE);

                    if (all.length >= this.MAX_ENTRIES) {
                        all
                            .sort((a, b) => a.timestamp - b.timestamp)
                            .slice(0, all.length - this.MAX_ENTRIES + 1)
                            .forEach(old => store.delete(old.keyword));
                    }

                    // 6) put new record
                    store.put({ keyword, data: slimData, timestamp: Date.now() });

                    tx.oncomplete = () => {
                        console.log('Save complete');
                        resolve();
                    };
                    tx.onerror = e => reject('Save transaction failed: ' + e.target.errorCode);

                } catch (err) {
                    reject('Error in save(): ' + err);
                }
            });
        },

        async versionupdate(db, searchVocab) {
            return new Promise(async (resolve, reject) => {
                try {
                    // Fetch the existing data for the given searchVocab
                    let cachedData = await this.get(db, searchVocab);

                    if (!cachedData || !cachedData.data) {
                        return resolve(); // No data to update
                    }

                    // Check if cachedData.data is an array and extract the first element
                    const dataToTransform = Array.isArray(cachedData.data) ? cachedData.data[0] : cachedData.data;

                    // Transform the data
                    const updatedData = {
                        category_count: dataToTransform.category_count,
                        examples: dataToTransform.examples.map(example => {
                            const imageUrlParts = example.image_url.split('/');
                            const soundUrlParts = example.sound_url.split('/');

                            // Extract media from the URL
                            const mediaIndex = imageUrlParts.indexOf('media');
                            const media = mediaIndex !== -1 && mediaIndex + 1 < imageUrlParts.length ? imageUrlParts[mediaIndex + 1] : '';

                            return {
                                image: imageUrlParts[imageUrlParts.length - 1],
                                sound: soundUrlParts[soundUrlParts.length - 1],
                                sentence: example.sentence,
                                translation: example.translation,
                                title: example.deck_name,
                                media: media,
                            };
                        })
                    };

                    // Open a readwrite transaction on your data store
                    const tx = db.transaction([this.DATA_STORE], 'readwrite');
                    const store = tx.objectStore(this.DATA_STORE);

                    // Put the new record directly
                    store.put({
                        keyword: searchVocab,
                        data: updatedData,
                        timestamp: Date.now()
                    });

                    tx.oncomplete = () => {
                        console.log('Version update complete');
                        resolve();
                    };
                    tx.onerror = e => {
                        console.error('Version update transaction failed:', e.target.errorCode);
                        reject('Version update transaction failed: ' + e.target.errorCode);
                    };

                } catch (error) {
                    console.error('Error in versionupdate:', error);
                    reject('Error in versionupdate: ' + error);
                }
            });
        }
        ,


        delete() {
            return new Promise((resolve, reject) => {
                const req = indexedDB.deleteDatabase(this.DB_NAME);
                req.onsuccess = () => resolve();
                req.onerror = e => reject('Delete failed: ' + e.target.errorCode);
                req.onblocked = () => reject('Delete blocked; close all other tabs');
            });
        }
    };



    // API FUNCTIONS=====================================================================================================================
    function getImmersionKitData(vocab, exactSearch) {
        return new Promise(async (resolve, reject) => {
            const searchVocab = exactSearch ? `「${vocab}」` : vocab;
            const url = `https://apiv2.immersionkit.com/search?q=${encodeURIComponent(searchVocab)}`;
            const maxRetries = 5;
            let attempt = 0;

            const storedValue = getItem(state.vocab);
            const isBlacklisted = storedValue && storedValue.split(',').length > 1 && parseInt(storedValue.split(',')[1], 10) === 2;

            // Return early if not blacklisted
            if (isBlacklisted) {
                resolve();
                return;
            }

            async function fetchData() {
                try {
                    const db = await IndexedDBManager.open();
                    let cachedData = await IndexedDBManager.get(db, searchVocab);

                    // Check if the cached data is outdated (v1 API data with 'data' field as an array)
                    if (cachedData && Array.isArray(cachedData.data) && cachedData.data.length > 0) {
                        console.log('Outdated data detected, updating...');
                        await IndexedDBManager.versionupdate(db, searchVocab);
                        // Rerun fetchData after updating
                        return fetchData();
                    } else if (cachedData && cachedData.examples && Array.isArray(cachedData.examples) && cachedData.examples.length > 0) {
                        console.log('Data retrieved from IndexedDB');
                        state.examples = cachedData.examples;
                        state.apiDataFetched = true;
                        updateCurrentExampleIndex();
                        resolve();
                    } else {
                        console.log(`Calling API for: ${searchVocab}`);
                        GM_xmlhttpRequest({
                            method: "GET",
                            url: url,
                            onload: async function(response) {
                                if (response.status === 200) {
                                    const jsonData = parseJSON(response.responseText);
                                    console.log("API JSON Received");
                                    console.log(url);
                                    const validationError = validateApiResponse(jsonData);
                                    if (!validationError) {
                                        await IndexedDBManager.save(db, searchVocab, jsonData);

                                        // Attempt to load the data from cache again after saving
                                        cachedData = await IndexedDBManager.get(db, searchVocab);
                                        if (cachedData && cachedData.examples && Array.isArray(cachedData.examples)) {
                                            console.log('Data retrieved from IndexedDB after saving');
                                            state.examples = cachedData.examples;
                                            state.apiDataFetched = true;
                                            updateCurrentExampleIndex();
                                            resolve();
                                        } else {
                                            reject('Failed to retrieve data from IndexedDB after saving');
                                        }
                                    } else {
                                        attempt++;
                                        if (attempt < maxRetries) {
                                            console.log(`Validation error: ${validationError}. Retrying... (${attempt}/${maxRetries})`);
                                            setTimeout(fetchData, 2000); // Add a 2-second delay before retrying
                                        } else {
                                            reject(`Invalid API response after ${maxRetries} attempts: ${validationError}`);
                                            state.error = true;
                                            embedImageAndPlayAudio(); // Update displayed text
                                        }
                                    }
                                } else {
                                    reject(`API call failed with status: ${response.status}`);
                                }
                            },
                            onerror: function(error) {
                                reject(`An error occurred: ${error}`);
                            }
                        });
                    }
                } catch (error) {
                    reject(`Error: ${error}`);
                }
            }

            function updateCurrentExampleIndex() {
                const storedValue = getItem(state.vocab);

                if (storedValue) {
                    // If stored data exists, use it to update the current example index
                    const storedIndex = parseInt(storedValue, 10);

                    // Update the current example index with the stored index
                    state.currentExampleIndex = storedIndex;
                    return;
                }

                // If no stored data exists, check sentence length
                for (let i = 0; i < state.examples.length; i++) {
                    if (state.examples[i].sentence.length >= CONFIG.MINIMUM_EXAMPLE_LENGTH) {
                        state.currentExampleIndex = i;
                        break;
                    }
                }
            }
            fetchData();
        });
    }

    function parseJSON(responseText) {
        try {
            return JSON.parse(responseText);
        } catch (e) {
            console.error('Error parsing JSON:', e);
            return null;
        }
    }

    function validateApiResponse(jsonData) {
        state.error = false;
        if (!jsonData) {
            return 'Not a valid JSON';
        }
        if (!jsonData.category_count || !jsonData.examples) {
            return 'Missing required data fields';
        }

        const categoryCount = jsonData.category_count;
        if (!categoryCount || Object.keys(categoryCount).length === 0) {
            return 'Missing or empty category count';
        }

        // Check if all category counts are zero
        const allZero = Object.values(categoryCount).every(count => count === 0);
        if (allZero) {
            return 'Blank API';
        }

        const examples = jsonData.examples;
        if (!Array.isArray(examples) || examples.length === 0) {
            return 'Missing or empty examples array';
        }

        return null; // No error
    }

    //FAVORITE DATA FUNCTIONS=====================================================================================================================
    function getStoredData(key) {
        // Retrieve the stored value from localStorage using the provided key
        const storedValue = getItem(key);

        // If a stored value exists, split it into index and exactState
        if (storedValue) {
            const [index, exactState] = storedValue.split(',');
            return {
                index: parseInt(index, 10), // Convert index to an integer
                exactState: exactState === '1' // Convert exactState to a boolean
            };
        }

        // Return default values if no stored value exists
        return { index: 0, exactState: state.exactSearch };
    }

    function storeData(key, index, exactState) {
        // Create a string value from index and exactState to store in localStorage
        const value = `${index},${exactState ? 1 : 0}`;

        // Store the value in localStorage using the provided key
        setItem(key, value);
    }


    // PARSE VOCAB FUNCTIONS =====================================================================================================================
    function parseVocabFromAnswer() {
        // Select all links containing "/kanji/" or "/vocabulary/" in the href attribute
        const elements = document.querySelectorAll('a[href*="/kanji/"], a[href*="/vocabulary/"]');
        console.log("Parsing Answer Page");

        // Iterate through the matched elements
        for (const element of elements) {
            const href = element.getAttribute('href');
            const text = element.textContent.trim();

            // Match the href to extract kanji or vocabulary (ignoring ID if present)
            const match = href.match(/\/(kanji|vocabulary)\/(?:\d+\/)?([^\#]*)#/);
            if (match) return match[2].trim();
            if (text) return text.trim();
        }
        return '';
    }

    function parseVocabFromReview() {
        console.log("Parsing Review Page");

        // Select the element with class 'kind' to determine the type of content
        const kindElement = document.querySelector('.kind');

        // If kindElement doesn't exist, set kindText to null
        const kindText = kindElement ? kindElement.textContent.trim() : null;

        // Accept 'Kanji' or 'Vocabulary' kindText
        if (kindText !== 'Kanji' && kindText !== 'Vocabulary') {
            console.log("Not Kanji or existing Vocabulary. Attempting to parse New Vocab.");

            // Attempt to parse from <a> tag with specific pattern
            const anchorElement = document.querySelector('a.plain[href*="/vocabulary/"]');

            if (anchorElement) {
                const href = anchorElement.getAttribute('href');

                const match = href.match(/\/vocabulary\/\d+\/([^#]+)#a/);

                if (match && match[1]) {
                    const new_vocab = match[1];
                    console.log("Found New Vocab:", new_vocab);
                    return new_vocab;
                }
            }

            console.log("No Vocabulary found.");
            return '';
        }

        if (kindText === 'Vocabulary') {
            // Select the element with class 'plain' to extract vocabulary
            const plainElement = document.querySelector('.plain');
            if (!plainElement) {
                return '';
            }

            let vocabulary = plainElement.textContent.trim();

            const nestedVocabularyElement = plainElement.querySelector('div:not([style])');

            if (nestedVocabularyElement) {
                vocabulary = nestedVocabularyElement.textContent.trim();
            }

            const specificVocabularyElement = plainElement.querySelector('div:nth-child(3)');

            if (specificVocabularyElement) {
                vocabulary = specificVocabularyElement.textContent.trim();
            }

            // Regular expression to check if the vocabulary contains kanji characters
            const kanjiRegex = /[\u4e00-\u9faf\u3400-\u4dbf]/;
            if (kanjiRegex.test(vocabulary) || vocabulary) {
                console.log("Found Vocabulary:", vocabulary);
                return vocabulary;
            }
        } else if (kindText === 'Kanji') {
            // Select the hidden input element to extract kanji
            const hiddenInput = document.querySelector('input[name="c"]');
            if (!hiddenInput) {
                return '';
            }

            const vocab = hiddenInput.value.split(',')[1];
            const kanjiRegex = /[\u4e00-\u9faf\u3400-\u4dbf]/;
            if (kanjiRegex.test(vocab)) {
                console.log("Found Kanji:", vocab);
                return vocab;
            }
        }

        console.log("No Vocabulary or Kanji found.");
        return '';
    }

    function parseVocabFromVocabulary() {
        // Get the current URL
        let url = window.location.href;

        // Remove query parameters (e.g., ?lang=english) and fragment identifiers (#)
        url = url.split('?')[0].split('#')[0];

        // Match the URL structure for a vocabulary page
        const match = url.match(/https:\/\/jpdb\.io\/vocabulary\/(\d+)\/([^\#\/]*)/);
        console.log("Parsing Vocabulary Page");

        if (match) {
            // Extract and decode the vocabulary part from the URL
            let vocab = match[2];
            state.embedAboveSubsectionMeanings = true; // Set state flag
            return decodeURIComponent(vocab);
        }

        // Return empty string if no match
        return '';
    }

    function parseVocabFromKanji() {
        // Get the current URL
        const url = window.location.href;

        // Match the URL structure for a kanji page
        const match = url.match(/https:\/\/jpdb\.io\/kanji\/(\d+)\/([^\#]*)#a/);
        console.log("Parsing Kanji Page");

        if (match) {
            // Extract and decode the kanji part from the URL
            let kanji = match[2];
            state.embedAboveSubsectionMeanings = true; // Set state flag
            kanji = kanji.split('/')[0];
            return decodeURIComponent(kanji);
        }

        // Return empty string if no match
        return '';
    }

    function parseVocabFromSearch() {
        // Get the current URL
        let url = window.location.href;

        // Match the URL structure for a search query, capturing the vocab between `?q=` and either `&` or `+`
        const match = url.match(/https:\/\/jpdb\.io\/search\?q=([^&+]*)/);
        console.log("Parsing Search Page");

        if (match) {
            // Extract and decode the vocabulary part from the URL
            let vocab = match[1];
            return decodeURIComponent(vocab);
        }

        // Return empty string if no match
        return '';
    }


    //EMBED FUNCTIONS=====================================================================================================================
    function createAnchor(marginLeft) {
        // Create and style an anchor element
        const anchor = document.createElement('a');
        anchor.href = '#';
        anchor.style.border = '0';
        anchor.style.display = 'inline-flex';
        anchor.style.verticalAlign = 'middle';
        anchor.style.marginLeft = marginLeft;
        return anchor;
    }

    function createIcon(iconClass, fontSize = '1.4rem', color = '#3d81ff') {
        // Create and style an icon element
        const icon = document.createElement('i');
        icon.className = iconClass;
        icon.style.fontSize = fontSize;
        icon.style.opacity = '1.0';
        icon.style.verticalAlign = 'baseline';
        icon.style.color = color;
        return icon;
    }

    function createSpeakerButton(soundUrl) {
        // Create a speaker button with an icon and click event for audio playback
        const anchor = createAnchor('0.5rem');
        const icon = createIcon('ti ti-volume');
        anchor.appendChild(icon);
        anchor.addEventListener('click', (event) => {
            event.preventDefault();
            playAudio(soundUrl);
        });
        return anchor;
    }

    function createStarButton() {
        // Create a star button with an icon and click event for toggling favorite state
        const anchor = createAnchor('0.5rem');
        const starIcon = document.createElement('span');
        const storedValue = getItem(state.vocab);
        // console.log(storedValue);

        // Determine the star icon (filled or empty) based on stored value
        if (storedValue) {
            const [storedIndex, storedExactState] = storedValue.split(',');
            const index = parseInt(storedIndex, 10);
            const exactState = Boolean(parseInt(storedExactState, 10));
            starIcon.textContent = (state.currentExampleIndex === index && state.exactSearch === exactState) ? '★' : '☆';
        } else {
            starIcon.textContent = '☆';
        }


        // Style the star icon
        starIcon.style.fontSize = '1.4rem';
        starIcon.style.color = '#3D8DFF';
        starIcon.style.verticalAlign = 'middle';
        starIcon.style.position = 'relative';
        starIcon.style.top = '-2px';

        // Append the star icon to the anchor and set up the click event to toggle star state
        anchor.appendChild(starIcon);
        anchor.addEventListener('click', (event) => {
            event.preventDefault();
            toggleStarState(starIcon);
        });

        return anchor;
    }

    function toggleStarState(starIcon) {
        const storedValue = getItem(state.vocab);
        const isBlacklisted = storedValue && storedValue.split(',').length > 1 && parseInt(storedValue.split(',')[1], 10) === 2;

        // Return early if blacklisted
        if (isBlacklisted) {
            starIcon.textContent = '☆';
            return;
        }

        // Toggle the star state between filled and empty
        if (storedValue) {
            const [storedIndex, storedExactState] = storedValue.split(',');
            const index = parseInt(storedIndex, 10);
            const exactState = storedExactState === '1';
            if (index === state.currentExampleIndex && exactState === state.exactSearch) {
                removeItem(state.vocab);
                starIcon.textContent = '☆';
            } else {
                setItem(state.vocab, `${state.currentExampleIndex},${state.exactSearch ? 1 : 0}`);
                starIcon.textContent = '★';
            }
        } else {
            setItem(state.vocab, `${state.currentExampleIndex},${state.exactSearch ? 1 : 0}`);
            starIcon.textContent = '★';
        }
    }

    function createQuoteButton() {
        // Create a quote button with an icon and click event for toggling quote style
        const anchor = createAnchor('0rem');
        const quoteIcon = document.createElement('span');

        // Set the icon based on exact search state
        quoteIcon.innerHTML = state.exactSearch ? '<b>「」</b>' : '『』';

        // Style the quote icon
        quoteIcon.style.fontSize = '1.1rem';
        quoteIcon.style.color = '#3D8DFF';
        quoteIcon.style.verticalAlign = 'middle';
        quoteIcon.style.position = 'relative';
        quoteIcon.style.top = '0px';

        // Append the quote icon to the anchor and set up the click event to toggle quote state
        anchor.appendChild(quoteIcon);
        anchor.addEventListener('click', (event) => {
            event.preventDefault();
            toggleQuoteState(quoteIcon);
        });

        return anchor;
    }

    function toggleQuoteState(quoteIcon) {
        const storedValue = getItem(state.vocab);
        const isBlacklisted = storedValue && storedValue.split(',').length > 1 && parseInt(storedValue.split(',')[1], 10) === 2;

        // Return early if blacklisted
        if (isBlacklisted) {
            return;
        }

        // Toggle between single and double quote styles
        state.exactSearch = !state.exactSearch;
        quoteIcon.innerHTML = state.exactSearch ? '<b>「」</b>' : '『』';

        // Update state based on stored data
        const storedData = getStoredData(state.vocab);
        if (storedData && storedData.exactState === state.exactSearch) {
            state.currentExampleIndex = storedData.index;
        } else {
            state.currentExampleIndex = 0;
        }

        state.apiDataFetched = false;
        embedImageAndPlayAudio();
        getImmersionKitData(state.vocab, state.exactSearch)
            .then(() => {
            embedImageAndPlayAudio();
        })
            .catch(error => {
            console.error(error);
        });
    }

    function createMenuButton() {
        // Create a menu button with a dropdown menu
        const anchor = createAnchor('0.5rem');
        const menuIcon = document.createElement('span');
        menuIcon.innerHTML = '☰';

        // Style the menu icon
        menuIcon.style.fontSize = '1.4rem';
        menuIcon.style.color = '#3D8DFF';
        menuIcon.style.verticalAlign = 'middle';
        menuIcon.style.position = 'relative';
        menuIcon.style.top = '-2px';

        // Append the menu icon to the anchor and set up the click event to show the overlay menu
        anchor.appendChild(menuIcon);
        anchor.addEventListener('click', async (event) => {
            event.preventDefault();
            if (isIOS() && await openExtensionOptionsPage()) {
                return;
            }
            await ensureCustomAudioSettingsLoaded();
            const overlay = createOverlayMenu();
            document.body.appendChild(overlay);
        });

        return anchor;
    }

    function createTextButton(vocab, exact) {
        const textButton = document.createElement('a');
        textButton.textContent = 'Immersion Kit';
        textButton.style.color = 'var(--subsection-label-color)';
        textButton.style.fontSize = '85%';
        textButton.style.marginRight = '0.5rem';
        textButton.style.verticalAlign = 'middle';

        const url = new URL('https://www.immersionkit.com/dictionary');
        url.searchParams.set('keyword', vocab);
        url.searchParams.set('sort', 'sentence_length:asc');
        if (exact) url.searchParams.set('exact', 'true');

        textButton.href = url.toString();
        textButton.target = '_blank';
        return textButton;
    }

    function createButtonContainer(soundUrl, vocab, exact) {
        // Create a container for all buttons
        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'button-container';
        buttonContainer.style.display = 'flex';
        buttonContainer.style.justifyContent = 'space-between';
        buttonContainer.style.alignItems = 'center';
        buttonContainer.style.marginBottom = '5px';
        buttonContainer.style.lineHeight = '1.4rem';

        // Create individual buttons
        const menuButton = createMenuButton();
        const textButton = createTextButton(vocab, exact);
        const speakerButton = createSpeakerButton(soundUrl);
        const starButton = createStarButton();
        const quoteButton = createQuoteButton();

        // Center the buttons within the container
        const centeredButtonsWrapper = document.createElement('div');
        centeredButtonsWrapper.style.display = 'flex';
        centeredButtonsWrapper.style.justifyContent = 'center';
        centeredButtonsWrapper.style.flex = '1';

        centeredButtonsWrapper.append(textButton, speakerButton, starButton, quoteButton);
        buttonContainer.append(centeredButtonsWrapper, menuButton);

        return buttonContainer;
    }

    // ——— Stop any playing audio ———
    function stopCurrentAudio() {
        if (state.currentSource) {
            try {
                state.currentSource.onended = null;
                state.currentSource.stop(0);
                state.currentSource.disconnect();
            } catch (e) { /* already stopped? ignore */ }
            state.currentSource = null;
        }
    }

    function playDecodedAudioBuffer(arrayBuffer, playId) {
        state.sharedAudioContext.decodeAudioData(
            arrayBuffer.slice(0),
            buffer => {
                if (playId !== state.lastPlayId) return;

                const src = state.sharedAudioContext.createBufferSource();
                src.buffer = buffer;
                const gain = state.sharedAudioContext.createGain();
                gain.gain.setValueAtTime(0, state.sharedAudioContext.currentTime);
                gain.gain.linearRampToValueAtTime(
                    (CONFIG.SOUND_VOLUME || 100) / 100,
                    state.sharedAudioContext.currentTime + 0.05
                );
                src.connect(gain).connect(state.sharedAudioContext.destination);

                src.start(0, 0.05);
                src.onended = () => {
                    if (state.currentSource === src) {
                        state.currentSource = null;
                    }
                };

                state.currentSource = src;
            },
            err => {
                console.error('decodeAudioData failed:', err);
            }
        );
    }

    // ——— Play a new clip ———
    function playAudio(soundUrl) {
        if (!soundUrl) return;

        // 1) bump play ID to cancel any in-flight requests/decodes
        const playId = ++state.lastPlayId;

        // 2) tear down old source instantly
        stopCurrentAudio();

        // 3) ensure context is resumed (autoplay policy)
        if (state.sharedAudioContext.state === 'suspended') {
            state.sharedAudioContext.resume().catch(() => {});
        }

        // 4) fetch via GM_xmlhttpRequest
        GM_xmlhttpRequest({
            method: 'GET',
            url: soundUrl,
            responseType: 'arraybuffer',
            onload(response) {
                // if a newer playAudio() ran, abort
                if (playId !== state.lastPlayId) return;
                playDecodedAudioBuffer(response.response, playId);
            },
            onerror(err) {
                console.error('GM_xmlhttpRequest failed:', err);
            }
        });
    }

    async function playCustomAudioBlob(blob) {
        if (!blob) return;

        const playId = ++state.lastPlayId;
        stopCurrentAudio();

        if (state.sharedAudioContext.state === 'suspended') {
            state.sharedAudioContext.resume().catch(() => {});
        }

        playDecodedAudioBuffer(await blobToArrayBuffer(blob), playId);
    }

    function primeSharedAudioContext() {
        if (state.sharedAudioContext.state === 'suspended') {
            state.sharedAudioContext.resume().catch(() => {});
        }
    }

    function isElementVisible(element) {
        return Boolean(element)
            && !element.hidden
            && element.getClientRects().length > 0
            && getComputedStyle(element).visibility !== 'hidden'
            && getComputedStyle(element).display !== 'none';
    }

    function isElementLaidOut(element) {
        return Boolean(element)
            && !element.hidden
            && element.getClientRects().length > 0
            && getComputedStyle(element).display !== 'none';
    }

    function getPrimaryAnswerBox() {
        const selectors = [
            '.review-hidden .answer-box',
            '.review-reveal .answer-box',
            '.answer-box'
        ];

        for (const selector of selectors) {
            const match = Array.from(document.querySelectorAll(selector)).find(isElementVisible);
            if (match) {
                return match;
            }
        }

        return null;
    }

    function getPrimarySentenceAudioTrigger() {
        const answerBox = getPrimaryAnswerBox();
        if (!answerBox) return null;

        return Array.from(answerBox.querySelectorAll('.card-sentence .example-audio'))
            .find(isElementVisible) || null;
    }

    function getPrimaryCustomAudioSentenceElement() {
        const answerBox = getPrimaryAnswerBox();
        if (!answerBox) return null;

        return Array.from(answerBox.querySelectorAll('.card-sentence .sentence'))
            .find(element => isElementVisible(element) && !element.querySelector('.example-audio')) || null;
    }

    function shouldIgnoreGlobalHotkey(event) {
        if (event.altKey || event.ctrlKey || event.metaKey) {
            return true;
        }

        const activeElement = document.activeElement;
        if (!activeElement) {
            return false;
        }

        const tagName = activeElement.tagName;
        if (activeElement.isContentEditable || tagName === 'TEXTAREA' || tagName === 'SELECT') {
            return true;
        }

        if (tagName !== 'INPUT') {
            return false;
        }

        const inputType = (activeElement.getAttribute('type') || 'text').toLowerCase();
        const nonTextInputTypes = new Set([
            'button',
            'submit',
            'checkbox',
            'radio',
            'range',
            'color',
            'file',
            'reset'
        ]);

        return !nonTextInputTypes.has(inputType);
    }

    // has to be declared (referenced in multiple functions but definition requires variables local to one function)
    let hotkeysListener;

    // Global hotkey 'i' to play the current example's audio
    document.addEventListener('keydown', (event) => {
        if (event.key !== 'i') return;
        const container = document.getElementById('immersion-kit-container');
        const speakerBtn = container && container.querySelector('.ti-volume');
        if (speakerBtn) {
            event.preventDefault();
            event.stopImmediatePropagation();
            event.stopPropagation();
            speakerBtn.closest('a').click();
        }
    });

    async function handleSentenceAudioHotkey(event) {
        if (event.__jpdbSentenceAudioHandled) return;
        if (shouldIgnoreGlobalHotkey(event)) return;

        event.__jpdbSentenceAudioHandled = true;
        event.preventDefault();
        event.stopImmediatePropagation();
        event.stopPropagation();
        primeSharedAudioContext();

        const sentenceAudioTrigger = getPrimarySentenceAudioTrigger();
        if (sentenceAudioTrigger) {
            sentenceAudioTrigger.click();
            return;
        }

        const sentenceElement = getPrimaryCustomAudioSentenceElement();
        if (sentenceElement) {
            await playCustomAudioForSentence(sentenceElement);
        }
    }

    // Global hotkey 'e' to play the current jpdb example sentence audio
    window.addEventListener('keydown', async (event) => {
        if (event.key !== 'e') return;
        await handleSentenceAudioHotkey(event);
    }, true);

    // Fallback listener matching the simpler 'i' style
    document.addEventListener('keydown', async (event) => {
        if (event.key !== 'e') return;
        await handleSentenceAudioHotkey(event);
    });

    // Global hotkey 'd' to reveal dictation masks
    window.addEventListener('keydown', (event) => {
        if (event.key.toLowerCase() !== 'd') return;
        handleDictationRevealHotkey(event);
    }, true);

    // Fallback listener matching the simpler 'i' style
    document.addEventListener('keydown', (event) => {
        if (event.key.toLowerCase() !== 'd') return;
        handleDictationRevealHotkey(event);
    });

    document.addEventListener('click', handleDictationRevealClick, true);

    // Global hotkey 's' to show answer
    document.addEventListener('keydown', (event) => {
        if (event.key !== 's') return;
        const tag = document.activeElement && document.activeElement.tagName;
        const submitBtn = document.getElementById('show-answer')
        if (submitBtn) submitBtn.click();
    });

    function renderImageAndPlayAudio(vocab, shouldAutoPlaySound) {
        injectReviewLayoutStyles();

        const example = state.examples[state.currentExampleIndex] || {};
        const imageUrl = example.image ? `https://us-southeast-1.linodeobjects.com/immersionkit/media/${example.media}/${example.title}/media/${example.image}` : null;
        const soundUrl = example.sound ? `https://us-southeast-1.linodeobjects.com/immersionkit/media/${example.media}/${example.title}/media/${example.sound}` : null;
        const sentence = example.sentence || null;
        const translation = example.translation || null;
        const title = example.title || null;
        const storedValue = getItem(state.vocab);
        const isBlacklisted = storedValue && storedValue.split(',').length > 1 && parseInt(storedValue.split(',')[1], 10) === 2;


        // Remove any existing container
        removeExistingContainer();
        if (!shouldRenderContainer()) return;

        // Create and append the main wrapper and text button container
        const wrapperDiv = createWrapperDiv();
        const textDiv = createButtonContainer(soundUrl, vocab, state.exactSearch);
        wrapperDiv.appendChild(textDiv);


        const createTextElement = (text) => {
            const textElement = document.createElement('div');
            textElement.className = 'jpdb-ik-example-text';
            textElement.textContent = text;
            textElement.style.padding = 'clamp(32px, 18vw, 100px) 0';
            textElement.style.whiteSpace = 'pre'; // Ensures newlines are respected
            return textElement;
        };

        if (isBlacklisted) {
            wrapperDiv.appendChild(createTextElement('BLACKLISTED'));
            shouldAutoPlaySound = false;
        } else if (state.apiDataFetched) {
            if (CONFIG.SHOW_EXAMPLE_IMAGES && imageUrl) {
                const imageElement = createImageElement(wrapperDiv, imageUrl, vocab, state.exactSearch);
                if (imageElement) {
                    imageElement.addEventListener('click', () => playAudio(soundUrl));
                }
            } else if (CONFIG.SHOW_EXAMPLE_IMAGES) {
                wrapperDiv.appendChild(createTextElement(`NO IMAGE\n(${title})`));
            }
            // Append sentence and translation or a placeholder text
            sentence ? appendSentenceAndTranslation(wrapperDiv, sentence, translation) : appendNoneText(wrapperDiv);
        } else if (state.error) {
            wrapperDiv.appendChild(createTextElement('ERROR\nNO EXAMPLES FOUND\n\nRARE WORD OR\nIMMERSIONKIT API IS TEMPORARILY DOWN'));
        } else {
            wrapperDiv.appendChild(createTextElement('LOADING'));
        }

        // Create navigation elements
        const navigationDiv = createNavigationDiv();
        const leftArrow = createLeftArrow(vocab, shouldAutoPlaySound);
        const rightArrow = createRightArrow(vocab, shouldAutoPlaySound);

        // Create and append the main container
        const containerDiv = createContainerDiv(leftArrow, wrapperDiv, rightArrow, navigationDiv);
        appendContainer(containerDiv);

        // Auto-play sound if configured
        if (CONFIG.AUTO_PLAY_SOUND && shouldAutoPlaySound) {
            playAudio(soundUrl);
        }

        scheduleDictationMasking();

        // Link hotkeys
        if (CONFIG.HOTKEYS.indexOf("None") === -1) {
            const leftHotkey = CONFIG.HOTKEYS[0];
            const rightHotkey = CONFIG.HOTKEYS[1];

            hotkeysListener = (event) => {
                if (event.repeat) return;
                switch (event.key.toLowerCase()) {
                    case leftHotkey.toLowerCase():
                        if (leftArrow.disabled) {
                            // listener gets removed, so need to re-add
                            window.addEventListener('keydown', hotkeysListener, {once: true});
                        } else {
                            leftArrow.click(); // don't need to re-add listener because renderImageAndPlayAudio() will run again
                        }
                        break;
                    case rightHotkey.toLowerCase():
                        if (rightArrow.disabled) {
                            // listener gets removed, so need to re-add
                            window.addEventListener('keydown', hotkeysListener, {once: true});
                        } else {
                            rightArrow.click(); // don't need to re-add listener because renderImageAndPlayAudio() will run again
                        }
                        break;
                    default:
                        // listener gets removed, so need to re-add
                        window.addEventListener('keydown', hotkeysListener, {once: true});
                }
            }

            window.addEventListener('keydown', hotkeysListener, {once: true});
        }
    }

    function removeExistingContainer() {
        // Remove the existing container if it exists
        const existingContainer = document.getElementById('immersion-kit-container');
        if (existingContainer) {
            existingContainer.remove();
        }
        window.removeEventListener('keydown', hotkeysListener);
    }

    function shouldRenderContainer() {
        // Determine if the container should be rendered based on the presence of certain elements
        const resultVocabularySection = document.querySelector('.result.vocabulary');
        const hboxWrapSection = document.querySelector('.hbox.wrap');
        const subsectionMeanings = document.querySelector('.subsection-meanings');
        const subsectionLabels = document.querySelectorAll('h6.subsection-label');
        return resultVocabularySection || hboxWrapSection || subsectionMeanings || subsectionLabels.length >= 3;
    }

    function createWrapperDiv() {
        // Create and style the wrapper div
        const wrapperDiv = document.createElement('div');
        wrapperDiv.id = 'image-wrapper';
        wrapperDiv.className = 'jpdb-ik-image-wrapper';
        wrapperDiv.style.textAlign = 'center';
        wrapperDiv.style.padding = '5px 0';
        wrapperDiv.style.width = '100%';
        wrapperDiv.style.maxWidth = CONFIG.IMAGE_WIDTH;
        wrapperDiv.style.boxSizing = 'border-box';
        return wrapperDiv;
    }

    // Detect iOS
    function isIOS() {
        return (/iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream)
            || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    }

    // Preload images
    function preloadImages() {
        if (!CONFIG.SHOW_EXAMPLE_IMAGES) return;

        // Preload images around the current example index
        const preloadDiv = GM_addElement(document.body, 'div', { style: 'display: none;' });
        const startIndex = Math.max(0, state.currentExampleIndex - CONFIG.NUMBER_OF_PRELOADS);
        const endIndex = Math.min(state.examples.length - 1, state.currentExampleIndex + CONFIG.NUMBER_OF_PRELOADS);

        for (let i = startIndex; i <= endIndex; i++) {
            if (!state.preloadedIndices.has(i) && state.examples[i].image) {
                const example = state.examples[i];
                const imageUrl = `https://us-southeast-1.linodeobjects.com/immersionkit/media/${example.media}/${example.title}/media/${example.image}`;
                if (isIOS()) {
                    GM_xmlhttpRequest({
                        method: 'GET',
                        url: imageUrl,
                        responseType: 'blob',
                        onload: function(response) {
                            if (response.status === 200 && response.response) {
                                example.blob = response.response;
                                state.preloadedIndices.add(i);
                            }
                        }
                    });
                } else {
                    GM_addElement(preloadDiv, 'img', { src: imageUrl });
                    state.preloadedIndices.add(i);
                }
            }
        }
    }

    // Create image element
    function createImageElement(wrapperDiv, imageUrl, vocab, exactSearch) {
        const searchVocab = exactSearch ? `「${vocab}」` : vocab;
        const example = state.examples[state.currentExampleIndex] || {};
        const title = example.title || '';
        let file_name = imageUrl.substring(imageUrl.lastIndexOf('/') + 1).replace(/^(Anime_|A_|Z)/, '');
        const titleText = `${searchVocab} #${state.currentExampleIndex + 1}\n${title}\n${file_name}`;

        if (isIOS()) {
            // --- Calculate width and 16:9 height from config ---
            const width = parseInt(CONFIG.IMAGE_WIDTH, 10);
            const height = Math.round(width * 9 / 16);

            // --- Outer container ---
            const imgContainer = document.createElement('div');
            imgContainer.className = 'jpdb-ik-image-frame';
            imgContainer.style = `width:100%;max-width:${CONFIG.IMAGE_WIDTH};margin:10px auto 0;position:relative;min-height:${height}px;aspect-ratio:16/9;`;

            // --- Hidden image until loaded ---
            const img = document.createElement('img');
            img.alt = 'Embedded Image';
            img.title = titleText;
            img.style = 'width:100%;max-width:100%;cursor:pointer;display:none;border-radius:4px;height:auto;';

            // --- Error fallback, also 16:9 ---
            const errorFallback = document.createElement('div');
            errorFallback.style = `display:none;width:100%;aspect-ratio:16/9;`;
            errorFallback.innerHTML =
                `<svg width="100%" height="100%" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">
                <rect width="${width}" height="${height}" fill="#f8d7da"/>
                <text x="50%" y="50%" text-anchor="middle" fill="#721c24" dy=".3em" font-size="18">Image failed to load</text>
            </svg>`;

            imgContainer.append(img, errorFallback);
            wrapperDiv.appendChild(imgContainer);

            // --- Use cached blob else load ---
            if (example.blob) {
                const objectURL = URL.createObjectURL(example.blob);
                img.src = objectURL;
                img.onload = () => {
                    errorFallback.style.display = 'none';
                    img.style.display = 'block';
                    URL.revokeObjectURL(objectURL);
                };
                img.onerror = () => {
                    img.style.display = 'none';
                    errorFallback.style.display = 'block';
                };
            } else {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: imageUrl,
                    responseType: 'blob',
                    onload: function(response) {
                        if (response.status === 200 && response.response) {
                            example.blob = response.response;
                            const objectURL = URL.createObjectURL(response.response);
                            img.src = objectURL;
                            img.onload = () => {
                                errorFallback.style.display = 'none';
                                img.style.display = 'block';
                                URL.revokeObjectURL(objectURL);
                            };
                            img.onerror = () => {
                                img.style.display = 'none';
                                errorFallback.style.display = 'block';
                            };
                        } else {
                            errorFallback.style.display = 'block';
                            console.error('Failed to load image:', imageUrl);
                        }
                    },
                    onerror: function() {
                        errorFallback.style.display = 'block';
                        console.error('GM_xmlhttpRequest error for', imageUrl);
                    }
                });
            }
            return img;
        } else {
            // Non-iOS: just add the image
            return GM_addElement(wrapperDiv, 'img', {
                src: imageUrl,
                alt: 'Embedded Image',
                title: titleText,
                style: `width: 100%; max-width: ${CONFIG.IMAGE_WIDTH}; height: auto; margin-top: 10px; cursor: pointer; border-radius: 4px;`
        });
        }
    }

    function escapeRegExp(value) {
        return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function createVocabHighlightSpan(text) {
        return `<span class="jpdb-ik-vocab-highlight" style="color: var(--outline-input-color);">${text}</span>`;
    }

    function highlightVocab(sentence, vocab) {
        // Highlight vocabulary in the sentence based on configuration
        if (!CONFIG.COLORED_SENTENCE_TEXT || !vocab) return sentence;

        if (state.exactSearch) {
            const regex = new RegExp(`(${escapeRegExp(vocab)})`, 'g');
            return sentence.replace(regex, match => createVocabHighlightSpan(match));
        } else {
            return vocab.split('').reduce((acc, char) => {
                const regex = new RegExp(escapeRegExp(char), 'g');
                return acc.replace(regex, match => createVocabHighlightSpan(match));
            }, sentence);
        }
    }

    function appendSentenceAndTranslation(wrapperDiv, sentence, translation) {
        // Append sentence and translation to the wrapper div
        const sentenceText = document.createElement('div');
        sentenceText.className = 'jpdb-ik-example-text';
        sentenceText.innerHTML = highlightVocab(sentence, state.vocab);
        sentenceText.style.marginTop = '10px';
        sentenceText.style.fontSize = CONFIG.SENTENCE_FONT_SIZE;
        sentenceText.style.color = 'lightgray';
        sentenceText.style.width = '100%';
        sentenceText.style.maxWidth = '100%';
        sentenceText.style.whiteSpace = 'pre-wrap';
        sentenceText.style.overflowWrap = 'anywhere';
        sentenceText.style.boxSizing = 'border-box';
        wrapperDiv.appendChild(sentenceText);

        if (CONFIG.ENABLE_EXAMPLE_TRANSLATION && translation) {
            const translationText = document.createElement('div');
            translationText.className = 'jpdb-ik-example-text';
            translationText.innerHTML = replaceSpecialCharacters(translation);
            translationText.style.marginTop = '5px';
            translationText.style.fontSize = CONFIG.TRANSLATION_FONT_SIZE;
            translationText.style.color = 'var(--subsection-label-color)';
            translationText.style.width = '100%';
            translationText.style.maxWidth = '100%';
            translationText.style.whiteSpace = 'pre-wrap';
            translationText.style.overflowWrap = 'anywhere';
            translationText.style.boxSizing = 'border-box';
            wrapperDiv.appendChild(translationText);
        }
    }

    function appendNoneText(wrapperDiv) {
        // Append a "None" text to the wrapper div
        const noneText = document.createElement('div');
        noneText.textContent = 'None';
        noneText.style.marginTop = '10px';
        noneText.style.fontSize = '85%';
        noneText.style.color = 'var(--subsection-label-color)';
        wrapperDiv.appendChild(noneText);
    }

    function createNavigationDiv() {
        // Create and style the navigation div
        const navigationDiv = document.createElement('div');
        navigationDiv.id = 'immersion-kit-embed';
        navigationDiv.className = 'jpdb-ik-navigation';
        navigationDiv.style.display = 'flex';
        navigationDiv.style.justifyContent = 'center';
        navigationDiv.style.alignItems = 'center';
        navigationDiv.style.maxWidth = CONFIG.IMAGE_WIDTH;
        navigationDiv.style.margin = '0 auto';
        return navigationDiv;
    }

    function createLeftArrow(vocab, shouldAutoPlaySound) {
        // Create and configure the left arrow button
        const leftArrow = document.createElement('button');
        leftArrow.className = 'jpdb-ik-arrow jpdb-ik-arrow--previous';
        leftArrow.textContent = '<';
        leftArrow.style.marginRight = '10px';
        leftArrow.style.width = CONFIG.ARROW_WIDTH;
        leftArrow.style.height = CONFIG.ARROW_HEIGHT;
        leftArrow.style.lineHeight = '25px';
        leftArrow.style.textAlign = 'center';
        leftArrow.style.display = 'flex';
        leftArrow.style.justifyContent = 'center';
        leftArrow.style.alignItems = 'center';
        leftArrow.style.padding = '0'; // Remove padding
        leftArrow.disabled = state.currentExampleIndex === 0;
        leftArrow.addEventListener('click', () => {
            if (state.currentExampleIndex > 0) {
                state.currentExampleIndex--;
                state.currentlyPlayingAudio = false;
                stopCurrentAudio();
                renderImageAndPlayAudio(vocab, shouldAutoPlaySound);
                preloadImages();
            }
        });
        return leftArrow;
    }

    function createRightArrow(vocab, shouldAutoPlaySound) {
        // Create and configure the right arrow button
        const rightArrow = document.createElement('button');
        rightArrow.className = 'jpdb-ik-arrow jpdb-ik-arrow--next';
        rightArrow.textContent = '>';
        rightArrow.style.marginLeft = '10px';
        rightArrow.style.width = CONFIG.ARROW_WIDTH;
        rightArrow.style.height = CONFIG.ARROW_HEIGHT;
        rightArrow.style.lineHeight = '25px';
        rightArrow.style.textAlign = 'center';
        rightArrow.style.display = 'flex';
        rightArrow.style.justifyContent = 'center';
        rightArrow.style.alignItems = 'center';
        rightArrow.style.padding = '0'; // Remove padding
        rightArrow.disabled = state.currentExampleIndex >= state.examples.length - 1;
        rightArrow.addEventListener('click', () => {
            if (state.currentExampleIndex < state.examples.length - 1) {
                state.currentExampleIndex++;
                state.currentlyPlayingAudio = false;
                stopCurrentAudio();
                renderImageAndPlayAudio(vocab, shouldAutoPlaySound);
                preloadImages();
            }
        });
        return rightArrow;
    }

    function createContainerDiv(leftArrow, wrapperDiv, rightArrow, navigationDiv) {
        // Create and configure the main container div
        const containerDiv = document.createElement('div');
        containerDiv.id = 'immersion-kit-container';
        containerDiv.className = 'jpdb-ik-container';
        containerDiv.style.setProperty('--jpdb-ik-image-width', CONFIG.IMAGE_WIDTH);
        containerDiv.style.display = 'flex';
        containerDiv.style.alignItems = 'center';
        containerDiv.style.justifyContent = 'center';
        containerDiv.style.flexDirection = 'column';
        containerDiv.style.width = '100%';
        containerDiv.style.maxWidth = '100%';

        const arrowWrapperDiv = document.createElement('div');
        arrowWrapperDiv.className = 'jpdb-ik-arrow-wrapper';
        arrowWrapperDiv.style.display = 'flex';
        arrowWrapperDiv.style.alignItems = 'center';
        arrowWrapperDiv.style.justifyContent = 'center';
        arrowWrapperDiv.style.maxWidth = '100%';

        arrowWrapperDiv.append(leftArrow, wrapperDiv, rightArrow);
        containerDiv.append(arrowWrapperDiv, navigationDiv);

        return containerDiv;
    }

    function shouldUseStackedReviewLayout() {
        return window.matchMedia('(max-width: 640px), (hover: none) and (pointer: coarse)').matches;
    }

    function appendContainer(containerDiv) {
        // Append the container div to the appropriate section based on configuration
        const resultVocabularySection = document.querySelector('.result.vocabulary');
        const hboxWrapSection = document.querySelector('.hbox.wrap');
        const subsectionMeanings = document.querySelector('.subsection-meanings');
        const subsectionComposedOfKanji = document.querySelector('.subsection-composed-of-kanji');
        const subsectionPitchAccent = document.querySelector('.subsection-pitch-accent');
        const subsectionLabels = document.querySelectorAll('h6.subsection-label');
        const vboxGap = document.querySelector('.vbox.gap');
        const styleSheet = document.querySelector('link[rel="stylesheet"]').sheet;

        if (CONFIG.WIDE_MODE && subsectionMeanings && !shouldUseStackedReviewLayout()) {
            const wrapper = document.createElement('div');
            wrapper.className = 'jpdb-ik-wide-wrapper';
            wrapper.style.display = 'flex';
            wrapper.style.alignItems = 'flex-start';
            styleSheet.insertRule('.subsection-meanings { max-width: none !important; }', styleSheet.cssRules.length);

            const originalContentWrapper = document.createElement('div');
            originalContentWrapper.className = 'jpdb-ik-original-content';
            originalContentWrapper.style.flex = '1';
            originalContentWrapper.style.minWidth = '0';
            originalContentWrapper.appendChild(subsectionMeanings);

            if (subsectionComposedOfKanji) {
                const newline1 = document.createElement('br');
                originalContentWrapper.appendChild(newline1);
                originalContentWrapper.appendChild(subsectionComposedOfKanji);
            }
            if (subsectionPitchAccent) {
                const newline2 = document.createElement('br');
                originalContentWrapper.appendChild(newline2);
                originalContentWrapper.appendChild(subsectionPitchAccent);
            }

            if (CONFIG.DEFINITIONS_ON_RIGHT_IN_WIDE_MODE) {
                wrapper.appendChild(containerDiv);
                wrapper.appendChild(originalContentWrapper);
            } else {
                wrapper.appendChild(originalContentWrapper);
                wrapper.appendChild(containerDiv);
            }

            if (vboxGap) {
                const existingDynamicDiv = vboxGap.querySelector('#dynamic-content');
                if (existingDynamicDiv) {
                    existingDynamicDiv.remove();
                }

                const dynamicDiv = document.createElement('div');
                dynamicDiv.id = 'dynamic-content';
                dynamicDiv.appendChild(wrapper);

                if (window.location.href.includes('vocabulary')) {
                    vboxGap.insertBefore(dynamicDiv, vboxGap.children[1]);
                } else {
                    vboxGap.insertBefore(dynamicDiv, vboxGap.firstChild);
                }
            }
        } else {
            if (state.embedAboveSubsectionMeanings && subsectionMeanings) {
                subsectionMeanings.parentNode.insertBefore(containerDiv, subsectionMeanings);
            } else if (resultVocabularySection) {
                resultVocabularySection.parentNode.insertBefore(containerDiv, resultVocabularySection);
            } else if (hboxWrapSection) {
                hboxWrapSection.parentNode.insertBefore(containerDiv, hboxWrapSection);
            } else if (subsectionLabels.length >= 4) {
                subsectionLabels[3].parentNode.insertBefore(containerDiv, subsectionLabels[3]);
            }
        }
    }

    function embedImageAndPlayAudio() {
        // Embed the image and play audio, removing existing navigation div if present
        const existingNavigationDiv = document.getElementById('immersion-kit-embed');
        if (existingNavigationDiv) existingNavigationDiv.remove();

        renderImageAndPlayAudio(state.vocab, CONFIG.AUTO_PLAY_SOUND);
        preloadImages();
    }

    function replaceSpecialCharacters(text) {
        // Replace special characters in the text
        return text.replace(/<br>/g, '\n').replace(/&quot;/g, '"').replace(/\n/g, '<br>');
    }

    function scheduleCustomAudioEnhancement() {
        clearTimeout(customAudioEnhanceTimer);
        customAudioEnhanceTimer = setTimeout(() => {
            enhanceCustomAudioControls().catch(error => {
                console.error('Failed to enhance custom audio controls:', error);
            });
        }, 150);
    }

    function injectReviewLayoutStyles() {
        if (reviewLayoutStyleElement) return;

        reviewLayoutStyleElement = document.createElement('style');
        reviewLayoutStyleElement.id = 'jpdb-ik-review-layout-style';
        reviewLayoutStyleElement.textContent = `
            #immersion-kit-container,
            #immersion-kit-container *,
            .jpdb-ik-wide-wrapper,
            .jpdb-ik-wide-wrapper * {
                box-sizing: border-box;
            }

            #immersion-kit-container .button-container {
                width: 100%;
                max-width: 100%;
            }

            #immersion-kit-container .button-container a {
                min-height: 32px;
                align-items: center;
            }

            #immersion-kit-container #image-wrapper,
            #immersion-kit-container .jpdb-ik-image-frame,
            #immersion-kit-container img[alt="Embedded Image"] {
                max-width: 100%;
            }

            #dynamic-content,
            .jpdb-ik-wide-wrapper,
            .jpdb-ik-original-content {
                min-width: 0;
                max-width: 100%;
            }

            @media (max-width: 640px), (hover: none) and (pointer: coarse) {
                #dynamic-content {
                    width: 100% !important;
                    max-width: 100% !important;
                    margin-left: 0 !important;
                    margin-right: 0 !important;
                }

                .jpdb-ik-wide-wrapper {
                    flex-direction: column !important;
                    align-items: stretch !important;
                    gap: 0.75rem;
                    width: 100% !important;
                    max-width: 100% !important;
                }

                .jpdb-ik-original-content {
                    order: 2;
                    width: 100% !important;
                    max-width: 100% !important;
                }

                #dynamic-content .subsection-meanings,
                #dynamic-content .subsection-composed-of-kanji,
                #dynamic-content .subsection-pitch-accent {
                    width: 100% !important;
                    max-width: 100% !important;
                }

                #immersion-kit-container {
                    order: 1;
                    width: 100% !important;
                    max-width: 100% !important;
                    margin: 0 auto 0.75rem;
                    padding-left: max(0.25rem, env(safe-area-inset-left));
                    padding-right: max(0.25rem, env(safe-area-inset-right));
                }

                #immersion-kit-container .jpdb-ik-arrow-wrapper {
                    display: grid !important;
                    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
                    grid-template-areas:
                        "content content"
                        "previous next";
                    gap: 8px;
                    width: 100% !important;
                    max-width: min(100%, var(--jpdb-ik-image-width, 400px));
                    margin: 0 auto;
                }

                #immersion-kit-container #image-wrapper {
                    grid-area: content;
                    width: 100% !important;
                    max-width: 100% !important;
                    min-width: 0;
                    padding: 4px 0 !important;
                }

                #immersion-kit-container .jpdb-ik-arrow {
                    width: 100% !important;
                    min-width: 0;
                    min-height: 44px;
                    height: 44px !important;
                    margin: 0 !important;
                    touch-action: manipulation;
                }

                #immersion-kit-container .jpdb-ik-arrow--previous {
                    grid-area: previous;
                }

                #immersion-kit-container .jpdb-ik-arrow--next {
                    grid-area: next;
                }

                #immersion-kit-container .button-container {
                    gap: 6px;
                    justify-content: center !important;
                    margin-bottom: 4px !important;
                }

                #immersion-kit-container .button-container > div {
                    flex: 1 1 auto !important;
                    min-width: 0;
                    flex-wrap: wrap;
                    row-gap: 2px;
                }

                #immersion-kit-container .button-container > a {
                    flex: 0 0 auto;
                }

                #immersion-kit-container img[alt="Embedded Image"],
                #immersion-kit-container .jpdb-ik-image-frame,
                #immersion-kit-container .jpdb-ik-example-text {
                    width: 100% !important;
                    max-width: 100% !important;
                }

                #immersion-kit-container .jpdb-ik-example-text {
                    padding-left: 2px;
                    padding-right: 2px;
                    overflow-wrap: anywhere;
                    word-break: normal;
                }
            }
        `;
        document.head.appendChild(reviewLayoutStyleElement);
    }

    function injectDictationStyles() {
        if (dictationStyleElement) return;

        dictationStyleElement = document.createElement('style');
        dictationStyleElement.id = 'jpdb-dictation-mask-style';
        dictationStyleElement.textContent = `
            .jpdb-dictation-mask {
                color: transparent !important;
                -webkit-text-fill-color: transparent !important;
                text-shadow: none !important;
                cursor: pointer;
            }

            .jpdb-dictation-mask * {
                color: transparent !important;
                -webkit-text-fill-color: transparent !important;
                text-shadow: none !important;
            }

            .jpdb-dictation-particle-layer {
                position: absolute;
                left: var(--jpdb-dictation-layer-left);
                top: var(--jpdb-dictation-layer-top);
                width: var(--jpdb-dictation-layer-width);
                height: var(--jpdb-dictation-layer-height);
                pointer-events: none;
                z-index: 2147483000;
                overflow: hidden;
                opacity: 1;
                transition: opacity 140ms ease, transform 140ms ease;
            }

            .jpdb-dictation-particle {
                position: absolute;
                left: var(--jpdb-particle-x);
                top: var(--jpdb-particle-y);
                width: var(--jpdb-particle-size);
                height: var(--jpdb-particle-size);
                border-radius: 999px;
                background: rgba(var(--jpdb-dictation-particle-rgb, 18, 20, 24), var(--jpdb-particle-opacity));
                filter: blur(var(--jpdb-particle-blur));
                transform: translate3d(0, 0, 0) scale(var(--jpdb-particle-scale-a));
                animation: jpdbDictationParticleDrift var(--jpdb-particle-duration) ease-in-out infinite;
                animation-delay: var(--jpdb-particle-delay);
                will-change: transform, opacity;
            }

            .jpdb-dictation-mask rt {
                color: var(--jpdb-dictation-ruby-mask-color, white) !important;
                -webkit-text-fill-color: var(--jpdb-dictation-ruby-mask-color, white) !important;
                text-shadow: none !important;
            }

            html.jpdb-dictation-revealing .jpdb-dictation-mask {
                color: var(--jpdb-dictation-reveal-color, currentColor) !important;
                -webkit-text-fill-color: var(--jpdb-dictation-reveal-color, currentColor) !important;
            }

            html.jpdb-dictation-revealing .jpdb-dictation-mask * {
                color: var(--jpdb-dictation-reveal-color, currentColor) !important;
                -webkit-text-fill-color: var(--jpdb-dictation-reveal-color, currentColor) !important;
            }

            html.jpdb-dictation-revealing .jpdb-dictation-mask rt {
                color: var(--jpdb-dictation-reveal-color, currentColor) !important;
                -webkit-text-fill-color: var(--jpdb-dictation-reveal-color, currentColor) !important;
            }

            html.jpdb-dictation-revealing .jpdb-dictation-particle-layer {
                opacity: 0;
                transform: scale(0.96);
            }

            @keyframes jpdbDictationParticleDrift {
                0% {
                    opacity: var(--jpdb-particle-opacity-a);
                    transform: translate3d(0, 0, 0) scale(var(--jpdb-particle-scale-a));
                }
                27% {
                    opacity: var(--jpdb-particle-opacity-b);
                    transform: translate3d(var(--jpdb-particle-dx1), var(--jpdb-particle-dy1), 0) scale(var(--jpdb-particle-scale-b));
                }
                54% {
                    opacity: var(--jpdb-particle-opacity-c);
                    transform: translate3d(var(--jpdb-particle-dx2), var(--jpdb-particle-dy2), 0) scale(var(--jpdb-particle-scale-c));
                }
                78% {
                    opacity: var(--jpdb-particle-opacity-d);
                    transform: translate3d(var(--jpdb-particle-dx3), var(--jpdb-particle-dy3), 0) scale(var(--jpdb-particle-scale-b));
                }
                100% {
                    opacity: var(--jpdb-particle-opacity-e);
                    transform: translate3d(var(--jpdb-particle-dx4), var(--jpdb-particle-dy4), 0) scale(var(--jpdb-particle-scale-a));
                }
            }

            @media (prefers-reduced-motion: reduce) {
                .jpdb-dictation-particle {
                    animation: none;
                }
            }
        `;
        document.head.appendChild(dictationStyleElement);
    }

    function normalizeDictationText(text) {
        return String(text || '').replace(/\s+/g, '').trim();
    }

    function getAnswerBoxPlainElement(answerBox) {
        if (!answerBox) return null;
        return Array.from(answerBox.children)
            .find(element => element.classList && element.classList.contains('plain')) || null;
    }

    function getAnswerBoxVocabularyElement(answerBox) {
        const plainElement = getAnswerBoxPlainElement(answerBox);
        if (!plainElement) return null;

        return Array.from(plainElement.children).find(element => {
            if (!isElementLaidOut(element)) return false;
            if (element.querySelector('.vocabulary-audio, .jpdb-custom-audio-controls')) return false;

            const text = getVisibleTextWithoutRuby(element);
            return text && text.length <= 80;
        }) || null;
    }

    function getDictationWordFromPage() {
        const answerVocabElement = getAnswerBoxVocabularyElement(getPrimaryAnswerBox());
        if (answerVocabElement) {
            return getVisibleTextWithoutRuby(answerVocabElement);
        }

        return resolveCurrentHeadword();
    }

    function getDictationCardSignature(word) {
        const answerBox = getPrimaryAnswerBox();
        const sentenceElement = answerBox && answerBox.querySelector('.card-sentence .sentence');
        const sentenceText = sentenceElement ? stripSentenceNodeText(sentenceElement) : '';
        const answerHref = answerBox && answerBox.querySelector('a.plain[href*="/vocabulary/"], a.plain[href*="/kanji/"]');
        const hrefPart = answerHref ? answerHref.getAttribute('href') || '' : '';
        return [
            window.location.pathname,
            window.location.search,
            normalizeDictationText(word),
            normalizeDictationText(sentenceText),
            hrefPart
        ].join('|');
    }

    function isDictationReviewPage() {
        return Array.from(document.querySelectorAll('.review-hidden .answer-box, .review-reveal .answer-box'))
            .some(isElementVisible);
    }

    function isDictationReviewPath() {
        return window.location.pathname.startsWith('/review');
    }

    function isExactDictationWord(element, word) {
        return normalizeDictationText(getVisibleTextWithoutRuby(element)) === normalizeDictationText(word);
    }

    function randomBetween(min, max) {
        return min + Math.random() * (max - min);
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function parseCssRgbColor(value) {
        const match = String(value || '').match(/rgba?\(([^)]+)\)/i);
        if (!match) return null;

        const parts = match[1].split(',').map(part => part.trim());
        if (parts.length < 3) return null;

        const color = {
            r: parseFloat(parts[0]),
            g: parseFloat(parts[1]),
            b: parseFloat(parts[2]),
            a: parts.length >= 4 ? parseFloat(parts[3]) : 1
        };

        return Number.isFinite(color.r)
            && Number.isFinite(color.g)
            && Number.isFinite(color.b)
            && Number.isFinite(color.a)
            ? color
            : null;
    }

    function getRelativeLuminance({ r, g, b }) {
        const toLinear = value => {
            const normalized = value / 255;
            return normalized <= 0.03928
                ? normalized / 12.92
                : Math.pow((normalized + 0.055) / 1.055, 2.4);
        };

        return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
    }

    function getNearestOpaqueBackgroundColor(element) {
        for (
            let current = element;
            current && current.nodeType === Node.ELEMENT_NODE;
            current = current.parentElement
        ) {
            const color = parseCssRgbColor(getComputedStyle(current).backgroundColor);
            if (color && color.a > 0.05) {
                return color;
            }
        }

        return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
            ? { r: 18, g: 20, b: 24, a: 1 }
            : { r: 255, g: 255, b: 255, a: 1 };
    }

    function getDictationMaskPalette(element) {
        const backgroundColor = getNearestOpaqueBackgroundColor(element);
        const isDarkBackground = getRelativeLuminance(backgroundColor) < 0.38;

        return isDarkBackground
            ? {
                particleRgb: '238, 241, 245',
                rubyMaskColor: 'rgba(255, 255, 255, 0.72)'
            }
            : {
                particleRgb: '18, 20, 24',
                rubyMaskColor: 'rgba(255, 255, 255, 0.96)'
            };
    }

    function getDictationParticleCount(rect) {
        const area = rect.width * rect.height;
        return clamp(Math.round(area / 70), 18, 84);
    }

    function setParticleStyle(particle, property, value) {
        particle.style.setProperty(property, value);
    }

    function createDictationParticle() {
        const particle = document.createElement('span');
        const size = Math.random() > 0.82
            ? randomBetween(2.4, 4.2)
            : randomBetween(0.9, 2.4);
        const opacity = Math.random() > 0.76
            ? randomBetween(0.54, 0.88)
            : randomBetween(0.22, 0.58);
        const duration = randomBetween(1150, 2450);

        particle.className = 'jpdb-dictation-particle';
        setParticleStyle(particle, '--jpdb-particle-x', `${randomBetween(0, 100).toFixed(2)}%`);
        setParticleStyle(particle, '--jpdb-particle-y', `${randomBetween(12, 88).toFixed(2)}%`);
        setParticleStyle(particle, '--jpdb-particle-size', `${size.toFixed(2)}px`);
        setParticleStyle(particle, '--jpdb-particle-opacity', opacity.toFixed(2));
        setParticleStyle(particle, '--jpdb-particle-opacity-a', (opacity * randomBetween(0.48, 0.72)).toFixed(2));
        setParticleStyle(particle, '--jpdb-particle-opacity-b', opacity.toFixed(2));
        setParticleStyle(particle, '--jpdb-particle-opacity-c', (opacity * randomBetween(0.62, 0.84)).toFixed(2));
        setParticleStyle(particle, '--jpdb-particle-opacity-d', (opacity * randomBetween(0.78, 0.96)).toFixed(2));
        setParticleStyle(particle, '--jpdb-particle-opacity-e', (opacity * randomBetween(0.52, 0.74)).toFixed(2));
        setParticleStyle(particle, '--jpdb-particle-blur', `${randomBetween(0, 0.85).toFixed(2)}px`);
        setParticleStyle(particle, '--jpdb-particle-duration', `${duration.toFixed(0)}ms`);
        setParticleStyle(particle, '--jpdb-particle-delay', `${randomBetween(-duration, 0).toFixed(0)}ms`);
        setParticleStyle(particle, '--jpdb-particle-dx1', `${randomBetween(-7, 7).toFixed(2)}px`);
        setParticleStyle(particle, '--jpdb-particle-dy1', `${randomBetween(-7, 2).toFixed(2)}px`);
        setParticleStyle(particle, '--jpdb-particle-dx2', `${randomBetween(-9, 9).toFixed(2)}px`);
        setParticleStyle(particle, '--jpdb-particle-dy2', `${randomBetween(-8, 3).toFixed(2)}px`);
        setParticleStyle(particle, '--jpdb-particle-dx3', `${randomBetween(-6, 6).toFixed(2)}px`);
        setParticleStyle(particle, '--jpdb-particle-dy3', `${randomBetween(-6, 2).toFixed(2)}px`);
        setParticleStyle(particle, '--jpdb-particle-dx4', `${randomBetween(-8, 8).toFixed(2)}px`);
        setParticleStyle(particle, '--jpdb-particle-dy4', `${randomBetween(-7, 2).toFixed(2)}px`);
        setParticleStyle(particle, '--jpdb-particle-scale-a', randomBetween(0.76, 1.18).toFixed(2));
        setParticleStyle(particle, '--jpdb-particle-scale-b', randomBetween(0.84, 1.34).toFixed(2));
        setParticleStyle(particle, '--jpdb-particle-scale-c', randomBetween(0.70, 1.24).toFixed(2));
        return particle;
    }

    function getDictationMaskElementId(element) {
        if (!element.dataset.jpdbDictationMaskId) {
            dictationMaskElementId += 1;
            element.dataset.jpdbDictationMaskId = String(dictationMaskElementId);
        }

        return element.dataset.jpdbDictationMaskId;
    }

    function getDictationParticleLayersForElement(element) {
        const maskId = element.dataset.jpdbDictationMaskId;
        if (!maskId) return [];

        return Array.from(document.querySelectorAll(`.jpdb-dictation-particle-layer[data-jpdb-dictation-owner="${maskId}"]`));
    }

    function removeDictationParticleLayersForElement(element) {
        getDictationParticleLayersForElement(element).forEach(layer => layer.remove());
    }

    function getDictationFontSize(element) {
        const computedStyle = getComputedStyle(element);
        return parseFloat(computedStyle.fontSize) || 16;
    }

    function isDictationBaseTextNode(node) {
        if (!node || !node.nodeValue || !node.nodeValue.trim()) return false;

        const parentElement = node.parentElement;
        if (!parentElement) return false;
        if (parentElement.closest('rt, .jpdb-dictation-particle-layer, .jpdb-custom-audio-controls, a.icon-link, button')) return false;
        return true;
    }

    function toPlainRect(rect) {
        return {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height
        };
    }

    function intersectPlainRects(first, second) {
        const left = Math.max(first.left, second.left);
        const top = Math.max(first.top, second.top);
        const right = Math.min(first.right, second.right);
        const bottom = Math.min(first.bottom, second.bottom);
        const width = right - left;
        const height = bottom - top;

        if (width <= 0 || height <= 0) return null;
        return { left, top, right, bottom, width, height };
    }

    function getDictationVisibilityContext(element) {
        let clipRect = null;

        for (
            let ancestor = element.parentElement;
            ancestor && ancestor !== document.documentElement;
            ancestor = ancestor.parentElement
        ) {
            const style = getComputedStyle(ancestor);
            if (
                ancestor.hidden
                || style.display === 'none'
                || style.visibility === 'hidden'
                || style.opacity === '0'
            ) {
                return { visible: false, clipRect: null };
            }

            const overflow = `${style.overflow} ${style.overflowX} ${style.overflowY}`;
            if (/(hidden|clip|auto|scroll)/.test(overflow)) {
                const ancestorRect = toPlainRect(ancestor.getBoundingClientRect());
                clipRect = clipRect ? intersectPlainRects(clipRect, ancestorRect) : ancestorRect;
                if (!clipRect) return { visible: false, clipRect: null };
            }
        }

        return { visible: true, clipRect };
    }

    function hasVisibleDictationArea(element) {
        if (!isElementLaidOut(element)) return false;

        const { visible, clipRect } = getDictationVisibilityContext(element);
        if (!visible) {
            return false;
        }

        if (!clipRect) {
            return true;
        }

        return Array.from(element.getClientRects()).some(rect => {
            const intersection = intersectPlainRects(toPlainRect(rect), clipRect);
            return Boolean(intersection && intersection.width > 1 && intersection.height > 1);
        });
    }

    function getDictationBaseTextClientRects(element) {
        const rects = [];
        const walker = document.createTreeWalker(
            element,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode(node) {
                    return isDictationBaseTextNode(node)
                        ? NodeFilter.FILTER_ACCEPT
                        : NodeFilter.FILTER_REJECT;
                }
            }
        );

        while (walker.nextNode()) {
            const range = document.createRange();
            range.selectNodeContents(walker.currentNode);
            rects.push(...Array.from(range.getClientRects())
                .filter(rect => rect.width > 0.5 && rect.height > 0.5));
            range.detach?.();
        }

        if (rects.length > 0) return rects;

        const fallbackRect = element.getBoundingClientRect();
        return fallbackRect.width > 0 && fallbackRect.height > 0 ? [fallbackRect] : [];
    }

    function createDictationOverlayRect(clientRect, fontSize) {
        const horizontalPadding = Math.max(2, fontSize * 0.05);
        const height = clamp(fontSize * 0.84, 8, Math.max(8, clientRect.height));
        const bottomAdjustment = fontSize * 0.05;
        const top = clientRect.bottom - height - bottomAdjustment;

        return {
            left: clientRect.left - horizontalPadding,
            top,
            right: clientRect.right + horizontalPadding,
            bottom: top + height,
            width: clientRect.width + horizontalPadding * 2,
            height
        };
    }

    function mergeDictationOverlayRects(rects) {
        const rows = [];
        const sortedRects = [...rects].sort((left, right) => left.top - right.top || left.left - right.left);

        sortedRects.forEach(rect => {
            const rectCenter = rect.top + rect.height / 2;
            const row = rows.find(candidate => {
                const rowCenter = candidate.top + candidate.height / 2;
                return Math.abs(rowCenter - rectCenter) <= Math.max(4, Math.max(candidate.height, rect.height) * 0.45);
            });

            if (!row) {
                rows.push({ ...rect });
                return;
            }

            row.left = Math.min(row.left, rect.left);
            row.top = Math.min(row.top, rect.top);
            row.right = Math.max(row.right, rect.right);
            row.bottom = Math.max(row.bottom, rect.bottom);
            row.width = row.right - row.left;
            row.height = row.bottom - row.top;
        });

        return rows;
    }

    function getDictationOverlayRects(element) {
        const fontSize = getDictationFontSize(element);
        const { visible, clipRect } = getDictationVisibilityContext(element);
        if (!visible) {
            return [];
        }

        const clientRects = getDictationBaseTextClientRects(element);
        const overlayRects = clientRects
            .map(rect => createDictationOverlayRect(rect, fontSize))
            .map(rect => clipRect ? intersectPlainRects(rect, clipRect) : rect)
            .filter(rect => rect && rect.width > 1 && rect.height > 1);
        return mergeDictationOverlayRects(overlayRects);
    }

    function createDictationOverlaySignature(rects) {
        return rects
            .map(rect => [
                Math.round(rect.left + window.scrollX),
                Math.round(rect.top + window.scrollY),
                Math.round(rect.width),
                Math.round(rect.height)
            ].join(':'))
            .join('|');
    }

    function positionDictationParticleLayer(layer, rect) {
        layer.style.setProperty('--jpdb-dictation-layer-left', `${(rect.left + window.scrollX).toFixed(2)}px`);
        layer.style.setProperty('--jpdb-dictation-layer-top', `${(rect.top + window.scrollY).toFixed(2)}px`);
        layer.style.setProperty('--jpdb-dictation-layer-width', `${rect.width.toFixed(2)}px`);
        layer.style.setProperty('--jpdb-dictation-layer-height', `${rect.height.toFixed(2)}px`);
    }

    function createDictationParticleLayer(element, rect) {
        const maskId = getDictationMaskElementId(element);
        const layer = document.createElement('span');
        const particleCount = getDictationParticleCount(rect);

        layer.className = 'jpdb-dictation-particle-layer';
        layer.dataset.jpdbDictationOwner = maskId;
        layer.setAttribute('aria-hidden', 'true');
        layer.style.setProperty('--jpdb-dictation-particle-rgb', element.dataset.jpdbDictationParticleRgb || '18, 20, 24');
        positionDictationParticleLayer(layer, rect);

        for (let i = 0; i < particleCount; i++) {
            layer.appendChild(createDictationParticle());
        }

        document.body.appendChild(layer);
    }

    function updateDictationMaskPalette(element) {
        const palette = getDictationMaskPalette(element);
        element.dataset.jpdbDictationParticleRgb = palette.particleRgb;
        element.style.setProperty('--jpdb-dictation-ruby-mask-color', palette.rubyMaskColor);
        getDictationParticleLayersForElement(element).forEach(layer => {
            layer.style.setProperty('--jpdb-dictation-particle-rgb', palette.particleRgb);
        });
    }

    function ensureDictationParticleLayers(element) {
        const overlayRects = getDictationOverlayRects(element);
        const signature = createDictationOverlaySignature(overlayRects);

        if (element.dataset.jpdbDictationOverlaySignature === signature && getDictationParticleLayersForElement(element).length > 0) {
            getDictationParticleLayersForElement(element).forEach(layer => {
                layer.style.setProperty('--jpdb-dictation-particle-rgb', element.dataset.jpdbDictationParticleRgb || '18, 20, 24');
            });
            return;
        }

        removeDictationParticleLayersForElement(element);
        element.dataset.jpdbDictationOverlaySignature = signature;

        overlayRects.forEach(rect => {
            createDictationParticleLayer(element, rect);
        });
    }

    function refreshDictationParticleLayers() {
        document.querySelectorAll('.jpdb-dictation-particle-layer').forEach(layer => layer.remove());
        document.querySelectorAll('.jpdb-dictation-mask').forEach(element => {
            ensureDictationParticleLayers(element);
        });
    }

    function removeOrphanDictationParticleLayers() {
        document.querySelectorAll('.jpdb-dictation-particle-layer').forEach(layer => {
            const ownerId = layer.dataset.jpdbDictationOwner;
            if (!ownerId || !document.querySelector(`.jpdb-dictation-mask[data-jpdb-dictation-mask-id="${ownerId}"]`)) {
                layer.remove();
            }
        });
    }

    function scheduleDictationParticleLayerRefresh() {
        if (!CONFIG.DICTATION_MODE || state.dictationRevealed) return;
        clearTimeout(dictationParticleRefreshTimer);
        dictationParticleRefreshTimer = setTimeout(refreshDictationParticleLayers, 90);
    }

    function ensureDictationParticleLayer(element) {
        ensureDictationParticleLayers(element);
    }

    function unmaskDictationElement(element) {
        removeDictationParticleLayersForElement(element);
        element.classList.remove('jpdb-dictation-mask');
        delete element.dataset.jpdbDictationMaskId;
        delete element.dataset.jpdbDictationOverlaySignature;
        delete element.dataset.jpdbDictationParticleRgb;
        element.style.removeProperty('--jpdb-dictation-reveal-color');
        element.style.removeProperty('--jpdb-dictation-ruby-mask-color');
    }

    function applyDictationMask(element) {
        if (!element) return;
        if (element.closest('.jpdb-custom-audio-controls')) return;
        updateDictationMaskPalette(element);
        if (element.classList.contains('jpdb-dictation-mask')) {
            ensureDictationParticleLayer(element);
            return;
        }

        const computedStyle = getComputedStyle(element);
        element.style.setProperty('--jpdb-dictation-reveal-color', computedStyle.color || 'currentColor');
        element.classList.add('jpdb-dictation-mask');
        ensureDictationParticleLayer(element);
    }

    function clearDictationMasks({ keepRevealClasses = false } = {}) {
        document.querySelectorAll('.jpdb-dictation-mask').forEach(element => {
            unmaskDictationElement(element);
        });
        document.querySelectorAll('.jpdb-dictation-particle-layer').forEach(layer => layer.remove());

        if (!keepRevealClasses) {
            document.documentElement.classList.remove('jpdb-dictation-mode-active', 'jpdb-dictation-revealing', 'jpdb-dictation-revealed');
            document.documentElement.classList.add('jpdb-dictation-mode-inactive');
        }
    }

    function getDictationMaskTargets(word) {
        const targets = new Set();
        const answerBox = getPrimaryAnswerBox();
        const answerVocabElement = getAnswerBoxVocabularyElement(answerBox);
        if (answerVocabElement && isExactDictationWord(answerVocabElement, word)) {
            targets.add(answerVocabElement);
        }

        const highlightedSelectors = [
            '.answer-box .highlight',
            '.result.vocabulary .highlight',
            '.subsection-examples .highlight',
            '#immersion-kit-container .highlight',
            '.jpdb-ik-vocab-highlight',
            '#immersion-kit-container span[style*="--outline-input-color"]'
        ].join(', ');

        document.querySelectorAll(highlightedSelectors).forEach(element => {
            targets.add(element);
        });

        document.querySelectorAll('.review-reveal .answer-box a.plain[href*="/vocabulary/"], .review-reveal .answer-box a.plain[href*="/kanji/"]').forEach(element => {
            if (hasVisibleDictationArea(element) && isExactDictationWord(element, word)) {
                targets.add(element);
            }
        });

        return Array.from(targets).filter(element => {
            if (element.closest('.jpdb-custom-audio-controls')) return false;
            return hasVisibleDictationArea(element);
        });
    }

    function updateDictationCardState(word) {
        const signature = getDictationCardSignature(word);
        if (signature === state.dictationSignature) return;

        state.dictationSignature = signature;
        state.dictationVocab = word;
        state.dictationRevealed = false;
        document.documentElement.classList.remove('jpdb-dictation-revealing', 'jpdb-dictation-revealed');
    }

    function updateDictationModeClass() {
        if (!CONFIG.DICTATION_MODE || !isDictationReviewPath()) {
            document.documentElement.classList.remove('jpdb-dictation-mode-active');
            document.documentElement.classList.add('jpdb-dictation-mode-inactive');
            return;
        }

        const word = getDictationWordFromPage();
        if (word) {
            updateDictationCardState(word);
        }

        document.documentElement.classList.remove('jpdb-dictation-mode-inactive');
        document.documentElement.classList.add('jpdb-dictation-mode-active');
    }

    function syncDictationMasking() {
        injectDictationStyles();
        removeOrphanDictationParticleLayers();
        updateDictationModeClass();

        if (!CONFIG.DICTATION_MODE || !isDictationReviewPath()) {
            clearDictationMasks();
            return;
        }

        if (!isDictationReviewPage()) {
            clearDictationMasks({ keepRevealClasses: true });
            document.documentElement.classList.remove('jpdb-dictation-revealing', 'jpdb-dictation-revealed');
            return;
        }

        const word = getDictationWordFromPage();
        if (!word) {
            clearDictationMasks();
            return;
        }

        updateDictationCardState(word);
        if (state.dictationRevealed) {
            clearDictationMasks({ keepRevealClasses: true });
            return;
        }

        document.documentElement.classList.remove('jpdb-dictation-revealed');
        const maskTargets = getDictationMaskTargets(word);
        const maskTargetSet = new Set(maskTargets);
        document.querySelectorAll('.jpdb-dictation-mask').forEach(element => {
            if (!maskTargetSet.has(element)) {
                unmaskDictationElement(element);
            }
        });
        maskTargets.forEach(applyDictationMask);
    }

    function scheduleDictationMasking() {
        clearTimeout(dictationMaskTimer);
        dictationMaskTimer = setTimeout(syncDictationMasking, 90);
    }

    function revealDictationMasks() {
        if (!CONFIG.DICTATION_MODE || state.dictationRevealed) return false;

        const maskedElements = Array.from(document.querySelectorAll('.jpdb-dictation-mask'));
        if (maskedElements.length === 0) {
            syncDictationMasking();
            if (!document.querySelector('.jpdb-dictation-mask')) return false;
        }

        state.dictationRevealed = true;
        document.documentElement.classList.remove('jpdb-dictation-revealed');
        document.documentElement.classList.add('jpdb-dictation-revealing');

        setTimeout(() => {
            clearDictationMasks({ keepRevealClasses: true });
            document.documentElement.classList.remove('jpdb-dictation-revealing');
            document.documentElement.classList.add('jpdb-dictation-revealed');
        }, 160);

        return true;
    }

    function isDictationInteractiveElement(element) {
        return Boolean(element.closest('.jpdb-custom-audio-controls, a, button, input, textarea, select, [role="button"]'));
    }

    function getElementFromEventTarget(target) {
        if (target instanceof Element) return target;
        if (target && target.parentElement) return target.parentElement;
        return null;
    }

    function handleDictationRevealClick(event) {
        if (!CONFIG.DICTATION_MODE || state.dictationRevealed || !isDictationReviewPage()) return;

        const target = getElementFromEventTarget(event.target);
        if (!target) return;
        if (isDictationInteractiveElement(target) && !target.closest('.jpdb-dictation-mask')) return;

        const revealTarget = target.closest([
            '.jpdb-dictation-mask',
            '.answer-box > .plain',
            '.answer-box .card-sentence .sentence',
            '.subsection-examples .used-in .jp',
            '#immersion-kit-container #image-wrapper'
        ].join(', '));

        if (!revealTarget) return;
        if (revealDictationMasks()) {
            event.preventDefault();
            event.stopImmediatePropagation();
            event.stopPropagation();
        }
    }

    function handleDictationRevealHotkey(event) {
        if (event.__jpdbDictationRevealHandled) return;
        if (shouldIgnoreGlobalHotkey(event)) return;
        if (!CONFIG.DICTATION_MODE || !isDictationReviewPage()) return;

        event.__jpdbDictationRevealHandled = true;
        event.preventDefault();
        event.stopImmediatePropagation();
        event.stopPropagation();
        revealDictationMasks();
    }

    function isCustomAudioSentenceTarget(sentenceElement) {
        if (!sentenceElement) return false;
        if (sentenceElement.closest('#immersion-kit-container')) return false;
        if (sentenceElement.querySelector('.example-audio')) return false;
        if (sentenceElement.querySelector('.jpdb-custom-audio-controls')) return false;
        return true;
    }

    function getCustomAudioSentenceTargets() {
        return Array.from(document.querySelectorAll('.card-sentence .sentence, .subsection-examples .used-in .jp'))
            .filter(isCustomAudioSentenceTarget);
    }

    function removeLeadingSentenceSpacer(sentenceElement) {
        const firstChild = sentenceElement.firstElementChild;
        if (
            firstChild
            && firstChild.tagName === 'DIV'
            && firstChild.textContent.trim() === ''
            && firstChild.style.width === '0.5rem'
        ) {
            firstChild.remove();
        }
    }

    function createCustomAudioActionLink(labelText, titleText) {
        const anchor = document.createElement('a');
        anchor.href = '#';
        anchor.className = 'icon-link';
        anchor.title = titleText;
        anchor.style.border = '0';
        anchor.style.display = 'inline-flex';
        anchor.style.alignItems = 'center';
        anchor.style.justifyContent = 'center';
        anchor.style.verticalAlign = 'middle';
        anchor.style.marginRight = '0.35rem';
        anchor.style.padding = '0.08rem 0.35rem';
        anchor.style.borderRadius = '999px';
        anchor.style.backgroundColor = 'rgba(61, 141, 255, 0.14)';
        anchor.style.color = '#3D8DFF';
        anchor.style.fontSize = '0.72rem';
        anchor.style.lineHeight = '1.2';
        anchor.style.textDecoration = 'none';
        anchor.textContent = labelText;
        return anchor;
    }

    function setCustomAudioControlsState(controls, { available, busy }) {
        controls.dataset.available = available ? '1' : '0';
        controls.dataset.busy = busy ? '1' : '0';

        const playButton = controls.querySelector('.jpdb-custom-audio-play');
        const uploadButton = controls.querySelector('.jpdb-custom-audio-upload');

        if (playButton) {
            playButton.style.opacity = busy ? '0.45' : (available ? '1' : '0.45');
            playButton.textContent = available ? 'Play' : 'Lookup';
            playButton.title = available
                ? 'Play custom example audio'
                : 'Try remote lookup for custom example audio';
        }

        if (uploadButton) {
            uploadButton.style.opacity = busy ? '0.45' : '1';
            uploadButton.textContent = available ? 'Replace' : 'Upload';
            uploadButton.title = available
                ? 'Replace custom example audio'
                : 'Upload custom example audio';
        }
    }

    async function refreshCustomAudioControlsState(sentenceElement, controls) {
        const descriptor = await getCustomAudioDescriptor(sentenceElement);
        const record = await CustomAudioCache.peek(descriptor.key);
        setCustomAudioControlsState(controls, {
            available: Boolean(record),
            busy: false
        });
    }

    function selectAudioFile() {
        return new Promise(resolve => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'audio/*,.mp3,.m4a,.wav,.ogg';
            input.addEventListener('change', () => {
                resolve(input.files && input.files[0] ? input.files[0] : null);
            }, { once: true });
            input.click();
        });
    }

    async function playCustomAudioForSentence(sentenceElement, controls = null, alertOnMissing = true) {
        const activeControls = controls || sentenceElement.querySelector('.jpdb-custom-audio-controls');
        if (activeControls) {
            setCustomAudioControlsState(activeControls, {
                available: activeControls.dataset.available === '1',
                busy: true
            });
        }

        try {
            const descriptor = await getCustomAudioDescriptor(sentenceElement);
            let record = await CustomAudioCache.get(descriptor.key);

            if (!record) {
                const remoteBlob = await fetchRemoteCustomAudioBlob(descriptor);
                if (remoteBlob) {
                    record = await CustomAudioCache.save(descriptor.key, remoteBlob, {
                        headword: descriptor.headword,
                        sentenceText: descriptor.sentenceText,
                        remoteSynced: true
                    });
                }
            }

            if (!record) {
                if (alertOnMissing) {
                    alert('No custom audio was found for this sentence. Use the upload button to add one.');
                }
                if (activeControls) {
                    setCustomAudioControlsState(activeControls, { available: false, busy: false });
                }
                return;
            }

            await playCustomAudioBlob(record.blob);
            if (activeControls) {
                await refreshCustomAudioControlsState(sentenceElement, activeControls);
            }
        } catch (error) {
            console.error('Failed to play custom audio:', error);
            alert(`Failed to play custom audio: ${error instanceof Error ? error.message : error}`);
            if (activeControls) {
                setCustomAudioControlsState(activeControls, {
                    available: activeControls.dataset.available === '1',
                    busy: false
                });
            }
        }
    }

    async function handleCustomAudioPlay(sentenceElement, controls) {
        await playCustomAudioForSentence(sentenceElement, controls, true);
    }

    async function handleCustomAudioUpload(sentenceElement, controls) {
        const file = await selectAudioFile();
        if (!file) return;

        if (!(file.type || '').startsWith('audio/')) {
            alert('Please choose an audio file.');
            return;
        }

        setCustomAudioControlsState(controls, {
            available: controls.dataset.available === '1',
            busy: true
        });

        try {
            const descriptor = await getCustomAudioDescriptor(sentenceElement);
            await CustomAudioCache.save(descriptor.key, file, {
                headword: descriptor.headword,
                sentenceText: descriptor.sentenceText,
                remoteSynced: false
            });

            const remoteResult = await uploadRemoteCustomAudio(descriptor, file);
            await CustomAudioCache.save(descriptor.key, file, {
                headword: descriptor.headword,
                sentenceText: descriptor.sentenceText,
                remoteSynced: remoteResult.remoteStored
            });

            await playCustomAudioBlob(file);
            await refreshCustomAudioControlsState(sentenceElement, controls);

            if (remoteResult.localOnly) {
                alert('Custom audio saved locally. Add your Cloudflare Worker URL in the extension menu to sync it remotely.');
            }
        } catch (error) {
            console.error('Failed to upload custom audio:', error);
            alert(`Failed to upload custom audio: ${error instanceof Error ? error.message : error}`);
            setCustomAudioControlsState(controls, {
                available: controls.dataset.available === '1',
                busy: false
            });
        }
    }

    function createCustomAudioControls(sentenceElement) {
        const controls = document.createElement('span');
        controls.className = 'jpdb-custom-audio-controls';
        controls.style.display = 'inline-flex';
        controls.style.alignItems = 'center';

        const playButton = createCustomAudioActionLink('Lookup', 'Try remote lookup for custom example audio');
        playButton.classList.add('jpdb-custom-audio-play');
        const uploadButton = createCustomAudioActionLink('Upload', 'Upload custom example audio');
        uploadButton.classList.add('jpdb-custom-audio-upload');

        playButton.addEventListener('click', async event => {
            event.preventDefault();
            await handleCustomAudioPlay(sentenceElement, controls);
        });

        uploadButton.addEventListener('click', async event => {
            event.preventDefault();
            await handleCustomAudioUpload(sentenceElement, controls);
        });

        const spacer = document.createElement('div');
        spacer.style.width = '0.25rem';
        spacer.style.display = 'inline-block';

        controls.append(playButton, uploadButton, spacer);
        setCustomAudioControlsState(controls, { available: false, busy: false });
        return controls;
    }

    async function enhanceCustomAudioControls() {
        const sentenceTargets = getCustomAudioSentenceTargets();
        for (const sentenceElement of sentenceTargets) {
            removeLeadingSentenceSpacer(sentenceElement);
            const controls = createCustomAudioControls(sentenceElement);
            sentenceElement.insertBefore(controls, sentenceElement.firstChild);
            await refreshCustomAudioControlsState(sentenceElement, controls);
        }
    }


    //MENU FUNCTIONS=====================================================================================================================
    ////FILE OPERATIONS=====================================================================================================================
    function handleImportButtonClick() {
        handleFileInput('application/json', importFavorites);
    }

    function handleImportDButtonClick() {
        handleFileInput('application/json', importData);
    }

    function handleImportBackupButtonClick() {
        handleFileInput('application/json', importBackup);
    }

    function handleFileInput(acceptType, callback) {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = acceptType;
        fileInput.addEventListener('change', callback);
        fileInput.click();
    }

    function createBlobAndDownload(data, filename, type) {
        const blob = new Blob([data], { type });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function buildBackupFilename() {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        return `jpdb-immersion-kit-backup-${timestamp}.json`;
    }

    function isKnownScriptStorageKey(key) {
        return key === 'JPDBImmersionKit*Examples-CONFIG_VARIABLES_PREFIXED'
            || key.startsWith(scriptPrefix)
            || key.startsWith(configPrefix);
    }

    function isLegacySelectionValue(value) {
        return typeof value === 'string' && /^\d+,[012]$/.test(value);
    }

    function collectBackupLocalStorage() {
        const localStorageEntries = {};
        const legacySelectionCandidates = {};

        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            const value = localStorage.getItem(key);

            if (isKnownScriptStorageKey(key)) {
                localStorageEntries[key] = value;
            } else if (isLegacySelectionValue(value)) {
                legacySelectionCandidates[key] = value;
            }
        }

        return { localStorageEntries, legacySelectionCandidates };
    }

    function readAllObjectStoreRecords(store) {
        return new Promise((resolve, reject) => {
            const records = [];
            const request = store.openCursor();

            request.onsuccess = event => {
                const cursor = event.target.result;
                if (cursor) {
                    records.push(cursor.value);
                    cursor.continue();
                } else {
                    resolve(records);
                }
            };
            request.onerror = event => reject(`Cursor error: ${event.target.errorCode}`);
        });
    }

    async function readIndexedDBBackup() {
        const db = await IndexedDBManager.open();
        try {
            const dataTx = db.transaction([IndexedDBManager.DATA_STORE], 'readonly');
            const dataStore = dataTx.objectStore(IndexedDBManager.DATA_STORE);
            const dataRecords = await readAllObjectStoreRecords(dataStore);

            const metaRecords = db.objectStoreNames.contains(IndexedDBManager.META_STORE)
                ? await readAllObjectStoreRecords(
                    db.transaction([IndexedDBManager.META_STORE], 'readonly')
                        .objectStore(IndexedDBManager.META_STORE)
                )
                : [];

            return {
                name: IndexedDBManager.DB_NAME,
                version: IndexedDBManager.DB_VERSION,
                dataStoreName: IndexedDBManager.DATA_STORE,
                metaStoreName: IndexedDBManager.META_STORE,
                dataStore: dataRecords,
                metaStore: metaRecords
            };
        } finally {
            db.close();
        }
    }

    async function buildBackupPayload() {
        const { localStorageEntries, legacySelectionCandidates } = collectBackupLocalStorage();
        return {
            schemaVersion: backupSchemaVersion,
            source: 'jpdb-immersion-kit-extension',
            exportedAt: new Date().toISOString(),
            localStorage: localStorageEntries,
            legacySelectionCandidates,
            indexedDB: await readIndexedDBBackup()
        };
    }

    function clearCurrentScriptStorage() {
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (isKnownScriptStorageKey(key)) {
                keysToRemove.push(key);
            }
        }

        keysToRemove.forEach(key => localStorage.removeItem(key));
    }

    function importBackupLocalStorage(backup) {
        clearCurrentScriptStorage();

        const localStorageEntries = backup.localStorage || {};
        Object.entries(localStorageEntries).forEach(([key, value]) => {
            if (isKnownScriptStorageKey(key)) {
                localStorage.setItem(key, value);
            }
        });

        const legacySelectionCandidates = backup.legacySelectionCandidates || {};
        Object.entries(legacySelectionCandidates).forEach(([key, value]) => {
            if (!isLegacySelectionValue(value)) {
                return;
            }
            const prefixedKey = key.startsWith(scriptPrefix) ? key : `${scriptPrefix}${key}`;
            if (localStorage.getItem(prefixedKey) === null) {
                localStorage.setItem(prefixedKey, value);
            }
        });
    }

    function replaceObjectStoreRecords(store, records) {
        return new Promise((resolve, reject) => {
            const clearRequest = store.clear();
            clearRequest.onerror = event => reject(`Clear failed: ${event.target.errorCode}`);
            clearRequest.onsuccess = () => {
                records.forEach(record => {
                    store.put(record);
                });
            };

            store.transaction.oncomplete = () => resolve();
            store.transaction.onerror = event => reject(`Transaction failed: ${event.target.errorCode}`);
        });
    }

    async function importBackupIndexedDB(backup) {
        const db = await IndexedDBManager.open();
        try {
            const indexedDBBackup = backup.indexedDB || {};
            const dataRecords = Array.isArray(indexedDBBackup.dataStore) ? indexedDBBackup.dataStore : [];
            const metaRecords = Array.isArray(indexedDBBackup.metaStore) ? indexedDBBackup.metaStore : [];

            await replaceObjectStoreRecords(
                db.transaction([IndexedDBManager.DATA_STORE], 'readwrite').objectStore(IndexedDBManager.DATA_STORE),
                dataRecords
            );

            if (db.objectStoreNames.contains(IndexedDBManager.META_STORE)) {
                await replaceObjectStoreRecords(
                    db.transaction([IndexedDBManager.META_STORE], 'readwrite').objectStore(IndexedDBManager.META_STORE),
                    metaRecords
                );
            }
        } finally {
            db.close();
        }
    }

    async function exportBackup() {
        try {
            const backup = await buildBackupPayload();
            createBlobAndDownload(
                JSON.stringify(backup, null, 2),
                buildBackupFilename(),
                'application/json'
            );
        } catch (error) {
            console.error('Error exporting backup:', error);
            alert(`Error exporting backup: ${error instanceof Error ? error.message : error}`);
        }
    }

    async function importBackup(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async function(e) {
            try {
                const backup = JSON.parse(e.target.result);
                if (!backup || typeof backup !== 'object') {
                    throw new Error('Backup file is not a JSON object.');
                }
                if (backup.schemaVersion !== backupSchemaVersion) {
                    throw new Error(`Unsupported backup schema version: ${backup.schemaVersion}`);
                }

                importBackupLocalStorage(backup);
                await importBackupIndexedDB(backup);

                alert('Backup imported successfully!');
                location.reload();
            } catch (error) {
                console.error('Error importing backup:', error);
                alert(`Error importing backup: ${error instanceof Error ? error.message : error}`);
            }
        };
        reader.readAsText(file);
    }

    function addBlacklist() {
        setItem(state.vocab, `0,2`);
        location.reload();
    }

    function remBlacklist() {
        removeItem(state.vocab);
        location.reload();
    }

    function exportFavorites() {
        const favorites = {};
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key.startsWith(scriptPrefix)) {
                const keyPrefixless = key.substring(scriptPrefix.length); // chop off the script prefix
                if (!keyPrefixless.startsWith(configPrefix)) {
                    favorites[keyPrefixless] = localStorage.getItem(key);
                    // For backwards compatibility keep the exported keys prefixless
                }
            }
        }
        const data = JSON.stringify(favorites, null, 2);
        createBlobAndDownload(data, 'favorites.json', 'application/json');
    }

    function importFavorites(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const favorites = JSON.parse(e.target.result);
                for (const key in favorites) {
                    setItem(key, favorites[key]);
                }
                alert('Favorites imported successfully!');
                location.reload();
            } catch (error) {
                alert(`Error importing favorites: ${error instanceof Error ? error.message : error}`);
            }
        };
        reader.readAsText(file);
    }

    async function exportData() {
        const dataEntries = {};

        try {
            const db = await IndexedDBManager.open();
            const indexedDBData = await IndexedDBManager.getAll(db);
            indexedDBData.forEach(item => {
                dataEntries[item.keyword] = item.data;
            });

            const data = JSON.stringify(dataEntries, null, 2);
            createBlobAndDownload(data, 'data.json', 'application/json');
        } catch (error) {
            console.error('Error exporting data from IndexedDB:', error);
        }
    }

    async function importData(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async function(e) {
            try {
                const dataEntries = JSON.parse(e.target.result);

                const db = await IndexedDBManager.open();
                for (const key in dataEntries) {
                    await IndexedDBManager.save(db, key, dataEntries[key]);
                }

                alert('Data imported successfully!');
                location.reload();
            } catch (error) {
                alert(`Error importing data: ${error instanceof Error ? error.message : error}`);
            }
        };
        reader.readAsText(file);
    }


    ////CONFIRMATION
    function createConfirmationPopup(messageText, onYes, onNo) {
        // Create a confirmation popup with Yes and No buttons
        const popupOverlay = document.createElement('div');
        popupOverlay.style.position = 'fixed';
        popupOverlay.style.top = '0';
        popupOverlay.style.left = '0';
        popupOverlay.style.width = '100%';
        popupOverlay.style.height = '100%';
        popupOverlay.style.backgroundColor = 'rgba(0, 0, 0, 0.75)';
        popupOverlay.style.zIndex = '1001';
        popupOverlay.style.display = 'flex';
        popupOverlay.style.justifyContent = 'center';
        popupOverlay.style.alignItems = 'center';

        const popupContent = document.createElement('div');
        popupContent.style.backgroundColor = 'var(--background-color)';
        popupContent.style.padding = '20px';
        popupContent.style.borderRadius = '5px';
        popupContent.style.boxShadow = '0 0 10px rgba(0, 0, 0, 0.5)';
        popupContent.style.textAlign = 'center';

        const message = document.createElement('p');
        message.textContent = messageText;

        const yesButton = document.createElement('button');
        yesButton.textContent = 'Yes';
        yesButton.style.backgroundColor = '#C82800';
        yesButton.style.marginRight = '10px';
        yesButton.addEventListener('click', () => {
            onYes();
            document.body.removeChild(popupOverlay);
        });

        const noButton = document.createElement('button');
        noButton.textContent = 'No';
        noButton.addEventListener('click', () => {
            onNo();
            document.body.removeChild(popupOverlay);
        });

        popupContent.appendChild(message);
        popupContent.appendChild(yesButton);
        popupContent.appendChild(noButton);
        popupOverlay.appendChild(popupContent);

        document.body.appendChild(popupOverlay);
    }

    ////BUTTONS
    function createActionButtonsContainer() {
        const actionButtonWidth = '100px';

        const closeButton = createButton('Close', '10px', closeOverlayMenu, actionButtonWidth);
        const saveButton = createButton('Save', '10px', saveConfig, actionButtonWidth);
        const defaultButton = createDefaultButton(actionButtonWidth);
        const deleteButton = createDeleteButton(actionButtonWidth);
        const deleteCurrentVocabButton = createDeleteCurrentVocabButton('400px');

        const actionButtonsContainer = document.createElement('div');
        actionButtonsContainer.style.textAlign = 'center';
        actionButtonsContainer.style.marginTop = '10px';
        actionButtonsContainer.append(closeButton, saveButton, defaultButton, deleteButton, deleteCurrentVocabButton);

        return actionButtonsContainer;
    }

    function createMenuButtons() {
        const blacklistContainer = createBlacklistContainer();
        const favoritesContainer = createFavoritesContainer();
        const dataContainer = createDataContainer();
        const backupContainer = createBackupContainer();
        const actionButtonsContainer = createActionButtonsContainer();

        const buttonContainer = document.createElement('div');
        buttonContainer.append(blacklistContainer, favoritesContainer, dataContainer, backupContainer, actionButtonsContainer);

        return buttonContainer;
    }

    function createButton(text, margin, onClick, width) {
        // Create a button element with specified properties
        const button = document.createElement('button');
        button.textContent = text;
        button.style.margin = margin;
        button.style.width = width;
        button.style.textAlign = 'center';
        button.style.display = 'inline-block';
        button.style.lineHeight = '30px';
        button.style.padding = '5px 0';
        button.addEventListener('click', onClick);
        return button;
    }

    ////BLACKLIST BUTTONS
    function createBlacklistContainer() {
        const blacklistButtonWidth = '200px';

        const addBlacklistButton = createButton('Add to Blacklist', '10px', addBlacklist, blacklistButtonWidth);
        const remBlacklistButton = createButton('Remove from Blacklist', '10px', remBlacklist, blacklistButtonWidth);

        const blacklistContainer = document.createElement('div');
        blacklistContainer.style.textAlign = 'center';
        blacklistContainer.style.marginTop = '10px';
        blacklistContainer.append(addBlacklistButton, remBlacklistButton);

        return blacklistContainer;
    }
    ////FAVORITE BUTTONS
    function createFavoritesContainer() {
        const favoritesButtonWidth = '200px';

        const exportButton = createButton('Export Favorites', '10px', exportFavorites, favoritesButtonWidth);
        const importButton = createButton('Import Favorites', '10px', handleImportButtonClick, favoritesButtonWidth);

        const favoritesContainer = document.createElement('div');
        favoritesContainer.style.textAlign = 'center';
        favoritesContainer.style.marginTop = '10px';
        favoritesContainer.append(exportButton, importButton);

        return favoritesContainer;

    }
    ////DATA BUTTONS
    function createDataContainer() {
        const dataButtonWidth = '200px';

        const exportButton = createButton('Export Data', '10px', exportData, dataButtonWidth);
        const importButton = createButton('Import Data', '10px', handleImportDButtonClick, dataButtonWidth);

        const dataContainer = document.createElement('div');
        dataContainer.style.textAlign = 'center';
        dataContainer.style.marginTop = '10px';
        dataContainer.append(exportButton, importButton);

        return dataContainer;
    }

    ////BACKUP BUTTONS
    function createBackupContainer() {
        const backupButtonWidth = '200px';

        const exportButton = createButton('Export Backup', '10px', exportBackup, backupButtonWidth);
        const importButton = createButton('Import Backup', '10px', handleImportBackupButtonClick, backupButtonWidth);

        const backupContainer = document.createElement('div');
        backupContainer.style.textAlign = 'center';
        backupContainer.style.marginTop = '10px';
        backupContainer.append(exportButton, importButton);

        return backupContainer;
    }

    ////CLOSE BUTTON
    function closeOverlayMenu() {
        loadConfig();
        document.body.removeChild(document.getElementById('overlayMenu'));
    }

    ////SAVE BUTTON
    async function saveConfig() {
        const overlay = document.getElementById('overlayMenu');
        if (!overlay) return;

        const inputs = overlay.querySelectorAll('input, span');
        const changes = gatherChanges(inputs);

        applyChanges(changes);
        await saveConfigToExtensionStorage(readLocalStorageConfig());
        await saveCustomAudioSettingsFromOverlay(overlay);
        finalizeSaveConfig();
        setVocabSize();
        setPageWidth();
        scheduleFavoritesAutoSync();
    }

    function gatherChanges(inputs) {
        const changes = {};

        inputs.forEach(input => {
            const key = input.getAttribute('data-key');
            const type = input.getAttribute('data-type');
            let value;

            if (type === 'boolean') {
                value = input.checked;
            } else if (type === 'number') {
                value = parseFloat(input.textContent);
            } else if (type === 'string') {
                value = input.textContent;
            } else if (type === 'object' && key === 'HOTKEYS') {
                value = input.textContent.replace(' and ', ' ');
            }

            if (key && type) {
                const typePart = input.getAttribute('data-type-part');
                const originalFormattedType = typePart.slice(1, -1);

                changes[configPrefix + key] = value + originalFormattedType;
            }
        });

        return changes;
    }

    function applyChanges(changes) {
        for (const key in changes) {
            setItem(key, changes[key]);
        }
    }

    function finalizeSaveConfig() {
        const wasDictationMode = CONFIG.DICTATION_MODE;
        loadConfig();
        if (CONFIG.DICTATION_MODE && !wasDictationMode) {
            state.dictationSignature = '';
            state.dictationRevealed = false;
        }
        window.removeEventListener('keydown', hotkeysListener);
        renderImageAndPlayAudio(state.vocab, CONFIG.AUTO_PLAY_SOUND);
        scheduleCustomAudioEnhancement();
        updateDictationModeClass();
        scheduleDictationMasking();
        const overlay = document.getElementById('overlayMenu');
        if (overlay) {
            document.body.removeChild(overlay);
        }
    }



    ////DEFAULT BUTTON
    function createDefaultButton(width) {
        const defaultButton = createButton('Default', '10px', () => {
            createConfirmationPopup(
                'This will reset all your settings to default. Are you sure?',
                async () => {
                    getLocalStorageKeys().forEach(key => {
                        if (key.startsWith(scriptPrefix + configPrefix)) {
                            localStorage.removeItem(key);
                        }
                    });
                    applyConfigObject(getDefaultConfigValues());
                    writeConfigToLocalStorage(CONFIG);
                    await saveConfigToExtensionStorage();
                    await resetCustomAudioSettings();
                    location.reload();
                },
                () => {
                    const overlay = document.getElementById('overlayMenu');
                    if (overlay) {
                        document.body.removeChild(overlay);
                    }
                    loadConfig();
                    document.body.appendChild(createOverlayMenu());
                }
            );
        }, width);
        defaultButton.style.backgroundColor = '#C82800';
        defaultButton.style.color = 'white';
        return defaultButton;
    }


    ////DELETE BUTTON
    async function deleteCurrentVocab() {
        try {
            const db = await IndexedDBManager.open();
            let currentVocab = state.vocab;

            // Wrap currentVocab with angle quotes if exactSearch is true
            if (state.exactSearch) {
                currentVocab = `「${currentVocab}」`;
            }

            // Delete from IndexedDB
            await IndexedDBManager.deleteEntry(db, currentVocab);
            console.log('Deleting from IndexedDB:', currentVocab);

            // Delete from local storage
            const localStorageKey = scriptPrefix + state.vocab;
            if (localStorage.getItem(localStorageKey)) {
                localStorage.removeItem(localStorageKey);
                console.log('Deleting from local storage:', localStorageKey);
            }

            alert('Current vocabulary deleted successfully!');
            location.reload();
        } catch (error) {
            console.error('Error deleting current vocabulary:', error);
            alert('Error deleting current vocabulary.');
        }
    }

    function createDeleteCurrentVocabButton(width) {
        const deleteCurrentVocabButton = createButton('Refresh Current Vocab from API', '10px', deleteCurrentVocab, width);
        deleteCurrentVocabButton.style.backgroundColor = '#C82800';
        deleteCurrentVocabButton.style.color = 'white';
        return deleteCurrentVocabButton;
    }

    function createDeleteButton(width) {
        const deleteButton = createButton('DELETE', '10px', () => {
            createConfirmationPopup(
                'This will delete all your favorites and cached data. Are you sure?',
                async () => {
                    await IndexedDBManager.delete();
                    await CustomAudioCache.delete().catch(error => {
                        console.warn('Failed to delete custom audio cache:', error);
                    });
                    getLocalStorageKeys().forEach(key => {
                        if (key.startsWith(scriptPrefix) && !key.startsWith(scriptPrefix + configPrefix)) {
                            localStorage.removeItem(key);
                        }
                    });
                    location.reload();
                },
                () => {
                    const overlay = document.getElementById('overlayMenu');
                    if (overlay) {
                        document.body.removeChild(overlay);
                    }
                    loadConfig();
                    document.body.appendChild(createOverlayMenu());
                }
            );
        }, width);
        deleteButton.style.backgroundColor = '#C82800';
        deleteButton.style.color = 'white';
        return deleteButton;
    }

    function createOverlayMenu() {
        // Create and return the overlay menu for configuration settings
        const overlay = document.createElement('div');
        overlay.id = 'overlayMenu';
        overlay.style.position = 'fixed';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100%';
        overlay.style.height = '100%';
        overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.75)';
        overlay.style.zIndex = '1000';
        overlay.style.display = 'flex';
        overlay.style.justifyContent = 'center';
        overlay.style.alignItems = 'center';

        const menuContent = document.createElement('div');
        menuContent.style.backgroundColor = 'var(--background-color)';
        menuContent.style.color = 'var(--text-color)';
        menuContent.style.padding = '20px';
        menuContent.style.borderRadius = '5px';
        menuContent.style.boxShadow = '0 0 10px rgba(0, 0, 0, 0.5)';
        menuContent.style.width = '80%';
        menuContent.style.maxWidth = '550px';
        menuContent.style.maxHeight = '80%';
        menuContent.style.overflowY = 'auto';

        for (const [key, value] of Object.entries(CONFIG)) {
            const optionContainer = document.createElement('div');
            optionContainer.style.marginBottom = '10px';
            optionContainer.style.display = 'flex';
            optionContainer.style.alignItems = 'center';

            const leftContainer = document.createElement('div');
            leftContainer.style.flex = '1';
            leftContainer.style.display = 'flex';
            leftContainer.style.alignItems = 'center';

            const rightContainer = document.createElement('div');
            rightContainer.style.flex = '1';
            rightContainer.style.display = 'flex';
            rightContainer.style.alignItems = 'center';
            rightContainer.style.justifyContent = 'center';

            const label = document.createElement('label');
            label.textContent = key.replace(/_/g, ' ').split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
            label.style.marginRight = '10px';

            leftContainer.appendChild(label);

            if (typeof value === 'boolean') {
                const checkboxContainer = document.createElement('div');
                checkboxContainer.style.display = 'flex';
                checkboxContainer.style.alignItems = 'center';
                checkboxContainer.style.justifyContent = 'center';

                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.checked = value;
                checkbox.setAttribute('data-key', key);
                checkbox.setAttribute('data-type', 'boolean');
                checkbox.setAttribute('data-type-part', '');
                checkboxContainer.appendChild(checkbox);

                rightContainer.appendChild(checkboxContainer);
            } else if (typeof value === 'number') {
                const numberContainer = document.createElement('div');
                numberContainer.style.display = 'flex';
                numberContainer.style.alignItems = 'center';
                numberContainer.style.justifyContent = 'center';

                const decrementButton = document.createElement('button');
                decrementButton.textContent = '-';
                decrementButton.style.marginRight = '5px';

                const input = document.createElement('span');
                input.textContent = value;
                input.style.margin = '0 10px';
                input.style.minWidth = '3ch';
                input.style.textAlign = 'center';
                input.setAttribute('data-key', key);
                input.setAttribute('data-type', 'number');
                input.setAttribute('data-type-part', '');

                const incrementButton = document.createElement('button');
                incrementButton.textContent = '+';
                incrementButton.style.marginLeft = '5px';

                const updateButtonStates = () => {
                    let currentValue = parseFloat(input.textContent);
                    if (currentValue <= 0) {
                        decrementButton.disabled = true;
                        decrementButton.style.color = 'grey';
                    } else {
                        decrementButton.disabled = false;
                        decrementButton.style.color = '';
                    }
                    if (key === 'SOUND_VOLUME' && currentValue >= 100) {
                        incrementButton.disabled = true;
                        incrementButton.style.color = 'grey';
                    } else {
                        incrementButton.disabled = false;
                        incrementButton.style.color = '';
                    }
                };

                decrementButton.addEventListener('click', () => {
                    let currentValue = parseFloat(input.textContent);
                    if (currentValue > 0) {
                        if (currentValue > 200) {
                            input.textContent = currentValue - 25;
                        } else if (currentValue > 20) {
                            input.textContent = currentValue - 5;
                        } else {
                            input.textContent = currentValue - 1;
                        }
                        updateButtonStates();
                    }
                });

                incrementButton.addEventListener('click', () => {
                    let currentValue = parseFloat(input.textContent);
                    if (key === 'SOUND_VOLUME' && currentValue >= 100) {
                        return;
                    }
                    if (currentValue >= 200) {
                        input.textContent = currentValue + 25;
                    } else if (currentValue >= 20) {
                        input.textContent = currentValue + 5;
                    } else {
                        input.textContent = currentValue + 1;
                    }
                    updateButtonStates();
                });

                numberContainer.appendChild(decrementButton);
                numberContainer.appendChild(input);
                numberContainer.appendChild(incrementButton);

                rightContainer.appendChild(numberContainer);

                // Initialize button states
                updateButtonStates();
            } else if (typeof value === 'string') {
                const typeParts = value.split(/(\d+)/).filter(Boolean);
                const numberParts = typeParts.filter(part => !isNaN(part)).map(Number);

                const numberContainer = document.createElement('div');
                numberContainer.style.display = 'flex';
                numberContainer.style.alignItems = 'center';
                numberContainer.style.justifyContent = 'center';

                const typeSpan = document.createElement('span');
                const formattedType = '(' + typeParts.filter(part => isNaN(part)).join('').replace(/_/g, ' ').toLowerCase() + ')';
                typeSpan.textContent = formattedType;
                typeSpan.style.marginRight = '10px';

                leftContainer.appendChild(typeSpan);

                typeParts.forEach(part => {
                    if (!isNaN(part)) {
                        const decrementButton = document.createElement('button');
                        decrementButton.textContent = '-';
                        decrementButton.style.marginRight = '5px';

                        const input = document.createElement('span');
                        input.textContent = part;
                        input.style.margin = '0 10px';
                        input.style.minWidth = '3ch';
                        input.style.textAlign = 'center';
                        input.setAttribute('data-key', key);
                        input.setAttribute('data-type', 'string');
                        input.setAttribute('data-type-part', formattedType);

                        const incrementButton = document.createElement('button');
                        incrementButton.textContent = '+';
                        incrementButton.style.marginLeft = '5px';

                        const updateButtonStates = () => {
                            let currentValue = parseFloat(input.textContent);
                            if (currentValue <= 0) {
                                decrementButton.disabled = true;
                                decrementButton.style.color = 'grey';
                            } else {
                                decrementButton.disabled = false;
                                decrementButton.style.color = '';
                            }
                            if (key === 'SOUND_VOLUME' && currentValue >= 100) {
                                incrementButton.disabled = true;
                                incrementButton.style.color = 'grey';
                            } else {
                                incrementButton.disabled = false;
                                incrementButton.style.color = '';
                            }
                        };

                        decrementButton.addEventListener('click', () => {
                            let currentValue = parseFloat(input.textContent);
                            if (currentValue > 0) {
                                if (currentValue > 200) {
                                    input.textContent = currentValue - 25;
                                } else if (currentValue > 20) {
                                    input.textContent = currentValue - 5;
                                } else {
                                    input.textContent = currentValue - 1;
                                }
                                updateButtonStates();
                            }
                        });

                        incrementButton.addEventListener('click', () => {
                            let currentValue = parseFloat(input.textContent);
                            if (key === 'SOUND_VOLUME' && currentValue >= 100) {
                                return;
                            }
                            if (currentValue >= 200) {
                                input.textContent = currentValue + 25;
                            } else if (currentValue >= 20) {
                                input.textContent = currentValue + 5;
                            } else {
                                input.textContent = currentValue + 1;
                            }
                            updateButtonStates();
                        });

                        numberContainer.appendChild(decrementButton);
                        numberContainer.appendChild(input);
                        numberContainer.appendChild(incrementButton);

                        // Initialize button states
                        updateButtonStates();
                    }
                });

                rightContainer.appendChild(numberContainer);
            } else if (typeof value === 'object') {
                const maxAllowedIndex = hotkeyOptions.length - 1

                let currentValue = value;
                let choiceIndex = hotkeyOptions.indexOf(currentValue.join(' '));
                if (choiceIndex === -1) {
                    currentValue = hotkeyOptions[0].split(' ');
                    choiceIndex = 0;
                }
                const textContainer = document.createElement('div');
                textContainer.style.display = 'flex';
                textContainer.style.alignItems = 'center';
                textContainer.style.justifyContent = 'center';

                const decrementButton = document.createElement('button');
                decrementButton.textContent = '<';
                decrementButton.style.marginRight = '5px';

                const input = document.createElement('span');
                input.textContent = currentValue.join(' and ');
                input.style.margin = '0 10px';
                input.style.minWidth = '3ch';
                input.style.textAlign = 'center';
                input.setAttribute('data-key', key);
                input.setAttribute('data-type', 'object');
                input.setAttribute('data-type-part', '');

                const incrementButton = document.createElement('button');
                incrementButton.textContent = '>';
                incrementButton.style.marginLeft = '5px';

                const updateButtonStates = () => {
                    if (choiceIndex <= 0) {
                        decrementButton.disabled = true;
                        decrementButton.style.color = 'grey';
                    } else {
                        decrementButton.disabled = false;
                        decrementButton.style.color = '';
                    }
                    if (choiceIndex >= maxAllowedIndex) {
                        incrementButton.disabled = true;
                        incrementButton.style.color = 'grey';
                    } else {
                        incrementButton.disabled = false;
                        incrementButton.style.color = '';
                    }
                };

                decrementButton.addEventListener('click', () => {
                    if (choiceIndex > 0) {
                        choiceIndex -= 1;
                        currentValue = hotkeyOptions[choiceIndex].split(' ');
                        input.textContent = currentValue.join(' and ');
                        updateButtonStates();
                    }
                });

                incrementButton.addEventListener('click', () => {
                    if (choiceIndex < maxAllowedIndex) {
                        choiceIndex += 1;
                        currentValue = hotkeyOptions[choiceIndex].split(' ');
                        input.textContent = currentValue.join(' and ');
                        updateButtonStates();
                    }
                });

                textContainer.appendChild(decrementButton);
                textContainer.appendChild(input);
                textContainer.appendChild(incrementButton);

                // Initialize button states
                updateButtonStates();

                rightContainer.appendChild(textContainer);
            }

            optionContainer.appendChild(leftContainer);
            optionContainer.appendChild(rightContainer);
            menuContent.appendChild(optionContainer);
        }

        menuContent.appendChild(createCustomAudioSettingsSection());

        const menuButtons = createMenuButtons();
        menuContent.appendChild(menuButtons);

        overlay.appendChild(menuContent);

        return overlay;
    }

    function createCustomAudioInputRow(labelText, inputId, value, type = 'text', placeholder = '') {
        const row = document.createElement('div');
        row.style.marginTop = '10px';
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.gap = '10px';

        const label = document.createElement('label');
        label.htmlFor = inputId;
        label.textContent = labelText;
        label.style.minWidth = '150px';

        const input = document.createElement('input');
        input.id = inputId;
        input.type = type;
        input.value = value;
        input.placeholder = placeholder;
        input.style.flex = '1';
        input.style.minWidth = '0';

        row.append(label, input);
        return row;
    }

    function createCustomAudioCheckboxRow(labelText, inputId, checked) {
        const row = document.createElement('div');
        row.style.marginTop = '10px';
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.gap = '10px';

        const label = document.createElement('label');
        label.htmlFor = inputId;
        label.textContent = labelText;
        label.style.minWidth = '150px';

        const input = document.createElement('input');
        input.id = inputId;
        input.type = 'checkbox';
        input.checked = Boolean(checked);

        row.append(label, input);
        return row;
    }

    function createCustomAudioSettingsSection() {
        const section = document.createElement('div');
        section.style.marginTop = '20px';
        section.style.paddingTop = '15px';
        section.style.borderTop = '1px solid rgba(255, 255, 255, 0.15)';

        const title = document.createElement('h3');
        title.textContent = 'Custom Example Audio';
        title.style.margin = '0 0 10px 0';
        title.style.fontSize = '1rem';

        const description = document.createElement('p');
        description.textContent = 'Upload your own sentence audio and optionally sync favorite example selections. Files and sync state use the same Cloudflare Worker in front of R2.';
        description.style.margin = '0 0 10px 0';
        description.style.fontSize = '0.9rem';
        description.style.opacity = '0.8';

        section.appendChild(title);
        section.appendChild(description);
        section.appendChild(
            createCustomAudioInputRow(
                'Worker URL',
                'custom-audio-worker-url',
                customAudioSettings.workerUrl,
                'text',
                'https://your-worker.your-subdomain.workers.dev'
            )
        );
        section.appendChild(
            createCustomAudioInputRow(
                'Auth Token',
                'custom-audio-auth-token',
                customAudioSettings.authToken,
                'password',
                'Optional bearer token'
            )
        );
        section.appendChild(
            createCustomAudioInputRow(
                'Cache Max MB',
                'custom-audio-cache-max-mb',
                String(customAudioSettings.cacheMaxMB),
                'number'
            )
        );
        section.appendChild(
            createCustomAudioCheckboxRow(
                'Sync Favorites',
                'custom-audio-sync-favorites',
                customAudioSettings.syncFavorites
            )
        );

        const actions = document.createElement('div');
        actions.style.marginTop = '10px';
        actions.style.display = 'flex';
        actions.style.flexWrap = 'wrap';
        actions.style.gap = '10px';
        actions.style.justifyContent = 'center';

        const syncFavoritesButton = createButton('Sync Favorites Now', '0', async () => {
            await handleFavoritesSyncButtonClick('sync');
        }, '180px');

        const pullFavoritesButton = createButton('Pull Favorites', '0', async () => {
            await handleFavoritesSyncButtonClick('pull');
        }, '160px');

        const clearCacheButton = createButton('Clear Custom Audio Cache', '0', async () => {
            createConfirmationPopup(
                'This will clear the local custom-audio cache only. Continue?',
                async () => {
                    await CustomAudioCache.clear();
                    scheduleCustomAudioEnhancement();
                    alert('Local custom-audio cache cleared.');
                },
                () => {}
            );
        }, '250px');
        clearCacheButton.style.backgroundColor = '#C82800';
        clearCacheButton.style.color = 'white';

        actions.append(syncFavoritesButton, pullFavoritesButton, clearCacheButton);
        section.appendChild(actions);

        return section;
    }

    async function saveCustomAudioSettingsFromOverlay(overlay) {
        const workerUrl = overlay.querySelector('#custom-audio-worker-url')?.value || '';
        const authToken = overlay.querySelector('#custom-audio-auth-token')?.value || '';
        const cacheMaxMB = overlay.querySelector('#custom-audio-cache-max-mb')?.value || String(CUSTOM_AUDIO_DEFAULTS.cacheMaxMB);
        const syncFavorites = Boolean(overlay.querySelector('#custom-audio-sync-favorites')?.checked);

        await saveCustomAudioSettings({
            workerUrl,
            authToken,
            cacheMaxMB,
            syncFavorites
        });
    }

    //MAIN FUNCTIONS=====================================================================================================================
    function onPageLoad() {
        if (!configStorageReady) {
            ensureConfigLoaded()
                .then(() => onPageLoad())
                .catch(error => {
                    console.error('Failed to initialize settings before page load:', error);
                    onPageLoad();
                });
            return;
        }

        // Initialize state and determine vocabulary based on URL
        state.embedAboveSubsectionMeanings = false;
        scheduleCustomAudioEnhancement();
        updateDictationModeClass();
        scheduleDictationMasking();

        const url = window.location.href;
        const machineTranslationFrame = document.getElementById('machine-translation-frame');

        // Proceed only if the machine translation frame is not present
        if (!machineTranslationFrame) {

            //display embed for first time with loading text
            embedImageAndPlayAudio();
            setPageWidth();

            if (url.includes('/vocabulary/')) {
                state.vocab = parseVocabFromVocabulary();
            } else if (url.includes('/search?q=')) {
                state.vocab = parseVocabFromSearch();
            } else if (url.includes('c=')) {
                state.vocab = parseVocabFromAnswer();
            } else if (url.includes('/kanji/')) {
                state.vocab = parseVocabFromKanji();
            } else if (url.includes('/review') && !url.endsWith('/review#a')) {
                state.vocab = parseVocabFromReview();
            }
        } else {
            console.log('Machine translation frame detected, skipping vocabulary parsing.');
        }

        // Retrieve stored data for the current vocabulary
        const { index, exactState } = getStoredData(state.vocab);
        state.currentExampleIndex = index;
        state.exactSearch = exactState;

        // Fetch data and embed image/audio if necessary
        if (state.vocab && !state.apiDataFetched) {
            getImmersionKitData(state.vocab, state.exactSearch)
                .then(() => {
                preloadImages();
                embedImageAndPlayAudio();
                scheduleCustomAudioEnhancement();
                scheduleDictationMasking();
            })
                .catch(console.error);
        } else if (state.apiDataFetched) {
            embedImageAndPlayAudio();
            //preloadImages();
            setVocabSize();
            setPageWidth();
            scheduleCustomAudioEnhancement();
            scheduleDictationMasking();
        }
    }

    function setPageWidth() {
        // Set the maximum width of the page
        document.body.style.maxWidth = CONFIG.PAGE_WIDTH;
    }

    // Observe URL changes and reload the page content accordingly
    const observer = new MutationObserver(() => {
        if (window.location.href !== observer.lastUrl) {
            observer.lastUrl = window.location.href;
            onPageLoad();
        }
    });

    const customAudioObserver = new MutationObserver(() => {
        scheduleCustomAudioEnhancement();
        updateDictationModeClass();
        scheduleDictationMasking();
    });

    // Function to apply styles
    function setVocabSize() {
        // Create a new style element
        const style = document.createElement('style');
        style.type = 'text/css';
        style.innerHTML = `
            .answer-box > .plain {
                font-size: ${CONFIG.VOCAB_SIZE} !important; /* Use the configurable font size */
                padding-bottom: 0.1rem !important; /* Retain padding */
            }
        `;

        // Append the new style to the document head
        document.head.appendChild(style);
    }
    observer.lastUrl = window.location.href;
    observer.observe(document, { subtree: true, childList: true });
    customAudioObserver.observe(document, { subtree: true, childList: true });

    // Add event listeners for page load and URL changes
    window.addEventListener('load', onPageLoad);
    window.addEventListener('popstate', onPageLoad);
    window.addEventListener('hashchange', onPageLoad);
    window.addEventListener('resize', scheduleDictationParticleLayerRefresh);
    window.addEventListener('scroll', scheduleDictationParticleLayerRefresh, true);

    // Initial configuration and preloading
    loadConfig();
    registerExtensionStorageListener();
    ensureConfigLoaded()
        .then(() => {
            setPageWidth();
            setVocabSize();
            updateDictationModeClass();
            scheduleDictationMasking();
        })
        .catch(error => {
            console.error('Failed to initialize extension settings:', error);
        });
    injectDictationStyles();
    updateDictationModeClass();
    ensureCustomAudioSettingsLoaded()
        .then(() => {
            if (customAudioSettings.syncFavorites && customAudioSettings.workerUrl) {
                return runFavoritesSync('sync', { silent: true });
            }
        })
        .catch(error => {
            console.error('Failed to initialize Cloudflare settings or favorites sync:', error);
        });
    setPageWidth();
    setVocabSize();
    scheduleCustomAudioEnhancement();
    scheduleDictationMasking();
    //preloadImages();

})();
