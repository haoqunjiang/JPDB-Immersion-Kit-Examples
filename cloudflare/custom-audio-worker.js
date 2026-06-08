export default {
    async fetch(request, env) {
        const origin = request.headers.get('Origin') || env.ALLOWED_ORIGIN || 'https://jpdb.io';

        if (request.method === 'OPTIONS') {
            return new Response(null, {
                status: 204,
                headers: buildCorsHeaders(origin)
            });
        }

        const url = new URL(request.url);
        const audioMatch = url.pathname.match(/^\/audio\/([a-f0-9]{64})$/);
        const isFavoritesRequest = url.pathname === '/favorites';

        if (!audioMatch && !isFavoritesRequest) {
            return withCors(
                new Response('Not found', { status: 404 }),
                origin
            );
        }

        if (!isAuthorized(request, env)) {
            return withCors(
                new Response('Unauthorized', { status: 401 }),
                origin
            );
        }

        if (isFavoritesRequest) {
            return handleFavoritesRequest(request, env, origin);
        }

        const objectKey = `audio/${audioMatch[1]}`;

        if (request.method === 'GET') {
            const object = await env.CUSTOM_AUDIO_BUCKET.get(objectKey);
            if (!object) {
                return withCors(
                    new Response('Not found', { status: 404 }),
                    origin
                );
            }

            const headers = buildCorsHeaders(origin);
            headers.set('Content-Type', object.httpMetadata?.contentType || 'audio/mpeg');
            headers.set('Cache-Control', 'public, max-age=31536000, immutable');
            headers.set('ETag', object.httpEtag);

            return new Response(object.body, {
                status: 200,
                headers
            });
        }

        if (request.method === 'PUT') {
            const contentType = request.headers.get('Content-Type') || 'audio/mpeg';
            const headword = safeDecodeURIComponent(request.headers.get('X-JPDB-Headword'));
            const sentence = safeDecodeURIComponent(request.headers.get('X-JPDB-Sentence'));

            await env.CUSTOM_AUDIO_BUCKET.put(objectKey, request.body, {
                httpMetadata: {
                    contentType
                },
                customMetadata: {
                    headword,
                    sentence
                }
            });

            return withCors(
                new Response(JSON.stringify({ ok: true, key: audioMatch[1] }), {
                    status: 200,
                    headers: {
                        'Content-Type': 'application/json'
                    }
                }),
                origin
            );
        }

        return withCors(
            new Response('Method not allowed', { status: 405 }),
            origin
        );
    }
};

const FAVORITES_OBJECT_KEY = 'sync/favorites.json';
const FAVORITES_SCHEMA_VERSION = 1;
const FAVORITES_MAX_BYTES = 1024 * 1024;
const FAVORITES_WRITE_MAX_ATTEMPTS = 5;

async function handleFavoritesRequest(request, env, origin) {
    if (request.method === 'GET') {
        const document = await readFavoritesDocument(env);
        return withCors(jsonResponse(document), origin);
    }

    if (request.method === 'PUT') {
        const contentLength = Number(request.headers.get('Content-Length') || 0);
        if (contentLength > FAVORITES_MAX_BYTES) {
            return withCors(
                new Response('Request body too large', { status: 413 }),
                origin
            );
        }

        let incoming;
        try {
            incoming = JSON.parse(await readRequestTextWithLimit(request, FAVORITES_MAX_BYTES));
        } catch (error) {
            if (error instanceof RequestBodyTooLargeError) {
                return withCors(
                    new Response('Request body too large', { status: 413 }),
                    origin
                );
            }

            return withCors(
                new Response('Invalid JSON', { status: 400 }),
                origin
            );
        }

        let merged;
        try {
            merged = await mergeAndWriteFavoritesDocument(env, normalizeFavoritesDocument(incoming));
        } catch (error) {
            if (error instanceof FavoritesWriteConflictError) {
                return withCors(
                    new Response('Favorites document changed during sync; retry the request', { status: 409 }),
                    origin
                );
            }

            throw error;
        }

        return withCors(jsonResponse(merged), origin);
    }

    return withCors(
        new Response('Method not allowed', { status: 405 }),
        origin
    );
}

class RequestBodyTooLargeError extends Error {}
class FavoritesWriteConflictError extends Error {}

async function readRequestTextWithLimit(request, maxBytes) {
    if (!request.body) return '';

    const reader = request.body.getReader();
    const decoder = new TextDecoder();
    let bytesRead = 0;
    let text = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        bytesRead += value.byteLength;
        if (bytesRead > maxBytes) {
            await reader.cancel();
            throw new RequestBodyTooLargeError();
        }

        text += decoder.decode(value, { stream: true });
    }

    text += decoder.decode();
    return text;
}

