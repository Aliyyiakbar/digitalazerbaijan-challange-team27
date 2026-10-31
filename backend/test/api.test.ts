// API inteqrasiya testləri: real PGlite (yaddaşda), yaddaşdaxili store, əl ilə idarə olunan saat.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { openDb, migrate } from '../src/db/db.js';
import { MemoryStore } from '../src/db/store.js';
import { ManualClock } from '../src/lib/clock.js';
import { loadNetwork } from '../src/engine/network.js';
import { Engine } from '../src/engine/engine.js';
import { createApp } from '../src/api/app.js';
import { pointAt } from '../src/lib/geo.js';

const clock = new ManualClock(Date.UTC(2026, 9, 28, 4, 30)); // 08:30 Bakı
let engine: Engine;
let app: ReturnType<typeof createApp>;
const KEY = 'test-key';

function placeBuses() {
  for (const r of engine.net.routes.values()) {
    for (let i = 0; i < 3; i++) {
      const d = (i / 3) * r.path.length + 200;
      const [lat, lon] = pointAt(r.path, d);
      engine.ingestGps({ busId: `${r.id}-${i + 1}`, routeId: r.id, lat, lon, dir: d < r.forwardLength ? 0 : 1 });
    }
  }
}

beforeAll(async () => {
  const db = await openDb('', 'memory');
  await migrate(db);
  engine = new Engine(loadNetwork(), clock, db, new MemoryStore(), { reservePool: 2 });
  await engine.init();
  app = createApp({ engine, sim: null, tokenSecret: 'secret', internalKey: KEY, corsOrigin: '*' });
  placeBuses();
  await engine.tick();
}, 30_000);

