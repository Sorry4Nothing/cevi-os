import { expoClient } from "@better-auth/expo/client";
import {
  focusManager,
  onlineManager,
  QueryClient,
} from "@tanstack/react-query";
import { usernameClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import Constants from "expo-constants";
import * as Network from "expo-network";
import { hc } from "hono/client";
import { useSyncExternalStore } from "react";
import { AppState } from "react-native";

import type { AppType } from "@cevi-os/api";
import { SPERRE_SCHLUESSEL, speicher } from "../speicher";

// TanStack Query kennt React Native nicht: Fokus aus dem AppState, Online-Stand aus expo-network
focusManager.setEventListener((imFokus) => {
  const abo = AppState.addEventListener("change", (status) =>
    imFokus(status === "active"),
  );
  return () => abo.remove();
});
onlineManager.setEventListener((setzeOnline) => {
  // Der Listener meldet nur Änderungen: den aktuellen Stand einmal selbst holen
  void Network.getNetworkStateAsync().then((stand) =>
    setzeOnline(!!stand.isConnected),
  );
  const abo = Network.addNetworkStateListener((stand) =>
    setzeOnline(!!stand.isConnected),
  );
  return () => abo.remove();
});

// Für die Offline-Meldung der Bildschirme
export function useOnline() {
  return useSyncExternalStore(
    (melden) => onlineManager.subscribe(melden),
    () => onlineManager.isOnline(),
  );
}

const url = process.env.EXPO_PUBLIC_API_URL;
const version = Constants.expoConfig?.version;
// Beides sind Baukonstanten: Fehlt eine, ist die App falsch gebaut und soll sofort auffallen
if (!url)
  throw new Error("EXPO_PUBLIC_API_URL fehlt: Die App ist falsch gebaut.");
if (!version)
  throw new Error("Die Version fehlt in app.json: Die App ist falsch gebaut.");

// «Bitte App aktualisieren»: gesetzt, sobald irgendeine Antwort 426 ist; zurück geht es nur über ein Update
let veraltet = false;
const horcher = new Set<() => void>();
function abonniere(melden: () => void) {
  horcher.add(melden);
  return () => {
    horcher.delete(melden);
  };
}
function setzeVeraltet() {
  if (veraltet) return;
  veraltet = true;
  horcher.forEach((melden) => melden());
}
export function useAppVeraltet() {
  return useSyncExternalStore(abonniere, () => veraltet);
}

// Ein Fehlertyp für jede Nicht-OK-Antwort der API; die Texte dazu stehen in fehlertexte.ts
export class ApiFehler extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiFehler";
  }
}

export const authClient = createAuthClient({
  baseURL: url,
  fetchOptions: {
    headers: { "X-App-Version": version },
    // Nur 426: Ein 401 beim Anmelden ist der Login-Fehler aus #15, keine verlorene Sitzung
    onError(kontext) {
      if (kontext.response?.status === 426) setzeVeraltet();
    },
  },
  plugins: [
    // scheme kommt aus app.json; disableCache, damit get-session nie im Secure Store landet
    expoClient({
      storagePrefix: "cevi-os",
      storage: speicher,
      disableCache: true,
    }),
    usernameClient(),
  ],
});

// Serverdaten nur im Arbeitsspeicher: kein Persister; 4xx ändert sich durch Wiederholen nicht
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (anzahl, fehler) =>
        fehler instanceof ApiFehler && fehler.status < 500 ? false : anzahl < 3,
    },
  },
});

// «Abmelden», «Überall abmelden» und jede 401-Antwort laufen hier zusammen
export async function abmelden() {
  try {
    await authClient.signOut();
  } catch {
    // Offline: Der Client hat den Secure Store schon geleert; die Server-Sitzung endet mit ihrem Ablauf
  } finally {
    queryClient.clear();
    // Geteiltes Handy: Die nächste Person startet mit eingeschalteter Sperre
    await speicher.deleteItemAsync(SPERRE_SCHLUESSEL).catch(() => {});
  }
}

const eigenerFetch: typeof fetch = async (eingabe, init) => {
  const antwort = await fetch(eingabe, init);
  if (antwort.ok) return antwort;
  if (antwort.status === 426) setzeVeraltet();
  if (antwort.status === 401) void abmelden();
  const koerper = (await antwort.json().catch(() => undefined)) as
    { code?: string; message?: string } | undefined;
  throw new ApiFehler(
    antwort.status,
    koerper?.code ?? "FEHLER",
    koerper?.message ?? "Anfrage fehlgeschlagen",
  );
};

// Der Hono-Client schickt das Cookie selbst mit: credentials "omit", Cookie aus dem Secure Store
export const api = hc<AppType>(url, {
  headers: async () => ({
    cookie: await authClient.getCookie(),
    "X-App-Version": version,
  }),
  init: { credentials: "omit" },
  fetch: eigenerFetch,
});
