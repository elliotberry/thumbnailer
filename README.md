# Thumbnailer (Tauri + React, JavaScript)

Desktop app that:

- opens with an optional folder argument, or lets you pick a folder in the UI
- scans that folder for image files
- creates thumbnails in Rust
- caches thumbnails as BLOBs in a local SQLite database
- displays them in a React gallery view

No TypeScript is used.

## Stack

- Tauri `2.10.2` (latest at setup time)
- React + Vite (JavaScript only)
- Rust crates: `image`, `rusqlite` (bundled SQLite), `sha2`, `base64`

## Development

Install deps:

```bash
npm install
```

Run app:

```bash
npm run tauri dev
```

Run app and pass a startup folder argument:

```bash
npm run tauri dev -- /absolute/path/to/images
```

## Build Targets

Configured bundle targets are macOS and Linux only:

- macOS: `app`, `dmg`
- Linux: `appimage`, `deb`, `rpm`

## Thumbnail Cache

SQLite cache file location:

- `app_data_dir/thumbnail_cache.sqlite`

Cache key uses the source image path hash plus source file modified timestamp to avoid stale thumbnails.
