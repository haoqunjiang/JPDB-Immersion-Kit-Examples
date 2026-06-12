# Browser Extension

Load [manifest.json](manifest.json) as an unpacked extension in Chrome:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click `Load unpacked`.
4. Select this `extension` directory.

Migration flow:

1. Disable the original userscript so it does not run alongside the extension.
2. If you want a backup file first, install [JPDB Immersion Kit Examples Export.user.js](../userscripts/JPDB%20Immersion%20Kit%20Examples%20Export.user.js) in Violentmonkey and download the JSON backup.
3. Open any supported `jpdb.io` page, open the extension's in-page settings menu, and use `Import Backup`.

## Options Page

The extension now includes [options.html](options.html) for extension settings. Chrome still supports the in-page menu on `jpdb.io`; on iPhone and iPad the `☰` button opens the extension options page instead so the settings fit the mobile screen.

Existing in-page settings are migrated from `jpdb.io` local storage into extension storage the first time the updated extension runs.

## iOS Safari

This directory is Safari Web Extension source. To package it for iPhone Safari, run Apple's Safari Web Extension converter on a Mac with full Xcode installed:

```sh
xcrun safari-web-extension-converter extension \
  --project-location safari \
  --app-name "JPDB Immersion Kit Examples" \
  --bundle-identifier "com.example.jpdb-immersion-kit-examples"
```

Then open the generated Xcode project, select an iOS-capable signing team and bundle identifier, build/run the containing app on the iPhone, and enable the extension in iOS Settings > Safari > Extensions.

This workspace does not currently have `safari-web-extension-converter` installed, so the Xcode wrapper was not generated here.

## Custom Example Audio

The extension can now add upload and playback controls for jpdb example sentences that do not have built-in sentence audio.

- Local cache: browser IndexedDB on `jpdb.io`
- Remote store: optional Cloudflare Worker + R2
- Cache behavior: local first, remote on miss
- Favorite sync: optional, using the same Worker URL and auth token

Cloudflare setup files live in [cloudflare](../cloudflare/). Start with [cloudflare/README.md](../cloudflare/README.md).

## Favorite Sync

Enable `Sync Favorites` in the options page or in-page settings menu after configuring the Worker URL and auth token. The extension syncs selected Immersion Kit examples and blacklist entries across devices with timestamp-based merging.

## Dictation Mode

Enable `Dictation Mode` in the options page or in-page settings menu to mask the review word and its highlighted occurrences while reviewing. Click the masked sentence or press `d` to reveal it for the current card.

## Sentence-Only Examples

Disable `Show Example Images` in the options page or in-page settings menu to hide Immersion Kit pictures while keeping the sentence, translation, audio, and navigation controls.
