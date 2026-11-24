# Flaksefeber

Et Flappy Bird-inspirert spill der en norsk havørn flyr gjennom snødekt granskog. Spillet kjører i nettleseren (laget for Google Chrome). Det er en Next.js-app med egen server og database (SQLite), laget for å kjøre på en VPS.

## Slik spiller du

- Trykk, klikk eller bruk mellomrom (også pil opp eller W) for å flakse.
- Fly mellom grantrærne som vokser opp fra bakken og ned fra oven.
- Treffer du et tre, faller ørnen ned i snøen og spillet er over. Da kan du spille på nytt eller dele scoren din.
- Maks score er 100. Når du klarer det, flyr ørnen langt ut i vinteren, og du får meldingen «WOW, du er veldig flink! Men klarer du det igjen?».

## XP, level og skins

- Du får 1 XP for hvert 10. tre du flyr forbi. Du starter på level 0, og maks level er 200 (level = total XP).
- Med XP låser du opp nye skins til ørnen: Havørn (0), Kongeørn (20), Snøørn (40), Nattørn (70), Nordlysørn (100), Ildørn (140) og Gullørn (200).
- Velg skin på startskjermen (der det står «Trykk for å flakse») med pilknappene eller venstre/høyre piltast. Låste skins vises som silhuett.

## Arenaer

Det er 10 arenaer, hver med egen bakgrunn, vær og egne hindringer. Hva som venter er en overraskelse: låste arenaer vises som «???» med mørk bakgrunn til du har klart 100 trær i arenaen før.

Når du klarer 100 trær i en arena, låses neste arena opp, og neste runde starter der. På startmenyen kan du bla mellom alle arenaene med pilknappene over skin-valget, men bare de du har låst opp kan spilles. Rekorden lagres per arena. Alle arenaene er definert i `lib/game/arenas.ts`.

## Gullfjær

Når du har passert 40 trær i en runde, dukker det opp en gullfjær midt i åpningen mellom to trær. Flyr du borti den, kan du treffe ett tre uten å dø. Fjæren brukes opp, og ørnen blinker en liten stund så den kommer seg ut av treet. Treffer du et tre til, eller bakken, er spillet over. Mens fjæren er aktiv, står det «Gullfjær» under scoren, og ørnen har en gylden glød. Fjæren kommer én gang per runde (`FEATHER_AT`).

## Rekord

Startmenyen viser alltid «Din rekord er X av 100 trær» for arenaen du står i, så du ser hvor nær målet du var sist. Rekorden lagres med en gang du dør eller vinner.

XP, valgt skin og rekorden din lagres på serveren, ikke i nettleseren. Se «Fusksikring» lenger ned.

## Konkurranse og felles toppliste

Velg **Konkurranse** fra menyen, skriv inn navn og klasse, og spill så lenge du klarer. Konkurranserunden har ingen målscore og gir ikke XP eller arenaopplåsing. Serveren kontrollerer rundene og lagrer kun spillerens beste resultat. Topplista er felles for alle som spiller på samme server; den kan vises samlet eller filtrert på klasse. Navnet og klassen kan oppdateres ved neste konkurranserunde. Rader med stygge navn kan skjules med `npm run admin` (se «Administrasjon»).

## Slik kjører du det

Krever Node.js 20.9 eller nyere.

```
npm install
npm run dev        # utvikling på http://localhost:3000
```

Spillet trenger kontakt med serveren for å lagre fremgang. Uten kontakt kan du spille, men ingenting lagres, og nye arenaer og skins låses ikke opp.

| Fil / mappe              | Innhold                                                    |
| ------------------------ | ---------------------------------------------------------- |
| `app/page.tsx`            | Sidens struktur og panelene for start og slutt             |
| `app/globals.css`        | Farger, typografi og layout                                |
| `app/api/game/route.ts`  | API-et nettleseren snakker med (`POST /api/game`)          |
| `lib/game/client.ts`     | Hele spillet i nettleseren: tegning, input og serverkall   |
| `lib/game/arenas.ts`     | De 10 arenaene: farger, bakgrunn, vær og trær              |
| `lib/game/sim.ts`        | Spillreglene (fysikk, trær, score) og typene for spilltilstanden, delt med serveren      |
| `lib/server/game.ts`     | Serveren: innlogging med cookie, runder, toppliste         |
| `lib/server/admin.ts`    | Admin: innlogging, legge til, endre og slette på topplista |
| `app/admin/`             | Admin-sidene (`/admin` og `/admin/login`)                  |
| `lib/server/logic.ts`    | Rene regler for score, XP og opplåsing (testes uten database) |
| `lib/server/db.ts`       | SQLite-databasen og tabellene                              |
| `scripts/admin.ts`       | Admin-brukere og topplista fra terminalen                  |
| `test/`                  | Tester av reglene, API-et og klienten                      |
| `deploy/`                | `deploy.sh` (utrulling med pm2) og nginx-eksempel          |
| `ecosystem.config.cjs`   | pm2-oppsettet                                              |
| `backup/supabase-versjon/` | Den gamle Supabase-versjonen, urørt                      |

