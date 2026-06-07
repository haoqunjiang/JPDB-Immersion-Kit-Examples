# JPDB Immersion Kit Examples

## Fork Notes

This fork differs significantly from the upstream [AwooDesu/JPDB-Immersion-Kit-Examples](https://github.com/AwooDesu/JPDB-Immersion-Kit-Examples) project. The upstream project is still the original userscript; this fork keeps that script and adds:

- An unpacked Chrome extension build in [extension](extension/).
- A migration/export userscript in [userscripts](userscripts/) for backing up userscript data.
- Custom jpdb sentence-audio upload/playback for examples without built-in audio.
- Optional Cloudflare Worker + R2 storage for custom audio, with local IndexedDB caching.
- Keyboard shortcut support for playing the current jpdb answer-box sentence audio.

A userscript for **jpdb.io** that embeds anime examples from **ImmersionKit** directly into the site.  

## Features  

- **Anime example images** displayed alongside vocab.  
- **Audio support** with autoplay and manual controls.  
- **Navigation arrows** to cycle through examples.  
- **Favorites system** to select preferred examples.  
- **Configurable settings** for appearance and behavior.  
- **Blacklist feature** to block unwanted examples.  

## Controls  

| Icon | Function |
|------|----------|
| 🔊 **Speaker** | Play example audio. |
| ⭐ **Star** | Mark as favorite (★ = favorite, ☆ = non-favorite). |
| 「」 **Exact Search** | Toggle exact search (「」 = enabled, 『』 = disabled). |
| ◀ **Left Arrow** | Go back one example. |
| ▶ **Right Arrow** | Go forward one example. |
| ☰ **Menu Button** | Open the settings menu. |

## Config Options  

The settings menu (**☰**) allows customization of the script's behavior:  

- **Image Width** – Adjust image size.  
- **Wide Mode** – Place image next to or above meanings.  
- **Definitions on Right in Wide Mode** – Place image left and definitions right.  
- **Arrow Width/Height** – Resize navigation arrows.  
- **Page Width** – Adjust overall layout width.  
- **Sound Volume** – Control audio playback volume.  
- **Enable Example Translation** – Show/hide English translation.  
- **Sentence Font Size** – Resize Japanese text.  
- **Translation Font Size** – Resize English translation.  
- **Colored Sentence Text** – Highlight vocab in the sentence.  
- **Auto Play Sound** – Automatically play audio when changing examples.  
- **Number of Preloads** – Set how many examples load in the background.  
- **Vocab Size** – Adjust vocab text size in reviews.  
- **Default to Exact Search** – Enables exact search option by default.
- **Hotkeys** – Buttons to go to next/previous example. Can easily add any key by editing line #27
- **Minimum Example Length** – Set a lower limit for sentence length.  
  - **⚠ Warning:** Changing this **will delete all current favorites.**  
- **Blacklist** – Prevent specific examples from appearing.  

## How It Works  

The script searches **ImmersionKit** for examples based on the current vocabulary and embeds them into **jpdb.io**. Audio can be played manually or automatically.  

## Chrome Extension  

This repo now also includes an unpacked Chrome extension build in [extension](extension/) plus an export-only migration userscript in [userscripts/JPDB Immersion Kit Examples Export.user.js](userscripts/JPDB%20Immersion%20Kit%20Examples%20Export.user.js).

Migration flow:

1. Load [extension/manifest.json](extension/manifest.json) as an unpacked extension in Chrome.
2. Disable the original userscript so it does not run at the same time as the extension.
3. If you want a portable backup, install the export userscript in Violentmonkey, download the backup JSON, then use `Import Backup` from the extension's in-page settings menu on `jpdb.io`.

The extension also supports uploading custom sentence audio for jpdb examples that are missing built-in audio. The recommended remote backend is Cloudflare Worker + R2; setup files are in [cloudflare](cloudflare/).

### **Audio Playback Note**  
If autoplay doesn't work, check your browser's site settings (click the lock icon next to the URL) and allow automatic audio playback.  

## Favorite System  

Favorites allow you to pick a default example for a word. Next time the word appears, your chosen example will be used.  

## Links  

- 📜 **GitHub Repository:** [https://github.com/AwooDesu/JPDB-Immersion-Kit-Examples](https://github.com/AwooDesu/JPDB-Immersion-Kit-Examples)  
- 📥 **Download at Greasyfork:** [https://greasyfork.org/en/scripts/507408-jpdb-immersion-kit-examples](https://greasyfork.org/en/scripts/507408-jpdb-immersion-kit-examples)  
- 🛠 **JPDB Website:** [https://jpdb.io](https://jpdb.io)  
- 🎞 **ImmersionKit:** [https://immersionkit.com](https://immersionkit.com)  

## Similar Projects  
 
- **JPDB Media Support:** [https://github.com/felix-ops/JPDB-Media-Support](https://github.com/felix-ops/JPDB-Media-Support)  
- **Standalone Chrome Variant:** [https://chromewebstore.google.com/detail/jpdb-immersion-kit-exampl/knedmjcggobmokkephmaggbgakjjckbf](https://chromewebstore.google.com/detail/jpdb-immersion-kit-exampl/knedmjcggobmokkephmaggbgakjjckbf) 

## Contributing  

Contributions are welcome! If you encounter bugs, have feature suggestions, or want to improve the script, feel free to open an issue or submit a pull request on **GitHub**.  

## License  

This project is licensed under the **MIT License**.  
