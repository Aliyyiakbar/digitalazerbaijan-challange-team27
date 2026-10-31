// Analitika engine — sistemin mərkəzi.
// GPS ping-ləri və sərnişin bildirişlərini qəbul edir, hər dövrdə (default 2 san) xətlər üzrə
// sıxlığı, etibarı, intervalları, tıxac səbəbini, proqnozu və domino riskini hesablayır,
// qaydaları yoxlayır və xəbərdarlıqlar yaradır. Nəticələr Redis pub/sub → WebSocket ilə yayılır.
import { EventEmitter } from 'node:events';
import { randomUUID, createHash } from 'node:crypto';
import type { Db } from '../db/db.js';
import type { LiveStore } from '../db/store.js';
import type { SimClock } from '../lib/clock.js';
import { aheadDistance, bearingAt, haversine, pointAt, project } from '../lib/geo.js';
import type { LoopStop, Network, RouteInfo } from './network.js';
import type { Alert, AlertType, Badge, BusState, CrowdEstimate, CrowdReport, Level, ReportContext } from './types.js';
import { WINDOW_MS, badgeFor, estimate, scoreToLevel, HIGH_SCORE, MEDIUM_SCORE } from './crowd.js';
import { effectiveTrust, geoWeight, TRUST_START, updateTrust } from './trust.js';
import { detectBots } from './botdetect.js';
import { analyzeHeadways, type BunchingResult } from './bunching.js';
import { classifyCause, type CauseResult } from './cause.js';
import { effectiveSpeed, etaSeconds } from './eta.js';
import { ForecastModel } from './forecast.js';
import { stopRisk, type RippleStop } from './ripple.js';
import { skipAdvice, type AdviceArrival } from './advice.js';
import { plan as planJourney } from './planner.js';
import { SustainedHighRule } from './rules.js';

const SNAPSHOT_EVERY_MS = 30_000;
const SAMPLE_KEEP_MS = 10 * 60_000;
const SPEED_KEEP_MS = 5 * 60_000; // sürət tıxaca tez reaksiya versin
const DWELL_RADIUS_M = 35;

export interface GpsPing {
  busId: string;
  routeId: string;
  lat: number;
  lon: number;
  dir?: 0 | 1;
  label?: string;
  reserve?: boolean;
}

export interface ReportInput {
  routeId?: string;
  busId?: string;
  stopId?: string;
  context: ReportContext;
  level: Level;
  deviceId: string;
  ip: string;
  lat?: number;
  lon?: number;
  accuracy?: number;
  source: CrowdReport['source'];
}

export interface ReportResult {
  ok: boolean;
  status: number;
  error?: string;
  report?: Pick<CrowdReport, 'id' | 'routeId' | 'busId' | 'stopId' | 'context' | 'level' | 'geoWeight' | 'trust' | 'distanceM'>;
  message?: string;
}

interface RouteRuntime {
  speedSamples: Array<{ ts: number; v: number }>;
  dwellSamples: Array<{ ts: number; s: number }>;
  rate: { minuteTs: number; count: number; baseline: number };
  attackUntil: number;
  attackSignals: string[];
  lastAlert: Partial<Record<AlertType, number>>;
  trafficSince: number | null;
  bunchSince: number | null;
}

export interface RouteView {
  id: string;
  name: string;
  kind: string;
  color: string;
  buses: number;
  plannedBuses: number;
  reserveBuses: number;
  crowd: CrowdEstimate;
  highForMs: number;
  cause: CauseResult;
  speedKmh: number | null;
  headway: Pick<BunchingResult, 'idealS' | 'cv' | 'pairs' | 'bigGaps'>;
  forecast: { p15: number | null; p30: number | null; baselineNow: number | null };
  attack: { active: boolean; signals: string[] };
  ripple: Array<RippleStop & { name: string }>;
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
  crowd: CrowdEstimate;
  bunchedFollower: boolean;
  holdS: number;
  dwellingAt: string | null;
}

export class Engine extends EventEmitter {
  buses = new Map<string, BusState>();
  devices = new Map<string, { firstSeen: number; trust: number; reports: number }>();
  alerts: Alert[] = [];
  reservePool: number;
  private rt = new Map<string, RouteRuntime>();
  private rule = new SustainedHighRule();
  forecast = new ForecastModel();
  forecastMae: number | null = null;
  private routeViews = new Map<string, RouteView>();
  private busViews = new Map<string, BusView>();
  private stopCrowd = new Map<string, CrowdEstimate>();
  private lastSnapshot = 0;
  private timer: NodeJS.Timeout | null = null;
  private busCounter = new Map<string, number>();
  private ipSalt = randomUUID();

  constructor(
    public net: Network,
    public clock: SimClock,
    public db: Db,
    public store: LiveStore,
    opts: { reservePool?: number } = {},
  ) {
    super();
    this.reservePool = opts.reservePool ?? 6;
    for (const id of net.routes.keys())
      this.rt.set(id, {
        speedSamples: [],
        dwellSamples: [],
        rate: { minuteTs: 0, count: 0, baseline: 1 },
        attackUntil: 0,
        attackSignals: [],
        lastAlert: {},
        trafficSince: null,
        bunchSince: null,
      });
  }

  // ---------------------------------------------------------------- başlanğıc

  async init(): Promise<void> {
    await this.seedNetwork();
    await this.loadForecast();
    const rows = await this.db.query<{ id: string; type: AlertType; route_id: string | null; created_at: Date; status: Alert['status']; title: string; recommendation: string; confidence: number | null; badge: Badge; explanation: Record<string, unknown>; dispatched_bus: string | null }>(
      'select * from alerts order by created_at desc limit 100',
    );
    this.alerts = rows.map((a) => ({
      id: a.id,
      type: a.type,
      routeId: a.route_id,
      createdAt: new Date(a.created_at).getTime(),
      status: a.status,
      title: a.title,
      recommendation: a.recommendation,
      confidence: a.confidence,
      badge: a.badge,
      explanation: a.explanation,
      dispatchedBusId: a.dispatched_bus,
    }));
    const devs = await this.db.query<{ id: string; first_seen: Date; trust: number; reports: number }>("select * from devices where source = 'app'");
    for (const d of devs) this.devices.set(d.id, { firstSeen: new Date(d.first_seen).getTime(), trust: d.trust, reports: d.reports });
  }

