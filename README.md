# Flaksefeber

Et Flappy Bird-inspirert spill der en norsk havørn flyr gjennom snødekt granskog. Spillet kjører i nettleseren (laget for Google Chrome) og trenger ingen installasjon.

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

Når du klarer 100 trær i en arena, låses neste arena opp, og neste runde starter der. På startmenyen kan du bla mellom alle arenaene med pilknappene over skin-valget, men bare de du har låst opp kan spilles. Rekorden lagres per arena. Alle arenaene er definert i `arenas.js`.

## Gullfjær

Når du har passert 40 trær i en runde, dukker det opp en gullfjær midt i åpningen mellom to trær. Flyr du borti den, kan du treffe ett tre uten å dø. Fjæren brukes opp, og ørnen blinker en liten stund så den kommer seg ut av treet. Treffer du et tre til, eller bakken, er spillet over. Mens fjæren er aktiv, står det «Gullfjær» under scoren, og ørnen har en gylden glød. Fjæren kommer én gang per runde (`FEATHER_AT`).

## Rekord

Startmenyen viser alltid «Din rekord er X av 100 trær» for arenaen du står i, så du ser hvor nær målet du var sist. Rekorden lagres med en gang du dør eller vinner.

XP, valgt skin og rekorden din lagres på en server (Supabase), ikke i nettleseren. Se «Fusksikring» lenger ned.

## Slik kjører du det

1. Last ned mappen med filene under.
2. Åpne `index.html` i Chrome (dobbeltklikk, eller dra filen inn i et nettleservindu).

Filene må ligge i samme mappe. Spillet trenger nett for å lagre fremgang. Uten kontakt med serveren kan du spille, men ingenting lagres, og nye arenaer og skins låses ikke opp.

| Fil          | Innhold                                        |
| ------------ | ---------------------------------------------- |
| `index.html` | Sidens struktur og panelene for start og slutt |
| `style.css`  | Farger, typografi og layout                    |
| `script.js`  | Hele spillet: fysikk, tegning og logikk        |
| `arenas.js`  | De 10 arenaene: farger, bakgrunn, vær og trær  |
| `sim.js`     | Spillreglene (fysikk, trær, score), delt med serveren |
| `config.js`  | Supabase-adresse og publiserbar nøkkel         |
| `supabase/`  | Database (migrasjon) og Edge Function `game`   |
| `test/`      | Tester av reglene og av klienten               |

Skrifttypene (Fjalla One og Nunito Sans) hentes fra Google Fonts, så du trenger nett første gang. Uten nett brukes reserveskrifter, og spillet fungerer likevel.

## Del spillet

- **Send mappen** som zip, så kan mottakeren åpne `index.html`.
- **Legg det på nett** ved å laste opp filene til en gratis tjeneste som GitHub Pages, Netlify eller Cloudflare Pages. Da får du en lenke du kan sende.

Knappen «Del score» kopierer en ferdig tekst til utklippstavlen. Hvis nettleseren ikke tillater kopiering (kan skje når filen åpnes direkte fra disk), vises teksten i et felt du kan merke og kopiere selv.

## Juster vanskelighetsgraden

Øverst i `script.js` ligger konstantene som styrer spillet:

| Konstant              | Standard  | Betydning                                    |
| --------------------- | --------- | -------------------------------------------- |
| `GAP_MIN` / `GAP_MAX` | 126 / 146 | Høyden på åpningen mellom topp- og bunntreet |
| `SPACING`             | 215       | Avstand mellom trærne sideveis               |
| `GRAV`                | 0.38      | Tyngdekraft                                  |
| `FLAP`                | -6.9      | Kraften i hvert vingeslag                    |
| `GOAL`                | 100       | Antall trær du må passere for å vinne        |
| `TREES_PER_XP`        | 10        | Antall trær per XP                           |
| `MAX_XP`              | 200       | Maks level / maks XP                         |

Hvor mye høyden på åpningen kan hoppe fra ett tre til neste, styres av tallet 230 i funksjonen `makeTree`. Farten øker i trinn: for hver 20. tre (20, 40, 60, 80) går ørnen raskere (`STEP_EVERY` og `STEP_BOOST`, startfart `BASE_SPEED`). Se `updatePlay`.

Fargene ligger som variabler øverst i `style.css`, og spillet leser dem derfra.

## Teknisk

Ren HTML, CSS og JavaScript med Canvas. Ingen biblioteker og ingen byggesteg. Spillet skalerer til skjermen og fungerer med mus, tastatur og berøring.

Lykke til med spillingen!


## Fusksikring (Supabase)

Spilleren logges inn anonymt i Supabase. Fremgangen (rekorder, opplåste arenaer, XP, skin) ligger i tabellen `progress`, og nettleseren har ikke lov til å skrive til den (RLS er på uten policies). Det er bare Edge Function `game` som skriver, og den gjør det slik:

1. Når en runde starter, får spilleren et tilfeldig frø (`seed`) fra serveren. Frøet bestemmer hvor åpningene mellom trærne havner.
2. Når runden er over, sender nettleseren bare hvilke bilder (steg) du flakset i. Den sender ikke score eller XP.
3. Serveren spiller av runden med samme regler (`sim.js`) og regner ut score, XP, rekord og opplåsing selv.
4. Runder som er raskere enn sanntid, brukt to ganger eller startet fra gammel fremgang, avvises.

Å endre localStorage eller koden i nettleseren gir derfor ingen fordel. Det du kan endre, er bare pene detaljer som tegningen. Det en server ikke kan se, er om en robot spiller for deg. Den må likevel klare spillet på ekte tid.

### Sette opp

```
npx supabase login
npx supabase link --project-ref hheyufazuxpeructpjpn   # spør om database-passordet
npm run deploy                                         # tester, db push og functions deploy
```

Slå på **Authentication → Providers → Anonymous sign-ins** i Supabase-dashbordet (eller kjør `npx supabase config push`). `sim.js` må være lik i rotmappen og i `supabase/functions/game/`, så bruk `npm run sync` etter endringer i reglene (testen sjekker at de er like). Kjør `npm test` for testene.

Publiserbar nøkkel i `config.js` er laget for å være offentlig. Database-passordet og `service_role`-nøkkelen skal aldri ligge i koden eller deles.
