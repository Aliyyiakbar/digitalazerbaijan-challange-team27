# Smart Transit Baku — Crowdsourcing Engine

Bakı ictimai nəqliyyatı üçün real vaxt marşrut və yük (sıxlıq) analitikası sisteminin funksional prototipi.

- **Sərnişin modulu** (PWA): dayanacaq və ya xətt seçilir, avtobusların canlı yeri, gözlənilən gəliş vaxtı (ETA) və sıxlıq səviyyəsi görünür. Sıxlığı bir toxunuşla bildirmək olar: aşağı, orta və ya yüksək.
- **Operator modulu** (analitika engine): sərnişin bildirişləri və GPS əsasında xətlər üzrə sıxlıq xəritəsi və siyahısı canlı yenilənir. Xətt **10 dəqiqə fasiləsiz "yüksək"** qalanda panelə avtomatik olaraq **"əlavə avtobus ehtiyatı ayrılmalıdır"** tövsiyəsi düşür. Operator bir kliklə ehtiyat avtobusu xəttə buraxır.

> **Kontekst.** Bakının avtobus sisteminə AYNA (Azərbaycan Yerüstü Nəqliyyat Agentliyi) baxır. BNA 2023-cü ildə ləğv edilib və funksiyaları AYNA-ya keçib. AYNA MaaS tətbiqi avtobusun yerini və ETA-nı göstərir, amma **avtobusun nə qədər dolu olduğunu göstərmir**. 4 avqust 2026-dan metroda 28 May–Nizami hissəsi bağlıdır, M1–M6 ekspres xətləri açılıb, sərnişinlər M6 və 17 nömrəli xətlərin sıxlığından şikayət edir. Prototip bu ssenari üzərində qurulub. Mənbələr: [docs/TEXNIKI_IZAH.md](docs/TEXNIKI_IZAH.md#mənbələr).

---

## Mündəricat
1. [Tez başlanğıc](#1-tez-başlanğıc)
2. [Demo ssenarisi (5 dəqiqə)](#2-demo-ssenarisi-5-dəqiqə)
3. [Arxitektura](#3-arxitektura)
4. [API](#4-api)
5. [Alqoritmlər qısaca](#5-alqoritmlər-qısaca)
6. [Testlər](#6-testlər)
7. [Qovluq strukturu](#7-qovluq-strukturu)
8. [Məhdudiyyətlər](#8-məhdudiyyətlər)
9. [Təhvil materialları](#9-təhvil-materialları)

---

## 1. Tez başlanğıc

### A) Docker ilə (tövsiyə olunur)

```bash
docker compose up --build
```

| Ünvan | Nə var |
|---|---|
| http://localhost:3000 | Sərnişin tətbiqi (PWA) |
| http://localhost:3000/operator | Dispetçer paneli |
| http://localhost:3000/operator/demo | Demo ssenariləri, simulyasiya sürəti |
| http://localhost:8080/api/docs | API sənədi (Swagger) |
| http://localhost:8080/gtfs-rt/vehicle-positions?format=json | GTFS-Realtime (JSON) |

Compose-da 5 servis var: `postgres` (16), `redis` (7), `backend` (API + engine + WebSocket), `simulator` (avtobus terminallarını təqlid edən ayrıca proses) və `frontend` (nginx).

Demoda hər şeyi sürətləndirmək üçün: `SIM_SPEED=10 docker compose up --build`.

### B) Lokal (Docker-siz)

Tələblər: **Node.js 22+** və **Redis** (`brew install redis && redis-server`). PostgreSQL **lazım deyil**: `DATABASE_URL` boşdursa backend **PGlite**-dan istifadə edir. Bu, WASM üzərində işləyən real PostgreSQL-dir, eyni sxem və eyni SQL ilə işləyir və məlumatı `backend/.data/` qovluğunda saxlayır.

```bash
npm run setup                  # backend + frontend asılılıqları
npm run dev                    # backend :8080 + frontend :5173
# brauzer: http://localhost:5173   və   http://localhost:5173/operator
```

Ayrı-ayrılıqda işə salmaq:

```bash
cd backend  && REDIS_URL=redis://127.0.0.1:6379 npm start          # API :8080
cd frontend && VITE_BACKEND=http://localhost:8080 npm run dev       # UI  :5173
```

Real PostgreSQL ilə: `DATABASE_URL=postgres://user:pass@localhost:5432/smart_transit npm start`. Sxem başlanğıcda avtomatik yaradılır (`backend/src/db/schema.sql`).

Production build (frontend-i backend özü verir): `npm start`. Ünvan: http://localhost:8080.

Bütün dəyişənlər: [`.env.example`](.env.example).

> **Telefondan test.** Brauzerin yer məlumatı (Geolocation API) və PWA quraşdırılması yalnız **HTTPS** və ya `localhost`-da işləyir. Telefonla `http://192.168.x.x` ünvanına girəndə bildirişlər koordinatsız gedir və azaldılmış çəki ilə sayılır. HTTPS üçün `cloudflared tunnel --url http://localhost:3000` və ya `mkcert` istifadə edin.

---

## 2. Demo ssenarisi (5 dəqiqə)

1. **/operator/demo** səhifəsində sürəti **×30** edin (10 dəqiqə ≈ 20 saniyə).
2. **"Pik saat: M6"** düyməsini basın və **/operator** panelinə keçin. M6 xətti xəritədə qırmızıya dönür, cədvəldə "Yüksək" sütununda dəqiqələr artır. 10-cu dəqiqədə səs siqnalı ilə **"M6 xəttinə əlavə ehtiyat avtobus ayrılmalıdır"** kartı düşür. **"Niyə?"** bölməsini açın: qayda, bal, bildiriş və cihaz sayı, etibar, səbəb (tıxac/tələbat), az yüklü donor xətt və buraxılış dayanacağı göstərilir.
3. **"Ehtiyat avtobus göndər"** düyməsini basın. Yeni M6·E avtobusu xəritəyə daxil olur, sərnişin tətbiqində də görünür.
4. **Kənar hal: "Boş avtobusa 'çox sıx' deyirlər"** (M1). 6 cihaz boş avtobusa "yüksək" göndərir, onlardan 4-ü evdən. Avtobus toplanmış cütün arxasındadır. Sistem bildirişi atmır, amma etibarı aşağı salır: nişan **"Yoxlanılmalı"** olur və səbəbləri yazılır. Sərnişin tətbiqində yaxındakı istifadəçiyə **"Doğrudurmu?"** sualı çıxır.
5. **Bot hücumu** (M3). 3 dəqiqə ərzində saniyədə bir bildiriş gəlir: 2 IP-dən, koordinatsız, yeni cihazlardan. Bildirişlər karantinə düşür, xəttin nişanı "Şübhəli" olur, "Saxta bildiriş" xəbərdarlığı yaranır.
6. **Tıxac** (6). Sürət düşür, amma dayanma müddəti adi qalır. Səbəb "Tıxac" kimi təsnif olunur və panel əlavə avtobusun kömək etməyəcəyini bildirir.
7. **Toplanma** (M2). İki avtobus bir-birinin ardınca düşür. Panel arxadakı avtobusu neçə dəqiqə saxlamağı tövsiyə edir, sərnişinə isə "bunu burax, növbətisi boşdur" deyilir.
8. **/operator/history** (vaxt maşını). Son 2 saatı geri sarıb sıxlığın necə yayıldığına baxın. Xəbərdarlıqlar zaman zolağında işarələnib.
9. Sərnişin tətbiqində **Marşrut** bölməsi. Variantlar "hiss olunan vaxta" görə sıralanır: dolu avtobusda ayaq üstə getmək təxminən 2.3 dəfə uzun hiss olunur.

---

## 3. Arxitektura

```mermaid
flowchart LR
  subgraph Sahə
    SIM[Simulyator / avtobus terminalları<br/>GPS hər 1 san]
    PAX[Sərnişin PWA<br/>React + Leaflet]
  end
  subgraph Backend [Backend — Node.js + Express + TypeScript]
    API[HTTP API + zod yoxlama]
    ENG[Analitika engine<br/>hər 1 san dövr]
    WS[WebSocket /ws]
  end
  R[(Redis<br/>bus:pos · win:route · rl:* · pub/sub)]
  PG[(PostgreSQL 16 / PGlite<br/>routes · stops · reports · alerts · snapshots)]
  OPS[Dispetçer paneli<br/>React + Leaflet]
  EXT[GTFS / GTFS-RT istehlakçıları<br/>AYNA MaaS, Google Maps]

  SIM -- POST /api/gps --> API
  PAX -- POST /api/reports --> API
  PAX -- GET arrivals / plan --> API
  API --> ENG
  ENG <--> R
  ENG --> PG
  R -- pub/sub --> WS
  WS --> PAX
  WS --> OPS
  OPS -- dispatch / alerts --> API
  ENG -- add-bus əmri --> SIM
  API -- /gtfs-rt/* --> EXT
```

**Axın:**
1. Avtobus terminalı (prototipdə simulyator) hər saniyə `POST /api/gps` göndərir.
2. Engine koordinatı xəttin "dövrəsinə" proyeksiya edir: gediş və qayıdış bir polilayn kimi saxlanılır, nəticədə avtobusun xətt boyunca neçə metr getdiyi məlum olur. Sonra sürət və dayanacaqda dayanma müddəti hesablanır.
3. Sərnişin `POST /api/reports` göndərir. Bildiriş yoxlanılır: HMAC cihaz tokeni, spam limiti, məsafə, cihazın etibarı. Sonra Redis-dəki 10 dəqiqəlik pəncərəyə (`ZSET win:{route}`) yazılır, PostgreSQL-də isə tarixçəsi qalır.
4. Engine hər dövrdə xətlər üzrə bunları hesablayır:
   - sıxlıq və etibar;
   - bot hücumu;
   - toplanma;
   - tıxac və ya tələbat;
   - proqnoz;
   - domino riski;
   - 10 dəqiqəlik qayda.

   Nəticələr Redis pub/sub vasitəsilə bütün WebSocket müştərilərinə gedir.
5. Operator "Ehtiyat avtobus göndər" basanda engine simulyatora `add-bus` əmri verir (ayrıca proses rejimində bu əmr WebSocket ilə gedir) və yeni avtobus GPS göndərməyə başlayır.

**Niyə belə:**
- Redis real vaxt "isti" məlumat üçündür: son mövqelər, sürüşən pəncərə, rate-limit, bir neçə backend instansı arasında pub/sub.
- PostgreSQL daimi məlumat üçündür: bildirişlərin auditi, xəbərdarlıqlar, vaxt maşını və proqnoz modeli üçün snapshot-lar.
- Ətraflı əsaslandırma: [docs/TEXNIKI_IZAH.md](docs/TEXNIKI_IZAH.md).

---

## 4. API

Tam sənəd: **`/api/docs`** (Swagger UI, OpenAPI 3.1).

| Metod | Yol | Təsvir |
|---|---|---|
| POST | `/api/session` | Anonim cihaz tokeni (HMAC) |
| GET | `/api/network` | Xətlər, dayanacaqlar, həndəsə |
| GET | `/api/stops/{id}/arrivals` | Dayanacağa gələn avtobuslar: ETA, sıxlıq, etibar, "bunu burax" tövsiyəsi |
| GET | `/api/routes/{id}/live` | Xəttin canlı avtobusları |
| GET | `/api/plan?from&to` | Sıxlığı nəzərə alan marşrut planı (≤1 köçürmə) |
| POST | `/api/reports` | Sıxlıq bildirişi: `context: bus\|stop`, `level: low\|medium\|high` |
| POST | `/api/gps` | Avtobus GPS ping-i (daxili açarla) |
| GET | `/api/operator/overview` | Xətlər üzrə hər şey + xəbərdarlıqlar |
| PATCH | `/api/operator/alerts/{id}` | `new → ack → resolved` |
| POST | `/api/operator/dispatch` | Ehtiyat avtobus: `reserve` və ya başqa xətdən `transfer` |
| GET | `/api/operator/history?minutes=120` | Vaxt maşını kadrları |
| GET | `/api/operator/forecast/{route}` | Proqnoz əyrisi |
| POST | `/api/sim/scenario`, `/api/sim/speed` | Demo idarəsi |
| GET | `/gtfs/static.zip` | Statik GTFS |
| GET | `/gtfs-rt/vehicle-positions`, `/trip-updates`, `/alerts` | GTFS-Realtime (protobuf; `?format=json`) |
| WS | `/ws` | `state`, `alert`, `alert.update`, `dispatch`, `clock` |

Nümunə:

```bash
S=$(curl -s -XPOST localhost:8080/api/session)
ID=$(echo $S | jq -r .deviceId); TOK=$(echo $S | jq -r .token)
curl -XPOST localhost:8080/api/reports -H 'content-type: application/json' \
  -H "x-device-id: $ID" -H "x-device-token: $TOK" \
  -d '{"context":"bus","busId":"M6-2","level":"high","lat":40.39,"lon":49.83,"accuracy":20}'
```

---

## 5. Alqoritmlər qısaca

| Nə | Necə | Fayl |
|---|---|---|
| **Əsas qayda** | Xətt **fasiləsiz 10 dəqiqə** "yüksək" qalır: bal ≥ 2.4, pəncərədə ≥ 5 bildiriş, ≥ 3 cihaz. Bu halda avtomatik tövsiyə yaranır. 60 saniyədən qısa enişlər fasilə sayılmır. Təkrar tövsiyə ən tez 10 dəqiqə sonra. | `engine/rules.ts` |
| Sıxlıq balı | Son 10 dəqiqənin çəkili ortası (1..3). Çəki = etibar × coğrafi çəki × 0.5^(yaş/5 dəq). | `engine/crowd.ts` |
| Etibar balı | Həcm, cihaz müxtəlifliyi, razılaşma və coğrafiyaya fiziki ziddiyyətlər əlavə olunur: toplanmanın arxa avtobusu, qısa və ya uzun dayanma, proqnoz. | `engine/crowd.ts` |
| Cihaz reputasiyası | "Truth discovery": konsensusla uyğun gələn bildiriş +0.05, ziddə düşən −0.10. Yeni cihaz ilk 5 dəqiqədə zəifdir. | `engine/trust.ts` |
| Coğrafi yoxlama | Avtobusa/dayanacağa ≤150 m olduqda ×1.0, ≤400 m ×0.6, ≤1 km ×0.25, uzaqda ×0.1, koordinat yoxdursa ×0.4. Koordinat saxlanılmır. | `engine/trust.ts` |
| Bot aşkarlanması | Sürət sıçrayışı, bir IP-də 4+ cihaz, maşın ritmi, koordinatsızlıq, yeni cihazlar. ≥2 siqnal olarsa karantin. | `engine/botdetect.ts` |
| Toplanma | İntervallar ideal intervalın <30%-i olduqda toplanma sayılır. Saxlama = (arxa − ön interval)/2. | `engine/bunching.ts` |
| Tıxac / tələbat | Sürət sərbəst axının <60%-i: tıxac. Dayanma şəbəkə medianının >1.5 qatı: tələbat. GTFS-RT `congestion_level`. | `engine/cause.ts` |
| ETA | Qalan məsafə / (avtobus sürəti ⊕ xəttin orta sürəti) + aralıq dayanacaqlar × orta dayanma. | `engine/eta.ts` |
| Proqnoz | Baza: xətt × 15 dəq × gün növü üzrə tarixi ortalama, üstəgəl EWMA real vaxt düzəlişi. 15 və 30 dəqiqə irəli. | `engine/forecast.ts` |
| Domino | Hər dayanacaq üçün +5/+10/+15 dəqiqədə yeri olan avtobusun gəlməmə riski. | `engine/ripple.ts` |
| Bunu burax | Gələn avtobus doludursa və ≤6 dəqiqə sonra boş və ya orta avtobus gəlirsə, tövsiyə verilir. | `engine/advice.ts` |
| Marşrut planı | Sadələşdirilmiş RAPTOR (0–1 köçürmə). Hiss olunan vaxt = gözləmə×1.5 + yol×sıxlıq əmsalı (1.0 / 1.19 / 2.32, Wardman & Whelan). | `engine/planner.ts` |

---

## 6. Testlər

```bash
npm test                         # hamısı
cd backend && npm test           # 45 test: engine unit + API inteqrasiya (PGlite yaddaşda)
cd frontend && npm test          # 7 test: UI smoke (jsdom, real API cavablarından fixture)
cd backend && npm run typecheck
```

Əsas inteqrasiya testi: *"10 dəqiqə davamlı yüksək → avtomatik tövsiyə → operator göndərir"*. Test 9:59-da tövsiyənin **olmadığını**, 10:00-da isə **olduğunu** yoxlayır.

---

## 7. Qovluq strukturu

```
smart-transit-baku/
├── backend/
│   ├── src/
│   │   ├── server.ts            giriş: DB + Redis + engine + simulyator + HTTP + WS
│   │   ├── api/                 Express marşrutları, OpenAPI
│   │   ├── engine/              analitika (təmiz, test olunan modullar)
│   │   ├── db/                  PostgreSQL/PGlite adapteri, sxem, Redis store
│   │   ├── sim/                 simulyator (daxili və ayrıca proses)
│   │   ├── gtfs/                GTFS + GTFS-RT ixracı
│   │   ├── seed/                geodata.json (OSM/OSRM), sintetik tarixçə
│   │   └── lib/                 həndəsə, simulyasiya saatı
│   ├── test/
│   └── Dockerfile
├── frontend/
│   ├── src/passenger/           sərnişin PWA
│   ├── src/operator/            dispetçer paneli
│   ├── src/components/          xəritə, sıxlıq/etibar nişanları, proqnoz qrafiki
│   ├── test/
│   └── Dockerfile, nginx.conf
├── scripts/                     geodata, ikonlar, dev başladıcı
├── docs/TEXNIKI_IZAH.md (.txt)  texniki izah sənədi
├── AI_DECLARATION.md            AI istifadəsi haqqında bəyannamə
└── docker-compose.yml
```

---

## 8. Məhdudiyyətlər

- **GPS və bildirişlər simulyasiyadır.** AYNA-nın açıq API-si və ya GTFS axını yoxdur. Simulyatorun "dürüst" sərnişinləri avtobusun həqiqi doluluğuna uyğun bildiriş göndərir (~14%-i bir səviyyə səhv olur). Ssenarilər UI-da "simulyasiya" kimi işarələnib.
- **Dayanacaq koordinatları** OpenStreetMap-dən (Overpass), yol həndəsəsi OSRM-dən bir dəfə çəkilib (`npm run geodata`). M1–M6 xətlərinin uc dayanacaqları AYNA elanındandır. **Adi xətlərin (6, 17, 61, 88) dayanacaq siyahısı təxminidir.**
- **Proqnoz modeli** 14 günlük **sintetik** tarixçə ilə öyrədilir. Real dəqiqlik yalnız AYNA/BakıKart məlumatı ilə ölçülə bilər.
- Operator panelində autentifikasiya yoxdur (prototip). Production üçün AYNA SSO/RBAC lazımdır.
- Docker faylları yazılıb, amma hazırlandığı mühitdə Docker işə salına bilmədi. Lokal yol (PGlite + Redis) və Docker-in istifadə etdiyi ayrıca simulyator rejimi isə test olunub. Ətraflı: [AI_DECLARATION.md](AI_DECLARATION.md).

---

## 9. Təhvil materialları

- [x] İşlək proqram və mənbə kodu (bu repo / zip arxiv)
- [x] İşə salma təlimatı və arxitektura qeydi: bu README
- [x] AI istifadəsi haqqında bəyannamə: [AI_DECLARATION.md](AI_DECLARATION.md)
- [x] Texniki izah sənədi: [docs/TEXNIKI_IZAH.md](docs/TEXNIKI_IZAH.md), Notepad üçün [docs/TEXNIKI_IZAH.txt](docs/TEXNIKI_IZAH.txt)

**Komanda:** [Üzv 1: rol] · [Üzv 2: rol] · [Üzv 3: rol]
