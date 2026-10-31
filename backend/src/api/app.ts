// HTTP API (Express). Bütün yoxlamalar zod ilə; xəta mesajları Azərbaycan dilində.
import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { Engine } from '../engine/engine.js';
import type { Simulator } from '../sim/simulator.js';
import type { Level } from '../engine/types.js';
import { openapi } from './openapi.js';
import { loadBackground } from '../engine/network.js';
import { encode, serviceAlerts, staticZip, toJson, tripUpdates, vehiclePositions } from '../gtfs/gtfs.js';

export interface AppDeps {
  engine: Engine;
  sim: Simulator | null;
  /** external simulyator rejimində əmrləri ötürmək üçün */
  simCommand?: (c: Record<string, unknown>) => void;
  tokenSecret: string;
  internalKey: string;
  corsOrigin: string;
  staticDir?: string;
}

const LEVELS: Record<string, Level> = { low: 1, medium: 2, high: 3, '1': 1, '2': 2, '3': 3 };

const reportSchema = z
  .object({
    context: z.enum(['bus', 'stop']).default('bus'),
    level: z.union([z.enum(['low', 'medium', 'high']), z.number().int().min(1).max(3)]),
    routeId: z.string().max(10).optional(),
    busId: z.string().max(40).optional(),
    stopId: z.string().max(10).optional(),
    lat: z.number().min(-90).max(90).optional(),
    lon: z.number().min(-180).max(180).optional(),
    accuracy: z.number().min(0).max(100_000).optional(),
    // yalnız daxili (simulyator) üçün
    deviceId: z.string().max(60).optional(),
    source: z.enum(['sim', 'bot']).optional(),
  })
  .refine((v) => v.busId || v.routeId, { message: 'busId və ya routeId lazımdır' })
  .refine((v) => v.context !== 'stop' || v.stopId, { message: 'Dayanacaq bildirişi üçün stopId lazımdır' });

const gpsSchema = z.object({
  busId: z.string().max(40),
  routeId: z.string().max(10),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  dir: z.union([z.literal(0), z.literal(1)]).optional(),
  label: z.string().max(20).optional(),
  reserve: z.boolean().optional(),
});

function sign(secret: string, deviceId: string): string {
  return createHmac('sha256', secret).update(deviceId).digest('base64url');
}

function safeEq(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const wrap = (fn: (req: Request, res: Response) => Promise<unknown> | unknown) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res)).catch(next);
};

