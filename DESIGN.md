# JOBBRA TARTÁS — játékterv és játékmenet

Böngészőben játszható, 3D-s autópálya-szimulátor. A játékos egy háromsávos autópályán vezet,
a cél kettős: **jobbra tartani** (magyar KRESZ-alapjárat: a jobb szélső sáv a haladási sáv), és
**gazdaságosan vezetni** (gáz/fék finomsága). A két cél olykor ütközik — ez adja a játék izgalmát.

---

## 1. Alapkoncepció

| | |
|---|---|
| Nézet | **belső (kokpit) nézet** — vezető szemmagasságból, visszapillantó tükörrel; külső (chase) kamera csak a kezdő/game-over képernyőn |
| Irányítás | W/S gáz–fék, A/D (vagy ←/→) kormányzás, **Q/E irányjelző (index)**, P szünet, M hang, érintőgombok mobilon |
| Sávok | 3 sáv; a játékos szabadon váltogat, de **a jobb szélső sáv a helye** |
| Forgalom | autók + kamionok, sávonként eltérő sebességtartománnyal (jobbra lassabb) |
| Játék vége | 3 élet; ütközés = baleset → −1 élet, −150 pont, szorzó nullázás |
| Nehézség | növekvő forgalomsűrűség az idővel |

A játék ritmusa: a jobb sávban lassú kamionok araszolnak → a játékos folyamatosan dönt:
_időben fékezni és mögötte maradni_ (jobb sávpontok, jó gazdaságosság) vagy
_szabályosan megelőzni_ (balra ki, előzés, vissza jobbra — előzés-bónusz), miközben a
balra kószálás büntetést von maga után.

---

## 2. Vezetés (érzés)

- **Analóg gáz/fék**: a gombnyomás nem azonnali teljes gáz — a tolatójel fokozatosan nő
  (0→1 kb. 0,5 s alatt), így a finom adagolásnak értelme van.
- Teljesítménygörbe: `a = gáz × 13 m/s² × (1 − v/46)`, fékezés `24 m/s²`, légellenállás
  `0,014·v²`. Végsebesség ~165 km/h, a zöld/gazdaságos zóna ~97–113 km/h.
- Kormányzás sebességérzékeny (álló helyben nem fordul, tempónál finoman).
- Súrlódás: az oldalcsúszást erősen csillapítjuk → arcade, de kiszámítható.

Az ütközést **nem mi írjuk**: a cannon-es rigid-body világ kezeli (kinematikus forgalom,
korlát, érintkezési események). Mi csak a kasztnira adott hajtóerőket adjuk meg.

---

## 3. Pontrendszer

| Esemény | Pont | Megjegyzés |
|---|---|---|
| Haladás a jobb sávban | **3 pont/mp** | a haladási sáv a jobb szélső |
| Haladás a középső sávban | 1,2 pont/mp | |
| Haladás a bal sávban | 0 pont/mp | |
| Szabályos előzés (balról) | **+30** | a megelőzött jármű elhaladásakor |
| Jobbról előznek (balon araszolsz) | **−15** | nem a Te hibád, de a Te felelősséged |
| Jobbról előzöl | **−15** | KRESZ: tilos jobbról előzni |
| Indexelt sávváltás | **+12** | a jelzés ≥0,2 s-mal előzte a váltást (max 3 s) |
| Index nélküli sávváltás | **−8** | KRESZ: sávváltás előtt kötelező jelezni |
| Baleset | **−150**, −1 élet, szorzó nullázódik | |
| Gazdaságossági szakasz-bónusz | lásd lent | 10 mp-enként fizet |

Az előzés/logika pontos feltétele (a két jármű egymás mellett elhaladásakor):

```
ha  játékos sávja < autó sávja:      // a játékos balra van
    ha  játékos gyorsabb:  +30 (szabályos előzés)
    különben:               −15 (jobbról előztek → húzódj jobbra)
ha  játékos sávja > autó sávja:      // a játékos jobbra van
    ha  játékos gyorsabb:  −15 (jobbról előztél — tilos!)
    különben:               nincs pont (az autó szabályosan balról előz)
```

---

## 4. Gazdaságossági bónusz (a játék „skill” eleme)

- **Sima-vezetés mérő** (eco, 0–100%): a képernyőn folyamatos csík.
- Csökken, ha: hirtelen/tartós gáz-fék (>18% analóg adagolásnál — a „rángatás”), a
  zöldzónától távoli sebesség (pl. álló hely vagy végsebesség).
- Nő, ha: nyugodt, egyenletes haladás a zöldzónában.
- **10 mp-es szakaszok**: a szakasz bónusza = `átlagos eco% × 11 × szorzó`.
- **Szorzó**: minden jó szakasz (≥72% átlag) növeli (×1 → ×1,5 → ×2 … max ×3,5);
  gyenge szakasz (<45%) vagy baleset nullázza. A szorzó és a sárga „✦” sor a HUD-on.

Erre épül a döntés-játék: jobb sávban kamion előtt vagy **korán, finoman fékezhetsz**
(jó eco, de lassú), vagy **előzöl** (+30, de középső sávban kevesebb pont és fékezési/
sávváltási ritmus). A zöldzóna éppen a kamionok sebessége felett van, a gyors forgalom alatt.

