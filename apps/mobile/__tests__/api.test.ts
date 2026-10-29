import { focusManager, onlineManager } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react-native";
import { AppState, type AppStateStatus } from "react-native";

import {
  abmelden,
  api,
  authClient,
  queryClient,
  useAppVeraltet,
} from "../src/api/client";
import { SCHLUESSEL } from "../src/speicher";

// Der echte Auth-Client mit dem Secure Store aus jest.setup.js; nur das Netz ist eine Attrappe
const speicher = (
  jest.requireMock("expo-secure-store") as { __speicher: Map<string, string> }
).__speicher;
const netz = global.fetch as jest.Mock;

type Antwort = (kopfzeilen: Headers) => Response;

function mockeNetz(antworten: Record<string, Antwort>) {
  netz.mockImplementation(async (eingabe: unknown, init?: RequestInit) => {
    const url = String(eingabe instanceof Request ? eingabe.url : eingabe);
    const kopfzeilen = new Headers(
      init?.headers ??
        (eingabe instanceof Request ? eingabe.headers : undefined),
    );
    for (const [endung, antwort] of Object.entries(antworten)) {
      if (new URL(url).pathname.endsWith(endung)) return antwort(kopfzeilen);
    }
    throw new Error(`Kein Netz im Test: ${url}`);
  });
}

const json = (
  status: number,
  koerper: unknown,
  kopfzeilen: Record<string, string> = {},
) =>
  new Response(JSON.stringify(koerper), {
    status,
    headers: { "content-type": "application/json", ...kopfzeilen },
  });

const SITZUNGS_COOKIE =
  "__Secure-better-auth.session_token=abc.sig; Max-Age=7776000; Path=/; HttpOnly; Secure; SameSite=Lax";

async function anmelden() {
  mockeNetz({
    "/sign-in/username": () =>
      json(
        200,
        { token: "t1", user: { id: "u1" } },
        { "set-cookie": SITZUNGS_COOKIE },
      ),
    "/get-session": () =>
      json(200, { user: { id: "u1" }, session: { id: "s1" } }),
  });
  const ergebnis = await authClient.signIn.username({
    username: "eltern.a",
    password: "x".repeat(12),
  });
  expect(ergebnis.error).toBeNull();
}

// Gecachte Einträge halten sonst gcTime-Timer offen, und der Jest-Worker kann nicht enden
afterAll(() => queryClient.clear());

beforeEach(() => {
  speicher.clear();
  queryClient.clear();
});

test("der Fokus für TanStack Query folgt dem AppState", () => {
  // Der Anschluss ans AppState passiert erst mit dem ersten Abonnenten
  const abo = focusManager.subscribe(() => {});
  const aufruf = jest
    .mocked(AppState.addEventListener)
    .mock.calls.find(([typ]) => typ === "change");
  expect(aufruf).toBeDefined();
  const melden = aufruf![1] as (status: AppStateStatus) => void;

  melden("background");
  expect(focusManager.isFocused()).toBe(false);
  melden("active");
  expect(focusManager.isFocused()).toBe(true);
  abo();
});

test("der Online-Stand für TanStack Query folgt expo-network", async () => {
  const { __netzHorcher } = jest.requireMock("expo-network") as {
    __netzHorcher: Set<(stand: { isConnected?: boolean }) => void>;
  };
  const abo = onlineManager.subscribe(() => {});
  // Der Listener meldet nur Änderungen: Den Anfang holt getNetworkStateAsync
  await waitFor(() => expect(__netzHorcher.size).toBeGreaterThan(0));
  expect(onlineManager.isOnline()).toBe(true);

  __netzHorcher.forEach((melden) => melden({ isConnected: false }));
  expect(onlineManager.isOnline()).toBe(false);
  __netzHorcher.forEach((melden) => melden({ isConnected: true }));
  expect(onlineManager.isOnline()).toBe(true);
  abo();
});

test("während der Sitzung liegt im Secure Store nur das Cookie", async () => {
  await anmelden();
  expect([...speicher.keys()]).toEqual(["cevi-os_cookie"]);
  // Die Liste fürs Löschen nach einer Neuinstallation kennt jeden geschriebenen Schlüssel
  expect(SCHLUESSEL).toEqual(expect.arrayContaining([...speicher.keys()]));

  // disableCache: Auch get-session legt keine Serverdaten im Secure Store ab
  await authClient.getSession();
  expect([...speicher.keys()]).toEqual(["cevi-os_cookie"]);
  expect(await authClient.getCookie()).toContain(
    "__Secure-better-auth.session_token=abc.sig",
  );
});

