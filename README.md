# Network Monitor (Electron + React + Node)

An installable desktop network traffic monitoring dashboard.

- Renderer: React + Vite (charts via Recharts)
- Backend: Electron main process (Node.js) running a local WebSocket server
- Streaming: `ws://127.0.0.1:7071`
- Capture: tries `cap` (libpcap/Npcap). Falls back to simulated traffic.

## Prerequisites

### Windows (live capture)
- Install **Npcap** (WinPcap-compatible mode recommended).
- You may need to run the app with elevated permissions depending on your environment.

### Linux (live capture)
- Install libpcap dev headers (distro package typically `libpcap-dev`).
- Packet capture may require root or granting capabilities to the packaged binary.

## Development

- Install deps: `npm install`
- Run desktop app: `npm run dev`

If you only want the web UI (no Electron): `npm run dev:web`

## Build & Package

- Build everything: `npm run build`
- Package (folder): `npm run pack`
- Package (installers): `npm run dist`

Outputs go to `release/`.

## GitHub Releases

This repo includes a GitHub Actions workflow that builds installers for Windows + Linux + macOS and attaches them to a GitHub Release when you push a tag like `v0.1.0`.

1) Create a GitHub repo and push your code (first time):

- `git init`
- `git add -A`
- `git commit -m "Initial"`
- `git branch -M main`
- `git remote add origin https://github.com/<you>/<repo>.git`
- `git push -u origin main`

2) Bump version in `package.json` (recommended) and tag a release:

- `git add package.json package-lock.json`
- `git commit -m "Release v0.1.0"`
- `git tag v0.1.0`
- `git push --follow-tags`

After the workflow completes, download installers from the GitHub Release page.

## Notes

- Live capture uses best-effort adapter selection. If capture isn’t available, switch to **Simulate** mode.
- This is a starting point: add DNS/HTTP enrichment and more anomaly rules as needed.
