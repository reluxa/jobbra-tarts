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

- [x] **1. Élet-számláló (❤) és a KAPU-felirat törlése a HUD-ról** — a mechanika (3 baleset → game over) és a „kell ≈ … km/h" kijelzés marad, csak a díszfeliratok mennek el
- [ ] **2. Jobbról-előzés → nagy képernyő-középpontú figyelmeztetés** — mint a SÁV FOGLALT!, „JOBBRÓL ELŐZTÉL! −5 s" pirosban (`warnBig(text, color)` általánosítás)
- [ ] **3. Sáv-függő időfogyás vizualizálása** — ×1,8 / ×1,35 / ×1 jelvény a KAPU-IDŐ panelen (piros/narancs/zöld), az effektív ütemmel
- [ ] **4. Középső sáv + foglalt jobb sáv → ne fogyjon gyorsabban** — ha a tőlünk jobbra lévő sáv foglalt, az óra 1,0×-szal fogy (a 3. pont jelvénye ezt mutatja)
- [ ] **5. Mobil játszhatóság** — diagnózis (teljesítmény: pixelRatio/tükör-RT, HUD-átfedések, gomb-elérhetőség), majd javítások
- [ ] **6. Cockpit-maszk kézi javítása** — `public/mask-editor.html` rajzoló tool (ÜVEG/KERET ecset, zoom, mentés) + `applyHandMask` a játékban; A-oszlop/műszerfal-tető átlátszóság kijavítása közösen rajzolva
- [ ] **7. Kanyargós autópálya + gazdagabb környezet** — látvány-szintű görbület (`roadShift(z)`, a sim marad egyenes); épületek, felüljáró, bokrok, sziklák, fafajták, km-táblák (mind instanced)
- [ ] **8. Több autómodell** — 3-6 új CC0/CC-BY low-poly (kisautó, furgon, busz, pickup, taxi, rendőr), Draco-GLB, típusonként elosztva; források a MODELS.md-ben

## Ötletek (nem prioritált)

- [ ] Élet-kijelzés máshogy: baleset-néző „törött üveg" effekt a game over-en
- [ ] Leaderboard / gépenkénti ranglista
- [ ] Nappal↔éjszaka / időjárás-váltás
- [ ] Zene + több hangvariáció
- [ ] „Mennyit mentettél a jobb sávval" statisztika futás után
