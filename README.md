# Magnet to qBittorrent

Browser extension that intercepts `magnet:` clicks and sends them straight to your qBittorrent Web UI, with category, tags, and paused state. Pick a category per click, or set a default and let the extension handle it. The popup shows the live queue, adds are confirmed with a small in-page toast, and optional system notifications report errors and completed downloads. Optional shortcut buttons jump straight to your other apps — Plex, Jellyfin, a NAS, a dashboard. Works in Chrome (Manifest V3) and Firefox (Manifest V2).

- **Click a magnet link** to open the picker: choose a category with `1`–`3`, toggle **Add paused** with `P`, confirm with `↵`. Magnet links inside iframes work too.
- **Right-click any link → Send to qBittorrent** to pick a category from a submenu. This also works for `.torrent` links: the extension downloads the file with your browser session (so tracker logins work) and uploads it. If that download fails, qBittorrent gets the URL instead.
- **Popup** (`Alt+Shift+M`): paste a magnet, pick a category, see the queue with progress, speed, time left and size. Click a torrent to open the Web UI.
- **Toolbar badge** shows the number of active downloads, or `!` when qBittorrent can't be reached.
- A magnet that is already in qBittorrent is not sent again; the toast says which category it is in.

## Install, dev — Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and pick this folder (or `dist/chrome` after `npm run build`).
4. Open the extension options and point it at your qBittorrent Web UI.

## Install, dev — Firefox

Firefox uses a separate MV2 manifest. Build both variants:

```bash
npm run build
```

Then `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** → pick `dist/firefox/manifest.json`.

## Configure

In the options page:

1. Web UI URL (e.g. `http://localhost:8080`, `http://192.168.1.20:8080`, or a remote `https://…`).
2. Optional **Fallback URL**, such as `http://192.168.1.20:8080`, for the same server when DNS fails.
3. Username and password.
4. **Test connection**. Categories load automatically once the connection works.
5. Pick a default category.
6. Save.

Both addresses are checked in parallel. The first successful response selects the address, and the slower request is cancelled. Each request has a 5-second timeout, including its response body. Before adding a torrent, the extension checks the API on both addresses and sends the add only to the winner. A lost add response is not retried automatically because the torrent may already be added. Connection status and **Open Web UI** use the last successful address. An HTTPS fallback must have a certificate valid for its address.

Download completion checks and the toolbar badge update once a minute, and right after an add. Error notifications, completion notifications and the badge are controlled separately in **Behavior**. The popup shortcut can be changed in `chrome://extensions/shortcuts` or Firefox's **Manage Extension Shortcuts**.

### Shortcuts

Optional. In **Shortcuts** you can add up to 6 addresses you want to reach straight from the popup — Plex, Jellyfin, a NAS file browser, a dashboard, anything on `http://` or `https://`. Each one gets a button in the popup footer, and each row has a switch so you can hide one without deleting it. The name is optional and falls back to the host name.

Clicking a "download complete" notification opens the **first** shortcut in the list, so put the app you usually go to at the top.

## Tests

```bash
npm test
```

## qBittorrent settings that matter

Error messages name the usual causes: wrong credentials, an IP ban after too many failed logins, or a torrent that is already in the list. If the test or add still fails with 401 / 403:

- Confirm the Web UI is reachable from this browser.
- Confirm username and password.
- In qBittorrent's Web UI settings, check **CSRF protection** and **Host header validation**.
- Make sure the qBittorrent port is open on the network you're on.

## Security

Credentials live in the browser profile's extension storage. Fine for a personal tool, not a password manager.

## License

MIT — see [LICENSE](LICENSE).
