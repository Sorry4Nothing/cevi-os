import { QueryClientProvider } from "@tanstack/react-query";
import { Slot } from "expo-router";
import {
  act,
  fireEvent,
  renderRouter,
  screen,
} from "expo-router/testing-library";
import { AccessibilityInfo, Platform } from "react-native";

import Detail from "../app/(tabs)/programme/[id]";
import { queryClient } from "../src/api/client";
import {
  FALKEN,
  json,
  mockeNetz,
  netz,
  programmDetail,
} from "./hilfen/programme";

function Wurzel() {
  return (
    <QueryClientProvider client={queryClient}>
      <Slot />
    </QueryClientProvider>
  );
}

const starte = () =>
  renderRouter(
    { _layout: Wurzel, "programme/[id]": Detail },
    { initialUrl: "/programme/p1" },
  );

const WALD = programmDetail({ id: "p1", titel: "Waldtag", stufen: [FALKEN] });
const mitAnmeldung = (eigeneAnmeldung: "ja" | "nein" | "offen") => ({
  ...WALD,
  eigeneAnmeldung,
});
const KONTEXT = "Anmeldung als Leitung, Waldtag";
const BEGONNEN =
  "Das Programm hat schon begonnen. Die Anmeldung lässt sich nicht mehr ändern.";
const OFFLINE =
  "Keine Internetverbindung. Ändern geht erst wieder mit Internet.";

const netzHorcher = (
  jest.requireMock("expo-network") as {
    __netzHorcher: Set<(stand: { isConnected: boolean }) => void>;
  }
).__netzHorcher;

// Die PUT-Anfragen an die Anmeldung, wie sie das Netz erreichten
const puts = () =>
  netz.mock.calls
    .map(([url, init]) => [String(url), init as RequestInit] as const)
    .filter(([, init]) => init.method === "PUT");

// beforeEach, nicht afterEach: Die automatische Abräumung von RNTL hängt den Baum erst nach den afterEach-Hooks aus
beforeEach(() => {
  jest.clearAllMocks();
  netzHorcher.forEach((melden) => melden({ isConnected: true }));
  queryClient.clear();
});
afterEach(() => jest.restoreAllMocks());

const AUSGANG = [
  ["iOS", "button", "selected"],
  ["Android", "radio", "checked"],
] as const;

describe.each(AUSGANG)("%s", (os, rolle, zustand) => {
  const wahl = (name: string, an: boolean) =>
    screen.getByRole(rolle, { name: `${name}, ${KONTEXT}`, [zustand]: an });

  test("Leitende sehen die Überschrift, Rolle, Namen und Zustand beider Antworten", async () => {
    if (os === "Android") jest.replaceProperty(Platform, "OS", "android");
    mockeNetz({ "/programme/p1": () => json(200, mitAnmeldung("ja")) });
    await starte();

    expect(
      await screen.findByRole("header", { name: "Anmeldung als Leitung" }),
    ).toBeOnTheScreen();
    expect(wahl("Ja", true)).toBeOnTheScreen();
    expect(wahl("Nein", false)).toBeOnTheScreen();
  });

  test("offen: keine der beiden Antworten ist gewählt", async () => {
    if (os === "Android") jest.replaceProperty(Platform, "OS", "android");
    mockeNetz({ "/programme/p1": () => json(200, mitAnmeldung("offen")) });
    await starte();

    await screen.findByRole("header", { name: "Anmeldung als Leitung" });
    expect(wahl("Ja", false)).toBeOnTheScreen();
    expect(wahl("Nein", false)).toBeOnTheScreen();
  });
});

test("Eltern: Ohne eigeneAnmeldung in der Antwort gibt es keine Anmeldung", async () => {
  mockeNetz({ "/programme/p1": () => json(200, WALD) });
  await starte();

  await screen.findByRole("header", { name: "Waldtag" });
  expect(screen.queryByText("Anmeldung als Leitung")).toBeNull();
  expect(screen.queryByRole("button", { name: /Ja, / })).toBeNull();
});

test("Nein senden: PUT mit dem Status, danach lädt das Detail neu", async () => {
  let stand: "offen" | "nein" = "offen";
  mockeNetz({
    "/programme/p1": () => json(200, mitAnmeldung(stand)),
    "/programme/p1/leitung": () => {
      stand = "nein";
      return new Response(null, { status: 204 });
    },
  });
  await starte();

  await fireEvent.press(
    await screen.findByRole("button", { name: `Nein, ${KONTEXT}` }),
  );

  expect(
    await screen.findByRole("button", {
      name: `Nein, ${KONTEXT}`,
      selected: true,
    }),
  ).toBeOnTheScreen();
  expect(puts()).toHaveLength(1);
  const [url, init] = puts()[0];
  expect(url).toBe("https://cevi-os.invalid/api/v1/programme/p1/leitung");
  expect(JSON.parse(init.body as string)).toEqual({ status: "nein" });
});

