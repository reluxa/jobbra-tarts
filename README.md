# Jobbra tartás — 3D autópálya-játék

Böngészőben játszható, háromsávos autópálya-szimulátor: pont jár a jobbra tartásért,
bónusz a gazdaságos gáz/fék-kezelésért. Részletes terv: **DESIGN.md**.

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

`W` gáz · `S` fék · `A`/`D` vagy `←`/`→` kormány · `P` szünet · `M` hang
(Mobilon: képernyő-gombok.)

## Technológia

Three.js (r169) + cannon-es (0.20) + Vite — az ütközést a cannon rigid-body
kontaktrendszere kezeli, a vezetés-'érzés' boltozatos (hangolás: `src/constants.js`).
