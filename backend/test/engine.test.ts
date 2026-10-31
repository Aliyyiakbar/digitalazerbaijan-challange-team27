import { describe, expect, it } from 'vitest';
import { estimate, scoreToLevel, WINDOW_MS } from '../src/engine/crowd.js';
import { SustainedHighRule } from '../src/engine/rules.js';
import { geoWeight, updateTrust, effectiveTrust } from '../src/engine/trust.js';
import { analyzeHeadways } from '../src/engine/bunching.js';
import { classifyCause } from '../src/engine/cause.js';
import { etaSeconds } from '../src/engine/eta.js';
import { ForecastModel } from '../src/engine/forecast.js';
import { detectBots } from '../src/engine/botdetect.js';
import { skipAdvice } from '../src/engine/advice.js';
import { stopRisk } from '../src/engine/ripple.js';
import { makePath, project, pointAt, haversine } from '../src/lib/geo.js';
import type { CrowdReport, Level } from '../src/engine/types.js';

const T0 = 1_790_000_000_000;
let seq = 0;
function rep(p: Partial<CrowdReport> & { level: Level }): CrowdReport {
  return {
    id: `r${seq++}`,
    ts: T0,
    routeId: 'M6',
    busId: 'M6-1',
    stopId: null,
    context: 'bus',
    deviceId: `d${seq}`,
    ip: `ip${seq}`,
    hasGeo: true,
    distanceM: 20,
    geoWeight: 1,
    trust: 0.7,
    quarantined: false,
    source: 'app',
    ...p,
  };
}

describe('sıxlıq hesabı', () => {
  it('bildiriş yoxdursa bal yoxdur', () => {
    const e = estimate([], T0);
    expect(e.score).toBeNull();
    expect(e.badge).toBe('none');
  });

  it('çəkili orta: yeni bildiriş köhnədən güclüdür', () => {
    const old = rep({ level: 1, ts: T0 - 9 * 60_000 });
    const fresh = rep({ level: 3, ts: T0 });
    const e = estimate([old, fresh], T0);
    expect(e.score!).toBeGreaterThan(2.3);
  });

  it('10 dəqiqədən köhnə bildirişlər sayılmır', () => {
    const e = estimate([rep({ level: 3, ts: T0 - WINDOW_MS - 1 })], T0);
    expect(e.n).toBe(0);
  });

  it('karantindəki bildirişlər sayılmır', () => {
    const e = estimate([rep({ level: 3, quarantined: true }), rep({ level: 1 })], T0);
    expect(e.score).toBe(1);
  });

  it('çox cihaz + razılaşma + yaxınlıq = yüksək etibar', () => {
    const list = Array.from({ length: 6 }, () => rep({ level: 3 }));
    const e = estimate(list, T0);
    expect(e.level).toBe(3);
    expect(e.badge).toBe('confirmed');
  });

  it('kənar hal: toplanmanın arxa avtobusuna "yüksək" — etibar düşür', () => {
    const list = Array.from({ length: 6 }, () => rep({ level: 3 }));
    const normal = estimate(list, T0);
    const follower = estimate(list, T0, { bunchedFollower: true });
    expect(follower.confidence).toBeLessThan(normal.confidence * 0.6);
    expect(follower.reasons.join(' ')).toMatch(/toplanmış/);
  });

  it('kənar hal: uzaqdan göndərilən bildirişlər etibarı azaldır', () => {
    const near = Array.from({ length: 5 }, () => rep({ level: 3 }));
    const far = Array.from({ length: 5 }, () => rep({ level: 3, geoWeight: 0.1, distanceM: 4000 }));
    expect(estimate(far, T0).confidence).toBeLessThan(estimate(near, T0).confidence);
  });

  it('kənar hal: ziddiyyətli bildirişlər', () => {
    const list = [1, 3, 1, 3, 1, 3].map((l) => rep({ level: l as Level }));
    const e = estimate(list, T0);
    expect(e.reasons.join(' ')).toMatch(/ziddir/);
  });

  it('bot hücumu altında etibar ≤ 0.2 və nişan "şübhəli"', () => {
    const e = estimate(Array.from({ length: 6 }, () => rep({ level: 3 })), T0, { underAttack: true });
    expect(e.confidence).toBeLessThanOrEqual(0.2);
    expect(e.badge).toBe('suspicious');
  });

  it('səviyyə sərhədləri', () => {
    expect(scoreToLevel(1.59)).toBe(1);
    expect(scoreToLevel(1.6)).toBe(2);
    expect(scoreToLevel(2.4)).toBe(3);
  });
});