async function readFavoritesDocument(env) {
    const snapshot = await readFavoritesSnapshot(env);
    return snapshot.document;
}

async function readFavoritesSnapshot(env) {
    const object = await env.CUSTOM_AUDIO_BUCKET.get(FAVORITES_OBJECT_KEY);
    if (!object) {
        return {
            document: createEmptyFavoritesDocument(),
            etag: null
        };
    }

    try {
        return {
            document: normalizeFavoritesDocument(JSON.parse(await object.text())),
            etag: object.etag
        };
    } catch {
        return {
            document: createEmptyFavoritesDocument(),
            etag: object.etag
        };
    }
}

async function mergeAndWriteFavoritesDocument(env, incomingDocument) {
    for (let attempt = 0; attempt < FAVORITES_WRITE_MAX_ATTEMPTS; attempt++) {
        const snapshot = await readFavoritesSnapshot(env);
        const merged = mergeFavoritesDocuments(snapshot.document, incomingDocument);
        const putResult = await env.CUSTOM_AUDIO_BUCKET.put(
            FAVORITES_OBJECT_KEY,
            JSON.stringify(merged),
            {
                httpMetadata: {
                    contentType: 'application/json'
                },
                onlyIf: buildFavoritesWriteCondition(snapshot)
            }
        );

        if (putResult) {
            return merged;
        }
    }

    throw new FavoritesWriteConflictError();
}

function buildFavoritesWriteCondition(snapshot) {
    if (snapshot.etag) {
        return {
            etagMatches: snapshot.etag
        };
    }

    return new Headers({
        'If-None-Match': '*'
    });
}

function createEmptyFavoritesDocument() {
    return {
        schemaVersion: FAVORITES_SCHEMA_VERSION,
        updatedAt: 0,
        entries: {},
        deleted: {}
    };
}

function normalizeFavoritesTimestamp(value) {
    const timestamp = Number(value);
    return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0;
}

function isFavoritesKey(key) {
    return typeof key === 'string' && key.length > 0 && !key.startsWith('CONFIG.');
}

function normalizeFavoritesDocument(value) {
    const document = createEmptyFavoritesDocument();

    Object.entries(value?.entries || {}).forEach(([key, record]) => {
        if (!isFavoritesKey(key) || record?.value === undefined || record?.value === null) return;

        const updatedAt = normalizeFavoritesTimestamp(record.updatedAt);
        if (!updatedAt) return;

        document.entries[key] = {
            value: String(record.value),
            updatedAt
        };
        document.updatedAt = Math.max(document.updatedAt, updatedAt);
    });

    Object.entries(value?.deleted || {}).forEach(([key, record]) => {
        if (!isFavoritesKey(key)) return;

        const updatedAt = normalizeFavoritesTimestamp(record?.updatedAt);
        if (!updatedAt) return;

        document.deleted[key] = { updatedAt };
        document.updatedAt = Math.max(document.updatedAt, updatedAt);
    });

    return document;
}

function mergeFavoritesDocuments(...documents) {
    const normalizedDocuments = documents.map(normalizeFavoritesDocument);
    const keys = new Set();

    normalizedDocuments.forEach(document => {
        Object.keys(document.entries).forEach(key => keys.add(key));
        Object.keys(document.deleted).forEach(key => keys.add(key));
    });

    const merged = createEmptyFavoritesDocument();

    keys.forEach(key => {
        let newestEntry = null;
        let newestDeleted = null;

        normalizedDocuments.forEach(document => {
            const entry = document.entries[key];
            if (entry && (!newestEntry || entry.updatedAt > newestEntry.updatedAt)) {
                newestEntry = entry;
            }

            const deleted = document.deleted[key];
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

function jsonResponse(value) {
    return new Response(JSON.stringify(value), {
        status: 200,
        headers: {
            'Content-Type': 'application/json'
        }
    });
}

function isAuthorized(request, env) {
    if (!env.CUSTOM_AUDIO_TOKEN) {
        return true;
    }

    return request.headers.get('Authorization') === `Bearer ${env.CUSTOM_AUDIO_TOKEN}`;
}

function buildCorsHeaders(origin) {
    return new Headers({
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-JPDB-Headword, X-JPDB-Sentence',
        'Access-Control-Max-Age': '86400',
        'Vary': 'Origin'
    });
}

function withCors(response, origin) {
    const headers = new Headers(response.headers);
    const corsHeaders = buildCorsHeaders(origin);
    corsHeaders.forEach((value, key) => headers.set(key, value));

    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
    });
}

function safeDecodeURIComponent(value) {
    if (!value) return '';

    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}
