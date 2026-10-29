import * as SecureStore from "expo-secure-store";
import { Platform, Settings } from "react-native";

// Bewusst ohne requireAuthentication: Der Geräte-Code bleibt der Rückfall für Menschen ohne Biometrie
const optionen = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

// Der einzige Weg zum Secure Store; die vier ersten Aufrufe braucht @better-auth/expo
export const speicher = {
  getItem: (schluessel: string) => SecureStore.getItem(schluessel, optionen),
  getItemAsync: (schluessel: string) =>
    SecureStore.getItemAsync(schluessel, optionen),
  setItem: (schluessel: string, wert: string) =>
    SecureStore.setItem(schluessel, wert, optionen),
  setItemAsync: (schluessel: string, wert: string) =>
    SecureStore.setItemAsync(schluessel, wert, optionen),
  deleteItemAsync: (schluessel: string) =>
    SecureStore.deleteItemAsync(schluessel, optionen),
};

export const SPERRE_SCHLUESSEL = "cevi-os_sperre";
// Die eine Liste für das Löschen nach einer Neuinstallation und für den Datenkategorien-Test
export const SCHLUESSEL = [
  "cevi-os_cookie",
  "cevi-os_session_data",
  SPERRE_SCHLUESSEL,
];

const INSTALLIERT = "cevi-os_installiert";

// iOS behält Keychain-Einträge über eine Deinstallation hinaus, NSUserDefaults gehen mit der App: Fehlt die Marke, ist es eine Neuinstallation
export async function alteEintraegeLoeschen() {
  // Android: Die Deinstallation leert den Store; Settings gibt es dort nicht
  if (Platform.OS !== "ios" || Settings.get(INSTALLIERT)) return;
  for (const schluessel of SCHLUESSEL)
    await speicher.deleteItemAsync(schluessel);
  // Erst nach dem letzten Löschen: Ein Fehler davor lässt den nächsten Start es nochmals versuchen
  Settings.set({ [INSTALLIERT]: true });
}