  private async seedNetwork(): Promise<void> {
    const [{ n }] = await this.db.query<{ n: string }>('select count(*)::text as n from routes');
    if (Number(n) > 0) return;
    for (const s of this.net.stops.values()) await this.db.query('insert into stops(id,name,lat,lon) values ($1,$2,$3,$4) on conflict do nothing', [s.id, s.name, s.lat, s.lon]);
    for (const r of this.net.routes.values()) {
      await this.db.query('insert into routes(id,name,kind,color,headway_min,capacity) values ($1,$2,$3,$4,$5,$6) on conflict do nothing', [r.id, r.name, r.kind, r.color, r.headwayMin, r.capacity]);
      for (const ls of r.loopStops)
        await this.db.query('insert into route_stops(route_id,seq,stop_id,dir,dist_m) values ($1,$2,$3,$4,$5) on conflict do nothing', [r.id, ls.seq, ls.stopId, ls.dir, ls.d]);
    }
  }

  async loadForecast(): Promise<void> {
    const rows = await this.db.query<{ ts: Date; route_id: string; score: number }>('select ts, route_id, score from snapshots where score is not null order by ts');
    if (!rows.length) return;
    const obs = rows.map((r) => ({ ts: new Date(r.ts).getTime(), routeId: r.route_id, score: r.score }));
    // son günü yoxlama üçün saxla, qalanı ilə öyrət
    const lastTs = obs[obs.length - 1].ts;
    const cut = lastTs - 24 * 3600_000;
    const train = obs.filter((o) => o.ts < cut);
    const test = obs.filter((o) => o.ts >= cut);
    if (train.length > 100 && test.length > 10) {
      this.forecast.train(train);
      this.forecastMae = this.forecast.mae(test);
    }
    this.forecast.train(obs);
  }

