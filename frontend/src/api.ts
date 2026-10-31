// Backend ilə əlaqə: tiplər, HTTP, WebSocket, anonim cihaz sessiyası və offline bildiriş növbəsi.
import { useEffect, useRef, useState } from 'react';

export type Level = 1 | 2 | 3;
export type Badge = 'confirmed' | 'check' | 'suspicious' | 'none';

export interface Stop {
  id: string;
  name: string;
  lat: number;
  lon: number;
  routes: string[];
}
export interface LoopStop {
  stopId: string;
  seq: number;
  dir: 0 | 1;
  d: number;
  towards: string;
}
export interface Route {
  id: string;
  name: string;
  kind: 'express' | 'regular';
  color: string;
  headwayMin: number;
  capacity: number;
  stopIds: string[];
  forward: [number, number][];
  backward: [number, number][];
  loopStops: LoopStop[];
}
export interface Network {
  stops: Stop[];
  routes: Route[];
}
export interface Crowd {
  score: number | null;
  level: Level | null;
  confidence: number;
  badge: Badge;
  n: number;
  devices: number;
  effN: number;
  reasons: string[];
}
export interface BusView {
  id: string;
  routeId: string;
  label: string;
  lat: number;
  lon: number;
  bearing: number;
  speedKmh: number;
  d: number;
  dir: 0 | 1;
  towards: string;
  reserve: boolean;
  crowd: Crowd;
  bunchedFollower: boolean;
  holdS: number;
  dwellingAt: string | null;
}
export interface Cause {
  cause: 'normal' | 'demand' | 'traffic' | 'mixed' | 'unknown';
  congestion: string;
  speedRatio: number | null;
  dwellRatio: number | null;
  text: string;
}
export interface RippleStop {
  stopId: string;
  seq: number;
  dir: 0 | 1;
  name: string;
  risk: [number, number, number];
  firstServiceableS: number | null;
}
export interface RouteView {
  id: string;
  name: string;
  kind: string;
  color: string;
  buses: number;
  plannedBuses: number;
  reserveBuses: number;
  crowd: Crowd;
  highForMs: number;
  cause: Cause;
  speedKmh: number | null;
  headway: { idealS: number; cv: number; pairs: Array<{ leader: string; follower: string; gapS: number; holdS: number }>; bigGaps: Array<{ before: string; gapS: number }> };
  forecast: { p15: number | null; p30: number | null; baselineNow: number | null };
  attack: { active: boolean; signals: string[] };
  ripple?: RippleStop[];
}
export type AlertType = 'reserve' | 'forecast' | 'bunching' | 'traffic' | 'bot';
export interface Alert {
  id: string;
  type: AlertType;
  routeId: string | null;
  createdAt: number;
  status: 'new' | 'ack' | 'resolved';
  title: string;
  recommendation: string;
  confidence: number | null;
  badge: Badge;
  explanation: Record<string, unknown>;
  dispatchedBusId?: string | null;
}
export interface LiveState {
  now: number;
  speed: number;
  reservePool: number;
  routes: RouteView[];
  buses: BusView[];
}
export interface Overview extends LiveState {
  forecastMae: number | null;
  alerts: Alert[];
}
export interface Arrival {
  busId: string;
  routeId: string;
  label: string;
  etaS: number;
  distanceM: number;
  level: Level | null;
  score: number | null;
  badge: Badge;
  confidence: number;
  bunchedFollower: boolean;
  towards: string;
  dir: 0 | 1;
  color: string;
  reserve: boolean;
}
export interface Arrivals {
  stop: Stop;
  arrivals: Arrival[];
  advice: { skipBusId: string; takeBusId: string; extraWaitS: number; text: string; certain: boolean } | null;
  stopCrowd: Record<string, Crowd>;
  now: number;
}
export interface Leg {
  routeId: string;
  busId: string;
  busLabel: string;
  fromStopId: string;
  toStopId: string;
  fromName: string;
  toName: string;
  waitS: number;
  rideS: number;
  level: Level | null;
  towards: string;
  color: string;
}
export interface Journey {
  legs: Leg[];
  totalS: number;
  perceivedS: number;
  transfers: number;
  comfort: string;
}
export interface PlanResult {
  from: Stop;
  to: Stop;
  journeys: Journey[];
  multipliers: { low: number; medium: number; high: number; source: string };
}
export interface HistoryFrame {
  ts: number;
  routes: Record<string, { score: number | null; confidence: number | null; buses: number; reports: number; speedKmh: number | null; cause: string | null }>;
  buses: Array<{ id: string; label: string; lat: number; lon: number; level: Level | null; routeId: string }>;
}
export interface History {
  now: number;
  frames: HistoryFrame[];
  alerts: Array<{ id: string; ts: number; type: AlertType; routeId: string | null; title: string }>;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  } catch {
    throw new ApiError(0, 'Serverə qoşulmaq alınmadı. İnternet bağlantısını yoxlayın.');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (body as { error?: string }).error ?? `Xəta ${res.status}`);
  return body as T;
}

