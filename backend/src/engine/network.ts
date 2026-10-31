// Şəbəkə modeli: hər xətt gediş + qayıdış həndəsəsindən ibarət bir "dövrə" (loop) kimi saxlanılır.
// Avtobusun vəziyyəti = dövrə boyunca məsafə (metr). Bu ETA, interval və proqnoz hesablarını sadələşdirir.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { type LatLon, type Path, makePath, project } from '../lib/geo.js';

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

export interface RouteInfo {
  id: string;
  name: string;
  kind: 'express' | 'regular';
  color: string;
  headwayMin: number;
  demand: number;
  plannedBuses: number;
  capacity: number;
  stopIds: string[]; // gediş istiqamətində
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
}

interface GeoFile {
  stops: Record<string, StopInfo>;
  routes: Array<{
    id: string;
    name: string;
    kind: 'express' | 'regular';
    color: string;
    stops: string[];
    buses: number;
    headwayMin: number;
    demand: number;
    forward: LatLon[];
    backward: LatLon[];
  }>;
}

export function loadNetwork(file?: string): Network {
  const here = dirname(fileURLToPath(import.meta.url));
  const raw = JSON.parse(readFileSync(file ?? join(here, '..', 'seed', 'geodata.json'), 'utf8')) as GeoFile;
  return buildNetwork(raw);
}

export function buildNetwork(raw: GeoFile): Network {
  const stops = new Map<string, StopInfo>(Object.values(raw.stops).map((s) => [s.id, s]));
  const routes = new Map<string, RouteInfo>();
  const routesByStop = new Map<string, string[]>();

  for (const r of raw.routes) {
    const fwd = makePath(r.forward);
    const loopPts: LatLon[] = [...r.forward, ...r.backward.slice(1)];
    const path = makePath(loopPts);
    const fwdLen = fwd.length;
    const first = stops.get(r.stops[0])!.name;
    const last = stops.get(r.stops[r.stops.length - 1])!.name;

    const loopStops: LoopStop[] = [];
    // gediş: hər dayanacağı gediş hissəsinə proyeksiya et (monoton artan məsafə)
    let prev = 0;
    r.stops.forEach((sid, i) => {
      const s = stops.get(sid)!;
      const pr = i === 0 ? { d: 0 } : i === r.stops.length - 1 ? { d: fwdLen } : project(path, [s.lat, s.lon], { from: prev, to: fwdLen });
      prev = pr.d;
      // son dayanacaqda avtobus dönür: oradan minən sərnişin geri istiqamətdə gedir
      const isTerminal = i === r.stops.length - 1;
      loopStops.push({ stopId: sid, seq: 0, dir: isTerminal ? 1 : 0, d: pr.d, towards: isTerminal ? first : last });
    });
    // qayıdış: son dayanacaq artıq dönüş nöqtəsidir, onu təkrarlamırıq
    const back = [...r.stops].reverse();
    prev = fwdLen;
    back.forEach((sid, i) => {
      if (i === 0) return;
      const s = stops.get(sid)!;
      const pr = i === back.length - 1 ? { d: path.length - 1 } : project(path, [s.lat, s.lon], { from: prev, to: path.length });
      prev = pr.d;
      loopStops.push({ stopId: sid, seq: 0, dir: 1, d: pr.d, towards: first });
    });
    loopStops.sort((a, b) => a.d - b.d).forEach((s, i) => (s.seq = i));

    routes.set(r.id, {
      id: r.id,
      name: r.name,
      kind: r.kind,
      color: r.color,
      headwayMin: r.headwayMin,
      demand: r.demand,
      plannedBuses: r.buses,
      capacity: r.kind === 'express' ? 95 : 85,
      stopIds: r.stops,
      path,
      forwardLength: fwdLen,
      loopStops,
      forward: r.forward,
      backward: r.backward,
    });
    for (const sid of new Set(r.stops)) {
      if (!routesByStop.has(sid)) routesByStop.set(sid, []);
      routesByStop.get(sid)!.push(r.id);
    }
  }
  return { stops, routes, routesByStop };
}