describe('əsas qayda: 10 dəqiqə davamlı yüksək', () => {
  const high = estimate(Array.from({ length: 6 }, () => rep({ level: 3 })), T0);
  const low = estimate(Array.from({ length: 6 }, () => rep({ level: 1 })), T0);

  it('9:59-da tövsiyə yaranmır, 10:00-da yaranır', () => {
    const rule = new SustainedHighRule();
    expect(rule.evaluate('M6', high, T0).fire).toBe(false);
    expect(rule.evaluate('M6', high, T0 + 9 * 60_000 + 59_000).fire).toBe(false);
    expect(rule.evaluate('M6', high, T0 + 10 * 60_000).fire).toBe(true);
  });

  it('cooldown: dərhal ikinci dəfə yaranmır', () => {
    const rule = new SustainedHighRule();
    rule.evaluate('M6', high, T0);
    expect(rule.evaluate('M6', high, T0 + 10 * 60_000).fire).toBe(true);
    expect(rule.evaluate('M6', high, T0 + 11 * 60_000).fire).toBe(false);
  });

  it('60 saniyədən uzun eniş sayğacı sıfırlayır', () => {
    const rule = new SustainedHighRule();
    rule.evaluate('M6', high, T0);
    rule.evaluate('M6', high, T0 + 4 * 60_000);
    rule.evaluate('M6', low, T0 + 6 * 60_000); // 2 dəq yüksək deyil
    expect(rule.evaluate('M6', high, T0 + 10 * 60_000).fire).toBe(false);
    expect(rule.evaluate('M6', high, T0 + 20 * 60_000).fire).toBe(true);
  });

  it('qısa (<60 san) eniş fasilə sayılmır', () => {
    const rule = new SustainedHighRule();
    rule.evaluate('M6', high, T0);
    rule.evaluate('M6', high, T0 + 5 * 60_000);
    rule.evaluate('M6', low, T0 + 5 * 60_000 + 30_000);
    expect(rule.evaluate('M6', high, T0 + 5 * 60_000 + 50_000).fire).toBe(false);
    expect(rule.evaluate('M6', high, T0 + 10 * 60_000).fire).toBe(true);
  });

  it('tək istifadəçi (az cihaz) qaydanı işə sala bilməz', () => {
    const rule = new SustainedHighRule();
    const one = estimate(Array.from({ length: 8 }, () => rep({ level: 3, deviceId: 'tek' })), T0);
    rule.evaluate('M6', one, T0);
    expect(rule.evaluate('M6', one, T0 + 11 * 60_000).fire).toBe(false);
  });
});

describe('etibar və coğrafi yoxlama', () => {
  it('konsensusla uyğun gələn cihazın etibarı artır, ziddə düşən azalır', () => {
    expect(updateTrust(0.5, 3, 2.9, 0.8)).toBeCloseTo(0.55);
    expect(updateTrust(0.5, 1, 2.9, 0.8)).toBeCloseTo(0.4);
    expect(updateTrust(0.5, 1, 2.9, 0.2)).toBe(0.5); // konsensus etibarsızdırsa dəyişmir
  });
  it('yeni cihaz ilk 5 dəqiqədə zəifdir', () => {
    expect(effectiveTrust(0.9, 60_000)).toBe(0.3);
    expect(effectiveTrust(0.9, 10 * 60_000)).toBe(0.9);
  });
  it('məsafəyə görə çəki', () => {
    expect(geoWeight(50, 10)).toBe(1);
    expect(geoWeight(300, 10)).toBe(0.6);
    expect(geoWeight(3000, 10)).toBe(0.1);
    expect(geoWeight(null, null)).toBe(0.4);
    expect(geoWeight(50, 2000)).toBe(0.4); // dəqiqlik pisdir
  });
});

describe('toplanma (bus bunching)', () => {
  it('bir-birinin ardınca gedən cütü tapır və saxlama tövsiyə edir', () => {
    const L = 10_000;
    const r = analyzeHeadways(
      [
        { id: 'a', d: 1000, label: 'A' },
        { id: 'b', d: 1100, label: 'B' },
        { id: 'c', d: 6000, label: 'C' },
      ],
      L,
      8,
    );
    expect(r.pairs).toHaveLength(1);
    expect(r.pairs[0]).toMatchObject({ leader: 'b', follower: 'a' });
    expect(r.pairs[0].holdS).toBeGreaterThan(0);
    expect(r.cv).toBeGreaterThan(0.5);
  });
  it('bərabər intervallarda toplanma yoxdur', () => {
    const r = analyzeHeadways([0, 2500, 5000, 7500].map((d, i) => ({ id: String(i), d, label: String(i) })), 10_000, 8);
    expect(r.pairs).toHaveLength(0);
    expect(r.cv).toBeLessThan(0.01);
  });
});

describe('tıxac və tələbat', () => {
  it('yavaş sürət + adi dayanma = tıxac', () => {
    expect(classifyCause({ movingSpeed: 3, avgDwellS: 22, crowdScore: 2 }).cause).toBe('traffic');
  });
  it('normal sürət + uzun dayanma = tələbat', () => {
    expect(classifyCause({ movingSpeed: 8, avgDwellS: 45, crowdScore: 2.6 }).cause).toBe('demand');
  });
  it('ikisi birlikdə = qarışıq', () => {
    expect(classifyCause({ movingSpeed: 3, avgDwellS: 45, crowdScore: 2.6 }).cause).toBe('mixed');
  });
  it('GTFS-RT tıxac səviyyəsi', () => {
    expect(classifyCause({ movingSpeed: 2.5, avgDwellS: 20, crowdScore: 1 }).congestion).toBe('SEVERE_CONGESTION');
    expect(classifyCause({ movingSpeed: 8, avgDwellS: 20, crowdScore: 1 }).congestion).toBe('RUNNING_SMOOTHLY');
  });
});