export const api = {
  get: <T>(p: string) => req<T>(p),
  post: <T>(p: string, body: unknown, headers?: Record<string, string>) => req<T>(p, { method: 'POST', body: JSON.stringify(body), headers }),
  patch: <T>(p: string, body: unknown) => req<T>(p, { method: 'PATCH', body: JSON.stringify(body) }),
};

// ---------------------------------------------------------------- anonim cihaz sessiyası

const SESSION_KEY = 'stb.session';
let sessionPromise: Promise<{ deviceId: string; token: string }> | null = null;

export function getSession(): Promise<{ deviceId: string; token: string }> {
  if (sessionPromise) return sessionPromise;
  sessionPromise = (async () => {
    const saved = localStorage.getItem(SESSION_KEY);
    if (saved) {
      const s = JSON.parse(saved) as { deviceId: string; token: string };
      // server tokeni yenidən imzalayır (server yenidən başlasa da eyni cihaz qalır)
      const fresh = await api.post<{ deviceId: string; token: string }>('/api/session', { deviceId: s.deviceId }).catch(() => s);
      localStorage.setItem(SESSION_KEY, JSON.stringify(fresh));
      return fresh;
    }
    const s = await api.post<{ deviceId: string; token: string }>('/api/session', {});
    localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    return s;
  })();
  sessionPromise.catch(() => (sessionPromise = null));
  return sessionPromise;
}

export interface ReportBody {
  context: 'bus' | 'stop';
  level: 'low' | 'medium' | 'high';
  busId?: string;
  routeId?: string;
  stopId?: string;
  lat?: number;
  lon?: number;
  accuracy?: number;
}
export interface ReportResponse {
  message: string;
  report: { id: string; geoWeight: number; trust: number; distanceM: number | null };
}

export async function sendReport(body: ReportBody): Promise<ReportResponse> {
  const s = await getSession();
  return api.post<ReportResponse>('/api/reports', body, { 'x-device-id': s.deviceId, 'x-device-token': s.token });
}

// ---------------------------------------------------------------- offline növbə (PWA)
// İnternet yoxdursa bildiriş yaddaşda saxlanılır və bağlantı bərpa olanda göndərilir.
// Server köhnə bildirişi azaldılmış çəki ilə qəbul edir (vaxt və coğrafi yoxlama yenidən aparılır).

const QUEUE_KEY = 'stb.queue';
export function queueReport(body: ReportBody): void {
  const q = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]') as Array<ReportBody & { queuedAt: number }>;
  q.push({ ...body, queuedAt: Date.now() });
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-10)));
}
export function queuedCount(): number {
  return (JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]') as unknown[]).length;
}
export async function flushQueue(): Promise<number> {
  const q = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]') as Array<ReportBody & { queuedAt: number }>;
  if (!q.length || !navigator.onLine) return 0;
  const left: typeof q = [];
  let sent = 0;
  for (const item of q) {
    // 10 dəqiqədən köhnə bildiriş artıq faydasızdır, atılır
    if (Date.now() - item.queuedAt > 10 * 60_000) continue;
    const { queuedAt: _q, ...body } = item;
    try {
      await sendReport(body);
      sent++;
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) left.push(item);
    }
  }
  localStorage.setItem(QUEUE_KEY, JSON.stringify(left));
  return sent;
}

// ---------------------------------------------------------------- hooks

export function useNetwork() {
  const [net, setNet] = useState<Network | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api
      .get<Network>('/api/network')
      .then(setNet)
      .catch((e: Error) => setError(e.message));
  }, []);
  return { net, error };
}

export type WsMessage = { type: 'state'; data: LiveState } | { type: 'alert'; data: Alert } | { type: 'alert.update'; data: Alert } | { type: 'dispatch'; data: Record<string, unknown> } | { type: 'clock'; data: { speed: number; now: number } } | { type: 'hello'; data: unknown };

/** WebSocket: canlı vəziyyət + hadisələr. Avtomatik yenidən qoşulur. */
export function useLive(onEvent?: (m: WsMessage) => void) {
  const [state, setState] = useState<LiveState | null>(null);
  const [connected, setConnected] = useState(false);
  const cb = useRef(onEvent);
  cb.current = onEvent;
  useEffect(() => {
    let ws: WebSocket | null = null;
    let stop = false;
    let retry: number | undefined;
    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}/ws`);
      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        if (!stop) retry = window.setTimeout(connect, 2000);
      };
      ws.onerror = () => ws?.close();
      ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data) as WsMessage;
        if (m.type === 'state') setState(m.data);
        cb.current?.(m);
      };
    };
    connect();
    return () => {
      stop = true;
      window.clearTimeout(retry);
      ws?.close();
    };
  }, []);
  return { state, connected };
}

export function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}