describe("Fehler", () => {
  const fokusse = () =>
    jest
      .mocked(AccessibilityInfo.sendAccessibilityEvent)
      .mock.calls.filter(
        ([element, art]) =>
          art === "focus" &&
          (element as unknown as { props: { children: string } }).props
            .children === BEGONNEN,
      );

  test("schon begonnen (409): Der Text bleibt stehen und nimmt jedes Mal den Fokus", async () => {
    mockeNetz({
      "/programme/p1": () => json(200, mitAnmeldung("offen")),
      "/programme/p1/leitung": () =>
        json(409, {
          code: "PROGRAMM_BEGONNEN",
          message: "Das Programm hat schon begonnen.",
        }),
    });
    await starte();
    const ja = await screen.findByRole("button", { name: `Ja, ${KONTEXT}` });

    await fireEvent.press(ja);
    expect(await screen.findByText(BEGONNEN)).toBeOnTheScreen();
    expect(fokusse()).toHaveLength(1);

    // Derselbe Fehler nochmals: Der Text bleibt, der Fokus kommt wieder
    await fireEvent.press(ja);
    await act(async () => {});
    expect(screen.getByText(BEGONNEN)).toBeOnTheScreen();
    expect(fokusse()).toHaveLength(2);
    // Der Stand der Anmeldung bleibt unverändert
    expect(
      screen.getByRole("button", { name: `Ja, ${KONTEXT}`, selected: false }),
    ).toBeOnTheScreen();
  });

  test("anderer Fehler: allgemeiner Text", async () => {
    mockeNetz({
      "/programme/p1": () => json(200, mitAnmeldung("offen")),
      "/programme/p1/leitung": () => json(500, { code: "FEHLER" }),
    });
    await starte();

    await fireEvent.press(
      await screen.findByRole("button", { name: `Ja, ${KONTEXT}` }),
    );

    expect(
      await screen.findByText(
        "Das Speichern hat nicht geklappt. Bitte nochmals versuchen.",
      ),
    ).toBeOnTheScreen();
  });

  test("404: Das Programm gilt als nicht mehr sichtbar", async () => {
    let sichtbar = true;
    mockeNetz({
      "/programme/p1": () =>
        sichtbar
          ? json(200, mitAnmeldung("offen"))
          : json(404, { code: "NICHT_GEFUNDEN", message: "Nicht gefunden." }),
      "/programme/p1/leitung": () => {
        sichtbar = false;
        return json(404, {
          code: "NICHT_GEFUNDEN",
          message: "Nicht gefunden.",
        });
      },
    });
    await starte();

    await fireEvent.press(
      await screen.findByRole("button", { name: `Ja, ${KONTEXT}` }),
    );

    expect(
      await screen.findByText("Dieses Programm ist nicht mehr sichtbar."),
    ).toBeOnTheScreen();
  });

  test("offline: Der Text steht da, es geht keine Anfrage raus", async () => {
    mockeNetz({ "/programme/p1": () => json(200, mitAnmeldung("offen")) });
    await starte();
    const ja = await screen.findByRole("button", { name: `Ja, ${KONTEXT}` });

    await act(async () =>
      netzHorcher.forEach((melden) => melden({ isConnected: false })),
    );
    await fireEvent.press(ja);

    expect(await screen.findByText(OFFLINE)).toBeOnTheScreen();
    expect(puts()).toHaveLength(0);
  });

  test("offline, zweimal gedrückt: Der Text nimmt den Fokus jedes Mal", async () => {
    mockeNetz({ "/programme/p1": () => json(200, mitAnmeldung("offen")) });
    await starte();
    const ja = await screen.findByRole("button", { name: `Ja, ${KONTEXT}` });
    await act(async () =>
      netzHorcher.forEach((melden) => melden({ isConnected: false })),
    );

    await fireEvent.press(ja);
    await fireEvent.press(ja);

    expect(screen.getByText(OFFLINE)).toBeOnTheScreen();
    const fokus = jest
      .mocked(AccessibilityInfo.sendAccessibilityEvent)
      .mock.calls.filter(
        ([element, art]) =>
          art === "focus" &&
          (element as unknown as { props: { children: string } }).props
            .children === OFFLINE,
      );
    expect(fokus).toHaveLength(2);
  });
});
