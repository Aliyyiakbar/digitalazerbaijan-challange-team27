#!/usr/bin/env node
// opendata.az rəsmi məlumatlarını sistemin şəbəkə formatına çevirir.
//
//   NODE_USE_ENV_PROXY=1 node scripts/import-opendata.mjs
//
// Mənbələr (opendata.az):
//   • Avtobusların hərəkət trayektoriyası — AYNA, CC0 (KMZ, 27.11.2025 snapshot)
//   • BakuBus dayanacaqlarının coğrafi koordinatları — Bakı Metropoliteni (CSV, lisenziya göstərilməyib)
//   • BakuBus marşrutları üzrə gündəlik gedişlər 2026 — Bakı Metropoliteni, CC BY (CSV)
//
// Rəsmi məlumatda xətt ↔ dayanacaq əlaqəsi yoxdur. Onu burada həndəsi olaraq qururuq:
// xəttin həndəsəsinə ≤ 25 m yaxın olan dayanacaq həmin xəttə aid sayılır, sırası isə
// xətt boyunca proyeksiyaya görə müəyyən edilir.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'backend', 'package.json'));
const JSZip = require('jszip');
const cache = join(root, 'scripts', '.cache');
mkdirSync(cache, { recursive: true });

const SOURCES = {
  shapes: { file: 'buslines.kmz', url: 'https://admin.opendata.az/dataset/366c03c3-f60a-4198-b8e4-959af2082296/resource/df2edcdc-2af2-4f78-8c49-d6c5b78402b6/download/buslines.kmz', page: 'https://opendata.az/dataset/avtobuslarin-hereket-trayektoriyasi', licence: 'CC0', publisher: 'AYNA' },
  stops: { file: 'dayanacaqlar.csv', url: 'https://admin.opendata.az/dataset/4e303bfc-c564-4a90-8233-59347494acb1/resource/d4a08018-bda7-4b8c-840e-4250d05f5806/download/dayanacaqlar.csv', page: 'https://opendata.az/dataset/bakubus-mmc-ye-mexsus-avtobus-marsrutlari-uzre-dayanacaqlarin-cografi-koordinatlari', licence: 'göstərilməyib', publisher: 'Bakı Metropoliteni' },
  ridership: { file: 'bakubus_passenger-2026.csv', url: 'https://admin.opendata.az/dataset/32766a9d-479c-41ff-a660-7b739b4ff034/resource/bbed6c16-79dc-4b3d-a0b6-b0411dcda473/download/bakubus_passenger-2026.csv', page: 'https://opendata.az/dataset/bakubus-marsrutlari-uzre-gundelik-sernisin-gedislerinin-sayi-2026', licence: 'CC BY', publisher: 'Bakı Metropoliteni' },
};

async function get(key) {
  const s = SOURCES[key];
  const p = join(cache, s.file);
  if (!existsSync(p)) {
    console.log('yüklənir:', s.file);
    const r = await fetch(s.url);
    if (!r.ok) throw new Error(`${s.file}: HTTP ${r.status}`);
    writeFileSync(p, Buffer.from(await r.arrayBuffer()));
  }
  return readFileSync(p);
}

