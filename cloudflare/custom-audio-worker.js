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
        const match = url.pathname.match(/^\/audio\/([a-f0-9]{64})$/);
        if (!match) {
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

        const objectKey = `audio/${match[1]}`;

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
                new Response(JSON.stringify({ ok: true, key: match[1] }), {
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
