// Sərnişin tətbiqinin ortaq nüvəsi: həm /mobile, həm masaüstü versiyası bunun üzərində qurulub.
// Naviqasiya URL-dədir: telefonun "geri" düyməsi işləyir, dayanacaq və xəttə birbaşa keçid vermək olur.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { flushQueue, queuedCount, useBackground, useLive, useNetwork, useOnline, type Journey, type LiveState, type Network, type Route } from '../api';
import type { FitRequest, MapArrow, MapBus, MapLine, MapStop } from '../components/MapView';
import { distM, useUserLocation, type Pos } from '../lib/geo';
import { useSaved } from '../lib/saved';

export type View = { kind: 'home' } | { kind: 'stop'; id: string } | { kind: 'route'; id: string } | { kind: 'plan' } | { kind: 'search' } | { kind: 'lines' } | { kind: 'saved' };
export type Dir = 0 | 1;
export interface Prefs {
  simple: boolean;
  contrast: boolean;
  large: boolean;
  theme?: 'auto' | 'light' | 'dark';
}

/** prefs.theme -> həll olunmuş mövzu. 'auto' sistem parametrlərini izləyir. */
export function useResolvedTheme(theme: Prefs['theme']): 'light' | 'dark' {
  const media = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const [sys, setSys] = useState(() => media?.matches ?? false);
  useEffect(() => {
    if (!media) return;
    const fn = (e: MediaQueryListEvent) => setSys(e.matches);
    media.addEventListener('change', fn);
    return () => media.removeEventListener('change', fn);
  }, [media]);
  return theme === 'dark' || (theme !== 'light' && sys) ? 'dark' : 'light';
}
export type InstallEvent = Event & { prompt: () => Promise<void> };
export interface Layers {
  buses: boolean;
  others: boolean;
  crowd: boolean;
}

const LEVEL_COLOR: Record<string, string> = { '1': '#1f8a4c', '2': '#c98a00', '3': '#d92d33', none: '#9aa3af' };

function parseView(path: string, base: string): View {
  const rest = (base && path.startsWith(base) ? path.slice(base.length) : path).split('/').filter(Boolean);
  const [a, b] = rest;
  if (a === 'stop' && b) return { kind: 'stop', id: decodeURIComponent(b) };
  if (a === 'route' && b) return { kind: 'route', id: decodeURIComponent(b) };
  if (a === 'plan') return { kind: 'plan' };
  if (a === 'search') return { kind: 'search' };
  if (a === 'lines') return { kind: 'lines' };
  if (a === 'saved') return { kind: 'saved' };
  return { kind: 'home' };
}

function pathOf(v: View, base: string): string {
  const root = base || '/';
  if (v.kind === 'home') return root;
  const prefix = base;
  if (v.kind === 'stop') return `${prefix}/stop/${encodeURIComponent(v.id)}`;
  if (v.kind === 'route') return `${prefix}/route/${encodeURIComponent(v.id)}`;
  return `${prefix}/${v.kind}`;
}

function usePrefs(): [Prefs, (p: Partial<Prefs>) => void] {
  const [p, setP] = useState<Prefs>(() => ({ simple: false, contrast: false, large: false, ...JSON.parse(localStorage.getItem('stb.prefs') ?? '{}') }));
  return [
    p,
    (patch) => {
      const n = { ...p, ...patch };
      setP(n);
      localStorage.setItem('stb.prefs', JSON.stringify(n));
    },
  ];
}

// ---------------------------------------------------------------- həndəsə

const cums = new WeakMap<Route, { pts: [number, number][]; cum: number[] }>();
function loopOf(r: Route) {
  let v = cums.get(r);
  if (!v) {
    const pts = [...r.forward, ...r.backward.slice(1)];
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + distM({ lat: pts[i - 1][0], lon: pts[i - 1][1] }, { lat: pts[i][0], lon: pts[i][1] }));
    v = { pts, cum };
    cums.set(r, v);
  }
  return v;
}

