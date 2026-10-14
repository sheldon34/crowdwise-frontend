import { useCallback, useEffect, useState } from 'react';

// ---------- Types (match the backend contract) ----------
export type Level = 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN';
export interface Zone { zone: string; people: number; devices: number; level: Level; stale: boolean; age_ms: number; mode: string }
export interface GraphNode { id: string; name: string; is_exit: boolean; hazard: boolean; load: number; capacity: number }
export interface Advice {
  from: string; mode: string; action: 'go' | 'stay' | 'shelter' | 'arrived'; message?: string; reason?: string;
  path_names?: string[]; est_minutes?: number; exit?: string; exit_assigned_people?: number; trapped?: boolean;
}
export interface RescueZone { rank: number; zone: string; name: string; people: number | null; level: string; trapped: boolean; hazard: boolean; stale: boolean; reasons: string[] }
export interface Rescue { mode: string; zones: RescueZone[]; blocked_edges: unknown[]; hazard_zones: string[] }
export interface Forecast { trend: 'rising' | 'steady' | 'falling'; current: number; forecast: { in_min: number; people: number }[] }
export interface Alert { t: number; text: string }

// ---------- Config (editable on the Settings page) ----------
const ls = (k: string) => localStorage.getItem(k) ?? '';
const m = localStorage.getItem('mock');
export const MOCK = m !== null ? m === '1' : import.meta.env.VITE_MOCK === '1';
export const base = () =>
  (ls('apiUrl') || import.meta.env.VITE_API_URL || `http://${location.hostname}:3000`).replace(/\/$/, '');

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  if (MOCK) return mock(path, init) as T;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (ls('token')) headers.Authorization = `Bearer ${ls('token')}`;
  const r = await fetch(base() + path, { ...init, headers });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
  return body as T;
}

// ---------- Mock backend (VITE_MOCK=1 or Settings) ----------
const CAP: Record<string, number> = { lobby: 80, hall_a: 120, hall_b: 100, cafeteria: 60, corridor: 40 };
const NAME: Record<string, string> = { lobby: 'Lobby', hall_a: 'Hall A', hall_b: 'Hall B', cafeteria: 'Cafeteria', corridor: 'Main corridor' };
const EXIT: Record<string, string> = { lobby: 'North exit', hall_a: 'North exit', hall_b: 'South exit', cafeteria: 'East exit', corridor: 'South exit' };
const mp: Record<string, number> = { lobby: 30, hall_a: 95, hall_b: 40, cafeteria: 20, corridor: 10 };
let mmode = 'normal';
const lvl = (z: string): Level => (mp[z] / CAP[z] >= 0.8 ? 'HIGH' : mp[z] / CAP[z] >= 0.5 ? 'MEDIUM' : 'LOW');

function mockAdvice(z: string): Advice {
  if (mmode === 'evacuation')
    return { from: z, mode: mmode, action: 'go', exit: EXIT[z], path_names: [NAME[z], EXIT[z]], est_minutes: 1.2,
      exit_assigned_people: 60, message: `Evacuate via ${EXIT[z]}.`, reason: 'blocked routes and hazard zones excluded' };
  if (lvl(z) === 'HIGH')
    return { from: z, mode: mmode, action: 'go', path_names: [NAME[z], 'Main corridor'], est_minutes: 0.2,
      message: `${NAME[z]} is crowded. Move to Main corridor.`, reason: `${NAME[z]} is crowded (HIGH)` };
  return { from: z, mode: mmode, action: 'stay', message: `${NAME[z]} is not crowded.` };
}

