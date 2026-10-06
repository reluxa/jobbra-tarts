# Sáv: kapu-játék MAG-szimulátor (stub— a játékba NINCS még beépítve)

Ez egy **fej nélküli, paraméterezett szimulátor**, amit azért építettünk, hogy
a "csak jobbra tartva lehet nyerni" játék-elvet teszteljük és hangoljuk, **mielőtt**
belekerül az `src/` játékba. Nem a renderelésről szól — a pálya-szabályok matematikájáról.

## Futtatás

```bash
node sim/run.mjs                     # keepRight stratégia, 30 futtatás
node sim/run.mjs keepRight 60        # több futtatás (statisztikailag stabilabb)
node sim/run.mjs leftCamper          # balos: megmutatja, miért veszítesz
node sim/run.mjs liberal
node sim/run.mjs compare 40          # összes stratégia egy táblába
```

Minden futtatás determinisztikus (seedelt), ezért a paraméterhangolás reprodukálható.

## A modell (mit modellez)

- **3 sáv**: 0 = külső (jobb, "hazai"), 1 = középső, 2 = belső (bal).
- **Kapu-óra** (`gateDist / kértÁtlag`): aki lefullad belőle (`ócra ≤ 0`) a következő
  kapujáig, bukik.
- **laneRate** = sávos óra-fogyás: a külső sáv 1.0 (leglassabb ütésű, nyerő), közép
  1.35, belső 1.8. **Ez az erő, ami jobbra terel** — a hosszú belső/középső tartózkodás
  effektíve leosztja az elért átlagodat.
- **laneCap** = sávos sebességhatár; a játékos tempója `cruise`.
- **Forgalom**: a külső sávban időnként teherautó (lassabb blokkoló). Őket ki kell
  kerülni (1-2 sávot balra), majd **visszatérni** — mert balra az óra zabál.
- **Büntetések**: index nélküli sávváltás −3 s, "bevágás" egy gyorsabb elé −5 s
  (a bevágás a szimben ritka hiba, ~4%).
- **Átlag-emelkedés**: `reqStart, reqStep` kapunként.

## Jelenlegi eredmény (default paraméterekkel, 40 futtatás)

```
keepRight (visszatér jobbra)   nyerés 93%   sáv: külső/közép/belső = 71% / 22% / 0%
középső-ben marad              nyerés  0%   (bukik azonnal)
belső-ben marad                nyerés  0%
liberal                        nyerés  0%
```

Következtetés: a **diszciplinált (jobbra tartó)** játékos nyer 93%-ban; aki belső/középső
sávban marad, szinte azonnal bukik. A játékos az ideje ~71%-át a külső sávban tölti,
a középsőt csak ritkán, átmeneti előzésre használja — a belsőt soha ("0%").

## Hangolás

Minden `defaultConfig()` bejegyzés bővíthető. A két legfontosabb gomb:

- **Nehézség / nyerhetőség**: `reqStart` + `reqStep`. Ha túl magasra viszed, a "jobbra
  tartás által elérhető átlag" fölé kerül → kvázi nyerhetetlen (pont ez a stabilitási
  korlát). A finom tartalék a `tartalék (s)` oszlopban figyelemre.
- **Büntetés keménysége**: `laneRate[]`, `noSignalPen`, `cutInPen`, és a `bevágás`
  gyakorisága (`behindMergingSpeed`).

## Játékmag-parancsok ellenőrzése

`sim/run.mjs` nyerési rátát, kapukénti tartalékot, sávban-töltött időt és büntetés-
összegeket ad ki. Így egy-egy szabályváltoztatás után pár másodperc alatt látni, hogy
a "csak jobbra tartva lehet nyerni" alapelv fennmarad-e, és mennyi marad a játéktartalék.
