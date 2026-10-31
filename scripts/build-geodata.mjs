#!/usr/bin/env node
// Bir dəfəlik skript: dayanacaq koordinatları (OpenStreetMap / Overpass-dan götürülüb)
// və OSRM ilə xətlərin real yol həndəsəsini çəkib backend/src/seed/geodata.json-a yazır.
// Demo internetsiz işləsin deyə nəticə repoda saxlanılır.
//
//   node scripts/build-geodata.mjs
//
// Qeyd: M1–M6 ekspres xətlərinin uc dayanacaqları AYNA-nın 04.08.2026 elanından götürülüb
// (azertag.az/xeber/4351909). Adi xətlərin (6, 17, 61, 88) dayanacaq siyahısı TƏXMİNİDİR
// və yalnız demo üçündür.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

// Overpass API, node[station=subway], 2026-10-31
const STOPS = {
  ELM: ['Elmlər Akademiyası', 40.37515, 49.81548],
  INS: ['İnşaatçılar', 40.38909, 49.80236],
  Y20: ['20 Yanvar', 40.40414, 49.8077],
  S20: ['20 Sentyabr', 40.39373, 49.82823],
  N8: ['8 Noyabr', 40.40187, 49.82051],
  NIZ: ['Nizami', 40.37932, 49.83002],
  M28: ['28 May', 40.37986, 49.84864],
  GEN: ['Gənclik', 40.39988, 49.85096],
  NAR: ['Nəriman Nərimanov', 40.40282, 49.87064],
  ULD: ['Ulduz', 40.41496, 49.89143],
  KOR: ['Koroğlu', 40.42086, 49.91809],
  QQ: ['Qara Qarayev', 40.41761, 49.93396],
  NEF: ['Neftçilər', 40.41116, 49.94257],
  XD: ['Xalqlar Dostluğu', 40.39689, 49.95299],
  AHM: ['Əhmədli', 40.38556, 49.95395],
  HA: ['Həzi Aslanov', 40.37304, 49.95357],
  SAH: ['Sahil', 40.37173, 49.84457],
  ICH: ['İçərişəhər', 40.36596, 49.83165],
  XET: ['Şah İsmayıl Xətai', 40.38326, 49.87214],
  MEA: ['Memar Əcəmi', 40.41068, 49.81394],
  AZP: ['Azadlıq prospekti', 40.42596, 49.84293],
  DER: ['Dərnəgül', 40.4254, 49.86179],
  BAK: ['Bakmil', 40.41414, 49.8788],
};

// kind: express (metro əvəzedici M-xətləri) | regular
// headwayMin: planlaşdırılmış interval; capacity: avtobus tutumu (oturacaq+ayaq üstü)
// demand: simulyatorda pik saatda tələbat çarpanı (M6 ən yüklüdür — Oxu.az, 21.09.2026)
const ROUTES = [
  { id: 'M1', name: 'Elmlər Akademiyası – 28 May', kind: 'express', color: '#0B6E4F', stops: ['ELM', 'NIZ', 'M28'], buses: 5, headwayMin: 6, demand: 1.15 },
  { id: 'M2', name: 'İnşaatçılar – Nizami – 28 May', kind: 'express', color: '#1F5FA8', stops: ['INS', 'ELM', 'NIZ', 'M28'], buses: 5, headwayMin: 7, demand: 1.0 },
  { id: 'M3', name: '20 Yanvar – Nizami – 28 May', kind: 'express', color: '#8A3B12', stops: ['Y20', 'N8', 'S20', 'NIZ', 'M28'], buses: 5, headwayMin: 7, demand: 1.05 },
  { id: 'M4', name: '20 Yanvar – Koroğlu', kind: 'express', color: '#5B3A8E', stops: ['Y20', 'MEA', 'AZP', 'DER', 'BAK', 'ULD', 'KOR'], buses: 6, headwayMin: 8, demand: 0.9 },
  { id: 'M5', name: '20 Yanvar – Gənclik', kind: 'express', color: '#A0153E', stops: ['Y20', 'N8', 'GEN'], buses: 4, headwayMin: 7, demand: 1.1 },
  { id: 'M6', name: 'Elmlər Akademiyası – Gənclik', kind: 'express', color: '#C2410C', stops: ['ELM', 'S20', 'N8', 'GEN'], buses: 4, headwayMin: 6, demand: 1.45 },
  { id: '6', name: 'Sahil – Ulduz', kind: 'regular', color: '#0E7490', stops: ['SAH', 'M28', 'GEN', 'NAR', 'ULD'], buses: 5, headwayMin: 9, demand: 0.85 },
  { id: '17', name: 'İçərişəhər – Şah İsmayıl Xətai', kind: 'regular', color: '#4D7C0F', stops: ['ICH', 'SAH', 'M28', 'XET'], buses: 4, headwayMin: 10, demand: 1.2 },
  { id: '61', name: 'Elmlər Akademiyası – Memar Əcəmi', kind: 'regular', color: '#57534E', stops: ['ELM', 'INS', 'Y20', 'MEA'], buses: 6, headwayMin: 8, demand: 0.45 },
  { id: '88', name: 'Koroğlu – Həzi Aslanov', kind: 'regular', color: '#9D174D', stops: ['KOR', 'QQ', 'NEF', 'XD', 'AHM', 'HA'], buses: 5, headwayMin: 9, demand: 0.7 },
];

async function osrm(coords) {
  const path = coords.map(([lat, lon]) => `${lon},${lat}`).join(';');
  const url = `https://router.project-osrm.org/route/v1/driving/${path}?overview=full&geometries=geojson&steps=false`;
  const res = await fetch(url, { headers: { 'User-Agent': 'smart-transit-baku-hackathon/1.0' } });
  if (!res.ok) throw new Error(`OSRM ${res.status}`);
  const j = await res.json();
  if (j.code !== 'Ok') throw new Error(`OSRM ${j.code}`);
  return j.routes[0].geometry.coordinates.map(([lon, lat]) => [+lat.toFixed(6), +lon.toFixed(6)]);
}

const out = { generatedAt: new Date().toISOString(), source: 'OpenStreetMap (Overpass) + OSRM', stops: {}, routes: [] };
for (const [id, [name, lat, lon]] of Object.entries(STOPS)) out.stops[id] = { id, name, lat, lon };

for (const r of ROUTES) {
  const coords = r.stops.map((s) => [STOPS[s][1], STOPS[s][2]]);
  let forward;
  try {
    forward = await osrm(coords);
  } catch (e) {
    console.warn(`  ${r.id}: OSRM alınmadı (${e.message}), düz xətlərlə`);
    forward = coords;
  }
  let backward;
  try {
    backward = await osrm([...coords].reverse());
  } catch {
    backward = [...forward].reverse();
  }
  out.routes.push({ ...r, forward, backward });
  console.log(`${r.id}: ${forward.length}+${backward.length} nöqtə`);
  await new Promise((ok) => setTimeout(ok, 1100));
}

const target = join(here, '..', 'backend', 'src', 'seed', 'geodata.json');
writeFileSync(target, JSON.stringify(out));
console.log('yazıldı:', target);
