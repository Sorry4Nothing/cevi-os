// Ersetzt den "jest"-Schlüssel in package.json (Jest erlaubt nur eine Konfiguration)
const preset = require("jest-expo/jest-preset");

const babel = preset.transform["\\.[jt]sx?$"];
if (!babel) throw new Error("Kein babel-jest im jest-expo-Preset gefunden");

module.exports = {
  preset: "jest-expo",
  // better-auth liefert nur .mjs; jest-config mischt transform mit dem des Presets
  transform: { "\\.mjs$": babel },
  // Überschreiben ersetzt die Liste ganz: die drei Preset-Einträge, im ersten um die ESM-Pakete von better-auth ergänzt
  transformIgnorePatterns: [
    "/node_modules/(?!(.pnpm|react-native|@react-native|@react-native-community|expo|@expo|@expo-google-fonts|react-navigation|@react-navigation|@sentry/react-native|native-base|standard-navigation|better-auth|@better-auth|@better-fetch|better-call|nanostores|@noble|jose|defu|rou3))",
    "/node_modules/react-native-reanimated/plugin/",
    "/node_modules/@react-native/babel-preset/",
  ],
  // Läuft nach den setupFiles des Presets
  setupFiles: ["./jest.setup.js"],
  // Gemessen am 2026-10-27: die ganze Suite (116 Tests) warm 17 s, mit kaltem Transform-Cache unter Parallel-Last 247 s; die 5 s von Jest rissen dabei einzelne Tests
  testTimeout: 60_000,
};
