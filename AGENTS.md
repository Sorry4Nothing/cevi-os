# Anweisungen für KI-Agenten

Diese Datei lesen Claude Code, Codex, Cursor, GitHub Copilot und andere Agenten automatisch. Sie gilt für jede Arbeit in diesem Repo.

## UX und Design: Pflicht bei jeder UI-Arbeit

Bei **jeder** Arbeit, die Oberfläche, Abläufe, Texte, Formulare, Navigation, Design oder Barrierefreiheit berührt – auch nur nebenbei –, gilt:

1. **Zuerst das UX- und Design-Handbuch lesen:** [`.claude/skills/ux-handbuch/SKILL.md`](.claude/skills/ux-handbuch/SKILL.md). Claude Code lädt es als Skill `ux-handbuch` automatisch; andere Agenten lesen die Datei direkt. Mindestens: «Verbindlichkeit», der Plattformteil (Teil 2 für die Web-Verwaltung unter `apps/api/public/admin` und die öffentlichen Seiten) und Teil 9 (Cevi OS).
2. **Rangfolge bei Widersprüchen:** Projekt-Doku in diesem Repo (unten) → Handbuch → allgemeines Wissen. Weicht das Handbuch von einer Projektregel ab, gilt die Projektregel; den Widerspruch im PR nennen, wenn er die UX spürbar verschlechtert.
3. **Vor dem Abschluss** das Qualitätstor (Handbuch Teil 11) durchgehen und im PR unter «Evidence» und «Barrierefreiheit» festhalten, was geprüft wurde und was nicht.
4. **Für Reviews** die Methode und das Ausgabeformat aus Teil 8 verwenden.

## Verbindliche Projekt-Doku

- [Checkliste Barrierefreiheit](docs/barrierefreiheit.md): Prüfpunkte mit festen Nummern für jeden Bildschirm; Massstab WCAG 2.2 AA.
- [Git-Workflow](docs/GIT_WORKFLOW.md): Branches, PRs, Commits, Releases und was nie ins Repo gehört.
- [Architektur](docs/architektur.md) und [API-Vertrag](docs/api/openapi.yaml): Die Apps zeigen nur, was die API erlaubt.
- [Bedrohungsmodell](docs/sicherheit/bedrohungsmodell.md) und [SECURITY.md](SECURITY.md).

## Weitere Regeln

- Nur Deutsch, Schweizer Schreibweise (ss, «»), «du», kurze Sätze, Buttons sind Verben, keine Emojis. Bezeichner im Code englisch.
- Das Repo ist öffentlich und Cevi OS verwaltet Daten von Kindern: **keine echten Namen, Zugangsdaten, Kalender-Adressen, Exporte, Server-Zugänge oder `.env`-Werte** in Code, Tests, Issues, PRs oder Screenshots. Screenshots nur aus der Demo-Abteilung.
- Git: ein Branch und ein PR pro Issue nach `develop`, PR-Abschnitte Summary, Evidence, Merge Danger, Barrierefreiheit; Conventional Commits mit deutschem Betreff und Issue-Nummer (Details: [Git-Workflow](https://github.com/Sorry4Nothing/cevi-os/blob/develop/docs/GIT_WORKFLOW.md)).

## Handbuch aktuell halten

Das Handbuch liegt als identische Kopie in allen drei Repos (`cevi-os`, `cevi-os-android`, `cevi-os-ios`) unter `.claude/skills/ux-handbuch/SKILL.md`. Änderungen immer in allen drei Repos gleich nachführen. Ändert sich ein Projektentscheid, Teil 9 des Handbuchs anpassen.
