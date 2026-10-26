# Git-Workflow

## Branches

- `develop` ist der Integrationsbranch und der Default-Branch des Repos. Jede Änderung kommt per PR hierher.
- `main` ist die Produktion. Ausgerollt wird nur von `main`.
- Beide Branches sind geschützt: Änderungen nur per PR, auch für Admins; kein Force-Push, kein Löschen.
- Die CI muss grün sein, bevor ein PR gemergt wird.

## Pro Issue

1. Den Branch mit der GitHub CLI aus dem Issue erzeugen, damit er im Issue unter «Development» steht: `gh issue develop <nr> --name feature/<nr>-<kurzname> --base develop --checkout`. Für Fehler heisst er `fix/<nr>-<kurzname>`.
2. Ein Branch und ein PR pro Issue.
3. Der PR geht nach `develop`, im Text steht `Closes #<nr>`. Weil `develop` der Default-Branch ist, schliesst GitHub das Issue beim Merge.
4. Der PR übernimmt Labels und Milestone des Issues.
5. Der PR-Text hat die Überschriften der Vorlage: Summary, Evidence, Merge Danger, Barrierefreiheit. Sie gelten auch, wenn `gh pr create --body` die Vorlage übergeht. Bei UI-Änderungen nennt Evidence die geprüften Punkte der [Checkliste Barrierefreiheit](barrierefreiheit.md).
6. Gemergt wird auf GitHub.

## Commits

Conventional Commits mit deutschem Betreff in Schweizer Schreibweise und der Nummer des Issues am Schluss, z. B.:

```text
chore: Monorepo-Gerüst mit npm workspaces und CI (#2)
```

## Release

Ein Release ist ein PR von `develop` nach `main`, gemergt mit «Create a merge commit». Nur so kommen die Commits von `develop` unverändert nach `main`. Squash und Rebase schreiben Kopien davon; der nächste Release-PR listet dann alte Commits noch einmal und kann Konflikte haben.

Ein Release läuft so:

1. Versions-PR nach `develop`: hebt `expo.version` in `apps/mobile/app.json` auf `X.Y.Z`, unter einem Issue wie jeder PR. Versionen steigen nur.
2. Release-PR von `develop` nach `main`, gemergt mit «Create a merge commit».
3. Tag von Hand auf dem Merge-Commit, annotiert: `git fetch origin`, dann `git tag -a vX.Y.Z -m "Release X.Y.Z" origin/main` und `git push origin vX.Y.Z`. Kein Workflow erzeugt Tags.

`eas build --profile production`, `eas submit` und EAS Update auf dem Kanal `production` laufen nur von `main` und startet eine benannte Person von Hand, ohne `EXPO_TOKEN` in GitHub Actions; EAS Update gibt es nur für reine JavaScript-Korrekturen. Image, Deploy und die EAS-Befehle stehen in [betrieb.md](betrieb.md) unter «Release».

## Was nie ins Repo kommt

Das Repo ist öffentlich, und Cevi OS verwaltet Daten von Kindern. Darum kommt nichts davon ins Repo, in Issues, in PRs oder auf Screenshots:

- echte Namen
- die ID des Google-Kalenders und eine geheime iCal-Adresse
- CSV-Dateien und andere Exporte
- Demo-Zugangsdaten
- Server-Zugänge (IP-Adressen, SSH)
- `.env`-Dateien und ihre Werte

Screenshots stammen nur aus der Demo-Abteilung.