test("Abmelden leert Secure Store und Query-Cache", async () => {
  await anmelden();
  queryClient.setQueryData(["ich"], { name: "Eltern A" });
  mockeNetz({ "/sign-out": () => json(200, { success: true }) });

  await abmelden();

  expect(speicher.get("cevi-os_cookie")).toBe("{}");
  expect(speicher.get("cevi-os_session_data")).toBe("{}");
  expect(queryClient.getQueryCache().getAll()).toEqual([]);
});

test("Abmelden löscht auch die Einstellung der App-Sperre, damit das nächste Mal die Sperre an ist", async () => {
  await anmelden();
  speicher.set("cevi-os_sperre", "aus");
  mockeNetz({ "/sign-out": () => json(200, { success: true }) });

  await abmelden();

  expect(speicher.has("cevi-os_sperre")).toBe(false);
});

test("Abmelden ohne Netz löscht die Einstellung der App-Sperre trotzdem", async () => {
  await anmelden();
  speicher.set("cevi-os_sperre", "aus");
  netz.mockRejectedValue(new TypeError("Network request failed"));

  await abmelden();

  expect(speicher.has("cevi-os_sperre")).toBe(false);
});

test("«Überall abmelden»: revoke-sessions, danach dieselbe Abmelde-Funktion", async () => {
  await anmelden();
  queryClient.setQueryData(["ich"], { name: "Eltern A" });
  mockeNetz({
    "/revoke-sessions": () => json(200, { status: true }),
    "/sign-out": () => json(200, { success: true }),
  });

  const { error } = await authClient.revokeSessions();
  expect(error).toBeNull();
  await abmelden();

  expect(speicher.get("cevi-os_cookie")).toBe("{}");
  expect(speicher.get("cevi-os_session_data")).toBe("{}");
  expect(queryClient.getQueryCache().getAll()).toEqual([]);
});

test("der Hono-Client schickt Cookie und Version selbst mit (credentials omit)", async () => {
  await anmelden();
  let cookie: string | null = null;
  let version: string | null = null;
  mockeNetz({
    "/api/v1/ich": (kopfzeilen) => {
      cookie = kopfzeilen.get("cookie");
      version = kopfzeilen.get("x-app-version");
      return json(200, { id: "u1" });
    },
  });

  await api.api.v1.ich.$get();

  expect(cookie).toContain("__Secure-better-auth.session_token=abc.sig");
  expect(version).toBe("0.1.0");
  const init = netz.mock.calls.at(-1)?.[1] as RequestInit | undefined;
  expect(init?.credentials).toBe("omit");
});

test("eine 401-Antwort wirft den einen Fehlertyp und meldet ab", async () => {
  await anmelden();
  queryClient.setQueryData(["ich"], { name: "Eltern A" });
  mockeNetz({
    "/api/v1/ich": () =>
      json(401, { code: "NICHT_ANGEMELDET", message: "Nicht angemeldet" }),
    "/sign-out": () => json(200, { success: true }),
  });

  await expect(api.api.v1.ich.$get()).rejects.toMatchObject({
    name: "ApiFehler",
    status: 401,
    code: "NICHT_ANGEMELDET",
  });

  await waitFor(() => expect(speicher.get("cevi-os_cookie")).toBe("{}"));
  expect(queryClient.getQueryCache().getAll()).toEqual([]);
});

// Zuletzt: Das 426-Flag bleibt im Modul gesetzt
test("eine 426-Antwort schaltet die App auf «Bitte App aktualisieren»", async () => {
  mockeNetz({
    "/api/v1/ich": () =>
      json(426, { code: "APP_VERALTET", message: "Bitte App aktualisieren" }),
  });

  await expect(api.api.v1.ich.$get()).rejects.toMatchObject({
    status: 426,
    code: "APP_VERALTET",
  });

  const { result } = await renderHook(() => useAppVeraltet());
  expect(result.current).toBe(true);
});