Skrifttypene (Fjalla One og Nunito Sans) hentes fra Google Fonts, så du trenger nett første gang. Uten nett brukes reserveskrifter, og spillet fungerer likevel.

## Del spillet

Send lenken til serveren. Knappen «Del score» kopierer en ferdig tekst til utklippstavlen. Hvis nettleseren ikke tillater kopiering, vises teksten i et felt du kan merke og kopiere selv.

## Juster vanskelighetsgraden

Konstantene som styrer spillet ligger i `CONST` øverst i `lib/game/sim.ts`. Nettleseren og serveren bruker samme fil, så de er alltid like:

| Konstant              | Standard  | Betydning                                    |
| --------------------- | --------- | -------------------------------------------- |
| `GAP_MIN` / `GAP_MAX` | 126 / 146 | Høyden på åpningen mellom topp- og bunntreet |
| `SPACING`             | 215       | Avstand mellom trærne sideveis               |
| `GRAV`                | 0.38      | Tyngdekraft                                  |
| `FLAP`                | -6.9      | Kraften i hvert vingeslag                    |
| `GOAL`                | 100       | Antall trær du må passere for å vinne        |
| `TREES_PER_XP`        | 10        | Antall trær per XP                           |
| `MAX_XP`              | 200       | Maks level / maks XP                         |

Hvor mye høyden på åpningen kan hoppe fra ett tre til neste, styres av tallet 230 i funksjonen `makeTree` i `lib/game/sim.ts`. Farten øker i trinn: for hver 20. tre (20, 40, 60, 80) går ørnen raskere (`STEP_EVERY` og `STEP_BOOST`, startfart `BASE_SPEED`). Se `step` i `lib/game/sim.ts`.

Fargene ligger som variabler øverst i `app/globals.css`, og spillet leser dem derfra.

## Teknisk

Next.js (App Router) med TypeScript (strict) og Canvas. Selve spillet bruker ingen biblioteker. Serveren lagrer i én SQLite-fil (`better-sqlite3`). Spillet skalerer til skjermen og fungerer med mus, tastatur og berøring.

Lykke til med spillingen!


## Fusksikring

Hver spiller får en tilfeldig nøkkel i en `httpOnly`-cookie. JavaScript på siden kan ikke lese eller endre den, og databasen lagrer bare en hash av den. Fremgangen (rekorder, opplåste arenaer, XP, skin) ligger i databasen på serveren, og bare serveren skriver til den:

1. Når en runde starter, får spilleren et tilfeldig frø (`seed`) fra serveren. Frøet bestemmer hvor åpningene mellom trærne havner.
2. Når runden er over, sender nettleseren bare hvilke bilder (steg) du flakset i. Den sender ikke score eller XP.
3. Serveren spiller av runden med samme regler (`lib/game/sim.ts`) og regner ut score, XP, rekord og opplåsing selv.
4. Runder som er raskere enn sanntid, brukt to ganger eller startet fra gammel fremgang, avvises.
5. Forespørsler fra andre nettsider avvises (Origin-sjekk og `SameSite`-cookie), og det er grenser for hvor mange runder og nye spillere som kan lages per minutt.

### Roboter

En server kan ikke se om det er et menneske eller et program som trykker. To ting gjør det likevel mye vanskeligere å jukse med et skript i konsollen:

- Spillkoden er en pakket modul. Det finnes ingen `window.Sim` eller annen global å hekte seg på.
- Spillet godtar bare ekte trykk (`event.isTrusted`). Tastetrykk og klikk laget med `dispatchEvent` eller `.click()` blir ignorert.

En bestemt person kan fortsatt lage en robot som styrer et ekte tastatur eller endrer koden før siden lastes. Da må den likevel spille på ekte tid.

## Kjøre på VPS (pm2)