/** Xəttin dövrəsində iki dayanacaq arasındakı hissə (dövrənin sonundan keçə bilər). */
export function loopSegment(r: Route, fromStop: string, toStop: string): [number, number][] {
  const { pts, cum } = loopOf(r);
  const L = cum[cum.length - 1];
  const froms = r.loopStops.filter((s) => s.stopId === fromStop);
  const tos = r.loopStops.filter((s) => s.stopId === toStop);
  if (!froms.length || !tos.length) return [];
  let a = froms[0].d;
  let b = tos[0].d;
  let best = Infinity;
  for (const f of froms)
    for (const t of tos) {
      const ahead = ((t.d - f.d) % L + L) % L;
      if (ahead < best) {
        best = ahead;
        a = f.d;
        b = t.d;
      }
    }
  const inside = (c: number) => (a <= b ? c >= a && c <= b : c >= a || c <= b);
  const idx = pts.map((_, i) => i).filter((i) => inside(cum[i]));
  if (a > b) {
    const start = idx.findIndex((i) => cum[i] >= a);
    return [...idx.slice(start), ...idx.slice(0, start)].map((i) => pts[i]);
  }
  return idx.map((i) => pts[i]);
}

/** Xətt boyunca bərabər aralıqlı istiqamət oxları. */
export function arrowsAlong(coords: [number, number][], count: number): MapArrow[] {
  if (coords.length < 2) return [];
  const K = Math.cos((coords[0][0] * Math.PI) / 180);
  const seg: number[] = [0];
  for (let i = 1; i < coords.length; i++) seg.push(seg[i - 1] + Math.hypot((coords[i][1] - coords[i - 1][1]) * K, coords[i][0] - coords[i - 1][0]));
  const total = seg[seg.length - 1];
  if (!total) return [];
  const out: MapArrow[] = [];
  for (let n = 1; n <= count; n++) {
    const at = (total * n) / (count + 1);
    let i = 1;
    while (i < seg.length - 1 && seg[i] < at) i++;
    const [la, lo] = coords[i - 1];
    const [lb, lp] = coords[i];
    const t = (at - seg[i - 1]) / (seg[i] - seg[i - 1] || 1);
    out.push({ id: `a${n}`, lat: la + (lb - la) * t, lon: lo + (lp - lo) * t, bearing: (Math.atan2((lp - lo) * K, lb - la) * 180) / Math.PI });
  }
  return out;
}

// ---------------------------------------------------------------- nüvə

export function usePassenger(base: string) {
  const { net, error } = useNetwork();
  const bg = useBackground();
  const { state: live, connected } = useLive();
  const online = useOnline();
  const { pos, status: locStatus, start: locate } = useUserLocation();
  const [prefs, setPrefs] = usePrefs();
  const savedApi = useSaved();
  const [install, setInstall] = useState<InstallEvent | null>(null);
  const [queued, setQueued] = useState(queuedCount());
  const [from, setFrom] = useState<string | null>(null);
  const [fitNonce, setFitNonce] = useState(0);
  const [journey, setJourney] = useState<Journey | null>(null);

  const location = useLocation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  // naməlum dayanacaq və ya xətt ünvanı (köhnə keçid) ekranı çökdürməsin: ana səhifə göstərilir
  const parsed = useMemo(() => parseView(location.pathname, base), [location.pathname, base]);
  const unknown = !!net && ((parsed.kind === 'stop' && !net.stops.some((s) => s.id === parsed.id)) || (parsed.kind === 'route' && !net.routes.some((r) => r.id === parsed.id)));
  const home = useMemo<View>(() => ({ kind: 'home' }), []);
  const view = unknown ? home : parsed;
  const dir: Dir = params.get('dir') === '1' ? 1 : 0;

  const go = useCallback(
    (v: View) => {
      // axtarış keçid ekranıdır: nəticədən geri qayıdanda yenidən açılmamalıdır
      navigate(pathOf(v, base), { replace: location.pathname.endsWith('/search') });
    },
    [navigate, base, location.pathname],
  );
  const back = useCallback(() => {
    if (location.key !== 'default') navigate(-1);
    else navigate(base || '/', { replace: true });
  }, [navigate, location.key, base]);
  const setDir = useCallback((d: Dir) => setParams(d ? { dir: '1' } : {}, { replace: true }), [setParams]);
  const refit = useCallback(() => setFitNonce((n) => n + 1), []);

  const { pushRecent } = savedApi;
  useEffect(() => {
    if (!net) return;
    if (unknown) navigate(base || '/', { replace: true });
    if (view.kind === 'stop') pushRecent(view.id);
    if (view.kind !== 'plan') setJourney(null);
  }, [net, view, unknown, navigate, base, pushRecent]);

  useEffect(() => {
    const h = (e: Event) => {
      e.preventDefault();
      setInstall(e as InstallEvent);
    };
    window.addEventListener('beforeinstallprompt', h);
    return () => window.removeEventListener('beforeinstallprompt', h);
  }, []);
  useEffect(() => {
    if (online) flushQueue().then(() => setQueued(queuedCount()));
    const t = window.setInterval(() => setQueued(queuedCount()), 4000);
    return () => window.clearInterval(t);
  }, [online]);
  useEffect(() => {
    if (pos && view.kind === 'home') refit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos != null]);

  // başlıq: paylaşılan keçiddə və brauzer tarixçəsində nəyin açıq olduğu görünsün
  useEffect(() => {
    if (!net) return;
    const name = view.kind === 'stop' ? net.stops.find((s) => s.id === view.id)?.name : view.kind === 'route' ? `${view.id} nömrəli xətt` : view.kind === 'plan' ? 'Marşrut planı' : view.kind === 'lines' ? 'Xətlər' : view.kind === 'saved' ? 'Seçilmişlər' : null;
    document.title = name ? `${name} · Smart Transit Baku` : 'Smart Transit Baku';
  }, [net, view]);

  return { net, error, bg, live, connected, online, pos, locStatus, locate, prefs, setPrefs, ...savedApi, install, setInstall, queued, from, setFrom, fitNonce, refit, journey, setJourney, view, go, back, dir, setDir };
}