describe('API', () => {
  it('health', async () => {
    const r = await request(app).get('/api/health');
    expect(r.status).toBe(200);
    expect(r.body.db).toBe('pglite');
  });

  it('şəbəkə: 10 xətt, M6 dayanacaqları', async () => {
    const r = await request(app).get('/api/network');
    expect(r.body.routes).toHaveLength(10);
    expect(r.body.routes.find((x: { id: string }) => x.id === 'M6').stopIds).toEqual(['ELM', 'S20', 'N8', 'GEN']);
  });

  it('tokensiz bildiriş rədd edilir', async () => {
    const r = await request(app).post('/api/reports').send({ busId: 'M6-1', level: 'high' });
    expect(r.status).toBe(401);
  });

  it('yanlış səviyyə 400 qaytarır', async () => {
    const s = await request(app).post('/api/session').send({});
    const r = await request(app).post('/api/reports').set('x-device-id', s.body.deviceId).set('x-device-token', s.body.token).send({ busId: 'M6-1', level: 'çox' });
    expect(r.status).toBe(400);
  });

  it('bildiriş qəbul olunur, spam limiti işləyir, uzaqdan gələn bildirişin çəkisi azdır', async () => {
    const s = await request(app).post('/api/session').send({});
    const h = { 'x-device-id': s.body.deviceId, 'x-device-token': s.body.token };
    const bus = engine.buses.get('M6-1')!;
    const ok = await request(app).post('/api/reports').set(h).send({ busId: 'M6-1', level: 'high', lat: bus.lat, lon: bus.lon, accuracy: 10 });
    expect(ok.status).toBe(201);
    expect(ok.body.report.geoWeight).toBe(1);
    const again = await request(app).post('/api/reports').set(h).send({ busId: 'M6-1', level: 'high' });
    expect(again.status).toBe(429);
    const far = await request(app).post('/api/reports').set(h).send({ busId: 'M6-2', level: 'high', lat: bus.lat + 0.05, lon: bus.lon });
    expect(far.status).toBe(201);
    expect(far.body.report.geoWeight).toBe(0.1);
  });

  it('dayanacaq bildirişi yalnız xəttin dayanacağı üçün', async () => {
    const s = await request(app).post('/api/session').send({});
    const h = { 'x-device-id': s.body.deviceId, 'x-device-token': s.body.token };
    const bad = await request(app).post('/api/reports').set(h).send({ context: 'stop', routeId: 'M6', stopId: 'HA', level: 'high' });
    expect(bad.status).toBe(400);
    const good = await request(app).post('/api/reports').set(h).send({ context: 'stop', routeId: 'M6', stopId: 'GEN', level: 'high' });
    expect(good.status).toBe(201);
  });

  it('dayanacaq gəlişləri ETA ilə', async () => {
    const r = await request(app).get('/api/stops/GEN/arrivals');
    expect(r.status).toBe(200);
    expect(r.body.arrivals.length).toBeGreaterThan(0);
    for (const a of r.body.arrivals) expect(a.etaS).toBeGreaterThanOrEqual(0);
  });

  it('marşrut planı variantlar qaytarır', async () => {
    const r = await request(app).get('/api/plan?from=ELM&to=GEN');
    expect(r.status).toBe(200);
    expect(r.body.journeys.length).toBeGreaterThan(0);
    expect(r.body.journeys[0].perceivedS).toBeGreaterThan(0);
  });

  it('SSENARİ: 10 dəqiqə davamlı yüksək → avtomatik "ehtiyat avtobus" tövsiyəsi → operator göndərir', async () => {
    const send = async (i: number) => {
      const bus = engine.buses.get(`M5-${(i % 3) + 1}`)!;
      return engine.submitReport({ busId: bus.id, context: 'bus', level: 3, deviceId: `sim-dev-${i}`, ip: `10.0.0.${i}`, lat: bus.lat, lon: bus.lon, accuracy: 10, source: 'sim' });
    };
    let n = 0;
    let fired = false;
    for (let minute = 0; minute <= 11; minute++) {
      // 0-cı dəqiqədə 5 bildiriş (qayda şərti dərhal ödənir), sonra hər dəqiqə 1
      for (let k = 0; k < (minute === 0 ? 5 : 1); k++) await send(n++);
      await engine.tick();
      if (engine.alerts.some((a) => a.type === 'reserve' && a.routeId === 'M5')) fired = true;
      if (minute < 10) expect(fired).toBe(false);
      clock.advance(60_000);
    }
    expect(fired).toBe(true);
    const alert = engine.alerts.find((a) => a.type === 'reserve' && a.routeId === 'M5')!;
    expect(alert.title).toMatch(/əlavə ehtiyat avtobus ayrılmalıdır/);
    expect(alert.explanation.highForMin).toBeGreaterThanOrEqual(10);

    const d = await request(app).post('/api/operator/dispatch').send({ routeId: 'M5', source: 'reserve', alertId: alert.id });
    expect(d.status).toBe(201);
    expect(engine.reservePool).toBe(1);
    expect(engine.alerts.find((a) => a.id === alert.id)!.status).toBe('ack');
  });

  it('ehtiyat bitəndə 409', async () => {
    await request(app).post('/api/operator/dispatch').send({ routeId: 'M1', source: 'reserve' });
    const r = await request(app).post('/api/operator/dispatch').send({ routeId: 'M1', source: 'reserve' });
    expect(r.status).toBe(409);
  });

  it('GTFS-RT JSON və protobuf', async () => {
    const j = await request(app).get('/gtfs-rt/vehicle-positions?format=json');
    expect(j.status).toBe(200);
    expect(j.body.header.gtfsRealtimeVersion).toBe('2.0');
    expect(j.body.entity.length).toBeGreaterThan(0);
    expect(j.body.entity[0].vehicle.occupancyStatus).toBeDefined();
    const pb = await request(app).get('/gtfs-rt/trip-updates').buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(pb.headers['content-type']).toMatch(/protobuf/);
    expect((pb.body as Buffer).length).toBeGreaterThan(50);
  });

  it('STATIC_DIR: SPA marşrutları index.html qaytarır, API toxunulmaz qalır', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'stb-static-'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>STB</title>');
    const app2 = createApp({ engine, sim: null, tokenSecret: 's', internalKey: KEY, corsOrigin: '*', staticDir: dir });
    const page = await request(app2).get('/operator/history');
    expect(page.status).toBe(200);
    expect(page.text).toContain('<title>STB</title>');
    const api = await request(app2).get('/api/health');
    expect(api.body.ok).toBe(true);
  });

  it('statik GTFS zip', async () => {
    const r = await request(app).get('/gtfs/static.zip').buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(r.status).toBe(200);
    expect((r.body as Buffer).subarray(0, 2).toString()).toBe('PK');
  });
});
