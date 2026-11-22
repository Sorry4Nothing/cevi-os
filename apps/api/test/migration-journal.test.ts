import { existsSync, readFileSync } from "node:fs";
import { expect, test } from "vitest";

// Der Migrator wendet nur Migrationen an, deren `when` grösser ist als das der zuletzt angewendeten; eine vertauschte Reihenfolge würde auf einer Datenbank, die schon die höhere kennt, still nichts tun. Beim Rebase paralleler PRs nummeriert der PR darum um
const journal = JSON.parse(
  readFileSync(
    new URL("../drizzle/meta/_journal.json", import.meta.url),
    "utf8",
  ),
) as { entries: { idx: number; when: number; tag: string }[] };

test("when steigt streng von Eintrag zu Eintrag", () => {
  for (const [i, e] of journal.entries.entries()) {
    if (i === 0) continue;
    expect(e.when, e.tag).toBeGreaterThan(journal.entries[i - 1].when);
  }
});

test("idx steigt streng und ist gleich der Nummer im Dateinamen", () => {
  for (const [i, e] of journal.entries.entries()) {
    expect(e.tag, String(e.idx)).toMatch(
      new RegExp(`^${String(e.idx).padStart(4, "0")}_`),
    );
    if (i > 0) expect(e.idx, e.tag).toBeGreaterThan(journal.entries[i - 1].idx);
  }
});

test("jeder Eintrag hat seine SQL-Datei", () => {
  for (const e of journal.entries) {
    expect(
      existsSync(new URL(`../drizzle/${e.tag}.sql`, import.meta.url)),
      e.tag,
    ).toBe(true);
  }
});
