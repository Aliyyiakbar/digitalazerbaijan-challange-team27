# AI istifadəsi haqqında bəyannamə (AI Declaration)

**Layihə:** Smart Transit Baku — Crowdsourcing Engine
**Komanda:** Team 27: Əli Məmmədov · Əliyyiəkbər Şirinli · Rauf Bayramov
**Tarix:** 31 oktyabr 2026

Bu sənəd layihədə süni intellektin harada, necə və hansı sorğularla istifadə olunduğunu açıq şəkildə bəyan edir.

---

## 1. İstifadə olunan alətlər

| Alət | Model | Nə üçün |
|---|---|---|
| **Claude Code** (Anthropic, CLI agent) | Claude Opus 5.5 | Araşdırma, arxitektura, bütün mənbə kodu, testlər, Docker faylları, sənədlər |
| Claude Code daxilində veb axtarış və səhifə oxuma | — | AYNA/BNA vəziyyəti, metro bağlanması, ədəbiyyat (bunching, dwell time, truth discovery, GTFS-RT, WCAG 2.2, crowding multipliers) |
| Dizayn təlimat paketləri (Claude Code "skills") | — | UI qərarları üçün yoxlama siyahıları və qaydalar: [`leonxlnx/taste-skill`](https://github.com/leonxlnx/taste-skill) (app-screen qaydaları, `draw.mjs` ilə üslub seçimi, `lint.mjs`), [`pbakaus/impeccable`](https://github.com/pbakaus/impeccable) (Operate mode, craft floor), [`emilkowalski/skills`](https://github.com/emilkowalski/skills) (animasiya və hiss qaydaları) |
| **Devin** (Cognition, AI proqram mühəndisi) | — | Son mərhələ: API sıxılması, UI düzəlişləri, Smart Transit Baku brendi, tünd və açıq tema, dispetçer panelinin yenilənməsi. Bu commit-lərdə `Co-Authored-By: Devin AI` qeyd olunub |
| Cursor / Copilot / ChatGPT | — | **İstifadə olunmayıb** |

---

## 2. Proses: insan nə istədi, AI nə etdi

İş bir neçə Claude Code sessiyasında, sonra Devin ilə aparılıb. Komanda üzvlərinin əsas sorğuları (Azərbaycan dilində, qısaldılmış):

1. **Tapşırığın mətni**: sərnişin modulu (ETA, sıxlıq bildirişi), operator modulu (sıxlıq xəritəsi, "10 dəqiqə yüksək → əlavə avtobus ehtiyatı" tövsiyəsi), təhvil materialları. Əlavə tələb: *"məsələni başa düş, araşdırma elə, nəsə yaratmazdan əvvəl"*.
2. *"Daha dəqiq araşdır, BNA nədir, AYNA baxır o temaya, vəziyyətə"*: AI əvvəlcə köhnə BNA məlumatına istinad etmişdi. Bu sorğudan sonra BNA-nın 2023-də ləğv edildiyi, AYNA-nın səlahiyyətləri, 2026-cı il metro bağlanması və M1–M6 xətləri araşdırıldı.
3. *"Bizdən soruş tech stack-ı"*: texnologiyaları **komanda seçdi**: Node.js + Express + TypeScript, React (Vite) + Leaflet, Redis + PostgreSQL, WebSocket. Sənədlər Azərbaycan dilində, `.md/.txt`. Zip arxiv, lokal git.
4. *"Docker-i bu kompüterə quraşdır və işlət"* və *"başlama nəsə yazmağa qətiyyən, ancaq plan"*: AI əvvəlcə yalnız plan təqdim etdi.
5. Tapşırıqdakı qaydanın dəqiq mətni təkrarlandı. *"Nə qədər crazy bonus ideyaların var yaz"*: AI 28 ideya təklif etdi.
6. **Komanda bonusları seçdi** (1, 3, 6, 7, 9, 10, 11, 15, 16, 17, 18, 19, 20, 26) və tapşırdı: *"edge case-lər ola bilər ki, avtobus boşdur, camaat mırt yüksək sıxlıq qeyd edir, belə şeyləri nəzərdə tut… research elə, planla"*.
7. *"Hamısını yığa bilərsən"* + skill-lərin istifadəsi (taste-skill, emilkowalski/skills, impeccable).
8. Xəritə xətası: CARTO altlığı `API_KEY_REQUIRED` qaytarırdı. AI açarsız OpenStreetMap plitələrinə keçdi.
9. *"Location verəndə mənim olduğum yer də göstərilsin… yollar çox monoton… UI çox clean elə, AYNA MaaS kimi… cramped"*. Komanda üzvü opendata.az-da tapdığı datasetlərin siyahısını verdi: marşrut həndəsəsi, dayanacaqlar, gündəlik gedişlər, problemləri ilə birlikdə. Tapşırıq: *"bu dataları istifadə elə, sayta qoş"*. AI bunları etdi:
   - faylları yüklədi və yoxladı;
   - `scripts/import-opendata.mjs` yazdı: xətt–dayanacaq əlaqəsi həndəsi yaxınlıqla qurulur;
   - simulyatoru və proqnozu real gedişlərlə kalibrlədi;
   - sərnişin UI-ını tam ekran xəritə və alt panel kimi yenidən qurdu;
   - istifadəçinin yerini xəritədə göstərdi;
   - operator panelini sadələşdirdi.
10. *"Bu repoda nə var, çək lokala və qaldır 3000 portunda"* və *"lokala git yüklə, pull elə"*: ayrıca Claude Code sessiyasında layihə başqa kompüterdə işə salındı. Node və Git quruldu.
11. *"Claude dayandı, davam edə bilərsən?"* və skill-lərin quraşdırılması: AI həmin işi müstəqil təkrarladı, ayrıca budaqda saxladı. Komanda iki versiyanı müqayisə edib GitHub-dakını seçdi: *"öz versiyanı at, GitHub-dakından davam"*.
12. *"Burda gediş-gəliş xətləri var, verdiyim skill-lərlə bu tətbiqi birbaşa mobile app kimi yığ, /mobile URL-də, kompüter üçün olanı daha təkmil versiyaya gətir"*. Sorğuda BirJob saytının marşrut aləti göstərilmişdi. AI saytın səhifəsini bir dəfə oxudu, `robots.txt`-də `/api/` və AI botları bağlı olduğu üçün onun bazasını **götürmədi**. Əvəzində:
   - gediş və qayıdış açıq marşrut faylından hesablandı: dayanacaqların yolun hansı tərəfində qaldığına görə 60 xətt çevrildi;
   - 120 nömrəli xəttin ikiqat uzunluğu (116 km əvəzinə 56 km) düzəldildi;
   - `/mobile` tətbiqi və kompüter versiyasının yeni bölmələri yazıldı;
   - naviqasiya URL-ə keçirildi, seçilmişlər əlavə olundu.
13. **Devin:** Claude ilə hazırlanmış *"repo-nu başdan-başa yoxla, UI-ı daha güclü et"* tapşırığı əsasında işlədi. Commit tarixçəsinə görə gördüyü işlər:
   - API cavablarının gzip ilə sıxılması;
   - fon xətlərinin təkrarının aradan qaldırılması, toxunma ekranı üçün hover düzəlişləri;
   - Smart Transit Baku brendi, yeni ikon, tünd və açıq tema;
   - dispetçer panelinin yenilənməsi və animasiyalar, avtobus nöqtələrinin sıxlığa görə rənglənməsi.
14. *"Təhvil materiallarını son versiyaya uyğun yenilə, lazım olan məlumatı soruş"*: AI bu sənədləri koda görə yenilədi, komanda üzvlərinin adlarını və istifadə olunan alətləri komanda verdi.

**AI-nin etdiyi:**
- mövzu araşdırması və mənbələr;
- qaydanın şərhi və kənar halların dizaynı;
- bütün backend kodu: engine, API, simulyator, GTFS;
- bütün frontend kodu;
- 57 avtomatik test;
- Docker faylları, README, texniki sənəd və bu bəyannamə.

**İnsanın etdiyi:**
- tapşırığın qoyuluşu;
- texnologiyaların seçimi;
- bonus funksiyaların seçimi;
- kənar hallara diqqət ("boş avtobusa yüksək deyirlər");
- istiqamətin düzəldilməsi (BNA → AYNA);
- qəbul və yoxlama.

---

## 3. Arxitektura qərarlarında AI-nin rolu

AI aşağıdakıları **təklif etdi**, komanda planı təsdiqlədi:
- 10 dəqiqəlik qaydanın şərhi: *fasiləsiz*, ≥5 bildiriş, ≥3 cihaz, 60 saniyəlik dözümlülük.
- Sıxlıq balı ilə **etibar balının** ayrılması və fiziki yoxlamalar: toplanmanın arxa avtobusu, dayanma müddəti, proqnoz.
- Bildirişlərin "avtobusdayam / dayanacaqdayam" kontekstinə bölünməsi.
- Xətlərin "dövrə" modeli. Redis (isti məlumat) və PostgreSQL (daimi məlumat) bölgüsü.
- Lokal mühitdə PostgreSQL işləmədiyi üçün **PGlite** (WASM Postgres) fallback-i.
- İstifadə olunan elmi üsullar ədəbiyyata əsaslanır və [docs/TEXNIKI_IZAH.md](docs/TEXNIKI_IZAH.md#mənbələr)-də mənbə ilə göstərilib: holding, truth discovery, dwell time, Wardman & Whelan, RAPTOR, GTFS-RT.

---

## 4. Testlərdə AI

- Testləri AI yazıb və işlədib: backend 45 (unit + API, PGlite yaddaşda), frontend 12 (jsdom smoke).
- Testlər real səhvlər tapıb və bunlar düzəldilib:
  - qaydanın "qısa eniş" məntiqi seyrək yoxlamalarda sayğacı səhv sıfırlayırdı;
  - tıxac təsnifatında sabit dayanma norması bütün xətləri "tələbat" kimi göstərirdi, adaptiv median ilə əvəz olundu;
  - son dayanacaqda istiqamət yanlış yazılırdı.
- Uçdan-uca yoxlama işləyən sistemdə HTTP sorğuları ilə aparılıb:
  - pik → tövsiyə → göndər → yeni avtobus;
  - saxta bildiriş;
  - bot;
  - tıxac;
  - ayrıca proses simulyator rejimi.
- Real brauzerdə (Edge, başsız rejim) telefon və kompüter ölçüsündə yoxlanılıb: səhifələr açılır, üfüqi daşma və konsol xətası yoxdur. Bu yoxlama Devin-in son UI dəyişikliklərindən sonra da təkrarlanıb.

---

## 5. AI-nin edə bilmədiyi / yoxlamadığı (dürüst qeyd)

| Nə | Səbəb | Komanda nə etməlidir |
|---|---|---|
| Docker Compose işə salınmayıb | İş mühitlərində Docker yox idi | Docker olan kompüterdə `docker compose up --build` işə salın və yoxlayın |
| Real PostgreSQL ilə test | Sandbox shared memory (`shmget`) bloklayır. Eyni SQL PGlite-da test olunub | Docker-də `postgres` servisi ilə bir dəfə yoxlayın |
| Real telefonda yoxlama | Yalnız kompüter brauzerində telefon ölçüsü yoxlanılıb | `/mobile`-i real telefonda açın: toxunma, klaviatura, notch |
| Gediş və qayıdış | Rəsmi açıq faylda yoxdur, həndəsədən hesablanıb | Bir neçə xətti AYNA MaaS ilə müqayisə edin |
| 206 xətti canlı görünür | Son gedişi 19 yanvar 2026-dır, siyahıdan çıxarılmayıb | Təqdimatda bilin və ya siyahıdan çıxarın |
| Xətt ↔ dayanacaq əlaqəsi | Rəsmi məlumatda yoxdur; ≤25 m həndəsi yaxınlıqla qurulub | Bir neçə xətti AYNA MaaS ilə müqayisə edin |
| Dayanacaq faylının lisenziyası | Göstərilməyib | Yenidən paylamazdan əvvəl Bakı Metropoliteni ilə dəqiqləşdirin |

---

## 6. Məsuliyyət

Kodun və sənədlərin hamısı AI ilə yaradılıb. Komanda onu təqdim etməzdən əvvəl:
- [ ] kodu oxuyub əsas axını izah edə bilir (engine dövrü, 10 dəqiqəlik qayda, etibar balı);
- [ ] sistemi öz kompüterində işə salıb, demo ssenarisini keçib;
- [ ] mənbələri yoxlayıb;
- [ ] simulyasiya və sintetik məlumatın **real olmadığını** münsiflərə açıq deyir.

Bütün kod komandanın məsuliyyətindədir.
