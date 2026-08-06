# Magnet to qBittorrent

Browser extension that intercepts `magnet:` clicks and sends them straight to your qBittorrent Web UI, with category, tags, and paused state. Pick a category per click, or set a default and let the extension handle it. The popup shows the live queue, adds are confirmed with a small in-page toast, and optional system notifications report errors and completed downloads. Optional shortcut buttons jump straight to your other apps — Plex, Jellyfin, a NAS, a dashboard. Works in Chrome (Manifest V3) and Firefox (Manifest V2).

## Install, dev — Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and pick this folder.
4. Open the extension options and point it at your qBittorrent Web UI.

## Install, dev — Firefox

Firefox uses a separate MV2 manifest:

```bash
cp manifest.firefox.json manifest.json
```

Then `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** → pick `manifest.json`. Restore the Chrome manifest when you go back.

## Configure

In the options page:

1. Web UI URL (e.g. `http://localhost:8080`, `http://192.168.1.20:8080`, or a remote `https://…`).
2. Username and password.
3. **Test connection**.
4. **Load categories**, pick a default.
5. Save.

Download completion checks run once a minute. Error and completion notifications are controlled separately in **Behavior**.

### Shortcuts

Optional. In **Shortcuts** you can add up to 6 addresses you want to reach straight from the popup — Plex, Jellyfin, a NAS file browser, a dashboard, anything on `http://` or `https://`. Each one gets a button in the popup footer, and each row has a switch so you can hide one without deleting it. The name is optional and falls back to the host name.

Clicking a "download complete" notification opens the **first** shortcut in the list, so put the app you usually go to at the top.

## Tests

```bash
npm test
```

## qBittorrent settings that matter

If the test or add fails with 401 / 403:

- Confirm the Web UI is reachable from this browser.
- Confirm username and password.
- In qBittorrent's Web UI settings, check **CSRF protection** and **Host header validation**.
- Make sure the qBittorrent port is open on the network you're on.

## Security

Credentials live in the browser profile's extension storage. Fine for a personal tool, not a password manager.

## License

MIT — see [LICENSE](LICENSE).