Appen ligger i `/var/www/html/flaksefeber` og kjøres av pm2 med `ecosystem.config.cjs`. Den lytter bare på `127.0.0.1:49000`, så nginx eller Apache må sende trafikken videre (se `deploy/nginx.conf`).

**Første gang:** kjør `deploy/deploy.sh` (se under). Den starter appen i pm2. Kjør så én gang `pm2 startup` (og kommandoen den skriver ut), så starter appen igjen etter omstart av serveren.

Annen port: `PORT=49001 ./deploy.sh`, og endre `proxy_pass` tilsvarende.

**Legge ut ny versjon:** kjør `deploy/deploy.sh` som pm2-brukeren (ikke med `sudo`):

```
./deploy.sh              # legger ut main
./deploy.sh <branch>     # legger ut en annen branch
```

Skriptet:

1. henter branchen (standard `main`) fra GitHub til en midlertidig mappe
2. kjører `npm ci`, `npm test` og `npm run build` der. Feiler noe, stopper det før den kjørende siden røres
3. tar backup av databasen til `data/backups/` (de 20 siste beholdes)
4. kopierer til `/var/www/html/flaksefeber` med `rsync --delete`. `data/` røres aldri
5. setter rettigheter: koden eies av `www-data`, mens `data/` og `.next/` eies av pm2-brukeren. `data/` har `700`, så webserveren aldri kan lese eller servere databasen
6. starter appen med `pm2 startOrReload ecosystem.config.cjs`, kjører `pm2 save` og sjekker at siden svarer

**Admin-brukere:**

```
cd /var/www/html/flaksefeber && npm run admin -- add-user <brukernavn>
```

Bruker du Apache i stedet for nginx, trenger du `ProxyPass "/" "http://127.0.0.1:49000/"`, `ProxyPreserveHost On` og `RequestHeader set X-Real-IP "%{REMOTE_ADDR}s"`.

Miljøvariabler (settes i `ecosystem.config.cjs`, `PORT` kan også settes foran `./deploy.sh`):

| Variabel        | Betydning                                                                 |
| --------------- | ------------------------------------------------------------------------- |
| `PORT`          | Porten appen lytter på (standard 49000)                                   |
| `DATA_DIR`      | Mappe for databasen (standard `./data`)                                   |
| `TRUST_PROXY`   | Standard `1`: proxyen foran setter `X-Real-IP` (brukes til grensen for nye spillere og innloggingsforsøk per IP). Sett `0` uten proxy |
| `COOKIE_SECURE` | `1` tvinger `Secure` på cookiene, `0` slår det av. Standard: på når forespørselen kom over HTTPS |

## Administrasjon

### Admin-siden

Teksten «Laget av Aksel Craig» nederst på hovedmenyen er en skjult knapp til `/admin`. Den ser ut som vanlig tekst. Der logger du inn og kan:

- legge til en rad på topplista (navn, klasse, score)
- endre navn, klasse eller score på en rad
- skjule en rad (vises ikke offentlig, men kan vises igjen) eller slette den

Brukernavnene for admin har ingenting med navnene på topplista å gjøre. De lages bare fra terminalen på serveren, og passordet lagres som en scrypt-hash:

```
npm run admin -- add-user <brukernavn>      # spør om passord (minst 10 tegn); kjør igjen for nytt passord
npm run admin -- remove-user <brukernavn>
npm run admin -- users
```

Innloggingen varer i 8 timer. Etter 8 feil forsøk på et kvarter (per bruker og per IP) må man vente. Alle endringer lagres med hvem som gjorde dem, og kan vises med `npm run admin -- log`.

Sletter du raden til en ekte spiller, kommer den tilbake neste gang hen spiller en konkurranserunde. Vil du stoppe en spiller, skjul raden i stedet.

### Fra terminalen

```
npm run admin -- list           # topp 50 (med nummer)
npm run admin -- list 2STA      # bare én klasse
npm run admin -- hide 12        # skjul rad nr. 12
npm run admin -- show 12        # vis den igjen
npm run admin -- log            # siste endringer gjort på /admin
npm run admin -- stats          # antall spillere, runder, rader og admin-brukere
npm run admin -- backup         # kopi av databasen til data/backups/
```

## Fra Supabase

Den gamle versjonen ligger urørt i `backup/supabase-versjon/`. Spillerne var anonyme Supabase-brukere, så fremgang og toppliste blir ikke med over. Alle starter på nytt på den nye serveren.