// ---------------------------------------------------------------- həndəsə
const R = 6371000;
const rad = (x) => (x * Math.PI) / 180;
const hav = (a, b) => {
  const dLat = rad(b[0] - a[0]);
  const dLon = rad(b[1] - a[1]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
};
const K = Math.cos(rad(40.4));
const xy = ([lat, lon]) => [rad(lon) * K * R, rad(lat) * R];
const polyLen = (pts) => pts.reduce((s, p, i) => (i ? s + hav(pts[i - 1], p) : 0), 0);

function rdp(pts, tol) {
  if (pts.length < 3) return pts;
  const P = pts.map(xy);
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = P[a];
    const [bx, by] = P[b];
    const vx = bx - ax;
    const vy = by - ay;
    const L2 = vx * vx + vy * vy || 1;
    let best = -1;
    let bd = 0;
    for (let i = a + 1; i < b; i++) {
      const t = Math.max(0, Math.min(1, ((P[i][0] - ax) * vx + (P[i][1] - ay) * vy) / L2));
      const d = Math.hypot(P[i][0] - ax - vx * t, P[i][1] - ay - vy * t);
      if (d > bd) {
        bd = d;
        best = i;
      }
    }
    if (bd > tol) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

const r6 = (x) => Math.round(x * 1e6) / 1e6;

// Bəzi adlarda Azərbaycan "ə" əvəzinə kiril "ә" (U+04D9) yazılıb — şriftdə fərqli görünür
const fixText = (t) => t.trim().replace(/ә/g, 'ə').replace(/Ә/g, 'Ə').replace(/[“”]/g, '"').replace(/\s+/g, ' ');

// ---------------------------------------------------------------- oxu
function parseKml(text) {
  const out = [];
  for (const pm of text.match(/<Placemark[\s\S]*?<\/Placemark>/g) ?? []) {
    const name = pm.match(/<name>([^<]*)<\/name>/)?.[1]?.trim();
    const parts = [...pm.matchAll(/<coordinates>([\s\S]*?)<\/coordinates>/g)].map((m) =>
      m[1]
        .trim()
        .split(/\s+/)
        .map((c) => {
          const [lon, lat] = c.split(',').map(Number);
          return [lat, lon];
        }),
    );
    if (!name || !parts.length) continue;
    // hissələri ucları ən yaxın olacaq şəkildə ardıcıl birləşdir
    let line = parts[0];
    for (const p of parts.slice(1)) {
      const end = line[line.length - 1];
      line = hav(end, p[0]) <= hav(end, p[p.length - 1]) ? line.concat(p) : line.concat([...p].reverse());
    }
    // Bəzi xətlərdə əsas həlqədən başqa qısa parçalar var (məs. 120: 56 km + 3 qısa parça). Onlar
    // birləşdirilsə xətt "açıq" görünür və yalançı geri dönüşlə iki qat uzanır.
    const longest = parts.reduce((a, b) => (polyLen(b) > polyLen(a) ? b : a));
    const total = parts.reduce((a, b) => a + polyLen(b), 0);
    out.push({ name, line, main: polyLen(longest) >= total * 0.8 ? longest : line });
  }
  return out;
}

/** Eyni adlı iki açıq xətt uc-uca gəlirsə, onlar gediş və qayıdışdır (məs. 1 nömrəli xətt). */
function routeLine(all) {
  const mains = all.map((s) => s.main);
  if (mains.length === 2 && hav(mains[0][mains[0].length - 1], mains[1][0]) < 500 && hav(mains[1][mains[1].length - 1], mains[0][0]) < 500) return mains[0].concat(mains[1]);
  const main = mains.reduce((a, b) => (polyLen(b) > polyLen(a) ? b : a));
  if (hav(main[0], main[main.length - 1]) <= 500) return main;
  return main.concat([...main].reverse().slice(1)); // açıq xətt: eyni yolla qayıdır
}

function parseCsv(text) {
  return text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => {
      const cells = [];
      let cur = '';
      let q = false;
      for (const ch of l) {
        if (ch === '"') q = !q;
        else if (ch === ',' && !q) {
          cells.push(cur);
          cur = '';
        } else cur += ch;
      }
      cells.push(cur);
      return cells;
    });
}

// ---------------------------------------------------------------- əsas
const kmz = await JSZip.loadAsync(await get('shapes'));
const kmlFile = Object.keys(kmz.files).find((f) => f.endsWith('.kml'));
const shapes = parseKml(await kmz.files[kmlFile].async('string'));

const stopRows = parseCsv((await get('stops')).toString('utf8')).slice(1);
const allStops = stopRows
  .filter((c) => c.length >= 5 && c[2])
  .map((c) => ({ id: `S${c[2].trim()}`, name: fixText(c[1]), lon: Number(c[3]), lat: Number(c[4]) }))
  .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon) && s.lat > 39 && s.lat < 42 && s.name);
const stopById = new Map(allStops.map((s) => [s.id, s]));

const paxRows = parseCsv((await get('ridership')).toString('utf8')).slice(1);
const pax = new Map();
for (const [date, route, v] of paxRows) {
  const d = date.slice(0, 10);
  if (!pax.has(route)) pax.set(route, []);
  pax.get(route).push([d, Number(v)]);
}

// dayanacaq şəbəkəsi (sürətli axtarış üçün)
const CELL = 0.0015;
const grid = new Map();
const key = (lat, lon) => `${Math.floor(lat / CELL)}:${Math.floor(lon / CELL)}`;
for (const s of allStops) {
  const k = key(s.lat, s.lon);
  if (!grid.has(k)) grid.set(k, []);
  grid.get(k).push(s);
}
function near(lat, lon) {
  const i = Math.floor(lat / CELL);
  const j = Math.floor(lon / CELL);
  const out = [];
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) out.push(...(grid.get(`${i + a}:${j + b}`) ?? []));
  return out;
}

const LINK_M = 25;
const CENTERLINE_M = 8; // yol oxuna bu qədər yaxın dayanacağın hansı tərəfdə olduğu bilinmir
const dirStats = { rightBefore: 0, leftBefore: 0, right: 0, left: 0, reversed: 0 };

