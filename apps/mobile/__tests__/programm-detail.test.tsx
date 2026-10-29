import { onlineManager, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import { Slot } from "expo-router";
import { fireEvent, renderRouter, screen } from "expo-router/testing-library";
import type { ReactNode } from "react";
import { Linking, Platform } from "react-native";

import Detail from "../app/(tabs)/programme/[id]";
import { queryClient } from "../src/api/client";
import { useProgramm } from "../src/api/programme";
import {
  FALKEN,
  json,
  mockeNetz,
  netz,
  programm,
  programmDetail,
} from "./hilfen/programme";

function Wurzel() {
  return (
    <QueryClientProvider client={queryClient}>
      <Slot />
    </QueryClientProvider>
  );
}

const starte = (id: string) =>
  renderRouter(
    { _layout: Wurzel, "programme/[id]": Detail },
    { initialUrl: `/programme/${id}` },
  );

const WALD = programmDetail({
  id: "p1",
  titel: "Waldtag",
  googleOrt: "Dorfplatz Adliswil",
  schlussZeit: "17:30:00",
  schlussOrt: "Bahnhof",
  mitnehmen: "Trinkflasche und Zvieri",
  infoEltern: "Bitte wetterfest anziehen.",
  stufen: [FALKEN],
});

beforeEach(() => queryClient.clear());
afterEach(() => {
  jest.restoreAllMocks();
  onlineManager.setOnline(true);
});

test("zeigt Zeit, Treffpunkt, Schluss, Mitnehmen und Info mit sichtbarer Beschriftung", async () => {
  mockeNetz({ "/programme/p1": () => json(200, WALD) });
  await starte("p1");

  expect(
    await screen.findByRole("header", { name: "Waldtag" }),
  ).toBeOnTheScreen();
  expect(screen.getByRole("header", { name: "Zeit" })).toBeOnTheScreen();
  expect(
    screen.getByText("Samstag, 31. Oktober 2026, 14:00 bis 17:00 Uhr"),
  ).toBeOnTheScreen();
  // Ohne ergänzten Treffpunkt steht der Ort aus Google
  expect(
    screen.getByRole("button", { name: "Treffpunkt, Dorfplatz Adliswil" }),
  ).toBeOnTheScreen();
  expect(screen.getByRole("header", { name: "Schluss" })).toBeOnTheScreen();
  expect(screen.getByText("17:30 Uhr, Bahnhof")).toBeOnTheScreen();
  expect(screen.getByRole("header", { name: "Mitnehmen" })).toBeOnTheScreen();
  expect(screen.getByText("Trinkflasche und Zvieri")).toBeOnTheScreen();
  expect(screen.getByRole("header", { name: "Info" })).toBeOnTheScreen();
  expect(screen.getByText("Bitte wetterfest anziehen.")).toBeOnTheScreen();
  // Der Server liefert sie nur mit Leitungssicht
  expect(screen.queryByText("Interne Beschreibung")).toBeNull();
  expect(screen.getByRole("button", { name: "Zurück" })).toBeOnTheScreen();
});

test("mit Leitungssicht steht die interne Beschreibung als Text", async () => {
  mockeNetz({
    "/programme/p1": () =>
      json(200, { ...WALD, googleBeschreibung: "Route im Leitungsordner" }),
  });
  await starte("p1");

  expect(
    await screen.findByRole("header", { name: "Interne Beschreibung" }),
  ).toBeOnTheScreen();
  expect(screen.getByText("Route im Leitungsordner")).toBeOnTheScreen();
});

test("ein ergänzter Treffpunkt ersetzt den Ort aus Google", async () => {
  mockeNetz({
    "/programme/p1": () =>
      json(200, { ...WALD, treffpunkt: "Waldhütte Hinterberg" }),
  });
  await starte("p1");

  expect(
    await screen.findByRole("button", {
      name: "Treffpunkt, Waldhütte Hinterberg",
    }),
  ).toBeOnTheScreen();
  expect(screen.queryByText("Dorfplatz Adliswil")).toBeNull();
});

test("leere Felder fallen weg", async () => {
  mockeNetz({
    "/programme/p2": () =>
      json(200, programmDetail({ id: "p2", titel: "Waldtag" })),
  });
  await starte("p2");

  await screen.findByRole("header", { name: "Zeit" });
  for (const label of ["Treffpunkt", "Schluss", "Mitnehmen", "Info"]) {
    expect(screen.queryByText(label)).toBeNull();
  }
});

test("ein abgesagtes Programm trägt den Hinweis «Abgesagt»", async () => {
  mockeNetz({
    "/programme/p1": () => json(200, { ...WALD, status: "abgesagt" }),
  });
  await starte("p1");

  expect(await screen.findByText("Abgesagt")).toBeOnTheScreen();
});

test("Android: Der Treffpunkt öffnet die Karten-App über den geo-Intent", async () => {
  jest.replaceProperty(Platform, "OS", "android");
  mockeNetz({ "/programme/p1": () => json(200, WALD) });
  await starte("p1");

  await fireEvent.press(
    await screen.findByRole("button", {
      name: "Treffpunkt, Dorfplatz Adliswil",
    }),
  );

  expect(Linking.openURL).toHaveBeenCalledWith(
    "geo:0,0?q=Dorfplatz%20Adliswil",
  );
});

test("iOS: Der Treffpunkt öffnet Apple Karten über den Map-Link", async () => {
  mockeNetz({ "/programme/p1": () => json(200, WALD) });
  await starte("p1");

  await fireEvent.press(
    await screen.findByRole("button", {
      name: "Treffpunkt, Dorfplatz Adliswil",
    }),
  );

  expect(Linking.openURL).toHaveBeenCalledWith(
    "https://maps.apple.com/?q=Dorfplatz%20Adliswil",
  );
});

test("lässt sich die Karten-App nicht öffnen, erscheint eine Meldung", async () => {
  jest
    .mocked(Linking.openURL)
    .mockRejectedValue(new Error("kein Handler für geo:"));
  mockeNetz({ "/programme/p1": () => json(200, WALD) });
  await starte("p1");

  await fireEvent.press(
    await screen.findByRole("button", {
      name: "Treffpunkt, Dorfplatz Adliswil",
    }),
  );

  expect(
    await screen.findByText("Die Karten-App liess sich nicht öffnen."),
  ).toBeOnTheScreen();
});

test("404 zeigt «nicht mehr sichtbar», keine alten Felder, und leert die Listen", async () => {
  queryClient.setQueryData(
    ["programme", "liste"],
    [WALD, programm({ id: "p9", titel: "Herbstfest" })],
  );
  mockeNetz({
    "/programme/p1": () =>
      json(404, { code: "NICHT_GEFUNDEN", message: "Nicht gefunden" }),
  });
  await starte("p1");

  expect(
    await screen.findByText("Dieses Programm ist nicht mehr sichtbar."),
  ).toBeOnTheScreen();
  // Der Titel aus der Liste ist weg, weil die Liste den Eintrag verliert
  expect(screen.queryByText("Dorfplatz Adliswil")).toBeNull();
  expect(queryClient.getQueryData(["programme", "liste"])).toEqual([
    expect.objectContaining({ id: "p9" }),
  ]);
});

describe("Teilnahme", () => {
  const LEA: { id: string; vorname: string; status: "ja" | "nein" | null } = {
    id: "k1",
    vorname: "Lea",
    status: null,
  };
  const MIT_KIND = { ...WALD, kinder: [LEA] };
  // Die Aufrufe früherer Tests zählen nicht
  beforeEach(() => netz.mockClear());
  // Der Client ruft fetch mit (url, init) auf
  const wahlen = () =>
    netz.mock.calls.filter(([, init]) => init?.method === "PUT");

  test("Ja und Nein stehen pro Kind, der Name beginnt mit dem sichtbaren Text", async () => {
    mockeNetz({ "/programme/p1": () => json(200, MIT_KIND) });
    await starte("p1");

    expect(
      await screen.findByRole("header", { name: "Teilnahme" }),
    ).toBeOnTheScreen();
    expect(screen.getByText("Lea")).toBeOnTheScreen();
    // Ohne Antwort ist nichts gewählt
    expect(
      screen.getByRole("button", { name: "Ja, Lea, Waldtag", selected: false }),
    ).toBeOnTheScreen();
    expect(
      screen.getByRole("button", {
        name: "Nein, Lea, Waldtag",
        selected: false,
      }),
    ).toBeOnTheScreen();
  });

  test("die gespeicherte Antwort ist gewählt", async () => {
    mockeNetz({
      "/programme/p1": () =>
        json(200, { ...WALD, kinder: [{ ...LEA, status: "nein" }] }),
    });
    await starte("p1");

    expect(
      await screen.findByRole("button", {
        name: "Nein, Lea, Waldtag",
        selected: true,
      }),
    ).toBeOnTheScreen();
    expect(
      screen.getByRole("button", { name: "Ja, Lea, Waldtag", selected: false }),
    ).toBeOnTheScreen();
  });

  test("Ja sendet die Antwort, lädt neu und sagt «gespeichert» an", async () => {
    let kinder = [LEA];
    mockeNetz({
      "/programme/p1/teilnahmen/k1": () => {
        kinder = [{ ...LEA, status: "ja" }];
        return new Response(null, { status: 204 });
      },
      "/programme/p1": () => json(200, { ...WALD, kinder }),
    });
    await starte("p1");

    await fireEvent.press(
      await screen.findByRole("button", { name: "Ja, Lea, Waldtag" }),
    );

    expect(await screen.findByText("Lea: Ja gespeichert.")).toBeOnTheScreen();
    expect(
      await screen.findByRole("button", {
        name: "Ja, Lea, Waldtag",
        selected: true,
      }),
    ).toBeOnTheScreen();
    const [[, init]] = wahlen();
    expect(JSON.parse(init.body as string)).toEqual({ status: "ja" });
  });

  test("ohne Internet erscheint die Meldung und nichts geht raus", async () => {
    mockeNetz({ "/programme/p1": () => json(200, MIT_KIND) });
    await starte("p1");
    const nein = await screen.findByRole("button", {
      name: "Nein, Lea, Waldtag",
    });

    await act(async () => onlineManager.setOnline(false));
    await fireEvent.press(nein);

    expect(
      await screen.findByText(
        "Keine Internetverbindung. Bitte später nochmals versuchen.",
      ),
    ).toBeOnTheScreen();
    expect(wahlen()).toHaveLength(0);
  });

  test("409 zeigt den Text des Servers", async () => {
    mockeNetz({
      "/programme/p1/teilnahmen/k1": () =>
        json(409, {
          code: "PROGRAMM_GESCHLOSSEN",
          message: "Das Programm ist abgesagt oder hat schon begonnen.",
        }),
      "/programme/p1": () => json(200, MIT_KIND),
    });
    await starte("p1");

    await fireEvent.press(
      await screen.findByRole("button", { name: "Ja, Lea, Waldtag" }),
    );

    expect(
      await screen.findByText(
        "Das Programm ist abgesagt oder hat schon begonnen. Die Teilnahme lässt sich nicht mehr ändern.",
      ),
    ).toBeOnTheScreen();
  });

  test("begonnen oder abgesagt: nur die Antwort als Text, keine Auswahl", async () => {
    mockeNetz({
      "/programme/p1": () =>
        json(200, {
          ...WALD,
          teilnahmeOffen: false,
          kinder: [
            { ...LEA, status: "ja" },
            { id: "k2", vorname: "Noah", status: null },
          ],
        }),
    });
    await starte("p1");

    expect(
      await screen.findByRole("header", { name: "Lea" }),
    ).toBeOnTheScreen();
    expect(screen.getByText("Ja")).toBeOnTheScreen();
    expect(screen.getByText("Keine Antwort")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: /Ja, Lea/ })).toBeNull();
  });

  test("ohne Kinder fällt der Abschnitt weg", async () => {
    mockeNetz({ "/programme/p1": () => json(200, WALD) });
    await starte("p1");

    await screen.findByRole("header", { name: "Zeit" });
    expect(screen.queryByRole("header", { name: "Teilnahme" })).toBeNull();
  });
});

// Zuletzt: Die Fake-Timer dieses Tests stören nachfolgende Tests
test("ein geladenes Detail bleibt 6 Minuten nach dem Verlassen im Speicher", async () => {
  jest.useFakeTimers();
  mockeNetz({ "/programme/p1": () => json(200, WALD) });
  const umschlag = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const { unmount } = await renderHook(() => useProgramm("p1"), {
    wrapper: umschlag,
  });
  await waitFor(() =>
    expect(queryClient.getQueryData(["programme", "p1"])).toBeTruthy(),
  );

  unmount();
  await act(async () => jest.advanceTimersByTime(6 * 60_000));

  // Mit der üblichen gcTime (5 Minuten) wäre der Eintrag jetzt weg
  expect(queryClient.getQueryData(["programme", "p1"])).toEqual(WALD);
  jest.useRealTimers();
});