function mock(path: string, init?: RequestInit): unknown {
  for (const z in mp) mp[z] = Math.max(0, Math.round(mp[z] + (Math.random() - 0.5) * 8));
  const ids = Object.keys(mp);
  const q = new URLSearchParams(path.split('?')[1] ?? '');
  if (path.startsWith('/api/zones'))
    return ids.map((z) => ({ zone: z, people: mp[z], devices: mp[z], level: lvl(z), stale: false, age_ms: 800, mode: mmode }))
      .sort((a, b) => b.people - a.people);
  if (path.startsWith('/api/graph'))
    return { nodes: ids.map((z) => ({ id: z, name: NAME[z], capacity: CAP[z], is_exit: false, hazard: false, load: mp[z] / CAP[z] })), edges: [] };
  if (path.startsWith('/api/mode')) {
    if (init?.method === 'POST') mmode = JSON.parse(String(init.body)).mode;
    return { mode: mmode, zone: '*', ts: Date.now(), note: null };
  }
  if (path.startsWith('/api/routes')) return Object.fromEntries(ids.map((z) => [z, mockAdvice(z)]));
  if (path.startsWith('/api/route')) return mockAdvice(q.get('from') ?? 'lobby');
  if (path.startsWith('/api/forecast')) {
    const z = q.get('zone') ?? 'lobby';
    return { trend: 'steady', current: mp[z], forecast: [{ in_min: 10, people: mp[z] }] };
  }
  if (path.startsWith('/api/rescue'))
    return { mode: mmode, blocked_edges: [], hazard_zones: [],
      zones: ids.slice().sort((a, b) => mp[b] - mp[a]).map((z, i) => ({ rank: i + 1, zone: z, name: NAME[z], people: mp[z],
        level: lvl(z), trapped: false, hazard: false, stale: false, reasons: mp[z] > CAP[z] ? ['over capacity'] : [] })) };
  throw new Error('mock: unknown endpoint');
}

// ---------- Live data: REST snapshot + SSE pushes (polling as fallback) ----------
export function useLive() {
  const [s, setS] = useState({
    zones: [] as Zone[], nodes: {} as Record<string, GraphNode>, routes: {} as Record<string, Advice>,
    rescue: null as Rescue | null, mode: 'normal', online: true, alerts: [] as Alert[],
  });
  const alert = useCallback((text: string) =>
    setS((p) => ({ ...p, alerts: [{ t: Date.now(), text }, ...p.alerts].slice(0, 50) })), []);

  const load = useCallback(async () => {
    try {
      const [zones, graph, routes, rescue, mode] = await Promise.all([
        api<Zone[]>('/api/zones'), api<{ nodes: GraphNode[] }>('/api/graph'), api<Record<string, Advice>>('/api/routes'),
        api<Rescue>('/api/rescue/priorities'), api<{ mode: string }>('/api/mode'),
      ]);
      const nodes = Object.fromEntries(graph.nodes.map((n) => [n.id, n]));
      const seen = new Set(zones.map((z) => z.zone));
      // Zones in the layout that never reported are shown as NO DATA, never as empty.
      const missing: Zone[] = graph.nodes.filter((n) => !n.is_exit && !seen.has(n.id))
        .map((n) => ({ zone: n.id, people: 0, devices: 0, level: 'UNKNOWN', stale: true, age_ms: 0, mode: 'normal' }));
      setS((p) => ({ ...p, zones: [...zones, ...missing], nodes, routes, rescue, mode: mode.mode, online: true }));
    } catch {
      setS((p) => ({ ...p, online: false }));
    }
  }, []);

  useEffect(() => {
    load();
    const poll = setInterval(load, 4000);
    let es: EventSource | undefined;
    if (!MOCK) {
      es = new EventSource(base() + '/api/stream');
      const on = (ev: string, fmt: (d: any) => string) =>
        es!.addEventListener(ev, (e) => { try { alert(fmt(JSON.parse((e as MessageEvent).data))); } catch { /* ignore */ } load(); });
      on('route', (d: Advice) => `${d.from}: ${d.message ?? d.action}`);
      on('mode', (d) => `Mode set to ${d.mode}${d.zone !== '*' ? ` for ${d.zone}` : ''}${d.note ? ` (${d.note})` : ''}`);
      on('graph', (d) => d.type === 'edge' ? `Route ${d.id} ${d.blocked ? 'blocked' : 'cleared'}` : `Zone ${d.id} hazard ${d.hazard ? 'reported' : 'cleared'}`);
    }
    return () => { clearInterval(poll); es?.close(); };
  }, [load, alert]);

  const setMode = async (mode: string, note: string) => {
    await api('/api/mode', { method: 'POST', body: JSON.stringify({ mode, zone: '*', note: note || null }) });
    if (MOCK) alert(`Mode set to ${mode}`);
    await load();
  };
  return { ...s, setMode };
}
export type Live = ReturnType<typeof useLive>;
