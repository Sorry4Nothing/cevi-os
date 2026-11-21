import { configDefaults, defineConfig } from "vitest/config";

// Tests, die die ganze Datenbank anfassen und darum nie neben anderen Dateien laufen:
// - sitzungen-beenden: Die CLI «sitzungen:beenden» löscht jede Sitzung der Testdatenbank
// - eckdaten und kalender/sync: Die Läufe gehen über alle Abteilungen und Stufen; neben einer anderen Datei legen sie dort Programme an oder loggen deren Kalenderadresse (zeigte sich, sobald eine zusätzliche Testdatei die Reihenfolge verschob)
const ALLEIN = [
  "test/sitzungen-beenden.test.ts",
  "test/eckdaten.test.ts",
  "test/kalender/sync.test.ts",
];

export default defineConfig({
  test: {
    globalSetup: "./test/frische-datenbank.ts",
    projects: [
      {
        test: {
          name: "parallel",
          exclude: [...configDefaults.exclude, ...ALLEIN],
          sequence: { groupOrder: 0 },
        },
      },
      {
        test: {
          name: "allein",
          include: ALLEIN,
          // Eine Datei nach der anderen: Die drei stören sich sonst gegenseitig
          fileParallelism: false,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