/** Dayanacaqları xəttə bağlayır: hər "keçid" üçün ən yaxın nöqtə, məsafə və yolun hansı tərəfi. */
function linkStops(line) {
  const cum = [0];
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + hav(line[i - 1], line[i]));
  const P = line.map(xy);
  const hits = new Map(); // stopId → [{d, off, seg, cross}]
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = P[i - 1];
    const [bx, by] = P[i];
    const vx = bx - ax;
    const vy = by - ay;
    const L2 = vx * vx + vy * vy || 1;
    const cands = new Set([...near(line[i - 1][0], line[i - 1][1]), ...near(line[i][0], line[i][1])]);
    for (const s of cands) {
      const [px, py] = xy([s.lat, s.lon]);
      const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / L2));
      const off = Math.hypot(px - ax - vx * t, py - ay - vy * t);
      if (off > LINK_M) continue;
      const d = cum[i - 1] + (cum[i] - cum[i - 1]) * t;
      const cross = vx * (py - ay) - vy * (px - ax); // mənfi: hərəkətin sağında
      if (!hits.has(s.id)) hits.set(s.id, []);
      hits.get(s.id).push({ d, off, seg: i, cross });
    }
  }
  const passes = [];
  for (const [id, hs] of hits) {
    hs.sort((a, b) => a.seg - b.seg);
    // ardıcıl seqmentlər bir keçiddir; hər keçiddən ən yaxın nöqtə
    let group = [hs[0]];
    const flush = () => passes.push({ stopId: id, ...group.reduce((a, b) => (b.off < a.off ? b : a)) });
    for (const h of hs.slice(1)) {
      if (h.seg - group[group.length - 1].seg <= 2) group.push(h);
      else {
        flush();
        group = [h];
      }
    }
    flush();
  }
  return { cum, passes };
}

function countSides(passes) {
  const n = new Map();
  for (const p of passes) n.set(p.stopId, (n.get(p.stopId) ?? 0) + 1);
  let right = 0;
  let left = 0;
  for (const p of passes) {
    if (n.get(p.stopId) !== 1 || p.off <= CENTERLINE_M) continue;
    if (p.cross < 0) right++;
    else left++;
  }
  return { right, left };
}

