# Crowd Monitor frontend

React + TypeScript + Vite. Works offline on a local network (no CDNs, no external requests).

## Run
```bash
npm install
cp .env.example .env     # optional
npm run dev              # http://localhost:5173
```
- Real backend: runs at `http://<this host>:3000` by default. Change it in **Settings** or `VITE_API_URL`.
- No backend yet: `VITE_MOCK=1 npm run dev`, or tick **Mock mode** in Settings.
- Deploy: `npm run build`, then serve `dist/` with any static server. Hash routing, so no server config is needed.

## Screens
- `#/` Operator dashboard: summary, zones (load, level, forecast, advice), live alerts, evacuation switch with typed confirmation.
- `#/evacuation` Rescue priorities, exit assignments, per-zone instructions. Opens automatically when evacuation starts.
- `#/zone/<zone-id>` Occupant page for one zone only (use as a QR link). Full red screen in evacuation.
- `#/settings` API URL, optional bearer token, mock mode.

## Notes
- Live updates: SSE (`/api/stream`) triggers refreshes; 4 s polling is the fallback, and an Offline badge shows when the backend is unreachable.
- Zones with no fresh data show NO DATA, never zero. Counts are labelled as estimates.
- Backend gaps: no zone coordinates (so no floor-plan map yet), and no auth on mode/hazard/block endpoints.
