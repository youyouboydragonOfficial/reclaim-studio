# Reclaim Studio

Windows desktop recovery utility for deleted photos, videos, GIFs and common documents.

## What it does

- Scans a selected folder without changing its contents.
- Performs a read-only signature scan against a drive or disk image when started as administrator.
- Recovers selected candidates into a separate folder chosen by the user.
- Processes everything locally; no files are uploaded.

## Important limitations

Deep scan is a best-effort file-carving workflow. It cannot guarantee recovery when the storage blocks have been overwritten, the volume is encrypted, or the file format does not expose a recognizable signature. Stop writing to the affected drive as soon as possible and always recover to another drive.

## Development

```powershell
npm install
npm start
npm run dist
```

The distributable installer and portable executable are written to `dist/`.
