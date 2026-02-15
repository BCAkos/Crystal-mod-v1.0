# Crystal Mod v1.0

Discord moderátor bot JavaScriptben, automoderációval, slash parancsokkal, fájlos logolással és webes panellel.

## Funkciók
- Automoderáció:
  - tiltott szavak szűrése
  - caps lock tiltás (nem ad figyelmeztetést)
  - flood/sok üzenet rövid idő alatt szűrése
  - azonos üzenet 5x / 1 perc szűrése
  - tulaj/tulaj rang/kiemelt rang/kiemelt személy ping tiltás
- Figyelmeztetés rendszer:
  - minden szabályszegéshez warn
  - 15 warn után automatikus 1 hetes ban
  - fokozatos timeout idők (.env-ből)
- Moderációs log:
  - Discord log csatorna embed logok
  - JSON + sima `.log` fájl mentés
- Web panel:
  - külön login felület felhasználónév/jelszóval (.env-ből)
  - log visszanézés
  - gyors webes moderáció (warn/kick/ban)
- Slash parancsok:
  - `/moderacio`, `/figy`, `/figylista`, `/figytorles`, `/jogok`, `/limit`, `/rankadas`, `/ranktorles`, `/clear`, `/panel`
- Rang alapú jogosultság:
  - JR Mod / Mod / Admin
  - JR Mod napi limit: Ban 1, Kick 2
  - Mod napi limit: Ban 3, Kick 5
  - Admin: végtelen

## Telepítés
```bash
npm install
cp .env.example .env
# töltsd ki a .env értékeket
npm start
```

## Mappák
- `main.js`: bot + automod + web panel (Pterodactyl kompatibilis gyökér mappa)
- `public/style.css`: panel kinézet
- `data/moderation-logs.json`: strukturált logok
- `data/moderation.log`: soronkénti log
- `data/warnings.json`: figyelmeztetések
- `data/daily-limits.json`: napi moderációs limitek

## Fontos
- A `/panel` gomb a `.env`-ben beállított `PANEL_URL` címet nyitja.
- A panel belépés `.env` alapú: `PANEL_LOGIN_USERS` + `PANEL_LOGIN_PASSWORDS` (azonos sorrendben).
