/* global jest */
// Läuft vor jedem Testmodul, nach dem Setup von jest-expo

// babel-preset-expo liest EXPO_PUBLIC_* unter Jest zur Laufzeit (expo/virtual/env)
process.env.EXPO_PUBLIC_API_URL = "https://cevi-os.invalid";

// Der Auth-Client merkt sich das globale fetch beim Erstellen; die Attrappe steht darum vor jedem Import.
// Ohne eigene Antwort im Test scheitert jeder Netzzugriff.
global.fetch = jest.fn(async (eingabe) => {
  throw new Error(`Kein Netz im Test: ${String(eingabe)}`);
});

// jest-expo liefert ein leeres Manifest: scheme und version kämen sonst als undefined an
jest.mock("expo-constants", () => {
  const original = jest.requireActual("expo-constants");
  return {
    ...original,
    __esModule: true,
    default: {
      ...original.default,
      expoConfig: {
        ...original.default?.expoConfig,
        scheme: "cevi-os",
        version: "0.1.0",
      },
    },
  };
});

// createURL würde mit dem leeren Manifest werfen; der Rest des Moduls bleibt echt (expo-router braucht ihn)
jest.mock("expo-linking", () => {
  const original = jest.requireActual("expo-linking");
  return {
    ...original,
    createURL: (pfad, optionen) =>
      `${optionen?.scheme ?? "cevi-os"}://${pfad ?? ""}`,
  };
});

// Secure Store im Arbeitsspeicher; __speicher lässt die Tests die Schlüssel prüfen
jest.mock("expo-secure-store", () => {
  const speicher = new Map();
  return {
    __esModule: true,
    __speicher: speicher,
    getItem: (schluessel) => speicher.get(schluessel) ?? null,
    getItemAsync: async (schluessel) => speicher.get(schluessel) ?? null,
    setItem: (schluessel, wert) => void speicher.set(schluessel, wert),
    setItemAsync: async (schluessel, wert) =>
      void speicher.set(schluessel, wert),
    deleteItemAsync: async (schluessel) => void speicher.delete(schluessel),
  };
});
