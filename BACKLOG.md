# Jobbra tartás — Feladat-backlog

Címkék: `[P1]` magas, `[P2]` közepes, `[P3]` alacsony/ötlet · `[x]` = kész

## Kész ✅

- [x] Kapu-idő kijelző javítás: `engine.reset()` nem cserélheti le a Scoring-példányt (a nézet elavult referenciája miatt ragadt 100%-on, az óra sosem fogyott)
- [x] HUD újragondolás: sötét panelek, nagyobb/kontrasztosabb feliratok, mobil elrendezés
- [x] KAPU-IDŐ panel a visszapillantó tükör alá (a tükröt nem fedi)
- [x] Sávváltási ablak felezése: `changeAhead` 9→4,5 m, `changeBehind` 20→10 m (+ konstans-alapú tesztek)
- [x] Jobbról-előzés időbüntetés vizualizálása: a KAPU-IDŐ panel villan és rázkódik, a szám rezdül, „−N s" chip felszáll (`timeHit`)
- [x] Deploy folyamat: htpc script (`deploy.sh`) + OpenCode skill

## Soron következő

- [x] **1. Élet-számláló (❤) törlése a HUD-ról** — a mechanika (3 baleset → game over) és a KAPU-felirat („KAPU #n", a pályát jelzi) marad
- [x] **2. Jobbról-előzés → nagy képernyő-középpontú figyelmeztetés** — mint a SÁV FOGLALT!, „JOBBRÓL ELŐZTÉL! −5 s" pirosban (`warnBig(text, color, small)` általánosítás; a hosszú felirat mobilon kisebb betűvel is elfér)
- [x] **3. Sáv-függő időfogyás vizualizálása** — ×1,8 / ×1,35 / ×1 jelvény a KAPU-IDŐ panelen (piros/narancs/zöld), az `engine.drainRate()` effektív ütemét mutatja frame-enként
- [x] **4. Középső sáv + foglalt jobb sáv → ne fogyjon gyorsabban** — ha a tőlünk jobbra lévő sáv foglalt, az óra 1,0×-szal fogy (`drainRate` kivétel; a jelvény ilyenkor is ×1-et mutat); UÉS: aktív előzés — ha a jobb szomszéd-sávban van kocsi (előre 9 / hátra 15 m belül, `TRAFFIC.passAhead/passBehind`), szintén ×1,0× fogyás, így az előzés nem büntet
- [x] **5. Mobil játszhatóság** — diagnózis + javítás: a start-overlay görgethető (`overflow-y: auto`) és mobilon kompakt (egyoszlopos szabályok, kisebb cím, fekvő nézetben alcím nélkül), így az INDÍTÁS gomb mindig elérhető; a halott ▲/▼ (gáz/fék) touch-gombok törölve; a HUD-tipp és a tipp-kör szövege érintőn touch-üzemű (◀ ▶ / ❮ ❯), a hint-box balra igazítva (nem lóg a km/h-ra); kisebb képernyőn pixelratió 1,75× (könnyebb render); **teljes képernyős mód mobilon** — az INDÍTÁS-koppintás (gesztus) belép a Fullscreen API-val, ⛶ gomb ki/be kapcsol (csak érintőn látszik); iPhone Safari-n nem támogatott, ott a gomb rejtve marad, de a „Kezdőképernyőhöz adás" (standalone) teljes képernyőt ad (apple-mobile-web-app-capable meta)
- [ ] **6. Cockpit-maszk kézi javítása** — ✅ rajzoló tool (`public/mask-editor.html`: ÜVEG/KERET ecset, zoom+pan, 3 nézet, undo/vázlat, letöltés+betöltés) + ✅ `applyHandMask` + ✅ üveg-területek berajzolva a szerkesztővel (`public/handmask.png`) + ✅ **A-oszlop átlátszóság javítva**: (1) a flood a sötét szerkezet (A-oszlop) fényes szegélyét is kimarja → 3-pass szegély-védelem a `carveTransparent`-ben (a sötét magból kifelé 3 réteg visszaáll), (2) az algoritmus által kimarott, fedetlen szegély-pixelekre automatikus KERET-vonások kerültek a `handmask.png`-be (BFS ≤20 lépés a sötétből, a tükör-lyuk és a zöld kizárva; 1355 piros px, élesben ellenőrizve: fogak fedettek, tükör/üveg átlátszó maradt) — ⏳ hátra: éles ellenőrzés (A-oszlop/műszerfal-tető élek)
- [ ] **7. Kanyargós autópálya + gazdagabb környezet** — látvány-szintű görbület (`roadShift(z)`, a sim marad egyenes); épületek, felüljáró, bokrok, sziklák, fafajták, km-táblák (mind instanced)
- [ ] **8. Több autómodell** — 3-6 új CC0/CC-BY low-poly (kisautó, furgon, busz, pickup, taxi, rendőr), Draco-GLB, típusonként elosztva; források a MODELS.md-ben

## Ötletek (nem prioritált)

- [ ] Élet-kijelzés máshogy: baleset-néző „törött üveg" effekt a game over-en
- [ ] Leaderboard / gépenkénti ranglista
- [ ] Nappal↔éjszaka / időjárás-váltás
- [ ] Zene + több hangvariáció
- [ ] „Mennyit mentettél a jobb sávval" statisztika futás után