export function createApp(deps: AppDeps) {
  const { engine } = deps;
  const app = express();
  app.set('trust proxy', true);
  app.use(cors({ origin: deps.corsOrigin === '*' ? true : deps.corsOrigin.split(',') }));
  app.use(express.json({ limit: '200kb' }));

  const isInternal = (req: Request) => {
    const k = req.header('x-internal-key');
    return !!k && safeEq(k, deps.internalKey);
  };

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, db: engine.db.kind, store: engine.store.kind, now: engine.clock.now(), speed: engine.clock.speed });
  });

  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapi, { customSiteTitle: 'Smart Transit Baku API' }));
  app.get('/api/openapi.json', (_req, res) => res.json(openapi));

  // ---------------------------------------------------------------- sərnişin

  app.post('/api/session', (req, res) => {
    const prev = typeof req.body?.deviceId === 'string' && /^[a-f0-9-]{36}$/.test(req.body.deviceId) ? req.body.deviceId : null;
    const deviceId = prev ?? randomUUID();
    res.status(201).json({ deviceId, token: sign(deps.tokenSecret, deviceId) });
  });

  app.get('/api/network', (_req, res) => {
    const net = engine.net;
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json({
      defaultStop: net.defaultStop,
      sources: net.sources,
      stops: [...net.stops.values()].map((s) => ({ ...s, routes: net.routesByStop.get(s.id) ?? [] })),
      routes: [...net.routes.values()].map((r) => ({
        id: r.id,
        name: r.name,
        kind: r.kind,
        color: r.color,
        headwayMin: r.headwayMin,
        capacity: r.capacity,
        plannedBuses: r.plannedBuses,
        stopIds: r.stopIds,
        forward: r.forward,
        backward: r.backward,
        loopStops: r.loopStops,
        ridership: r.ridership,
      })),
    });
  });

  // Bütün AYNA xətləri (opendata.az, 243 xətt) — xəritədə fon qatı; canlı məlumat yalnız `live: true` olanlarda
  let bg: unknown = null;
  app.get('/api/network/background', (_req, res) => {
    bg ??= loadBackground();
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.json(bg);
  });

  app.get('/api/state', (_req, res) => res.json(engine.liveState()));

  app.get('/api/routes/:id/live', (req, res) => {
    const v = engine.routeLive(String(req.params.id));
    if (!v) return res.status(404).json({ error: 'Xətt tapılmadı' });
    res.json(v);
  });

  app.get('/api/stops/:id/arrivals', (req, res) => {
    const v = engine.arrivals(String(req.params.id));
    if (!v) return res.status(404).json({ error: 'Dayanacaq tapılmadı' });
    res.json(v);
  });

  app.get('/api/plan', (req, res) => {
    const from = String(req.query.from ?? '');
    const to = String(req.query.to ?? '');
    if (!from || !to || from === to) return res.status(400).json({ error: 'Fərqli "from" və "to" dayanacaqları seçin' });
    const p = engine.plan(from, to);
    if (!p) return res.status(404).json({ error: 'Dayanacaq tapılmadı' });
    res.json(p);
  });

  app.post(
    '/api/reports',
    wrap(async (req, res) => {
      const parsed = reportSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join('; ') });
      const b = parsed.data;
      const internal = isInternal(req);
      let deviceId: string;
      if (internal && b.deviceId) deviceId = b.deviceId;
      else {
        const id = req.header('x-device-id') ?? '';
        const tok = req.header('x-device-token') ?? '';
        if (!id || !tok || !safeEq(tok, sign(deps.tokenSecret, id))) return res.status(401).json({ error: 'Cihaz tokeni yoxdur və ya etibarsızdır. Səhifəni yeniləyin.' });
        deviceId = id;
      }
      const r = await engine.submitReport({
        routeId: b.routeId,
        busId: b.busId,
        stopId: b.stopId,
        context: b.context,
        level: LEVELS[String(b.level)],
        deviceId,
        ip: (internal && req.header('x-sim-ip')) || req.ip || 'unknown',
        lat: b.lat,
        lon: b.lon,
        accuracy: b.accuracy,
        source: internal && b.source ? b.source : 'app',
      });
      if (!r.ok) return res.status(r.status).json({ error: r.error });
      res.status(201).json({ message: r.message, report: r.report });
    }),
  );

  // ---------------------------------------------------------------- GPS (AVL qəbulu)

  app.post('/api/gps', (req, res) => {
    if (!isInternal(req)) return res.status(401).json({ error: 'Yalnız avtobus terminalları üçün' });
    const list = Array.isArray(req.body) ? req.body : [req.body];
    let ok = 0;
    const errors: string[] = [];
    for (const item of list) {
      const p = gpsSchema.safeParse(item);
      if (!p.success) {
        errors.push(p.error.issues[0].message);
        continue;
      }
      const r = engine.ingestGps(p.data);
      if (r.ok) ok++;
      else if (r.error) errors.push(r.error);
    }
    res.status(errors.length && !ok ? 400 : 202).json({ accepted: ok, errors: errors.slice(0, 5) });
  });

  // ---------------------------------------------------------------- operator

  app.get('/api/operator/overview', (_req, res) => res.json(engine.overview()));

  app.get('/api/operator/alerts', (req, res) => {
    const st = req.query.status ? String(req.query.status) : null;
    res.json(engine.alerts.filter((a) => !st || a.status === st));
  });

  app.patch(
    '/api/operator/alerts/:id',
    wrap(async (req, res) => {
      const s = z.object({ status: z.enum(['new', 'ack', 'resolved']) }).safeParse(req.body);
      if (!s.success) return res.status(400).json({ error: 'status: new | ack | resolved' });
      const a = await engine.setAlertStatus(String(req.params.id), s.data.status);
      if (!a) return res.status(404).json({ error: 'Xəbərdarlıq tapılmadı' });
      res.json(a);
    }),
  );

  app.post(
    '/api/operator/dispatch',
    wrap(async (req, res) => {
      const s = z
        .object({ routeId: z.string(), source: z.enum(['reserve', 'transfer']).default('reserve'), fromRouteId: z.string().optional(), alertId: z.string().optional() })
        .safeParse(req.body);
      if (!s.success) return res.status(400).json({ error: 'routeId lazımdır' });
      const r = await engine.dispatch(s.data);
      if (!r.ok) return res.status(r.status).json({ error: r.error });
      res.status(201).json(r);
    }),
  );

  app.get(
    '/api/operator/history',
    wrap(async (req, res) => {
      const m = Math.max(5, Math.min(240, Number(req.query.minutes ?? 120)));
      res.json(await engine.history(m));
    }),
  );

  app.get('/api/operator/forecast/:routeId', (req, res) => {
    if (!engine.net.routes.has(String(req.params.routeId))) return res.status(404).json({ error: 'Xətt tapılmadı' });
    res.json(engine.routeForecast(String(req.params.routeId)));
  });

  // ---------------------------------------------------------------- simulyasiya (demo)

  app.get('/api/sim/state', (_req, res) => {
    res.json({ now: engine.clock.now(), speed: engine.clock.speed, mode: deps.sim ? 'in-process' : 'external', sim: deps.sim?.state() ?? null });
  });

  app.post('/api/sim/speed', (req, res) => {
    const f = Number(req.body?.factor);
    if (!Number.isFinite(f) || f <= 0) return res.status(400).json({ error: 'factor müsbət ədəd olmalıdır' });
    engine.clock.setSpeed(f);
    engine.store.publish({ type: 'clock', data: { speed: engine.clock.speed, now: engine.clock.now() } }).catch(() => {});
    res.json({ speed: engine.clock.speed });
  });

  app.post('/api/sim/scenario', (req, res) => {
    const s = z.object({ name: z.enum(['peak', 'fake', 'bots', 'traffic', 'bunch', 'reset']), routeId: z.string().optional() }).safeParse(req.body);
    if (!s.success) return res.status(400).json({ error: 'name: peak | fake | bots | traffic | bunch | reset' });
    if (deps.sim) return res.json(deps.sim.scenario(s.data.name, s.data.routeId));
    deps.simCommand?.({ type: 'scenario', ...s.data });
    res.json({ ok: true, message: 'Əmr xarici simulyatora göndərildi' });
  });

  // ---------------------------------------------------------------- GTFS / GTFS-RT

  app.get(
    '/gtfs/static.zip',
    wrap(async (_req, res) => {
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="smart-transit-baku-gtfs.zip"');
      res.send(await staticZip(engine));
    }),
  );
  const feed = (name: string, build: (e: Engine) => ReturnType<typeof vehiclePositions>) => {
    app.get(`/gtfs-rt/${name}`, (req, res) => {
      const msg = build(engine);
      if (req.query.format === 'json') return res.json(toJson(msg));
      res.setHeader('Content-Type', 'application/x-protobuf');
      res.send(Buffer.from(encode(msg)));
    });
  };
  feed('vehicle-positions', vehiclePositions);
  feed('trip-updates', tripUpdates);
  feed('alerts', serviceAlerts);

  // ---------------------------------------------------------------- statik frontend (production)
  if (deps.staticDir && existsSync(deps.staticDir)) {
    app.use(express.static(deps.staticDir, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api|gtfs|ws).*/, (_req, res) => res.sendFile(join(deps.staticDir!, 'index.html')));
  }

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[api]', err);
    res.status(500).json({ error: 'Daxili xəta' });
  });
  return app;
}