const seenNames = new Set();
const routes = [];
const HUE_STEP = 137.508;
function color(i) {
  // canlı, bir-birindən fərqlənən rənglər (qızıl bucaq), ağ mətn üçün kifayət qədər tünd
  const h = (i * HUE_STEP + 12) % 360;
  const s = 0.68;
  const l = 0.42;
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return `#${[f(0), f(8), f(4)].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

for (const sh of shapes) {
  if (!pax.has(sh.name) || seenNames.has(sh.name)) continue;
  seenNames.add(sh.name);
  let line = rdp(routeLine(shapes.filter((s) => s.name === sh.name)), 4).map(([a, b]) => [r6(a), r6(b)]);
  let linked = linkStops(line);

  // İstiqamət: faylda xətlər çox vaxt hərəkətin əksinə çəkilib. Azərbaycanda hərəkət sağdandır,
  // ona görə bir dəfə keçilən dayanacaqların çoxu solda qalırsa, xətt tərsinə çevrilir.
  let side = countSides(linked.passes);
  dirStats.rightBefore += side.right;
  dirStats.leftBefore += side.left;
  if (side.left > side.right) {
    line = [...line].reverse();
    linked = linkStops(line);
    side = countSides(linked.passes);
    dirStats.reversed++;
  }
  dirStats.right += side.right;
  dirStats.left += side.left;
  const { cum } = linked;
  const L = cum[cum.length - 1];
  // dönüş nöqtəsi: başlanğıcdan ən uzaq nöqtə
  let turn = 0;
  let far = 0;
  line.forEach((p, i) => {
    const d = hav(line[0], p);
    if (d > far) {
      far = d;
      turn = i;
    }
  });
  const fwdLen = cum[turn];

  // eyni küçədən gediş və qayıdış keçirsə, dayanacaq sağda qaldığı istiqamətə aiddir
  const byStop = new Map();
  for (const p of linked.passes) byStop.set(p.stopId, [...(byStop.get(p.stopId) ?? []), p]);
  const cand = [];
  for (const passes of byStop.values()) {
    const right = passes.filter((p) => p.off <= CENTERLINE_M || p.cross < 0);
    cand.push(...(passes.length > 1 && right.length ? right : passes));
  }
  // yaxın (70 m) dayanacaqlardan yalnız xəttə ən yaxın olanı saxla (küçənin qarşı tərəfi və s.)
  cand.sort((a, b) => a.d - b.d);
  const kept = [];
  for (const c of cand) {
    const last = kept[kept.length - 1];
    if (last && c.d - last.d < 70) {
      if (c.off < last.off) kept[kept.length - 1] = c;
    } else kept.push(c);
  }
  if (kept.length < 4) continue;

  const series = pax.get(sh.name).sort((a, b) => a[0].localeCompare(b[0]));
  const mean = series.reduce((a, [, v]) => a + v, 0) / series.length;
  const dowSum = Array(7).fill(0);
  const dowN = Array(7).fill(0);
  for (const [d, v] of series) {
    const w = new Date(d + 'T00:00:00Z').getUTCDay();
    dowSum[w] += v;
    dowN[w]++;
  }
  const dow = dowSum.map((s, i) => (dowN[i] ? +(s / dowN[i] / mean).toFixed(3) : 1));
  const last30 = series.slice(-30);
  const recent = last30.reduce((a, [, v]) => a + v, 0) / last30.length;

  const stopsOut = kept.map((k) => ({ stopId: k.stopId, d: Math.round(k.d) }));
  const nearest = (d) => stopsOut.reduce((a, b) => (Math.abs(b.d - d) < Math.abs(a.d - d) ? b : a));
  const first = stopById.get(nearest(0).stopId).name;
  const terminal = stopById.get(nearest(fwdLen).stopId).name;
  const loopMinutes = L / 7 / 60 + stopsOut.length * 0.4;
  const buses = Math.max(3, Math.min(14, Math.round(recent / 1300)));
  routes.push({
    id: sh.name,
    name: `${first} – ${terminal}`,
    kind: /^[MEH]/.test(sh.name) ? 'express' : 'regular',
    loop: line,
    fwdLen: Math.round(fwdLen),
    length: Math.round(L),
    stops: stopsOut,
    buses,
    headwayMin: Math.max(3, Math.round(loopMinutes / buses)),
    ridership: { meanDaily: Math.round(mean), recentDaily: Math.round(recent), days: series.length, from: series[0][0], to: series[series.length - 1][0], dow, series: series.slice(-90).map(([d, v]) => [d.slice(5), v]) },
  });
}

routes.sort((a, b) => a.id.localeCompare(b.id, 'az', { numeric: true }));
routes.forEach((r, i) => (r.color = color(i)));
const used = new Set(routes.flatMap((r) => r.stops.map((s) => s.stopId)));
const stops = {};
for (const id of used) {
  const s = stopById.get(id);
  stops[id] = { id, name: s.name, lat: s.lat, lon: s.lon };
}
// ilkin dayanacaq: ən çox xəttin keçdiyi dayanacaq
const count = new Map();
for (const r of routes) for (const id of new Set(r.stops.map((s) => s.stopId))) count.set(id, (count.get(id) ?? 0) + 1);
const defaultStop = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];

const out = {
  generatedAt: new Date().toISOString(),
  sources: Object.values(SOURCES).map(({ file, page, licence, publisher }) => ({ file, page, licence, publisher })),
  note: 'Xətt ↔ dayanacaq əlaqəsi rəsmi məlumatda yoxdur; həndəsi yaxınlığa (≤25 m) görə qurulub. Avtobus sayı və interval gündəlik gedişlərdən təxmin edilib.',
  defaultStop,
  stops,
  routes,
};
const seedDir = join(root, 'backend', 'src', 'seed');
writeFileSync(join(seedDir, 'geodata.json'), JSON.stringify(out));

// fon şəbəkəsi: bütün AYNA xətləri (canlı olmayanlar da), sadələşdirilmiş
const bg = shapes.map((s) => ({ id: s.name, live: routes.some((r) => r.id === s.name), coords: rdp(s.line, 25).map(([a, b]) => [+a.toFixed(5), +b.toFixed(5)]) }));
writeFileSync(join(seedDir, 'network-all.json'), JSON.stringify({ source: SOURCES.shapes.page, routes: bg }));

const stopsPerRoute = routes.map((r) => r.stops.length);
console.log(`canlı xətlər: ${routes.length}, dayanacaqlar: ${used.size}/${allStops.length}, dayanacaq/xətt: ${Math.min(...stopsPerRoute)}–${Math.max(...stopsPerRoute)}`);
console.log(`avtobuslar: ${routes.reduce((a, r) => a + r.buses, 0)}, ilkin dayanacaq: ${stops[defaultStop].name} (${count.get(defaultStop)} xətt)`);
console.log(`fon şəbəkəsi: ${bg.length} xətt`);
console.log(`istiqamət: faylda sağda ${dirStats.rightBefore}, solda ${dirStats.leftBefore}; ${dirStats.reversed} xətt çevrildi, indi sağ pay ${Math.round((dirStats.right / Math.max(1, dirStats.right + dirStats.left)) * 100)}%`);
for (const id of ['1', '14', '88', '120', '141E', 'M6']) {
  const r = routes.find((x) => x.id === id);
  if (r) console.log(`  ${id}: ${(r.length / 1000).toFixed(1)} km, gediş ${r.stops.filter((s) => s.d < r.fwdLen - 30).length} + qayıdış ${r.stops.filter((s) => s.d >= r.fwdLen - 30).length} dayanacaq, ${r.buses} avtobus | ${r.name}`);
}
