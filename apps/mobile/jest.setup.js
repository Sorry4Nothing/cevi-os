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

// Die nativen Attrappen von jest-expo lösten undefined auf; Standard «erlaubt, aber ohne projectId», so senden die bestehenden Abläufe kein PUT.
// __tipp ruft die Horcher wie ein Tipp auf eine Benachrichtigung; die echte getLastNotificationResponse wirft ohne natives Modul
jest.mock("expo-notifications", () => {
  const original = jest.requireActual("expo-notifications");
  const horcher = new Set();
  return {
    ...original,
    __esModule: true,
    __tipp: (antwort) => horcher.forEach((melden) => melden(antwort)),
    setNotificationHandler: jest.fn(),
    getLastNotificationResponse: jest.fn(() => null),
    clearLastNotificationResponse: jest.fn(),
    addNotificationResponseReceivedListener: jest.fn((melden) => {
      horcher.add(melden);
      return { remove: () => horcher.delete(melden) };
    }),
    getPermissionsAsync: jest.fn(async () => ({
      granted: true,
      canAskAgain: true,
    })),
    requestPermissionsAsync: jest.fn(async () => ({
      granted: true,
      canAskAgain: true,
    })),
    setNotificationChannelAsync: jest.fn(async () => null),
    getExpoPushTokenAsync: jest.fn(async () => ({
      type: "expo",
      data: "ExpoPushToken[test]",
    })),
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

// jest-expo mockt ExpoNetwork.addListener als nacktes jest.fn (remove() würde werfen);
// __netzHorcher lässt die Tests den Netzstand melden. Keine jest.fn: restoreAllMocks nähme die Implementation weg
jest.mock("expo-network", () => {
  const horcher = new Set();
  return {
    __esModule: true,
    __netzHorcher: horcher,
    getNetworkStateAsync: async () => ({ isConnected: true }),
    addNetworkStateListener: (melden) => {
      horcher.add(melden);
      return { remove: () => horcher.delete(melden) };
    },
  };
});

// Secure Store im Arbeitsspeicher; __speicher lässt die Tests die Schlüssel prüfen.
// Die Konstanten bleiben echt (sonst sind alle undefined und eine falsche Option fiele nicht auf); __aufrufe hält Methode, Schlüssel und Optionen
jest.mock("expo-secure-store", () => {
  const original = jest.requireActual("expo-secure-store");
  const speicher = new Map();
  const aufrufe = [];
  const merke = (methode, schluessel, optionen) =>
    void aufrufe.push({ methode, schluessel, optionen });
  return {
    ...original,
    __esModule: true,
    __speicher: speicher,
    __aufrufe: aufrufe,
    getItem: (schluessel, optionen) => {
      merke("getItem", schluessel, optionen);
      return speicher.get(schluessel) ?? null;
    },
    getItemAsync: async (schluessel, optionen) => {
      merke("getItemAsync", schluessel, optionen);
      return speicher.get(schluessel) ?? null;
    },
    setItem: (schluessel, wert, optionen) => {
      merke("setItem", schluessel, optionen);
      speicher.set(schluessel, wert);
    },
    setItemAsync: async (schluessel, wert, optionen) => {
      merke("setItemAsync", schluessel, optionen);
      speicher.set(schluessel, wert);
    },
    deleteItemAsync: async (schluessel, optionen) => {
      merke("deleteItemAsync", schluessel, optionen);
      speicher.delete(schluessel);
    },
  };
});

// RN's Settings braucht SettingsManager, den das Preset nicht kennt; hier ein Speicher im Arbeitsspeicher (NSUserDefaults)
jest.mock("react-native/Libraries/Settings/Settings", () => {
  const werte = new Map();
  return {
    __esModule: true,
    default: {
      __werte: werte,
      get: (schluessel) => werte.get(schluessel),
      set: (neu) => Object.entries(neu).forEach(([k, v]) => werte.set(k, v)),
    },
  };
});

// Die nativen Attrappen von jest-expo liefern undefined; Standard «Code und Fingerabdruck da, Entsperren gelingt», damit Tests mit dem echten Wurzel-Layout von selbst entsperren
jest.mock("expo-local-authentication", () => {
  const original = jest.requireActual("expo-local-authentication");
  return {
    ...original,
    __esModule: true,
    getEnrolledLevelAsync: jest.fn(
      async () => original.SecurityLevel.BIOMETRIC_STRONG,
    ),
    authenticateAsync: jest.fn(async () => ({ success: true })),
  };
});
