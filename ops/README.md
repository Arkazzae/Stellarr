# Stellarr OPs

Osobny frontend panelu właściciela instancji: przegląd, użytkownicy z sesjami i
rolami, metryki działającego procesu, logi i audyt, kopie zapasowe, wydania
aplikacji oraz ustawienia instancji.

## Uruchomienie

```bash
npm install
npm run dev
```

Aplikacja działa na `http://localhost:3001`. W trybie developerskim żądania do
`/api` i `/health` są przekazywane do `STELLARR_API_ORIGIN` (domyślnie
`http://127.0.0.1:5000`; wzór w `.env.example`).

W produkcyjnym obrazie statyczny build jest dostępny pod `/ops/` na tym samym
originie co główny klient. Endpointy `/api/ops/*` wymagają zalogowania kontem z
systemową rolą właściciela. Panel korzysta z trwałego rejestru sesji i audytu,
metryk działającego procesu, bufora logów oraz kopii SQLite tworzonych online.

## Sprawdzenie

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

`npm run build` sprawdza typy i zapisuje build w `dist/`; `npm run preview`
serwuje go lokalnie na porcie 4174.
