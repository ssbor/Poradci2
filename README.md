https://ssbor.github.io/Poradci2/

# MPSV Daily Build – GitHub Pages

Automatické denní stažení a zpracování datasetu MPSV (volná místa) → tři malé JSONy pro frontend.

## Složky
- `tools/build-daily.js` – stream parser (Node 20+)
- `.github/workflows/daily-build.yml` – denní build + Pages deploy
- `public/index.html` – fungující UI napojené na `public/data/*.json`
- `public/ssbor-ukazka-3obory-fetch.html` – vaše stránka s doplněným fetch loaderem

## Nasazení
1. Nahrajte vše do GitHub repozitáře (branch `main`).
2. V **Settings → Pages** zvolte deploy přes GitHub Actions.
3. V **Actions** spusťte workflow *Daily MPSV Data Build* (Run workflow).
4. Po doběhu bude web dostupný v GitHub Pages (viz *Deployments*).

## Lokální náhled
```bash
npm install
npm run build    # vytvoří public/data/*.json
npm start        # http://localhost:8000
```

## Úprava kategorií
Změňte `classify()` v `tools/build-daily.js` (ISCO prefixy).
