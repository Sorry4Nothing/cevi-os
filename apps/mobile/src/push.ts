import Constants from "expo-constants";
import {
  addNotificationResponseReceivedListener,
  AndroidImportance,
  AndroidNotificationVisibility,
  clearLastNotificationResponse,
  DEFAULT_ACTION_IDENTIFIER,
  getExpoPushTokenAsync,
  getLastNotificationResponse,
  getPermissionsAsync,
  setNotificationChannelAsync,
  type Notification,
  type NotificationBehavior,
  type NotificationResponse,
} from "expo-notifications";
import { useRouter } from "expo-router";
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

// Alle Ids der API sind UUIDs; die Daten eines Pushes kommen von aussen, daraus entsteht nie ein Pfad aus ungeprüftem Text
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Die einzige Stelle, die den Pfad des Gruppenchats kennt
const CHAT_PFAD = "/chat";

// Der Pfad zu Typ und Id eines Pushes; alles Unbekannte (auch «person», bis es ein Ziel gibt) öffnet kein Ziel
export function zielAusPush(data: Record<string, unknown> | undefined) {
  const id = data?.id;
  if (typeof id !== "string" || !UUID.test(id)) return null;
  if (data?.typ === "programm") return `/programme/${id}`;
  if (data?.typ === "chat") return `${CHAT_PFAD}/${id}`;
  return null;
}

let offenerChat: string | null = null;
// Der Chat-Bildschirm meldet sich bei Fokus an und beim Verlassen ab
export function setzeOffenenChat(id: string | null) {
  offenerChat = id;
}

// Wie Expos Standard (alles zeigen), ausser für den Chat, der gerade offen ist: Dort liest die Person die Nachricht schon
export async function pushHandler(
  benachrichtigung: Notification,
): Promise<NotificationBehavior> {
  const data = benachrichtigung.request.content.data;
  const zeigen = !(
    data?.typ === "chat" &&
    offenerChat !== null &&
    data.id === offenerChat
  );
  return {
    shouldShowBanner: zeigen,
    shouldShowList: zeigen,
    shouldPlaySound: zeigen,
    shouldSetBadge: zeigen,
  };
}

// Im Tab-Layout, nicht in der Wurzel: Die Tabs hängen erst nach der Anmeldung, ein Tipp davor wartet so, bis die Person drin ist
export function usePushTipps() {
  const router = useRouter();
  useEffect(() => {
    function oeffnen(antwort: NotificationResponse | null) {
      if (antwort?.actionIdentifier !== DEFAULT_ACTION_IDENTIFIER) return;
      // Sonst öffnen Tabs, die nach Abmelden und Anmelden neu hängen, denselben Tipp nochmals
      clearLastNotificationResponse();
      const ziel = zielAusPush(antwort.notification.request.content.data);
      // withAnchor: Aus dem Kaltstart liegt die Liste unter dem Ziel, «Zurück» landet dort
      if (ziel) router.push(ziel, { withAnchor: true });
    }
    // Kaltstart: Das native Modul hält den Tipp, der die App gestartet hat
    oeffnen(getLastNotificationResponse());
    const abo = addNotificationResponseReceivedListener(oeffnen);
    return () => abo.remove();
  }, [router]);
}
