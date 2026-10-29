import { onlineManager, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { Alert } from "react-native";

import { ApiFehler, authClient, queryClient } from "../src/api/client";
import { useKontoLoeschen } from "../src/api/konto";

// Der echte Client mit dem Secure Store aus jest.setup.js; nur das Netz ist eine Attrappe
const speicher = (
  jest.requireMock("expo-secure-store") as { __speicher: Map<string, string> }
).__speicher;
const netz = global.fetch as jest.Mock;

type Antwort = (anfrage: { methode: string; text: string }) => Response;

function mockeNetz(antworten: Record<string, Antwort>) {
  netz.mockImplementation(async (eingabe: unknown, init?: RequestInit) => {
    const anfrage = eingabe instanceof Request ? eingabe : undefined;
    const url = String(anfrage?.url ?? eingabe);
    const methode = anfrage?.method ?? init?.method ?? "GET";
    const text = String(init?.body ?? (await anfrage?.clone().text()) ?? "");
    for (const [endung, antwort] of Object.entries(antworten)) {
      if (new URL(url).pathname.endsWith(endung)) {
        return antwort({ methode, text });
      }
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
const ohneKoerper = () => new Response(null, { status: 204 });

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
  expect(speicher.get("cevi-os_cookie")).toContain("session_token");
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

const loeschen = (passwort = "geheim") =>
  renderHook(() => useKontoLoeschen(), { wrapper }).then(async (hook) => {
    await act(async () => hook.result.current.mutate(passwort));
    return hook;
  });

afterAll(() => queryClient.clear());

let dialog: jest.SpyInstance;
beforeEach(() => {
  speicher.clear();
  queryClient.clear();
  onlineManager.setOnline(true);
  dialog = jest.spyOn(Alert, "alert").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test("204: ein DELETE mit dem Passwort, danach ist der Secure Store leer, der Cache auch und die Bestätigung steht", async () => {
  await anmelden();
  queryClient.setQueryData(["ich"], { name: "Eltern A" });
  const gesehen: { methode: string; text: string }[] = [];
  mockeNetz({
    "/api/v1/ich": (anfrage) => {
      gesehen.push(anfrage);
      return ohneKoerper();
    },
    "/sign-out": () => json(200, { success: true }),
  });

  const { result } = await loeschen("geheim");

  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(gesehen).toHaveLength(1);
  expect(gesehen[0].methode).toBe("DELETE");
  expect(JSON.parse(gesehen[0].text)).toEqual({ passwort: "geheim" });
  expect(speicher.get("cevi-os_cookie")).toBe("{}");
  expect(speicher.get("cevi-os_session_data")).toBe("{}");
  expect(queryClient.getQueryCache().getAll()).toEqual([]);
  expect(dialog).toHaveBeenCalledTimes(1);
  expect(dialog).toHaveBeenCalledWith("Das Konto ist gelöscht.");
});

test("scheitert die Abmeldung nach der 204 am Netz, steht die Bestätigung trotzdem", async () => {
  await anmelden();
  mockeNetz({
    "/api/v1/ich": ohneKoerper,
    "/sign-out": () => {
      throw new TypeError("Network request failed");
    },
  });

  await loeschen();

  await waitFor(() => expect(dialog).toHaveBeenCalledTimes(1));
  // Der Client leert den Speicher vor seiner Anfrage
  expect(speicher.get("cevi-os_cookie")).toBe("{}");
});

test.each([
  ["falsches Passwort", 400, "PASSWORT_FALSCH"],
  ["letzter Admin", 409, "LETZTER_ADMIN"],
  ["Wartezeit", 429, "ZU_VIELE_ANFRAGEN"],
])(
  "%s: ApiFehler, die Person bleibt angemeldet, keine Bestätigung",
  async (_, status, code) => {
    await anmelden();
    queryClient.setQueryData(["ich"], { name: "Eltern A" });
    mockeNetz({ "/api/v1/ich": () => json(status, { code, message: "x" }) });

    const { result } = await loeschen();

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiFehler);
    expect(result.current.error).toMatchObject({ status, code });
    expect(speicher.get("cevi-os_cookie")).toContain("session_token");
    expect(queryClient.getQueryData(["ich"])).toEqual({ name: "Eltern A" });
    expect(dialog).not.toHaveBeenCalled();
  },
);

test("ohne Netz geht die Anfrage trotzdem hinaus und scheitert mit dem Netzfehler, statt zu warten", async () => {
  await anmelden();
  onlineManager.setOnline(false);
  mockeNetz({
    "/api/v1/ich": () => {
      throw new TypeError("Network request failed");
    },
  });

  const { result } = await loeschen();

  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(result.current.error).toBeInstanceOf(TypeError);
  expect(result.current.error).not.toBeInstanceOf(ApiFehler);
  expect(speicher.get("cevi-os_cookie")).toContain("session_token");
  expect(dialog).not.toHaveBeenCalled();
});