---

## 5. Forgalom-modell

- Sávonkénti sebességtartományok (m/s):
  - bal sáv: 30–38 (gyorsak), közép: 25–32, jobb sáv: 19–27 + kamionok 16–21.
- Kamion-arány a jobb sávban ~55%, hosszú pótkocsival.
- Kinematikus testek: mi mozgatjuk őket sávon belül állandó sebességgel; konvoj-összetapadás
  van (azonos sávban a hátsó átveszi az első tempóját).
- Spawn: a ködön túl (145–255 m), nehézséggel csökkenő időköz, max 16+ autó.
- **Hátulról érkezők** (a tükörnek): a spawnok ~50%-a gyors, csak-a-bal-sávos autó,
  amely a játékos mögött (70–140 m) indul és utoléri — a bal sávban szabályosan előzhet.
- Despawn: csak a **lassabb** lemaradt autók kerülnek ki a játékos mögül; a gyorsabb
  hátulról közelítők addig maradnak, amíg utolérnek és el nem haladnak.

---

## 6. HUD és UX

- Balra fent: **PONT** (nagy) + legjobb.
- Fönt középen: életek (❤) + szorzó × / sárga csillagok.
- Jobbra fent: **SIMA VEZETÉS** csík (zöld-sárga-piros) + szakasz-idő csík.
- Jobbra lent: sebesség km/h.
- 3D-be vetített feliratok: „+30 ELŐZÉS”, „Jobbról előztek! −15”, „+12 INDEXELÉS ✓”,
  „−8 INDEXELÉS NÉLKÜL”, „+870 ✦ BÓNUSZ ×2,5”, „−150 BALESET” — a világbeli pozícióra vetítve.
- **Visszapillantó tükör**: alacsony felbontású (420×105) céltextúra, a kormány fölé rajzolt
  kép a tükörtáblán — minden képkockán a tükör-kamera hátsó nézete tölti. A rendes
  főnézetben fólia-kamera a világ objektumaihoz rétegelve (saját autó váza + a külvilág),
  a belső elemek (műszerfal, kormány, tükrök) külön rétegben, hogy a kokpitból látszódjanak.
- Első 15 mp: forgó tanító tippek. Kezdő képernyő: a szabályok összefoglalása.
- Rázkódás, piros villanás, szilánkok balesetkor. Hangeffektek WebAudio-val (M ki/be).

---

## 7. Technológia és architektúra

- **Three.js** (r169) — megjelenítés; **cannon-es** (0.20) — fizika/ütközés; **Vite** — build/dev.
- Pálya felépítés: lapos szakaszok (út 6000 m hosszú textúragörgetéssel), korlát + fák + táblák,
  köd a távolságban.
- Játékos-autó: **igazi 3D-modell** (`public/models/ferrari.glb`, Draco-tömörített,
  `public/draco/` dekódoló); a forgalom sedan/ferrari/teherautó-modellek klónjaival megy.
  `src/models.js` normalizál (méretarány ~4,3 m, tájolás +Z felé, talajra festés);
  betöltési hiba esetén dobozos vészrájzolás. Nevek/licencek a modellfájlok mellett.
- Fizika: gravitáció nélküli cannon-világ; a játékos kasztnija dinamikus (kontakteseményekhez
  kell), a sebességet mi írjuk elő — ez arcade érzést és determinisztikus hangolást ad.
- Fájlok: `src/main.js` (orgona), `player.js`, `traffic.js`, `world.js`, `scoring.js`,
  `hud.js`, `effects.js`, `input.js`, `audio.js`, `constants.js` (minden hangolási szám itt).
- **Automata teszt**: `npm run smoke` — fej nélküli Chromium + puppeteer-core ellenőrzi a
  gyorsulást, kormányirányt, szünetet, balesetet, szakaszt; képeket rögzít a `screenshots/`-ba.

---

## 8. Hangolási csavarok (constants.js)

`CAR.maxSpeed`, `DRIVE.accel/brake/drag/lateralK/yawRate`, `SCORE.lanePerSec/ecoBase`,
`ECO.harshFloor/harshDrain/recover`, szakaszhossz 10 s, `TRAFFIC: speedByLane/spawnBase`.

---

## 9. Bővítési ötletek (v2+)

- **Sávváltó forgalom**: lassabb kamion húzódjon ki jobbra (indexekkel) — a szabályos
  sávváltás-pontozás és a lassú sávváltó autók már kész.
- **Időjárás/napszak**: eső (csúszós, rosszabb tapadás → gazdaságosabb itt is tanít),
  éjszaka (fényszórók, világító korlát-reflektorpóznák).
- **Üzemanyag- és károsanyag-mutató**: a bónusz „l/100km” stílusú visszajelzést is mutat.
- **Leaderboard** (név + pont, localStorage vagy szerver), napi „zöld kihívás”.
- **Események**: balesetes előzési foltok, útlezárás → zárósáv mellett elterelés, őz.
- **Módok**: „Taxi-mód” (utas+idő), „Flotta-menedzser” (költség/pont arány), szabad forgalom.
- **Kontroller** (Gamepad API), hangtervezés, pulzáló zene a feszültséghez.
