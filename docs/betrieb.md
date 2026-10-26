# Betrieb

Dieses Dokument beschreibt die Abläufe für den Betrieb von Cevi OS; ausgerollt wird nur von `main`.

## Release

Die App-Version ist `expo.version` in `apps/mobile/app.json`, genau in der Form `X.Y.Z`: Jede andere Form behandelt die API als veraltet (426), und der Tag passt nicht mehr zu ihr. Der Tag eines Releases ist `v` plus diese Version. Build-Nummern vergibt EAS selbst (`appVersionSource: "remote"` und `autoIncrement` in `apps/mobile/eas.json`).

1. Versions-PR nach `develop`: hebt `expo.version` auf `X.Y.Z`, unter einem Issue wie jeder PR. Versionen steigen nur.
2. Release-PR von `develop` nach `main`, gemergt mit «Create a merge commit» ([GIT_WORKFLOW.md](GIT_WORKFLOW.md) sagt warum).
3. Tag von Hand auf dem Merge-Commit, annotiert: `git fetch origin`, dann `git tag -a vX.Y.Z -m "Release X.Y.Z" origin/main` und `git push origin vX.Y.Z`. Kein Workflow erzeugt Tags.
4. Warten, bis der Workflow «Image» ([`.github/workflows/image.yml`](../.github/workflows/image.yml)) grün ist: Er prüft, dass der Tag `vX.Y.Z` heisst und zur App-Version passt, baut das API-Image und legt es als `ghcr.io/sorry4nothing/cevi-os-api:vX.Y.Z` in GHCR ab. Ein falscher Tag baut kein Image.
5. Auf dem Server ausrollen: den Tag auschecken, dann `deploy/deploy.sh vX.Y.Z` (Backup, Migration, Neustart, Portprüfung).
6. Nur wenn sich die App geändert hat: Store-Build oder EAS Update, siehe unten.

Ein Tag, dessen Lauf ein Image gebaut hat, wird nie verschoben, gelöscht oder neu vergeben. Hat der Lauf keines gebaut, weil die Tag-Prüfung oder der Build rot war: den Tag löschen (`git push origin --delete vX.Y.Z` und `git tag -d vX.Y.Z`), die Ursache per PR beheben und neu taggen.

`APP_MIN_VERSION` in `deploy/.env` auf dem Server steigt nur, um eine alte App auszusperren, und erst, wenn die neue Version in beiden Stores ist.

### Store-Build oder EAS Update

`eas build --profile production`, `eas submit` und EAS Update auf dem Kanal `production` laufen nur von `main` und startet eine benannte Person von Hand, in `apps/mobile`:

- Vorher ein sauberer Checkout von `main`, dessen HEAD der Tag ist: `git describe --tags --exact-match` gibt `vX.Y.Z` aus. Danach im Wurzelordner `npm ci`, denn Export und Fingerprint rechnen mit den lokalen Paketen.
- Will eas-cli dabei eine Datei ändern, abbrechen und die Änderung per PR über `develop` bringen.

Nach einer nativen Änderung — ein neues oder aktualisiertes Paket mit nativem Code, ein Expo-SDK-Update oder eine Änderung an `app.json` — braucht es einen Store-Build:

```sh
npx eas-cli build --profile production --platform all
npx eas-cli submit --platform android --latest
npx eas-cli submit --platform ios --latest
```

Für eine reine JavaScript-Korrektur reicht ein EAS Update; sie ist trotzdem ein Release mit neuer Version, Tag und Image, nur der App-Teil geht als Update statt als Build. Die App nimmt ein Update nur an, wenn sein Fingerprint dem des installierten Builds entspricht (`runtimeVersion` mit `policy: "fingerprint"` in `app.json`); ein Update mit nativer Änderung erreicht installierte Builds also nicht. Vorher pro Plattform die ID des letzten Produktions-Builds holen und den Fingerprint vergleichen:

```sh
npx eas-cli build:list --build-profile production --status finished --limit 1 --platform android
npx eas-cli build:list --build-profile production --status finished --limit 1 --platform ios
npx eas-cli fingerprint:compare --build-id <ID> --environment production
```

Sind die Fingerprints auf beiden Plattformen gleich, das Update veröffentlichen; `--environment production` lädt dabei keine lokale `.env`:

```sh
npx eas-cli update --channel production --environment production --message "vX.Y.Z"
```

Sonst Store-Build und Submit statt Update.

### Kein `EXPO_TOKEN` in GitHub Actions

EAS Update signiert im Gratis-Plan nicht: Wer das Expo-Konto übernimmt, kann Code auf alle Geräte schicken. Darum gibt es kein `EXPO_TOKEN` in GitHub Actions, und kein Workflow spricht mit EAS.
