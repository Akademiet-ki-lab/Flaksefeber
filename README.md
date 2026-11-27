# Flaksefeber

<p align="center">
  <img src="app/icon.png" alt="Flaksefeber-ikon" width="180">
</p>

Et Flappy Bird-inspirert spill der en norsk havørn flyr gjennom en snødekt granskog. Spillet er laget med Next.js, React, TypeScript og Canvas. Spilleregjlene, fremgangen og konkurransescore verifiseres av serveren og lagres i SQLite.

**Nytt nettsted:** [flaksefeber.no](https://flaksefeber.no)

## Funksjoner

- 10 arenaer med egne bakgrunner, vær og hindringer
- 7 ørneskins som låses opp med XP
- To spillmoduser: vanlig spill og konkurranse
- Felles toppliste og filtrering på klasse
- Serververifisert spill og beskyttelse mot vanlige juksmetoder
- Lagring av arenaer, XP, skins og rekorder på serveren
- Bevarte resultater fra den gamle topplista
- SQLite-backup og automatisk deploy med PM2

## Krav

Prosjektet bruker **Node.js 25.x** lokalt, i GitHub Actions og på VPS-serveren. `better-sqlite3@13` krever Node.js 22 eller nyere, og Node 25 brukes for at alle miljøer skal være like.

```bash
node --version   # skal vise v25.x
npm --version
```

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

Velg **Konkurranse** fra menyen. Konkurranse krever en bruker. Vanlig modus gjør det ikke.

- **Ny bruker:** eleven velger et unikt brukernavn (til innlogging), et visningsnavn (vises på topplista), klasse og et passord på minst 6 tegn.
- **Innlogging** varer i 30 dager, eller til eleven trykker «Logg ut».
- **Passord og klasse** kan bare endres av admin, på admin-siden. Elever kan ikke endre dem selv. Glemt passord: admin setter et nytt.

Konkurranserunden har ingen målscore og gir ikke XP eller arenaopplåsing. Serveren kontrollerer rundene og lagrer kun brukerens beste resultat. Resultatet hører til brukeren, så det er det samme uansett hvilken PC eleven spiller på. Topplista kan vises samlet eller filtrert på klasse.

I konkurransemodus øker farten for hvert 10. tre, men **slutter å øke etter 180 trær** (`SPEED_STOP_AT` i `lib/game/sim.ts`). Etter **200 trær** kommer en **snøstorm** (`STORM_AT`): skrå snøstriper og en lys dis som kommer og går i vindkast. Stormen er bare tegning i nettleseren (`lib/game/client.ts`). Den endrer ikke spillet, og serveren regner ikke med den.

## Ukentlig nullstilling og All time leaderboard

Topplisten i konkurransemodus nullstilles **hver mandag kl. 00:00 (norsk tid)**. Før det flyttes alle resultatene til tabellen `leaderboard_history`, så ingenting går tapt. Det er ingen planlagt jobb: første forespørsel etter mandag 00:00 gjør nullstillingen (`rollWeek` i `lib/server/db.ts`, kalt fra `getDb`). Den virker derfor også om serveren har vært nede over midnatt. Første gang koden kjører, noteres bare uken, og ingenting nullstilles.

«All time leaderboard» til venstre for spillet slår sammen den gamle topplista, ukene som er over og den løpende topplista. Hver person vises én gang med beste score:

- Hver konto er én person. To kontoer med samme navn og klasse slås aldri sammen.
- Gamle resultater har ingen kontoer. De slås sammen når navn og klasse er like, og med en konto bare hvis nøyaktig én konto har samme navn og klasse.
- Rader som admin har skjult, og rader uten poeng, vises ikke.

## Bevaring av gammel toppliste

Den gamle topplista fra Supabase-versjonen beholdes lokalt i SQLite og vises på store skjermer til venstre for spillet. Originaldataene ligger i `lib/server/legacy-leaderboard.json` og kopieres til `legacy_leaderboard` ved oppstart.

Tabellen er skrivebeskyttet av SQLite-triggere. Den er derfor uavhengig av Supabase og GitHub Pages og kan ikke endres fra appen eller admin-siden.

## For kjøring og installasjon

Se **Lokal utvikling** for Node 25, npm-kommandoer og oppstart. Se **GitHub Actions og automatisk deploy** for produksjonsutrulling.

## Prosjektstruktur

| Fil eller mappe | Innhold |
|---|---|
| `app/page.tsx` | Hovedside, spillflate og menyer |
| `app/Game.tsx` | Kobler React og spillklienten sammen |
| `app/OldLeaderboard.tsx` | Visning av gammel toppliste |
| `app/globals.css` | Spillutseende og responsivt layout |
| `app/api/game/route.ts` | Spill- og spiller-API |
| `lib/game/client.ts` | Tegning, input og kommunikasjon med serveren |
| `lib/game/arenas.ts` | Arenaer, bakgrunn, vær og hindringer |
| `lib/game/sim.ts` | Delt spillmotor brukt av nettleser og server |
| `lib/server/db.ts` | SQLite-schema, migrering og legacy-data |
| `lib/server/game.ts` | Runder, fremgang, kontoer og toppliste |
| `lib/server/admin.ts` | Administrasjon av brukere og toppliste |
| `test/` | Spill-, API-, admin-, legacy- og klienttester |
| `deploy/deploy.sh` | Test, build, backup, rsync og PM2-restart |
| `.github/workflows/` | CI og automatisk VPS-deploy |
| `ecosystem.config.cjs` | PM2-konfigurasjon for produksjon |

Skrifttypene Fjalla One og Nunito Sans hentes fra Google Fonts, så de krever nett første gang. Reserveskrifter brukes uten internett.

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

## Teknisk oppbygging

Appen bruker Next.js App Router med TypeScript, React og Canvas. Serveren bruker én SQLite-fil gjennom `better-sqlite3`. Alle runder, fremdriftsdata, kontoer og konkurransescore verifiseres av serveren.

Spillet skal skalere til mobil, nettbrett og datamaskin med mus, tastatur eller berøring.

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

**Første gang:** opprett `/var/www/html/flaksefeber` og sørg for at deploy-/PM2-brukeren eier mappa. Kjør `deploy/deploy.sh` (se under). Den starter appen i pm2. Kjør så `pm2 startup` som samme bruker og utfør kommandoen den skriver ut, så starter appen igjen etter omstart av serveren.

Annen port: `PORT=49001 ./deploy.sh`, og endre `proxy_pass` tilsvarende.

**Legge ut ny versjon:** kjør `deploy/deploy.sh` som brukeren `flaksefeber`, som må eie appmappa og PM2-prosessen. Skriptet bruker ikke `sudo`:

```
./deploy.sh              # legger ut main
./deploy.sh <branch>     # legger ut en annen branch
```

Skriptet:

1. henter branchen (standard `main`) fra GitHub til en midlertidig mappe
2. kjører `npm ci`, `npm test` og `npm run build` der. Feiler noe, stopper det før den kjørende siden røres
3. tar backup av databasen til `data/backups/` (de 20 siste beholdes)
4. kopierer til `/var/www/html/flaksefeber` med `rsync --delete`. `data/` røres aldri og har `700`, så andre brukere (inkludert webserveren) ikke kan lese databasen
5. starter appen med `pm2 startOrReload ecosystem.config.cjs`, kjører `pm2 save` og sjekker at siden svarer

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
- endre navn, klasse eller score på en rad (for en elev endres også brukeren)
- skjule en rad (vises ikke offentlig, men kan vises igjen) eller slette den
- under **Brukere**: sette nytt passord for en elev (eleven logges ut overalt), endre visningsnavn og klasse, eller slette brukeren (raden på topplista slettes også)

Brukernavnene for admin er adskilt fra elevenes brukere og har ingenting med navnene på topplista å gjøre. De lages bare fra terminalen på serveren, og passordet lagres som en scrypt-hash:

```
npm run admin -- add-user <brukernavn>      # spør om passord (minst 10 tegn); kjør igjen for nytt passord
npm run admin -- remove-user <brukernavn>
npm run admin -- users
```

Innloggingen varer i 8 timer. Etter 8 feil forsøk på et kvarter (per bruker og per IP) må man vente. Alle endringer lagres med hvem som gjorde dem, og kan vises med `npm run admin -- log`.

Sletter du raden til en elev, kommer den tilbake neste gang eleven spiller konkurranse. Vil du stoppe en elev, skjul raden eller slett brukeren.

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

## Lokal utvikling

Prosjektet krever **Node.js 25.x** lokalt, i GitHub Actions og på VPS-serveren. `better-sqlite3@13` krever minst Node.js 22.

```bash
npm ci
npm run dev        # http://localhost:3000
npm test
npm run typecheck
npm run build
```

Bruk Node 25 for å matche produksjonsmiljøet og unngå problemer med native Node-pakker som SQLite-biblioteket.

Spillet trenger kontakt med serveren for å lagre fremgang. Uten kontakt kan du spille, men fremgang og kontoer lagres ikke.

## GitHub Actions og automatisk deploy

Workflowene er:

- `.github/workflows/ci.yml` — test, typecheck og produksjonsbuild ved push og pull request
- `.github/workflows/deploy.yml` — deploy av `main` etter vellykket CI, eller manuelt fra Actions

Legg inn følgende repository-secrets:

| Secret | Verdi |
|---|---|
| `DEPLOY_HOST` | VPS-domene eller IP-adresse |
| `DEPLOY_USER` | Unix-brukeren som eier appen og PM2-prosessen |
| `DEPLOY_SSH_PORT` | Vanligvis `22` |
| `DEPLOY_SSH_KEY` | Privat SSH-nøkkel for deploy |
| `DEPLOY_KNOWN_HOSTS` | Vertsnøklene fra `ssh-keyscan` |

Push til `main` for å starte CI og deretter mulig deploy. Du kan også starte deploy manuelt under **Actions → Deploy → Run workflow**.
