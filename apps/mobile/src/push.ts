import Constants from "expo-constants";
import {
  AndroidImportance,
  AndroidNotificationVisibility,
  getExpoPushTokenAsync,
  getPermissionsAsync,
  setNotificationChannelAsync,
} from "expo-notifications";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Platform } from "react-native";

import { api } from "./api/client";

// Vor jeder Erlaubnis-Frage und jedem Token-Abruf: Android 13+ fragt ohne Kanäle gar nicht, und ein Push auf einen fehlenden Kanal wird nicht gezeigt
export async function kanaeleAnlegen() {
  if (Platform.OS !== "android") return;
  const kanal = {
    importance: AndroidImportance.DEFAULT,
    bypassDnd: false,
    // Android übernimmt lockscreenVisibility nicht aus der App; was auf dem Sperrbildschirm steht, entscheidet die Einstellung der Person
    lockscreenVisibility: AndroidNotificationVisibility.PRIVATE,
  };
  await setNotificationChannelAsync("chat", {
    name: "Chat",
    ...kanal,
  });
  await setNotificationChannelAsync("programme", {
    name: "Programme",
    ...kanal,
  });
}

// shortcut: Ohne Netz beim Start oder nach später in den Einstellungen erteilter Erlaubnis kommt das Token erst beim nächsten Start oder Sitzungswechsel an; ein AppState-Listener kommt, sobald das Pushes kostet
export async function tokenRegistrieren() {
  try {
    await kanaeleAnlegen();
    const erlaubnis = await getPermissionsAsync();
    if (!erlaubnis.granted) return;
    // eas init schreibt die projectId nach extra.eas; ohne sie (lokaler Build, Tests) gibt es kein Token
    const projectId: string | undefined =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId;
    if (!projectId) return;
    const { data } = await getExpoPushTokenAsync({ projectId });
    await api.api.v1["push-token"].$put({
      json: {
        token: data,
        // Platform.OS kennt mehr Werte, Builds gibt es nur für die zwei
        plattform: Platform.OS === "ios" ? "ios" : "android",
      },
    });
  } catch {
    // Kein Token oder keine Antwort (Emulator, offline, Push-Schlüssel fehlen): Der nächste Start versucht es wieder
  }
}

// Einmal pro App-Lauf: Nach «Weiter» bleibt der Schritt weg, auch wenn Android canAskAgain weiter true meldet (erst die zweite Ablehnung macht es false)
let schrittErledigt = false;
const horcher = new Set<() => void>();
function abonniere(melden: () => void) {
  horcher.add(melden);
  return () => {
    horcher.delete(melden);
  };
}
export function schliesseSchrittAb() {
  schrittErledigt = true;
  horcher.forEach((melden) => melden());
}

// Ob das Tor den Schritt «Pushes» zeigt: «laden», solange die Abfrage läuft; eine scheiternde Abfrage überspringt den Schritt
export function usePushSchritt(aktiv: boolean): boolean | "laden" {
  const erledigt = useSyncExternalStore(abonniere, () => schrittErledigt);
  const [noetig, setNoetig] = useState<boolean | "laden">("laden");
  useEffect(() => {
    if (!aktiv || erledigt) return;
    let aktuell = true;
    getPermissionsAsync().then(
      // Ein frisches Android 13+ meldet denied mit canAskAgain true, nie undetermined; Android bis 12 meldet granted
      (status) => {
        if (aktuell) setNoetig(!status.granted && status.canAskAgain);
      },
      () => {
        if (aktuell) setNoetig(false);
      },
    );
    return () => {
      aktuell = false;
    };
  }, [aktiv, erledigt]);
  if (!aktiv || erledigt) return false;
  return noetig;
}
