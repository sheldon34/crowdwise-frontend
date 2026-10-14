import { useEffect, useState } from 'react';
import { NavLink, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { api, MOCK, useLive, type Advice, type Forecast, type Live, type Zone } from './api';

const LV: Record<string, { icon: string; label: string }> = {
  LOW: { icon: '✓', label: 'LOW' }, MEDIUM: { icon: '!', label: 'MEDIUM' },
  HIGH: { icon: '‼', label: 'HIGH' }, UNKNOWN: { icon: '?', label: 'NO DATA' },
};
const ago = (ms: number) => (ms < 1000 ? 'just now' : ms < 60000 ? `${Math.round(ms / 1000)}s ago` : `${Math.round(ms / 60000)}m ago`);

// Level is always shown as icon + text, never colour alone. Stale data shows as NO DATA.
function Badge({ level, stale }: { level: string; stale?: boolean }) {
  const k = stale || !(level in LV) ? 'UNKNOWN' : level;
  return <span className={`badge ${k}`}>{LV[k].icon} {LV[k].label}</span>;
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return <div className="stat" title={hint}><b>{value}</b><span>{label}</span></div>;
}

function ForecastLine({ zone }: { zone: string }) {
  const [f, setF] = useState<Forecast | null>(null);
  useEffect(() => {
    let on = true;
    const run = () => api<Forecast>(`/api/forecast?zone=${encodeURIComponent(zone)}&horizons=10`)
      .then((d) => on && setF(d)).catch(() => on && setF(null)); // 422 = not enough data yet
    run();
    const t = setInterval(run, 15000);
    return () => { on = false; clearInterval(t); };
  }, [zone]);
  if (!f) return <small className="muted">Forecast: not enough data yet</small>;
  const p = f.forecast[0];
  const arrow = f.trend === 'rising' ? '↗' : f.trend === 'falling' ? '↘' : '→';
  return <small>{arrow} {f.trend}, ~{Math.round(p?.people ?? f.current)} in {p?.in_min ?? 10} min</small>;
}

function ModeControl({ mode, onChange }: { mode: string; onChange: (m: string, note: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const evac = mode === 'evacuation';
  const phrase = evac ? 'NORMAL' : 'EVACUATE';
  const confirm = async () => {
    setBusy(true); setErr('');
    try { await onChange(evac ? 'normal' : 'evacuation', note); setOpen(false); setTyped(''); setNote(''); }
    catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  return (
    <>
      <button className={evac ? 'btn' : 'btn danger'} onClick={() => setOpen(true)}>
        {evac ? 'Return to normal' : 'Switch to EVACUATION'}
      </button>
      {open && (
        <div className="modal" role="dialog" aria-modal="true" aria-label="Confirm mode change">
          <div className="panel">
            <h2>{evac ? 'End evacuation mode?' : 'Start evacuation mode?'}</h2>
            <p>This changes guidance for every zone. Type <b>{phrase}</b> to confirm.</p>
            <input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Confirmation text" />
            <input placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
            {err && <p className="err" role="alert">{err}</p>}
            <div className="row">
              <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
              <button className="btn danger" disabled={busy || typed.trim().toUpperCase() !== phrase} onClick={confirm}>
                {busy ? 'Working…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ZoneCard({ z, live }: { z: Zone; live: Live }) {
  const node = live.nodes[z.zone];
  const load = node ? node.load : 0;
  const a = live.routes[z.zone];
  return (
    <article className={`zone ${z.stale ? 'UNKNOWN' : z.level}`}>
      <header><h3>{node?.name ?? z.zone}</h3><Badge level={z.level} stale={z.stale} /></header>
      <p className="big" title="Estimate from WiFi device counts">
        {z.stale ? 'No data' : `~${Math.round(z.people)}`} <small>{z.stale ? '' : 'people'}</small>
      </p>
      <div className="bar" role="meter" aria-label="Load" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(load * 100)}>
        <i style={{ width: `${Math.min(load, 1) * 100}%` }} />
      </div>
      <small className="muted">
        {z.stale ? 'Sensor silent: treated as unsafe' : `Updated ${ago(z.age_ms)}`}{node && !z.stale ? ` · load ${Math.round(load * 100)}%` : ''}
      </small>
      {!z.stale && <ForecastLine zone={z.zone} />}
      {a && a.action !== 'stay' && <p className="advice">{a.message}</p>}
    </article>
  );
}

function Dashboard({ live }: { live: Live }) {
  const fresh = live.zones.filter((z) => !z.stale);
  const total = Math.round(fresh.reduce((a, z) => a + z.people, 0));
  return (
    <>
      <section className="cards">
        <Stat label="People (estimate)" value={`~${total}`} hint="Estimated from WiFi device counts, not exact" />
        <Stat label="HIGH zones" value={fresh.filter((z) => z.level === 'HIGH').length} />
        <Stat label="Zones with no data" value={live.zones.filter((z) => z.stale).length} />
        <Stat label="Blocked routes / hazards" value={`${live.rescue?.blocked_edges.length ?? 0} / ${live.rescue?.hazard_zones.length ?? 0}`} />
      </section>
      <h2>Zones</h2>
      <section className="grid">{live.zones.map((z) => <ZoneCard key={z.zone} z={z} live={live} />)}</section>
      <h2>Live alerts</h2>
      <ul className="feed" aria-live="polite">
        {live.alerts.length === 0 && <li className="muted">No alerts yet.</li>}
        {live.alerts.map((a) => <li key={a.t + a.text}><time>{new Date(a.t).toLocaleTimeString()}</time> {a.text}</li>)}
      </ul>
    </>
  );
}

function Evacuation({ live }: { live: Live }) {
  const r = live.rescue;
  const routes = Object.values(live.routes).filter((a) => live.nodes[a.from]);
  const exits: Record<string, { name: string; zones: number; people: number }> = {};
  for (const a of routes) {
    if (a.action !== 'go' || !a.exit) continue;
    const e = (exits[a.exit] ??= { name: a.path_names?.[a.path_names.length - 1] ?? a.exit, zones: 0, people: a.exit_assigned_people ?? 0 });
    e.zones++;
  }
  return (
    <>
      {live.mode !== 'evacuation' && <p className="note">Evacuation mode is not active. These are the current priorities.</p>}
      <h2>Rescue priorities</h2>
      <ol className="rescue">
        {r?.zones.map((z) => (
          <li key={z.zone} className={z.trapped ? 'trapped' : ''}>
            <b>#{z.rank} {z.name}</b>
            <span> · {z.people == null ? 'unknown' : `~${Math.round(z.people)}`} people</span>
            {z.trapped && <strong> · TRAPPED</strong>}
            <ul>{z.reasons.map((x) => <li key={x}>{x}</li>)}</ul>
          </li>
        ))}
      </ol>
      {r && (r.blocked_edges.length > 0 || r.hazard_zones.length > 0) &&
        <p className="note">Blocked routes: {r.blocked_edges.length}. Hazard zones: {r.hazard_zones.join(', ') || 'none'}.</p>}
      <h2>Exits</h2>
      <section className="cards">
        {Object.entries(exits).map(([id, e]) => <Stat key={id} label={`${e.name} · ${e.zones} zone(s)`} value={`~${e.people}`} hint="People assigned" />)}
        {Object.keys(exits).length === 0 && <p className="muted">No exit assignments yet.</p>}
      </section>
      <h2>Instructions per zone</h2>
      <table>
        <thead><tr><th>Zone</th><th>Instruction</th><th>Path</th><th>Est. min</th></tr></thead>
        <tbody>
          {routes.map((a) => (
            <tr key={a.from} className={a.trapped ? 'trapped' : ''}>
              <td>{live.nodes[a.from]?.name ?? a.from}</td><td>{a.message}</td>
              <td>{a.path_names?.join(' → ') ?? ''}</td><td>{a.est_minutes ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

// Mobile-first, one zone only: no other zones' data and no operator controls.
function ZonePage() {
  const { id = '' } = useParams();
  const [a, setA] = useState<Advice | null>(null);
  const [lost, setLost] = useState(false);
  useEffect(() => {
    let on = true;
    const run = () => api<Advice>(`/api/route?from=${encodeURIComponent(id)}`)
      .then((d) => on && (setA(d), setLost(false))).catch(() => on && setLost(true));
    run();
    const t = setInterval(run, 3000);
    return () => { on = false; clearInterval(t); };
  }, [id]);
  const evac = a?.mode === 'evacuation';
  useEffect(() => { document.body.dataset.mode = evac ? 'evacuation' : 'normal'; }, [evac]);
  return (
    <main className={`occupant ${evac ? 'evac' : ''}`} aria-live="assertive">
      <p className="muted">{id}</p>
      {!a ? <h1>{lost ? 'Connection lost. Follow the posted exit signs.' : 'Loading…'}</h1> : (
        <>
          <h1>{a.message ?? a.action}</h1>
          {a.action === 'go' && a.path_names && <ol>{a.path_names.map((p, i) => <li key={i}>{p}</li>)}</ol>}
          {a.est_minutes != null && a.action === 'go' && <p>About {a.est_minutes} min</p>}
          {lost && <p className="warn">Connection lost. Showing the last advice. Follow the posted signs.</p>}
        </>
      )}
    </main>
  );
}

function Settings() {
  const [url, setUrl] = useState(localStorage.getItem('apiUrl') ?? '');
  const [token, setToken] = useState(localStorage.getItem('token') ?? '');
  const [mock, setMock] = useState(MOCK);
  const save = () => {
    localStorage.setItem('apiUrl', url); localStorage.setItem('token', token); localStorage.setItem('mock', mock ? '1' : '0');
    location.reload();
  };
  return (
    <section className="panel form">
      <h2>Settings</h2>
      <label>API URL<input value={url} placeholder={`http://${location.hostname}:3000`} onChange={(e) => setUrl(e.target.value)} /></label>
      <label>Bearer token (optional)<input value={token} type="password" onChange={(e) => setToken(e.target.value)} /></label>
      <label className="check"><input type="checkbox" checked={mock} onChange={(e) => setMock(e.target.checked)} /> Mock mode (no backend)</label>
      <button className="btn" onClick={save}>Save and reload</button>
      <p className="muted">Occupant page for a zone: <code>#/zone/&lt;zone-id&gt;</code> (for example, a QR code per zone).</p>
    </section>
  );
}

function Shell() {
  const live = useLive();
  const nav = useNavigate();
  useEffect(() => {
    document.body.dataset.mode = live.mode;
    if (live.mode === 'evacuation') nav('/evacuation'); // evacuation becomes the primary view
  }, [live.mode, nav]);
  return (
    <>
      <header className="top">
        <strong>Crowd Monitor</strong>
        <nav>
          <NavLink to="/" end>Dashboard</NavLink>
          <NavLink to="/evacuation">Evacuation</NavLink>
          <NavLink to="/settings">Settings</NavLink>
        </nav>
        <span className={`pill ${live.online ? 'ok' : 'bad'}`}>{live.online ? '● Live' : '○ Offline, data may be old'}{MOCK ? ' (mock)' : ''}</span>
        <span className={`pill mode ${live.mode}`}>{live.mode.toUpperCase()}</span>
        <ModeControl mode={live.mode} onChange={live.setMode} />
      </header>
      {live.mode === 'evacuation' && <div className="banner" role="alert">EVACUATION MODE ACTIVE</div>}
      <main className="page">
        <Routes>
          <Route path="/" element={<Dashboard live={live} />} />
          <Route path="/evacuation" element={<Evacuation live={live} />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/zone/:id" element={<ZonePage />} />
      <Route path="*" element={<Shell />} />
    </Routes>
  );
}
