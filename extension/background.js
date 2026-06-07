const FETCH_MESSAGE = 'JPDB_IK_FETCH';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== FETCH_MESSAGE) {
        return false;
    }

    handleFetchRequest(message.request)
        .then(sendResponse)
        .catch(error => {
            sendResponse({
                transportOk: false,
                error: error instanceof Error ? error.message : String(error)
            });
        });

    return true;
});

async function handleFetchRequest(request) {
    const response = await fetch(request.url, {
        method: request.method || 'GET',
        headers: request.headers || {},
        body: request.body ?? undefined,
        credentials: 'omit'
    });

    const headers = Object.fromEntries(response.headers.entries());
    if (request.responseType === 'arraybuffer' || request.responseType === 'blob') {
        const buffer = await response.arrayBuffer();
        return {
            transportOk: true,
            status: response.status,
            statusText: response.statusText,
            headers,
            contentType: response.headers.get('content-type') || 'application/octet-stream',
            bodyBase64: arrayBufferToBase64(buffer)
        };
    }

    return {
        transportOk: true,
        status: response.status,
        statusText: response.statusText,
        headers,
        responseText: await response.text()
    };
}

function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let binary = '';

    for (let index = 0; index < bytes.length; index += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }

    return btoa(binary);
}