describe('ETA və həndəsə', () => {
  it('qalan məsafə / sürət + aralıq dayanacaqlar', () => {
    const stops = [0, 1000, 2000, 3000].map((d, i) => ({ stopId: `s${i}`, seq: i, dir: 0 as const, d, towards: 'x' }));
    const e = etaSeconds(500, 3000, 4000, stops, 10, 20);
    expect(e.distance).toBe(2500);
    expect(e.stopsBetween).toBe(2);
    expect(e.seconds).toBe(250 + 40);
  });
  it('dövrə boyunca proyeksiya pəncərə ilə istiqaməti qarışdırmır', () => {
    // gediş-qayıdış: eyni küçə
    const path = makePath([
      [40.0, 49.0],
      [40.0, 49.01],
      [40.0, 49.0],
    ]);
    const half = path.length / 2;
    const p: [number, number] = [40.0, 49.005];
    expect(project(path, p, { from: 0, to: half }).d).toBeLessThan(half);
    expect(project(path, p, { from: half, to: path.length }).d).toBeGreaterThan(half);
    expect(haversine(pointAt(path, half / 2), p)).toBeLessThan(2);
  });
});

describe('proqnoz modeli', () => {
  it('tarixi profili öyrənir və real vaxt düzəlişi tətbiq edir', () => {
    const m = new ForecastModel();
    const obs = [];
    for (let d = 0; d < 7; d++)
      for (let h = 0; h < 24; h++) obs.push({ ts: Date.UTC(2026, 9, 5 + d, h - 4, 0), routeId: 'M6', score: h === 8 ? 2.8 : 1.2 });
    m.train(obs);
    const at8 = Date.UTC(2026, 9, 20, 4, 0); // 08:00 Bakı, çərşənbə axşamı
    expect(m.baseline('M6', at8)!).toBeGreaterThan(1.9);
    const at3 = Date.UTC(2026, 9, 20, 23, 0); // 03:00 Bakı
    expect(m.baseline('M6', at3)!).toBeLessThan(1.3);
    const before = m.predict('M6', at3, 15)!;
    m.observe('M6', at3, 3);
    m.observe('M6', at3, 3);
    expect(m.predict('M6', at3, 15)!).toBeGreaterThan(before);
  });
});

describe('bot aşkarlanması', () => {
  it('sıçrayış + bir IP-dən çoxlu cihaz + koordinatsız = hücum', () => {
    const now = T0;
    const list = Array.from({ length: 40 }, (_, i) => rep({ level: 3, ts: now - i * 1000, deviceId: `bot${i}`, ip: 'X', hasGeo: false, geoWeight: 0.4 }));
    const devices = new Map(list.map((r) => [r.deviceId, { firstSeen: now - 30_000 }]));
    const v = detectBots(list, now, devices, 1);
    expect(v.attack).toBe(true);
    expect(v.suspiciousIds.size).toBe(40);
    expect(v.signals.length).toBeGreaterThanOrEqual(3);
  });
  it('adi axın hücum sayılmır', () => {
    const list = Array.from({ length: 6 }, (_, i) => rep({ level: 2, ts: T0 - i * 45_000 }));
    expect(detectBots(list, T0, new Map(), 2).attack).toBe(false);
  });
});

describe('"bunu burax" və domino', () => {
  it('dolu avtobusdan sonra 6 dəqiqə ərzində boş avtobus varsa tövsiyə edir', () => {
    const a = skipAdvice([
      { busId: '1', routeId: 'M6', label: 'M6·1', etaS: 60, level: 3, badge: 'confirmed', bunchedFollower: false },
      { busId: '2', routeId: 'M6', label: 'M6·2', etaS: 240, level: 1, badge: 'confirmed', bunchedFollower: false },
    ]);
    expect(a?.takeBusId).toBe('2');
    expect(a?.text).toMatch(/M6·2/);
  });
  it('növbəti avtobus çox gecdirsə tövsiyə yoxdur', () => {
    expect(
      skipAdvice([
        { busId: '1', routeId: 'M6', label: 'a', etaS: 60, level: 3, badge: 'confirmed', bunchedFollower: false },
        { busId: '2', routeId: 'M6', label: 'b', etaS: 900, level: 1, badge: 'confirmed', bunchedFollower: false },
      ]),
    ).toBeNull();
  });
  it('yalnız dolu avtobuslar gəlirsə risk artır', () => {
    const full = stopRisk([{ busId: '1', etaS: 120, level: 3 }, { busId: '2', etaS: 500, level: 3 }], 360);
    const ok = stopRisk([{ busId: '1', etaS: 120, level: 1 }], 360);
    expect(full.risk[2]).toBeGreaterThan(ok.risk[2]);
    expect(ok.firstServiceableS).toBe(120);
  });
});
