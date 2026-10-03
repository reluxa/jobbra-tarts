# Jobbra tartás — 3D autópálya-játék

Böngészőben játszható, háromsávos autópálya-szimulátor: pont jár a jobbra tartásért,
bónusz a gazdaságos gáz/fék-kezelésért. **Belső (kokpit) nézetből** vezeted a járgányt,
igazi 3D-s autómodellekkel, visszapillantó tükörrel — látod, ha hátulról érkezik egy gyors
autó. Részletes terv: **DESIGN.md**.

## Futtatás

```bash
npm install
npm run dev      # http://localhost:5173
```

## Teszt (fej nélküli Chromium)

```bash
npm run smoke    # fizika + játékmenet automatikus ellenőrzése, kép a screenshots/-ba
```

## Kezelés

`W` gáz · `S` fék · `A`/`D` vagy `←`/`→` kormány · **`Q` balra / `E` jobbra index**
(irányjelző) · `P` szünet · `M` hang
(Mobilon: képernyő-gombok, az index-gombok is.)

## Technológia

Three.js (r169) + cannon-es (0.20) + Vite — az ütközést a cannon rigid-body
kontaktrendszere kezeli, a vezetés-'érzés' boltozatos (hangolás: `src/constants.js`).
Autómodellek: licencelt glTF-fájlok a `public/models/` alatt (Ferrari, sedan, teherautó),
GLTFLoader + Draco-tömörítés; ha a fájl nem töltene be, dobozos vészrájzolás lép be.
