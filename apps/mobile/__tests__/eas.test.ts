import eas from "../eas.json";

test("EAS lädt nur eingecheckte Dateien hoch", () => {
  expect(eas.cli.requireCommit).toBe(true);
});
