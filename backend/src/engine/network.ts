// Şəbəkə modeli: hər xətt bir "dövrə" (loop) kimi saxlanılır — gediş + qayıdış bir polilayn.
// Avtobusun vəziyyəti = dövrə boyunca məsafə (metr). Bu ETA, interval və proqnoz hesablarını sadələşdirir.
// Məlumat: opendata.az (AYNA marşrut həndəsəsi, BakuBus dayanacaqları və gündəlik gedişlər),
// scripts/import-opendata.mjs ilə backend/src/seed/geodata.json-a çevrilir.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { type LatLon, type Path, makePath } from '../lib/geo.js';

export interface StopInfo {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

export interface LoopStop {
  stopId: string;
  seq: number; // dövrə üzrə sıra
  dir: 0 | 1; // 0 = gediş, 1 = qayıdış
  d: number; // dövrə boyunca məsafə (m)
  towards: string; // istiqamətin son dayanacağının adı
}

export interface Ridership {
  meanDaily: number;
  recentDaily: number;
  days: number;
  from: string;
  to: string;
  dow: number[]; // bazar=0 … şənbə=6, orta günə nisbət
  series: Array<[string, number]>; // son 90 gün (AA-GG, gediş)
}

export interface RouteInfo {
  id: string;
  name: string;
  kind: 'express' | 'regular';
  color: string;
  headwayMin: number;
  /** Nisbi sıxlıq indeksi: bir avtobusa düşən real gündəlik gediş / şəbəkə medianı. */
  demand: number;
  ridership: Ridership;
  plannedBuses: number;
  capacity: number;
  stopIds: string[]; // dövrə sırası ilə, təkrarsız
  path: Path; // dövrə
  forwardLength: number;
  loopStops: LoopStop[];
  forward: LatLon[];
  backward: LatLon[];
}

export interface Network {
  stops: Map<string, StopInfo>;
  routes: Map<string, RouteInfo>;
  routesByStop: Map<string, string[]>;
  defaultStop: string;
  sources: Array<{ file: string; page: string; licence: string; publisher: string }>;
}

export interface GeoFile {
  defaultStop: string;
  sources?: Network['sources'];
  stops: Record<string, StopInfo>;
  routes: Array<{
    id: string;
    name: string;
    kind: 'express' | 'regular';
    color: string;
    loop: LatLon[];
    fwdLen: number;
    stops: Array<{ stopId: string; d: number }>;
    buses: number;
    headwayMin: number;
    ridership: Ridership;
  }>;
}

const here = dirname(fileURLToPath(import.meta.url));

export function loadNetwork(file?: string): Network {
  const raw = JSON.parse(readFileSync(file ?? join(here, '..', 'seed', 'geodata.json'), 'utf8')) as GeoFile;
  return buildNetwork(raw);
}

export function loadBackground(): unknown {
  return JSON.parse(readFileSync(join(here, '..', 'seed', 'network-all.json'), 'utf8'));
}

export function buildNetwork(raw: GeoFile): Network {
  const stops = new Map<string, StopInfo>(Object.values(raw.stops).map((s) => [s.id, s]));
  const routes = new Map<string, RouteInfo>();
  const routesByStop = new Map<string, string[]>();

  const perBus = raw.routes.map((r) => r.ridership.recentDaily / Math.max(1, r.buses)).sort((a, b) => a - b);
  const median = perBus[Math.floor(perBus.length / 2)] || 1;

  for (const r of raw.routes) {
    const path = makePath(r.loop);
    const fwdLen = Math.min(r.fwdLen, path.length);
    const turnIdx = path.cum.findIndex((c) => c >= fwdLen);
    const forward = r.loop.slice(0, Math.max(2, turnIdx + 1));
    const backward = r.loop.slice(Math.max(0, turnIdx));
    const sorted = [...r.stops].filter((s) => stops.has(s.stopId)).sort((a, b) => a.d - b.d);
    const nameOf = (id: string) => stops.get(id)!.name;
    const firstName = nameOf(sorted[0].stopId);
    const terminal = sorted.reduce((a, b) => (Math.abs(b.d - fwdLen) < Math.abs(a.d - fwdLen) ? b : a));
    const termName = nameOf(terminal.stopId);
    const loopStops: LoopStop[] = sorted.map((s, i) => {
      // dönüş dayanacağından minən sərnişin artıq geri istiqamətdə gedir
      const dir: 0 | 1 = s.d < fwdLen - 30 ? 0 : 1;
      return { stopId: s.stopId, seq: i, dir, d: Math.min(s.d, path.length - 1), towards: dir === 0 ? termName : firstName };
    });
    const stopIds = [...new Set(loopStops.map((s) => s.stopId))];
    routes.set(r.id, {
      id: r.id,
      name: r.name,
      kind: r.kind,
      color: r.color,
      headwayMin: r.headwayMin,
      demand: +(r.ridership.recentDaily / Math.max(1, r.buses) / median).toFixed(3),
      ridership: r.ridership,
      plannedBuses: r.buses,
      capacity: r.kind === 'express' ? 95 : 85,
      stopIds,
      path,
      forwardLength: fwdLen,
      loopStops,
      forward,
      backward,
    });
    for (const sid of stopIds) {
      if (!routesByStop.has(sid)) routesByStop.set(sid, []);
      routesByStop.get(sid)!.push(r.id);
    }
  }
  return { stops, routes, routesByStop, defaultStop: raw.defaultStop, sources: raw.sources ?? [] };
}
