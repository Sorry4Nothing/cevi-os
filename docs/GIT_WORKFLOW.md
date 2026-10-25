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

Tags und Builds folgen mit #70.

## Was nie ins Repo kommt

Das Repo ist öffentlich, und Cevi OS verwaltet Daten von Kindern. Darum kommt nichts davon ins Repo, in Issues, in PRs oder auf Screenshots:

- echte Namen
- die ID des Google-Kalenders und eine geheime iCal-Adresse
- CSV-Dateien und andere Exporte
- Demo-Zugangsdaten
- Server-Zugänge (IP-Adressen, SSH)
- `.env`-Dateien und ihre Werte

Screenshots stammen nur aus der Demo-Abteilung.
