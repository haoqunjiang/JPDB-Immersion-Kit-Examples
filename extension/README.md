# Chrome Extension

Load [manifest.json](manifest.json) as an unpacked extension in Chrome:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click `Load unpacked`.
4. Select this `extension` directory.

Migration flow:

1. Disable the original userscript so it does not run alongside the extension.
2. If you want a backup file first, install [JPDB Immersion Kit Examples Export.user.js](../userscripts/JPDB%20Immersion%20Kit%20Examples%20Export.user.js) in Violentmonkey and download the JSON backup.
3. Open any supported `jpdb.io` page, open the extension's in-page settings menu, and use `Import Backup`.

## Custom Example Audio

The extension can now add upload and playback controls for jpdb example sentences that do not have built-in sentence audio.

- Local cache: browser IndexedDB on `jpdb.io`
- Remote store: optional Cloudflare Worker + R2
- Cache behavior: local first, remote on miss

Cloudflare setup files live in [cloudflare](../cloudflare/). Start with [cloudflare/README.md](../cloudflare/README.md).

## Dictation Mode

Enable `Dictation Mode` in the in-page settings menu to mask the review word and its highlighted occurrences while reviewing. Click the masked sentence or press `d` to reveal it for the current card.

## Sentence-Only Examples

Disable `Show Example Images` in the in-page settings menu to hide Immersion Kit pictures while keeping the sentence, translation, audio, and navigation controls.
