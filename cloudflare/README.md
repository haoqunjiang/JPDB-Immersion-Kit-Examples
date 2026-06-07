# Cloudflare Setup

Recommended stack: **Cloudflare R2 + Cloudflare Workers**.

Why this pair:

- `R2` is the object store for the MP3 files.
- `Workers` gives you a small authenticated API for `GET` and `PUT`, plus CORS for the browser extension.
- The extension keeps a local IndexedDB cache, so it only hits Cloudflare on upload and on cache miss.

Files:

- Worker template: [custom-audio-worker.js](custom-audio-worker.js)
- Wrangler example: [wrangler.toml.example](wrangler.toml.example)

## Deploy

1. Create an R2 bucket, for example `jpdb-custom-audio`.
2. Copy [wrangler.toml.example](wrangler.toml.example) to `wrangler.toml`.
3. Set the bucket name in `wrangler.toml`.
4. Set a bearer token secret:

```bash
wrangler secret put CUSTOM_AUDIO_TOKEN
```

5. Deploy:

```bash
wrangler deploy
```

## Configure The Extension

Open the extension menu on `jpdb.io` and fill in:

- `Worker URL`: your deployed Worker URL, for example `https://jpdb-custom-audio.your-subdomain.workers.dev`
- `Auth Token`: the same token you stored as `CUSTOM_AUDIO_TOKEN`
- `Cache Max MB`: local cache size for uploaded or downloaded custom audio

## API Contract

- `PUT /audio/<sha256-key>` uploads or replaces an MP3 object.
- `GET /audio/<sha256-key>` fetches the MP3 object.
- `OPTIONS /audio/<sha256-key>` handles CORS preflight.

The extension computes the `<sha256-key>` from the current headword plus the sentence text, so the same sentence resolves to the same remote object.
