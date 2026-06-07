// ==UserScript==
// @name         JPDB Immersion Kit Examples Export
// @version      1.0.0
// @description  Exports JPDB Immersion Kit Examples localStorage and IndexedDB data into a single backup file.
// @author       haoqunjiang
// @namespace    jpdb-immersion-kit-examples
// @match        https://jpdb.io/review*
// @match        https://jpdb.io/vocabulary/*
// @match        https://jpdb.io/kanji/*
// @match        https://jpdb.io/search*
// @grant        none
// @license      MIT
// ==/UserScript==

(function() {
    'use strict';

    if (window.__jpdbImmersionKitExamplesExportScriptLoaded) {
        return;
    }
    window.__jpdbImmersionKitExamplesExportScriptLoaded = true;

    const backupSchemaVersion = 1;
    const scriptPrefix = 'JPDBImmersionKitExamples-';
    const configPrefix = 'CONFIG.';
    const configMigrationFlag = 'JPDBImmersionKit*Examples-CONFIG_VARIABLES_PREFIXED';
    const dbName = 'ImmersionKitDB';
    const dataStoreName = 'dataStore';
    const metaStoreName = 'metaStore';

    function isKnownScriptStorageKey(key) {
        return key === configMigrationFlag
            || key.startsWith(scriptPrefix)
            || key.startsWith(configPrefix);
    }

    function isLegacySelectionValue(value) {
        return typeof value === 'string' && /^\d+,[012]$/.test(value);
    }

    function collectBackupLocalStorage() {
        const localStorageEntries = {};
        const legacySelectionCandidates = {};

        for (let index = 0; index < localStorage.length; index++) {
            const key = localStorage.key(index);
            const value = localStorage.getItem(key);

            if (isKnownScriptStorageKey(key)) {
                localStorageEntries[key] = value;
            } else if (isLegacySelectionValue(value)) {
                legacySelectionCandidates[key] = value;
            }
        }

        return { localStorageEntries, legacySelectionCandidates };
    }

    function openDatabase() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(dbName);

            request.onupgradeneeded = event => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(dataStoreName)) {
                    db.createObjectStore(dataStoreName, { keyPath: 'keyword' });
                }
                if (!db.objectStoreNames.contains(metaStoreName)) {
                    db.createObjectStore(metaStoreName, { keyPath: 'key' });
                }
            };

            request.onsuccess = event => resolve(event.target.result);
            request.onerror = event => reject(new Error(`IndexedDB error: ${event.target.errorCode}`));
        });
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
            request.onerror = event => reject(new Error(`Cursor error: ${event.target.errorCode}`));
        });
    }

    async function readIndexedDBBackup() {
        const db = await openDatabase();
        try {
            const dataStore = db.transaction([dataStoreName], 'readonly').objectStore(dataStoreName);
            const dataStoreRecords = await readAllObjectStoreRecords(dataStore);

            const metaStoreRecords = db.objectStoreNames.contains(metaStoreName)
                ? await readAllObjectStoreRecords(
                    db.transaction([metaStoreName], 'readonly').objectStore(metaStoreName)
                )
                : [];

            return {
                name: dbName,
                version: db.version,
                dataStoreName,
                metaStoreName,
                dataStore: dataStoreRecords,
                metaStore: metaStoreRecords
            };
        } finally {
            db.close();
        }
    }

    async function buildBackupPayload() {
        const { localStorageEntries, legacySelectionCandidates } = collectBackupLocalStorage();

        return {
            schemaVersion: backupSchemaVersion,
            source: 'jpdb-immersion-kit-export-userscript',
            exportedAt: new Date().toISOString(),
            localStorage: localStorageEntries,
            legacySelectionCandidates,
            indexedDB: await readIndexedDBBackup()
        };
    }

    function createBlobAndDownload(data, filename, type) {
        const blob = new Blob([data], { type });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        URL.revokeObjectURL(url);
    }

    function buildBackupFilename() {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        return `jpdb-immersion-kit-backup-${timestamp}.json`;
    }

    function ensureExportButton() {
        if (document.getElementById('jpdb-ik-export-button')) {
            return;
        }

        const button = document.createElement('button');
        button.id = 'jpdb-ik-export-button';
        button.textContent = 'Export JPDB IK Backup';
        button.style.position = 'fixed';
        button.style.right = '16px';
        button.style.bottom = '16px';
        button.style.zIndex = '2147483647';
        button.style.padding = '12px 16px';
        button.style.border = '1px solid #4a5568';
        button.style.borderRadius = '10px';
        button.style.background = '#111827';
        button.style.color = '#f9fafb';
        button.style.fontSize = '14px';
        button.style.cursor = 'pointer';
        button.style.boxShadow = '0 6px 18px rgba(0, 0, 0, 0.3)';

        button.addEventListener('click', async () => {
            button.disabled = true;
            const originalText = button.textContent;
            button.textContent = 'Exporting...';

            try {
                const backup = await buildBackupPayload();
                createBlobAndDownload(
                    JSON.stringify(backup, null, 2),
                    buildBackupFilename(),
                    'application/json'
                );
                button.textContent = 'Backup Downloaded';
            } catch (error) {
                console.error('Error exporting backup:', error);
                button.textContent = 'Export Failed';
                alert(`Error exporting backup: ${error instanceof Error ? error.message : error}`);
            } finally {
                setTimeout(() => {
                    button.disabled = false;
                    button.textContent = originalText;
                }, 1500);
            }
        });

        document.body.appendChild(button);
    }

    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', ensureExportButton, { once: true });
    } else {
        ensureExportButton();
    }
})();
