# Core-Track branding

| File | Use |
| --- | --- |
| `logo-source-500.png` | Original logo artwork (500×500, transparent rounded corners, full bleed). Source for in-app logos. |
| `app-icon-1024.png` | App-icon master: the logo scaled to 824×824 and centred on a transparent 1024×1024 canvas, following Apple's macOS icon grid so it matches other Dock icons. |

Regenerate the desktop app icons (macOS `.icns`, Windows `.ico`, PNGs) after changing the master:

```bash
cd desktop
npx tauri icon ../branding/app-icon-1024.png
rm -rf src-tauri/icons/android src-tauri/icons/ios   # Tauri-mobile icons, not used
```

In-app copies: `desktop/src/assets/logo.png` (sidebar, 128 px) and `desktop/public/favicon.png` (64 px), both from the unpadded source.

A higher-resolution (1024 px or vector) source would give sharper large icons; the current master is upscaled from 500 px.
