import eas from "../eas.json";
import app from "../app.json";

test("EAS lädt nur eingecheckte Dateien hoch", () => {
  expect(eas.cli.requireCommit).toBe(true);
});

test("Die Runtime-Version folgt dem Fingerprint des nativen Stands", () => {
  expect(app.expo.runtimeVersion).toEqual({ policy: "fingerprint" });
});

test("Produktions-Builds hängen am Update-Kanal production", () => {
  expect(eas.build.production.channel).toBe("production");
});

test("Die App-Version hat die Form X.Y.Z", () => {
  expect(app.expo.version).toMatch(/^\d+\.\d+\.\d+$/);
});