// ---------------------------------------------------------------- xəritə səhnəsi

export interface SceneInput {
  net: Network | null;
  live: LiveState | null;
  view: View;
  dir: Dir;
  pos: Pos | null;
  fitNonce: number;
  journey: Journey | null;
  layers: Layers;
  hover?: string | null;
  bg: { routes: Array<{ id: string; live?: boolean; coords: [number, number][] }> } | null;
}

/** Görünüşdən xəritə təbəqələri. Həndəsə seçim dəyişəndə, avtobuslar hər canlı yenilənmədə hesablanır. */
export function useScene({ net, live, view, dir, pos, fitNonce, journey, layers, hover, bg }: SceneInput) {
  // sıxlıq rəngi yalnız səviyyə dəyişəndə xətləri yenidən çəksin
  const levelKey = layers.crowd ? (live?.routes ?? []).map((r) => `${r.id}:${r.crowd.level ?? 0}`).join() : '';
  const levels = useMemo(() => new Map((layers.crowd ? live?.routes ?? [] : []).map((r) => [r.id, r.crowd.level])), [levelKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const base = useMemo(() => {
    const empty = { lines: [] as MapLine[], stops: [] as MapStop[], arrows: [] as MapArrow[], fit: null as FitRequest | null, ids: null as Set<string> | null, labeled: false, busDir: null as Dir | null, arrowColor: '#0f1419' };
    if (!net) return empty;
    const byId = new Map(net.routes.map((r) => [r.id, r]));
    const allCoords = (r: Route) => loopOf(r).pts;
    const userPt: [number, number][] = pos ? [[pos.lat, pos.lon]] : [];
    const hoverLine = (): MapLine[] => {
      const r = hover ? byId.get(hover) : null;
      return r ? [{ id: `hover-${r.id}`, coords: allCoords(r), color: r.color, weight: 6, opacity: 1 }] : [];
    };

    if (view.kind === 'stop') {
      const stop = net.stops.find((s) => s.id === view.id);
      if (!stop) return empty;
      return {
        ...empty,
        lines: [...stop.routes.map((id) => ({ id, coords: allCoords(byId.get(id)!), color: byId.get(id)!.color, weight: 4, opacity: 0.8, label: `${id} · ${byId.get(id)!.name}` })), ...hoverLine()],
        stops: [{ ...stop, selected: true }],
        ids: new Set(stop.routes),
        labeled: true,
        fit: { key: `stop-${stop.id}-${fitNonce}`, points: [[stop.lat, stop.lon] as [number, number], ...(pos && distM(pos, stop) < 2500 ? userPt : [])] },
      };
    }
    if (view.kind === 'route') {
      const r = byId.get(view.id);
      if (!r) return empty;
      const active = dir === 0 ? r.forward : r.backward;
      const other = dir === 0 ? r.backward : r.forward;
      const inDir = new Set(r.loopStops.filter((s) => s.dir === dir).map((s) => s.stopId));
      return {
        ...empty,
        lines: [
          { id: `${r.id}-other`, coords: other, color: r.color, weight: 3, opacity: 0.28 },
          { id: `${r.id}-active`, coords: active, color: r.color, weight: 6, opacity: 1 },
        ],
        stops: net.stops.filter((s) => inDir.has(s.id)),
        arrows: arrowsAlong(active, 12),
        arrowColor: r.color,
        ids: new Set([r.id]),
        labeled: true,
        busDir: dir,
        fit: { key: `route-${r.id}-${dir}-${fitNonce}`, points: active },
      };
    }
    if (view.kind === 'plan' && journey) {
      const segs = journey.legs.map((l) => ({ l, coords: byId.get(l.routeId) ? loopSegment(byId.get(l.routeId)!, l.fromStopId, l.toStopId) : [] }));
      const ends = new Set(journey.legs.flatMap((l) => [l.fromStopId, l.toStopId]));
      const pts = segs.flatMap((s) => s.coords);
      return {
        ...empty,
        lines: segs.map(({ l, coords }, i) => ({ id: `leg-${i}-${l.routeId}`, coords, color: l.color, weight: 6, opacity: 1, label: `${l.routeId}: ${l.fromName} → ${l.toName}` })),
        stops: net.stops.filter((s) => ends.has(s.id)).map((s) => ({ ...s, selected: true })),
        arrows: segs.flatMap(({ coords }, i) => arrowsAlong(coords, 4).map((a) => ({ ...a, id: `${i}-${a.id}` }))),
        ids: new Set(journey.legs.map((l) => l.routeId)),
        labeled: true,
        fit: pts.length ? { key: `plan-${journey.legs.map((l) => `${l.routeId}${l.fromStopId}${l.toStopId}`).join()}-${fitNonce}`, points: pts } : null,
      };
    }
    // ümumi baxış: bütün canlı xətlər, yaxındakı dayanacaqlar
    const near = pos ? [...net.stops].sort((a, b) => distM(pos, a) - distM(pos, b)).slice(0, 6) : [];
    return {
      ...empty,
      lines: [
        ...net.routes.map((r) => {
          const level = levels.get(r.id);
          return { id: r.id, coords: allCoords(r), color: layers.crowd ? LEVEL_COLOR[String(level ?? 'none')] : r.color, weight: hover ? 1.5 : layers.crowd && level === 3 ? 4 : 2.5, opacity: hover ? 0.2 : 0.6, label: `${r.id} · ${r.name}` };
        }),
        ...hoverLine(),
      ],
      stops: near,
      fit: pos ? { key: `home-user-${fitNonce}`, points: [[pos.lat, pos.lon] as [number, number], ...near.slice(0, 3).map((s) => [s.lat, s.lon] as [number, number])] } : { key: `home-${fitNonce}`, points: [[40.36, 49.78], [40.47, 49.98]] as [number, number][] },
    };
  }, [net, view, dir, pos, fitNonce, journey, layers.crowd, levels, hover]);

  const buses: MapBus[] = useMemo(() => {
    if (!net || !layers.buses) return [];
    const color = new Map(net.routes.map((r) => [r.id, r.color]));
    return (live?.buses ?? [])
      .filter((b) => !base.ids || base.ids.has(b.routeId))
      .map((b) => {
        const onDir = base.busDir == null || b.dir === base.busDir;
        return {
          id: b.id,
          lat: b.lat,
          lon: b.lon,
          label: base.labeled && onDir ? b.routeId : '',
          level: b.crowd.level,
          color: layers.crowd ? LEVEL_COLOR[String(b.crowd.level ?? 'none')] : color.get(b.routeId),
          ring: b.bunchedFollower,
          reserve: b.reserve,
          dim: !onDir,
        };
      });
  }, [net, live, base, layers.buses, layers.crowd]);

  const background: MapLine[] = useMemo(() => (layers.others ? (bg?.routes ?? []).filter((r) => !r.live).map((r, i) => ({ id: `${r.id}-${i}`, coords: r.coords, color: '#7b8794', weight: 1.2, opacity: 0.3 })) : []), [bg, layers.others]);

  return { ...base, buses, background };
}
