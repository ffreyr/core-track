# Running Core-Track without a terminal (macOS)

Two pieces:

1. **Backend** — a per-user LaunchAgent (`com.coretrack.backend.plist`) starts
   the FastAPI server at login and keeps it running in the background, even
   when the desktop app is closed. The iPhone app/widget will talk to it.
2. **Desktop app** — a production `Core-Track.app` you keep in `/Applications`.

---

## 1. Backend LaunchAgent

### Install and start (one time)

Stop any backend you started by hand first (press `Ctrl+C` in that terminal),
otherwise port 8000 is taken and the agent cannot start.

```bash
cp /Users/ardakaya/Documents/core-track/deploy/macos/com.coretrack.backend.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.coretrack.backend.plist
```

It starts immediately and again at every login.

### Check it is running

```bash
launchctl print gui/$(id -u)/com.coretrack.backend | grep -E "state|pid"
curl http://localhost:8000/api/health
```

Logs: `~/Library/Logs/core-track-backend.log` (or open **Console.app** →
Log Reports).

### Restart after changing backend code

```bash
launchctl kickstart -k gui/$(id -u)/com.coretrack.backend
```

Database migrations run automatically on that restart (with a backup in
`backend/data/backups/`).

### Stop / uninstall

```bash
launchctl bootout gui/$(id -u)/com.coretrack.backend
rm ~/Library/LaunchAgents/com.coretrack.backend.plist
```

### If the log says "Operation not permitted"

The project lives in `~/Documents`, which macOS protects. A background job
started by launchd may be denied access (or macOS shows a one-time
"Python would like to access files in your Documents folder" prompt — click
**Allow**). If it was denied:

1. **System Settings → Privacy & Security → Full Disk Access** → **+**
2. Press `⌘⇧G` and enter
   `/opt/homebrew/Cellar/python@3.14/3.14.7/Frameworks/Python.framework/Versions/3.14/Resources/Python.app`
3. Enable it, then restart the agent with the `kickstart` command above.

(Alternative: move the project out of `~/Documents`, e.g. to
`~/Developer/core-track`, and update the paths in the plist.)

---

## 2. Desktop app

### Build

```bash
cd /Users/ardakaya/Documents/core-track/desktop && npm run tauri build -- --bundles app
```

`--bundles app` builds only the `.app` (skips the `.dmg`, which is not
needed for personal use and opens Finder windows while it is created).

### Install

The app is created at:

```
/Users/ardakaya/Documents/core-track/desktop/src-tauri/target/release/bundle/macos/Core-Track.app
```

Drag it to **Applications** (or run the command below), then open it from
Launchpad/Spotlight. To start it at login: **System Settings → General →
Login Items → +** → Core-Track.

```bash
cp -R /Users/ardakaya/Documents/core-track/desktop/src-tauri/target/release/bundle/macos/Core-Track.app /Applications/
```

Closing the window keeps Core-Track in the menu bar; use the menu-bar icon →
**Quit Core-Track** to quit. Rebuild and copy again after code changes.