  start(intervalMs = 2000): void {
    this.timer = setInterval(() => {
      this.tick().catch((e) => console.error('[engine] tick xətası', e));
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  // ---------------------------------------------------------------- GPS

  ingestGps(p: GpsPing): { ok: boolean; error?: string } {
    const route = this.net.routes.get(p.routeId);
    if (!route) return { ok: false, error: 'Naməlum xətt' };
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return { ok: false, error: 'Koordinat düzgün deyil' };
    const now = this.clock.now();
    const L = route.path.length;
    let bus = this.buses.get(p.busId);
    let window: { from: number; to: number } | undefined;
    if (bus && bus.routeId === p.routeId) {
      const dt = Math.max(1, (now - bus.lastTs) / 1000);
      window = { from: bus.d - 150, to: bus.d + Math.max(2500, dt * 40) };
    } else if (p.dir != null) {
      window = p.dir === 0 ? { from: 0, to: route.forwardLength } : { from: route.forwardLength, to: L };
    }
    const pr = project(route.path, [p.lat, p.lon], window);
    const d = ((pr.d % L) + L) % L;

    if (!bus || bus.routeId !== p.routeId) {
      const n = (this.busCounter.get(p.routeId) ?? 0) + 1;
      this.busCounter.set(p.routeId, n);
      bus = {
        id: p.busId,
        routeId: p.routeId,
        label: p.label ?? `${p.routeId}·${n}`,
        d,
        lat: p.lat,
        lon: p.lon,
        bearing: bearingAt(route.path, d),
        speed: 0,
        lastTs: now,
        dwellingAt: null,
        dwellStart: null,
        reserve: !!p.reserve,
        addedAt: now,
      };
      this.buses.set(p.busId, bus);
      this.db
        .query("insert into buses(id,route_id,label,status) values ($1,$2,$3,$4) on conflict (id) do update set route_id = excluded.route_id, status = excluded.status", [bus.id, bus.routeId, bus.label, bus.reserve ? 'reserve' : 'active'])
        .catch(() => {});
      return { ok: true };
    }

    const dt = (now - bus.lastTs) / 1000;
    if (dt <= 0) return { ok: true };
    let moved = aheadDistance(bus.d, d, L);
    if (moved > L - 200) moved = 0; // kiçik geri sürüşmə (GPS səsi)
    const raw = moved / dt;
    bus.speed = bus.speed * 0.6 + raw * 0.4;
    const rt = this.rt.get(route.id)!;
    if (raw > 1.5 && raw < 30) rt.speedSamples.push({ ts: now, v: raw });

    // dayanma aşkarlanması
    const near = nearestLoopStop(route.loopStops, d, L);
    const atStop = near && near.dist <= DWELL_RADIUS_M && raw < 1.2;
    const key = near ? `${near.stop.stopId}#${near.stop.seq}` : null;
    if (atStop && bus.dwellingAt == null) {
      bus.dwellingAt = key;
      bus.dwellStart = bus.lastTs;
    } else if (!atStop && bus.dwellingAt != null && bus.dwellStart != null) {
      const dwellS = (now - bus.dwellStart) / 1000;
      if (dwellS >= 3 && dwellS < 900) {
        rt.dwellSamples.push({ ts: now, s: dwellS });
        const stopId = bus.dwellingAt.split('#')[0];
        this.db
          .query('insert into stop_dwell_events(bus_id,route_id,stop_id,arrived,departed,dwell_s) values ($1,$2,$3,$4,$5,$6)', [bus.id, route.id, stopId, new Date(bus.dwellStart), new Date(now), dwellS])
          .catch(() => {});
      }
      bus.dwellingAt = null;
      bus.dwellStart = null;
    }

    const snapped = pointAt(route.path, d);
    bus.d = d;
    bus.lat = snapped[0];
    bus.lon = snapped[1];
    bus.bearing = bearingAt(route.path, d);
    bus.lastTs = now;
    return { ok: true };
  }

  removeBus(busId: string): void {
    this.buses.delete(busId);
    this.busViews.delete(busId);
    this.store.removeBus(busId).catch(() => {});
    this.db.query("update buses set status = 'depot' where id = $1", [busId]).catch(() => {});
  }

  // ---------------------------------------------------------------- cihazlar və bildirişlər

  touchDevice(id: string, source: string): { firstSeen: number; trust: number; reports: number } {
    let d = this.devices.get(id);
    if (!d) {
      // simulyasiyanın "dürüst" sərnişinləri köhnə, etibarı orta-yüksək cihazlar kimi modelləşdirilir
      d = source === 'sim' ? { firstSeen: this.clock.now() - 86_400_000, trust: 0.7, reports: 0 } : { firstSeen: this.clock.now(), trust: TRUST_START, reports: 0 };
      this.devices.set(id, d);
      if (source !== 'sim')
        this.db.query('insert into devices(id,first_seen,trust,source) values ($1,$2,$3,$4) on conflict do nothing', [id, new Date(d.firstSeen), d.trust, source]).catch(() => {});
    }
    return d;
  }

  hashIp(ip: string): string {
    return createHash('sha256').update(this.ipSalt + ip).digest('hex').slice(0, 16);
  }

  async submitReport(inp: ReportInput): Promise<ReportResult> {
    const now = this.clock.now();
    let routeId = inp.routeId ?? null;
    let busId = inp.busId ?? null;
    const stopId = inp.stopId ?? null;
    if (busId) {
      const b = this.buses.get(busId);
      if (!b) return { ok: false, status: 404, error: 'Bu avtobus hazırda xətdə deyil' };
      routeId = b.routeId;
    }
    if (!routeId || !this.net.routes.has(routeId)) return { ok: false, status: 400, error: 'Xətt göstərilməyib və ya naməlumdur' };
    const route = this.net.routes.get(routeId)!;
    if (inp.context === 'stop') {
      if (!stopId || !route.stopIds.includes(stopId)) return { ok: false, status: 400, error: 'Dayanacaq bu xəttə aid deyil' };
      busId = null;
    }
    const hasGeo = inp.lat != null && inp.lon != null && Number.isFinite(inp.lat) && Number.isFinite(inp.lon);
    // avtobus seçilməyibsə — istifadəçiyə ən yaxın avtobusu götür
    if (inp.context === 'bus' && !busId) {
      const cands = [...this.buses.values()].filter((b) => b.routeId === routeId);
      if (!cands.length) return { ok: false, status: 409, error: 'Bu xətdə hazırda avtobus yoxdur' };
      if (hasGeo) {
        cands.sort((a, b) => haversine([inp.lat!, inp.lon!], [a.lat, a.lon]) - haversine([inp.lat!, inp.lon!], [b.lat, b.lon]));
        busId = cands[0].id;
      }
    }

    // spam limiti: eyni cihaz eyni hədəf üçün 2 dəqiqədə 1 dəfə; ümumi 10 dəqiqədə 20
    if (inp.source === 'app') {
      const target = busId ?? `${routeId}:${stopId ?? 'route'}`;
      if (!(await this.store.rateLimit(`${inp.deviceId}:${target}`, 120_000, 1)))
        return { ok: false, status: 429, error: 'Bu avtobus üçün artıq bildiriş göndərmisiniz. 2 dəqiqə sonra yenidən cəhd edin.' };
      if (!(await this.store.rateLimit(`${inp.deviceId}:all`, 600_000, 20)))
        return { ok: false, status: 429, error: 'Çox sayda bildiriş. Bir az sonra yenidən cəhd edin.' };
    }

    let distanceM: number | null = null;
    if (hasGeo) {
      if (inp.context === 'bus' && busId) {
        const b = this.buses.get(busId)!;
        distanceM = haversine([inp.lat!, inp.lon!], [b.lat, b.lon]);
      } else if (stopId) {
        const s = this.net.stops.get(stopId)!;
        distanceM = haversine([inp.lat!, inp.lon!], [s.lat, s.lon]);
      }
    }
    const gw = geoWeight(distanceM, inp.accuracy ?? null);
    const dev = this.touchDevice(inp.deviceId, inp.source);
    const trust = effectiveTrust(dev.trust, now - dev.firstSeen);
    const rt = this.rt.get(routeId)!;
    const report: CrowdReport = {
      id: randomUUID(),
      ts: now,
      routeId,
      busId,
      stopId,
      context: inp.context,
      level: inp.level,
      deviceId: inp.deviceId,
      ip: this.hashIp(inp.ip),
      hasGeo,
      distanceM: distanceM == null ? null : Math.round(distanceM),
      geoWeight: gw,
      trust,
      quarantined: rt.attackUntil > now && inp.source !== 'sim' && (!hasGeo || now - dev.firstSeen < 2 * 60_000),
      source: inp.source,
    };

    // etibarın yenilənməsi: bu cihaz istisna olmaqla mövcud konsensusla müqayisə
    const prior = (await this.store.reports(routeId, now - WINDOW_MS)).filter(
      (r) => r.deviceId !== inp.deviceId && r.context === report.context && (report.context === 'bus' ? r.busId === busId : r.stopId === stopId),
    );
    const cons = estimate(prior, now);
    dev.trust = updateTrust(dev.trust, report.level, cons.score, cons.confidence);
    dev.reports++;

    await this.store.addReport(report);
    this.db
      .query(
        'insert into crowd_reports(id,ts,route_id,bus_id,stop_id,context,level,device_id,ip_hash,has_geo,distance_m,geo_weight,trust,quarantined,source) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)',
        [report.id, new Date(now), routeId, busId, stopId, report.context, report.level, report.deviceId, report.ip, hasGeo, report.distanceM, gw, trust, report.quarantined, report.source],
      )
      .catch((e) => console.error('[db] report', e.message));
    if (inp.source !== 'sim')
      this.db.query('update devices set trust = $2, reports = reports + 1 where id = $1', [inp.deviceId, dev.trust]).catch(() => {});

    const msg =
      gw >= 1 ? 'Təşəkkürlər! Bildirişiniz tam çəki ilə qəbul edildi.' : hasGeo ? 'Təşəkkürlər! Avtobusdan/dayanacaqdan uzaq olduğunuz üçün bildirişin çəkisi azaldıldı.' : 'Təşəkkürlər! Yer məlumatı olmadığı üçün bildiriş azaldılmış çəki ilə qəbul edildi.';
    return {
      ok: true,
      status: 201,
      message: msg,
      report: { id: report.id, routeId, busId, stopId, context: report.context, level: report.level, geoWeight: gw, trust, distanceM: report.distanceM },
    };
  }

  // ---------------------------------------------------------------- analitika dövrü

  async tick(): Promise<void> {
    const now = this.clock.now();
    const newAlerts: Alert[] = [];

    // mövqeləri Redis-ə yaz
    const pos: Record<string, string> = {};
    for (const b of this.buses.values()) pos[b.id] = JSON.stringify({ routeId: b.routeId, lat: b.lat, lon: b.lon, d: b.d, ts: b.lastTs });
    await this.store.setBusPositions(pos);

    // dayanma müddətinin adaptiv bazası: bütün şəbəkə üzrə median
    const dwellAvg = new Map<string, number | null>();
    for (const [id, rt] of this.rt) {
      rt.speedSamples = rt.speedSamples.filter((s) => now - s.ts <= SPEED_KEEP_MS);
      rt.dwellSamples = rt.dwellSamples.filter((s) => now - s.ts <= SAMPLE_KEEP_MS);
      dwellAvg.set(id, rt.dwellSamples.length >= 2 ? rt.dwellSamples.reduce((a, s) => a + s.s, 0) / rt.dwellSamples.length : null);
    }
    const known = [...dwellAvg.values()].filter((x): x is number => x != null).sort((a, b) => a - b);
    const baseDwell = known.length >= 3 ? known[Math.floor(known.length / 2)] : null;

    for (const route of this.net.routes.values()) {
      const rt = this.rt.get(route.id)!;
      const movingSpeed = rt.speedSamples.length >= 3 ? rt.speedSamples.reduce((a, s) => a + s.v, 0) / rt.speedSamples.length : null;
      const avgDwell = dwellAvg.get(route.id) ?? null;
      const reports = await this.store.reports(route.id, now - WINDOW_MS - 60_000);

      // --- bot aşkarlanması
      const verdict = detectBots(reports, now, this.devices, rt.rate.baseline);
      if (verdict.attack) {
        rt.attackUntil = now + 5 * 60_000;
        rt.attackSignals = verdict.signals;
        for (const r of reports)
          if (verdict.suspiciousIds.has(r.id) && !r.quarantined) {
            r.quarantined = true;
            await this.store.updateReport(r);
            this.db.query('update crowd_reports set quarantined = true where id = $1', [r.id]).catch(() => {});
            const dev = this.devices.get(r.deviceId);
            if (dev) dev.trust = Math.max(0.1, dev.trust - 0.2);
          }
        if (this.cooldownOk(rt, 'bot', now, 10 * 60_000))
          newAlerts.push(
            this.makeAlert('bot', route.id, now, `${route.id} xəttində saxta bildiriş hücumu şübhəsi`, 'Şübhəli bildirişlər karantinə alındı və sıxlıq hesabından çıxarıldı. Bu xətt üzrə tövsiyələri əl ilə yoxlayın.', null, 'suspicious', {
              signals: verdict.signals,
              quarantined: verdict.suspiciousIds.size,
              ratePerMin: verdict.ratePerMin,
              baselinePerMin: verdict.baselinePerMin,
            }),
          );
      } else {
        // adi bildiriş sürətinin bazası (EWMA) — yalnız hücum olmayanda yenilənir
        const minute = Math.floor(now / 60_000);
        if (minute !== rt.rate.minuteTs) {
          const lastMinuteCount = reports.filter((r) => now - r.ts <= 60_000).length;
          rt.rate.baseline = rt.rate.baseline * 0.8 + lastMinuteCount * 0.2;
          rt.rate.minuteTs = minute;
        }
      }
      const underAttack = rt.attackUntil > now;
      const live = reports.filter((r) => now - r.ts <= WINDOW_MS);

      // --- intervallar və toplanma
      const routeBuses = [...this.buses.values()].filter((b) => b.routeId === route.id);
      const headway = analyzeHeadways(routeBuses.map((b) => ({ id: b.id, d: b.d, label: b.label })), route.path.length, movingSpeed ?? 7);
      const hwById = new Map(headway.headways.map((h) => [h.busId, h]));

      // --- səbəb (tıxac / tələbat)
      const dwellRatio = avgDwell == null ? null : avgDwell / (baseDwell ?? 22);
      const expectedNow = this.forecast.baseline(route.id, now);

      // --- avtobus üzrə sıxlıq
      const busCrowd = new Map<string, CrowdEstimate>();
      for (const b of routeBuses) {
        const own = live.filter((r) => r.context === 'bus' && r.busId === b.id);
        const hw = hwById.get(b.id);
        const e = estimate(own, now, {
          bunchedFollower: hw?.bunched,
          longDwell: dwellRatio != null && dwellRatio > 1.5,
          shortDwell: dwellRatio != null && dwellRatio < 0.9 && (movingSpeed ?? 0) > 5,
          expectedScore: expectedNow,
          underAttack,
        });
        busCrowd.set(b.id, e);
      }

      // --- xətt üzrə sıxlıq
      const busReports = live.filter((r) => r.context === 'bus');
      const crowd = estimate(busReports, now, {
        longDwell: dwellRatio != null && dwellRatio > 1.5,
        shortDwell: dwellRatio != null && dwellRatio < 0.9 && (movingSpeed ?? 0) > 5,
        expectedScore: expectedNow,
        underAttack,
      });
      if (crowd.level === 3) {
        // "yüksək" bildirişlərin çoxu toplanmanın arxa avtobuslarına aiddirsə — şübhəli
        const highW = busReports.filter((r) => r.level === 3 && !r.quarantined);
        const onFollowers = highW.filter((r) => r.busId && hwById.get(r.busId)?.bunched).length;
        if (highW.length >= 3 && onFollowers / highW.length > 0.5) {
          crowd.confidence *= 0.6;
          crowd.reasons.push('"Yüksək" bildirişlərin çoxu toplanmış qrupun arxa avtobusuna aiddir');
          crowd.badge = badgeFor(crowd.confidence, crowd.n, underAttack);
        }
      }
      const cause = classifyCause({ movingSpeed, avgDwellS: avgDwell, crowdScore: crowd.score, baseDwellS: baseDwell });

      // --- dayanacaq sıxlığı (gözləyənlər)
      for (const sid of new Set(route.stopIds)) {
        const sr = live.filter((r) => r.context === 'stop' && r.stopId === sid);
        if (sr.length) this.stopCrowd.set(`${route.id}|${sid}`, estimate(sr, now, { underAttack }));
        else this.stopCrowd.delete(`${route.id}|${sid}`);
      }

      // --- proqnoz
      if (crowd.score != null && crowd.confidence >= 0.35) this.forecast.observe(route.id, now, crowd.score);
      const p15 = this.forecast.predict(route.id, now, 15);
      const p30 = this.forecast.predict(route.id, now, 30);

      // --- domino riski
      const vEff = (b: BusState) => effectiveSpeed(b.speed, movingSpeed);
      const plannedHeadwayS = route.headwayMin * 60;
      const ripple: Array<RippleStop & { name: string }> = route.loopStops.map((ls) => {
        const arr = routeBuses.map((b) => ({
          busId: b.id,
          etaS: etaSeconds(b.d, ls.d, route.path.length, route.loopStops, vEff(b), avgDwell ?? 22).seconds,
          level: busCrowd.get(b.id)?.level ?? crowd.level,
        }));
        const r = stopRisk(arr, plannedHeadwayS);
        return { stopId: ls.stopId, seq: ls.seq, dir: ls.dir, name: this.net.stops.get(ls.stopId)!.name, ...r };
      });

      // --- əsas qayda: 10 dəqiqə davamlı yüksək
      const res = this.rule.evaluate(route.id, crowd, now);
      if (res.fire) newAlerts.push(this.reserveAlert(route, crowd, res.highForMs, cause, p30, ripple, now));

      // --- qabaqlayıcı proqnoz xəbərdarlığı
      if (p30 != null && p30 >= HIGH_SCORE && (crowd.score == null || crowd.score < HIGH_SCORE - 0.2) && this.cooldownOk(rt, 'forecast', now, 30 * 60_000))
        newAlerts.push(
          this.makeAlert('forecast', route.id, now, `${route.id}: 30 dəqiqə sonra yüksək sıxlıq gözlənilir`, `Proqnoz ${p30.toFixed(2)} bal göstərir. Ehtiyat avtobusu indidən hazır vəziyyətə gətirin.`, null, 'none', {
            p15,
            p30,
            now: crowd.score,
            model: 'baza (xətt × 15 dəq × gün növü) + EWMA düzəlişi',
            mae: this.forecastMae,
          }),
        );

      // --- toplanma xəbərdarlığı (cüt ən azı 3 dəqiqə toplanmış qalıbsa)
      if (headway.pairs.length) rt.bunchSince ??= now;
      else rt.bunchSince = null;
      if (headway.pairs.length && rt.bunchSince != null && now - rt.bunchSince >= 3 * 60_000 && this.cooldownOk(rt, 'bunching', now, 15 * 60_000)) {
        const p = headway.pairs[0];
        const f = this.buses.get(p.follower);
        const l = this.buses.get(p.leader);
        const holdMin = Math.max(1, Math.round(p.holdS / 60));
        const nextStop = f ? nextLoopStop(route.loopStops, f.d, route.path.length) : null;
        const stopName = nextStop ? this.net.stops.get(nextStop.stopId)!.name : 'növbəti';
        newAlerts.push(
          this.makeAlert('bunching', route.id, now, `${route.id}: ${l?.label ?? ''} və ${f?.label ?? ''} bir-birinin ardınca gedir`, `${f?.label} avtobusunu ${stopName} dayanacağında təxminən ${holdMin} dəq saxlayın ki, intervallar bərabərləşsin.`, null, 'none', {
            pairs: headway.pairs.map((x) => ({ ...x, leaderLabel: this.buses.get(x.leader)?.label, followerLabel: this.buses.get(x.follower)?.label })),
            idealHeadwayMin: +(headway.idealS / 60).toFixed(1),
            cv: +headway.cv.toFixed(2),
            method: 'İnterval əsaslı saxlama: (arxa interval − ön interval) / 2',
          }),
        );
      }

      // --- tıxac xəbərdarlığı (3 dəqiqə davamlı)
      if (cause.cause === 'traffic' || cause.cause === 'mixed') {
        rt.trafficSince ??= now;
        if (now - rt.trafficSince >= 3 * 60_000 && this.cooldownOk(rt, 'traffic', now, 15 * 60_000))
          newAlerts.push(
            this.makeAlert('traffic', route.id, now, `${route.id}: tıxac səbəbindən gecikmə`, 'Problem tələbatda deyil, yolda: əlavə avtobus intervalı tam düzəltməyəcək. Avtobus zolağına nəzarəti gücləndirin və ya alternativ küçə ilə yönləndirin.', null, 'none', {
              speedRatio: cause.speedRatio,
              dwellRatio: cause.dwellRatio,
              congestion: cause.congestion,
              text: cause.text,
            }),
          );
      } else rt.trafficSince = null;

      // --- görünüşlər
      for (const b of routeBuses) {
        const hw = hwById.get(b.id);
        const dir: 0 | 1 = b.d < route.forwardLength ? 0 : 1;
        this.busViews.set(b.id, {
          id: b.id,
          routeId: b.routeId,
          label: b.label,
          lat: b.lat,
          lon: b.lon,
          bearing: Math.round(b.bearing),
          speedKmh: Math.round(b.speed * 3.6),
          d: b.d,
          dir,
          towards: dir === 0 ? this.net.stops.get(route.stopIds[route.stopIds.length - 1])!.name : this.net.stops.get(route.stopIds[0])!.name,
          reserve: b.reserve,
          crowd: busCrowd.get(b.id)!,
          bunchedFollower: !!hw?.bunched,
          holdS: Math.round(hw?.holdS ?? 0),
          dwellingAt: b.dwellingAt,
        });
      }
      this.routeViews.set(route.id, {
        id: route.id,
        name: route.name,
        kind: route.kind,
        color: route.color,
        buses: routeBuses.length,
        plannedBuses: route.plannedBuses,
        reserveBuses: routeBuses.filter((b) => b.reserve).length,
        crowd,
        highForMs: res.highForMs,
        cause,
        speedKmh: movingSpeed == null ? null : Math.round(movingSpeed * 3.6),
        headway: { idealS: headway.idealS, cv: headway.cv, pairs: headway.pairs, bigGaps: headway.bigGaps },
        forecast: { p15, p30, baselineNow: expectedNow },
        attack: { active: underAttack, signals: underAttack ? rt.attackSignals : [] },
        ripple,
      });
    }

    await this.store.prune(now - WINDOW_MS - 5 * 60_000, [...this.net.routes.keys()]);

    for (const a of newAlerts) await this.saveAlert(a);
    if (now - this.lastSnapshot >= SNAPSHOT_EVERY_MS) {
      this.lastSnapshot = now;
      await this.snapshot(now);
    }
    await this.store.publish({ type: 'state', data: this.liveState() });
    for (const a of newAlerts) await this.store.publish({ type: 'alert', data: a });
  }

  private cooldownOk(rt: RouteRuntime, type: AlertType, now: number, ms: number): boolean {
    const last = rt.lastAlert[type];
    if (last != null && now - last < ms) return false;
    rt.lastAlert[type] = now;
    return true;
  }

  private makeAlert(type: AlertType, routeId: string | null, now: number, title: string, recommendation: string, confidence: number | null, badge: Badge, explanation: Record<string, unknown>): Alert {
    return { id: randomUUID(), type, routeId, createdAt: now, status: 'new', title, recommendation, confidence, badge, explanation, dispatchedBusId: null };
  }

  private reserveAlert(route: RouteInfo, crowd: CrowdEstimate, highForMs: number, cause: CauseResult, p30: number | null, ripple: Array<RippleStop & { name: string }>, now: number): Alert {
    // donor xətt: yükü aşağı olan, kifayət qədər avtobusu olan xətt
    const donors = [...this.net.routes.values()]
      .filter((r) => r.id !== route.id)
      .map((r) => {
        const v = this.routeViews.get(r.id);
        const score = v?.crowd.score ?? this.forecast.baseline(r.id, now) ?? 1.5;
        const buses = [...this.buses.values()].filter((b) => b.routeId === r.id).length;
        return { routeId: r.id, name: r.name, score, buses };
      })
      .filter((d) => d.buses >= 3 && d.score < MEDIUM_SCORE)
      .sort((a, b) => a.score - b.score);
    const donor = donors[0] ?? null;
    const worst = [...ripple].sort((a, b) => b.risk[1] - a.risk[1])[0];
    const dispatchStop = worst && worst.risk[1] > 0 ? worst : ripple[0];

    let rec = `${route.id} xəttinə əlavə avtobus ehtiyatı ayrılmalıdır. Avtobusu ${dispatchStop.name} dayanacağından xəttə buraxın — sıxlıq dalğası ora doğru gedir.`;
    if (donor) rec += ` Ehtiyat parkda avtobus yoxdursa: ${donor.routeId} xətti hazırda az yüklüdür (${donor.score.toFixed(1)} bal), oradan 1 avtobus köçürmək olar.`;
    if (cause.cause === 'traffic' || cause.cause === 'mixed') rec += ' Diqqət: səbəbin bir hissəsi tıxacdır, əlavə avtobus problemi tam həll etməyə bilər.';

    const minutes = Math.round(highForMs / 60_000);
    return this.makeAlert('reserve', route.id, now, `${route.id} xəttinə əlavə ehtiyat avtobus ayrılmalıdır`, rec, crowd.confidence, crowd.badge, {
      rule: 'Xətt üzrə sıxlıq ≥10 dəqiqə fasiləsiz "yüksək" (bal ≥ 2.4, ≥ 5 bildiriş, ≥ 3 cihaz)',
      highForMin: minutes,
      score: crowd.score,
      reports: crowd.n,
      devices: crowd.devices,
      confidence: crowd.confidence,
      reasons: crowd.reasons,
      cause: cause.cause,
      causeText: cause.text,
      speedRatio: cause.speedRatio,
      dwellRatio: cause.dwellRatio,
      forecast30: p30,
      donor,
      dispatchStop: { stopId: dispatchStop.stopId, name: dispatchStop.name, seq: dispatchStop.seq },
    });
  }

  private async saveAlert(a: Alert): Promise<void> {
    this.alerts.unshift(a);
    this.alerts = this.alerts.slice(0, 200);
    await this.db.query(
      'insert into alerts(id,type,route_id,created_at,status,title,recommendation,confidence,badge,explanation) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [a.id, a.type, a.routeId, new Date(a.createdAt), a.status, a.title, a.recommendation, a.confidence, a.badge, JSON.stringify(a.explanation)],
    );
    this.emit('alert', a);
  }

  private async snapshot(now: number): Promise<void> {
    for (const v of this.routeViews.values()) {
      const positions = [...this.busViews.values()].filter((b) => b.routeId === v.id).map((b) => ({ id: b.id, label: b.label, lat: +b.lat.toFixed(5), lon: +b.lon.toFixed(5), level: b.crowd.level }));
      await this.db.query(
        'insert into snapshots(ts,route_id,score,confidence,buses,reports,speed_kmh,headway_cv,cause,positions) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict do nothing',
        [new Date(now), v.id, v.crowd.score, v.crowd.confidence, v.buses, v.crowd.n, v.speedKmh, v.headway.cv, v.cause.cause, JSON.stringify(positions)],
      );
    }
  }

  // ---------------------------------------------------------------- operator əməliyyatları

  async setAlertStatus(id: string, status: Alert['status']): Promise<Alert | null> {
    const a = this.alerts.find((x) => x.id === id);
    if (!a) return null;
    a.status = status;
    await this.db.query('update alerts set status = $2, updated_at = now() where id = $1', [id, status]);
    await this.store.publish({ type: 'alert.update', data: a });
    return a;
  }

  async dispatch(opts: { routeId: string; source: 'reserve' | 'transfer'; fromRouteId?: string; alertId?: string }): Promise<{ ok: boolean; status: number; error?: string; busId?: string; atStop?: string }> {
    const route = this.net.routes.get(opts.routeId);
    if (!route) return { ok: false, status: 404, error: 'Naməlum xətt' };
    const now = this.clock.now();
    let removed: string | null = null;
    if (opts.source === 'reserve') {
      if (this.reservePool <= 0) return { ok: false, status: 409, error: 'Ehtiyat parkda avtobus qalmayıb. Az yüklü xətdən köçürün.' };
      this.reservePool--;
    } else {
      const from = opts.fromRouteId;
      if (!from || !this.net.routes.has(from) || from === opts.routeId) return { ok: false, status: 400, error: 'Köçürmə üçün başqa xətt seçin' };
      const cands = [...this.buses.values()].filter((b) => b.routeId === from);
      if (cands.length < 3) return { ok: false, status: 409, error: `${from} xəttində köçürmək üçün kifayət qədər avtobus yoxdur` };
      // donordan ən böyük boşluq yaratmayacaq avtobusu götür (sonuncu əlavə olunanı)
      const pick = cands.sort((a, b) => b.addedAt - a.addedAt)[0];
      removed = pick.id;
      this.removeBus(pick.id);
      this.emit('sim', { type: 'remove-bus', busId: pick.id });
    }
    const alert = opts.alertId ? this.alerts.find((a) => a.id === opts.alertId) : this.alerts.find((a) => a.routeId === opts.routeId && a.type === 'reserve' && a.status !== 'resolved');
    const explained = alert?.explanation as { dispatchStop?: { seq: number } } | undefined;
    const seq = explained?.dispatchStop?.seq;
    const ls = (seq != null ? route.loopStops.find((s) => s.seq === seq) : null) ?? route.loopStops[0];
    const busId = `${route.id}-R${Math.floor(now / 1000) % 100000}`;
    this.emit('sim', { type: 'add-bus', routeId: route.id, busId, d: ls.d, reserve: true, label: `${route.id}·E${route.plannedBuses + this.countReserve(route.id) + 1}` });
    this.rule.reset(route.id, now);
    if (alert) {
      alert.status = 'ack';
      alert.dispatchedBusId = busId;
      await this.db.query("update alerts set status = 'ack', dispatched_bus = $2, updated_at = now() where id = $1", [alert.id, busId]);
      await this.store.publish({ type: 'alert.update', data: alert });
    }
    await this.store.publish({ type: 'dispatch', data: { routeId: route.id, busId, removed, atStop: this.net.stops.get(ls.stopId)!.name, source: opts.source } });
    return { ok: true, status: 201, busId, atStop: this.net.stops.get(ls.stopId)!.name };
  }

  private countReserve(routeId: string): number {
    return [...this.buses.values()].filter((b) => b.routeId === routeId && b.reserve).length;
  }

  // ---------------------------------------------------------------- oxuma

  liveState() {
    return {
      now: this.clock.now(),
      speed: this.clock.speed,
      reservePool: this.reservePool,
      routes: [...this.routeViews.values()].map((r) => ({ ...r, ripple: undefined })),
      buses: [...this.busViews.values()],
    };
  }

  overview() {
    return {
      now: this.clock.now(),
      speed: this.clock.speed,
      reservePool: this.reservePool,
      forecastMae: this.forecastMae,
      routes: [...this.routeViews.values()],
      alerts: this.alerts.slice(0, 60),
    };
  }

  routeLive(routeId: string) {
    const r = this.routeViews.get(routeId);
    if (!r) return null;
    return { route: r, buses: [...this.busViews.values()].filter((b) => b.routeId === routeId) };
  }

  /** Dayanacağa gələn avtobuslar: ETA, sıxlıq, etibar və "bunu burax" tövsiyəsi. */
  arrivals(stopId: string) {
    const stop = this.net.stops.get(stopId);
    if (!stop) return null;
    const out: Array<AdviceArrival & { towards: string; dir: 0 | 1; color: string; distanceM: number; confidence: number; reserve: boolean; score: number | null }> = [];
    for (const rid of this.net.routesByStop.get(stopId) ?? []) {
      const route = this.net.routes.get(rid)!;
      const rv = this.routeViews.get(rid);
      const movingSpeed = rv?.speedKmh != null ? rv.speedKmh / 3.6 : null;
      for (const ls of route.loopStops.filter((s) => s.stopId === stopId)) {
        for (const b of [...this.buses.values()].filter((x) => x.routeId === rid)) {
          const bv = this.busViews.get(b.id);
          const e = etaSeconds(b.d, ls.d, route.path.length, route.loopStops, effectiveSpeed(b.speed, movingSpeed));
          if (e.distance > route.path.length * 0.75) continue; // dövrənin o biri başındadır
          out.push({
            busId: b.id,
            routeId: rid,
            label: b.label,
            etaS: Math.round(e.seconds),
            distanceM: Math.round(e.distance),
            level: bv?.crowd.level ?? null,
            score: bv?.crowd.score ?? null,
            badge: bv?.crowd.badge ?? 'none',
            confidence: bv?.crowd.confidence ?? 0,
            bunchedFollower: !!bv?.bunchedFollower,
            towards: ls.towards,
            dir: ls.dir,
            color: route.color,
            reserve: b.reserve,
          });
        }
      }
    }
    out.sort((a, b) => a.etaS - b.etaS);
    const stopCrowd: Record<string, CrowdEstimate> = {};
    for (const rid of this.net.routesByStop.get(stopId) ?? []) {
      const sc = this.stopCrowd.get(`${rid}|${stopId}`);
      if (sc) stopCrowd[rid] = sc;
    }
    return { stop, arrivals: out.slice(0, 12), advice: skipAdvice(out), stopCrowd, now: this.clock.now() };
  }

  plan(from: string, to: string) {
    if (!this.net.stops.has(from) || !this.net.stops.has(to)) return null;
    const routeSpeed = (rid: string) => {
      const v = this.routeViews.get(rid)?.speedKmh;
      return v ? Math.max(3, v / 3.6) : 7;
    };
    const arrival = (rid: string, ls: LoopStop, afterS: number) => {
      const route = this.net.routes.get(rid)!;
      let best: { busId: string; label: string; etaS: number; level: number | null } | null = null;
      for (const b of this.buses.values()) {
        if (b.routeId !== rid) continue;
        const e = etaSeconds(b.d, ls.d, route.path.length, route.loopStops, effectiveSpeed(b.speed, routeSpeed(rid)));
        let eta = e.seconds;
        // bu avtobusu qaçırırıqsa, növbəti dövrəni gözləyirik
        if (eta < afterS) eta += route.path.length / routeSpeed(rid);
        if (!best || eta < best.etaS) best = { busId: b.id, label: b.label, etaS: eta, level: this.busViews.get(b.id)?.crowd.level ?? null };
      }
      return best;
    };
    const journeys = planJourney(this.net, from, to, arrival, routeSpeed, 4);
    return {
      from: this.net.stops.get(from),
      to: this.net.stops.get(to),
      journeys: journeys.map((j) => ({
        ...j,
        legs: j.legs.map((l) => ({ ...l, fromName: this.net.stops.get(l.fromStopId)!.name, toName: this.net.stops.get(l.toStopId)!.name, color: this.net.routes.get(l.routeId)!.color })),
      })),
      multipliers: { low: 1.0, medium: 1.19, high: 2.32, source: 'Wardman & Whelan (2011)' },
    };
  }

  async history(minutes: number) {
    const now = this.clock.now();
    const rows = await this.db.query<{ ts: Date; route_id: string; score: number | null; confidence: number | null; buses: number; reports: number; speed_kmh: number | null; cause: string | null; positions: unknown }>(
      'select ts, route_id, score, confidence, buses, reports, speed_kmh, cause, positions from snapshots where ts >= $1 and ts <= $2 and synthetic = false order by ts',
      [new Date(now - minutes * 60_000), new Date(now)],
    );
    const frames = new Map<number, { ts: number; routes: Record<string, unknown>; buses: unknown[] }>();
    for (const r of rows) {
      const ts = new Date(r.ts).getTime();
      if (!frames.has(ts)) frames.set(ts, { ts, routes: {}, buses: [] });
      const f = frames.get(ts)!;
      f.routes[r.route_id] = { score: r.score, confidence: r.confidence, buses: r.buses, reports: r.reports, speedKmh: r.speed_kmh, cause: r.cause };
      const pos = (typeof r.positions === 'string' ? JSON.parse(r.positions) : r.positions) as Array<Record<string, unknown>> | null;
      if (pos) f.buses.push(...pos.map((p) => ({ ...p, routeId: r.route_id })));
    }
    const alerts = this.alerts.filter((a) => a.createdAt >= now - minutes * 60_000).map((a) => ({ id: a.id, ts: a.createdAt, type: a.type, routeId: a.routeId, title: a.title }));
    return { now, frames: [...frames.values()], alerts };
  }

  routeForecast(routeId: string) {
    const now = this.clock.now();
    const pts: Array<{ ts: number; baseline: number | null; predicted: number | null }> = [];
    for (let m = -120; m <= 60; m += 15) {
      const ts = now + m * 60_000;
      pts.push({ ts, baseline: this.forecast.baseline(routeId, ts), predicted: m >= 0 ? this.forecast.predict(routeId, now, m) : null });
    }
    return { routeId, now, points: pts, mae: this.forecastMae };
  }

  levelOf(score: number | null): Level | null {
    return score == null ? null : scoreToLevel(score);
  }
}

function nearestLoopStop(stops: LoopStop[], d: number, L: number): { stop: LoopStop; dist: number } | null {
  let best: { stop: LoopStop; dist: number } | null = null;
  for (const s of stops) {
    const a = aheadDistance(d, s.d, L);
    const dist = Math.min(a, L - a);
    if (!best || dist < best.dist) best = { stop: s, dist };
  }
  return best;
}

function nextLoopStop(stops: LoopStop[], d: number, L: number): LoopStop | null {
  let best: LoopStop | null = null;
  let bestA = Infinity;
  for (const s of stops) {
    const a = aheadDistance(d, s.d, L);
    if (a > 30 && a < bestA) {
      bestA = a;
      best = s;
    }
  }
  return best;
}
