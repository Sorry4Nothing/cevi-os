import { onlineManager, QueryClientProvider } from "@tanstack/react-query";
import { Slot } from "expo-router";
import {
  act,
  fireEvent,
  renderRouter,
  screen,
} from "expo-router/testing-library";
import { Alert } from "react-native";

import Meldungen from "../app/(tabs)/verwaltung/meldungen/index";
import type { MeldungZeile } from "../src/api/meldungen";
import { queryClient } from "../src/api/client";
import { json, netz } from "./hilfen/programme";

function Wurzel() {
  return (
    <QueryClientProvider client={queryClient}>
      <Slot />
    </QueryClientProvider>
  );
}

const starte = () =>
  renderRouter(
    { _layout: Wurzel, "verwaltung/meldungen/index": Meldungen },
    { initialUrl: "/verwaltung/meldungen" },
  );

function meldung(nr: number, aenderung: Partial<MeldungZeile> = {}) {
  return {
    id: `m${nr}`,
    erstelltAm: "2026-10-31T13:30:00.000Z",
    text: `Gemeldeter Text ${nr}`,
    nachrichtId: `n${nr}`,
    ausgeblendet: false,
    chat: {
      typ: "stufe" as const,
      stufe: { id: "s1", name: "Falken", kuerzel: "F" },
    },
    autor: { id: "u2", name: "Anna Muster", deaktiviert: false },
    gemeldetVon: "Berta Leiterin",
    ...aenderung,
  };
}

let offene: MeldungZeile[];
let seiten: Record<
  string,
  { meldungen: MeldungZeile[]; naechster: string | null }
>;
let aufrufe: string[];
let antwort: () => Response;

beforeEach(() => {
  queryClient.clear();
  netz.mockClear();
  offene = [];
  seiten = {};
  aufrufe = [];
  antwort = () => new Response(null, { status: 204 });
  netz.mockImplementation(async (eingabe: unknown, init?: RequestInit) => {
    const url = new URL(
      String(eingabe instanceof Request ? eingabe.url : eingabe),
    );
    if (init?.method === "GET" || init?.method === undefined) {
      if (url.pathname.endsWith("/admin/meldungen")) {
        return json(
          200,
          seiten[url.searchParams.get("vor") ?? ""] ?? {
            meldungen: offene,
            naechster: null,
          },
        );
      }
    }
    aufrufe.push(`${init?.method} ${url.pathname.split("/api/v1/")[1]}`);
    if (init?.method === "PATCH") {
      aufrufe.push(String(init.body));
    }
    return antwort();
  });
});
afterEach(() => {
  jest.restoreAllMocks();
  onlineManager.setOnline(true);
});

const dialog = () => jest.spyOn(Alert, "alert").mockImplementation(() => {});
const bestaetige = async (spion: jest.SpyInstance) => {
  const [, , knoepfe] = spion.mock.calls.at(-1)!;
  await act(async () => knoepfe[1].onPress());
};

test("ohne offene Meldungen steht ein Hinweis", async () => {
  await starte();

  expect(await screen.findByText("Keine offenen Meldungen.")).toBeOnTheScreen();
});

test("zeigt Autorin, Chat, Melderin und die Kopie des Textes", async () => {
  offene = [meldung(1)];
  await starte();

  expect(
    await screen.findByRole("header", {
      name: "Anna Muster, 31. Oktober, 14:30 Uhr",
    }),
  ).toBeOnTheScreen();
  expect(
    screen.getByText("Gruppenchat Falken, gemeldet von Berta Leiterin"),
  ).toBeOnTheScreen();
  expect(screen.getByText("Gemeldeter Text 1")).toBeOnTheScreen();
});

test("eine Meldung ohne Kopie und ohne Nachricht sagt es und bietet nur «Erledigt»", async () => {
  offene = [
    meldung(1, { text: null, nachrichtId: null, chat: null, autor: null }),
  ];
  await starte();

  expect(
    await screen.findByText("Die Kopie des Textes ist gelöscht."),
  ).toBeOnTheScreen();
  expect(
    screen.getByText("Nachricht gelöscht, gemeldet von Berta Leiterin"),
  ).toBeOnTheScreen();
  expect(
    screen.getByRole("header", { name: /^Konto gelöscht/ }),
  ).toBeOnTheScreen();
  expect(
    screen.queryByRole("button", { name: "Nachricht ausblenden" }),
  ).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Konto deaktivieren" }),
  ).toBeNull();
  expect(screen.getByRole("button", { name: "Erledigt" })).toBeOnTheScreen();
});

test("Ausblenden und Deaktivieren laufen über einen Dialog, ausgeblendete und deaktivierte Fälle bieten sie nicht mehr an", async () => {
  const spion = dialog();
  offene = [meldung(1)];
  await starte();

  await fireEvent.press(
    await screen.findByRole("button", { name: "Nachricht ausblenden" }),
  );
  expect(aufrufe).toEqual([]);
  expect(spion.mock.calls[0][0]).toBe("Nachricht ausblenden?");
  await bestaetige(spion);
  expect(aufrufe).toEqual(["POST nachrichten/n1/ausblenden"]);

  await fireEvent.press(
    screen.getByRole("button", { name: "Konto deaktivieren" }),
  );
  expect(spion.mock.calls[1][0]).toBe("Konto deaktivieren?");
  await bestaetige(spion);
  expect(aufrufe).toContain("POST admin/personen/u2/deaktivieren");
});

test("bereits ausgeblendet und deaktiviert: keine der beiden Aktionen, dafür ein Hinweis mit Symbol und Text", async () => {
  offene = [
    meldung(1, {
      ausgeblendet: true,
      autor: { id: "u2", name: "Anna Muster", deaktiviert: true },
    }),
  ];
  await starte();

  await screen.findByText("Gemeldeter Text 1");
  expect(screen.getByText("ausgeblendet")).toBeOnTheScreen();
  expect(
    screen.queryByRole("button", { name: "Nachricht ausblenden" }),
  ).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Konto deaktivieren" }),
  ).toBeNull();
});

test("«Erledigt» erledigt ohne Dialog und sagt, dass die Kopie gelöscht ist", async () => {
  offene = [meldung(1)];
  await starte();

  await fireEvent.press(
    await screen.findByRole("button", { name: "Erledigt" }),
  );

  expect(aufrufe).toEqual(["PATCH admin/meldungen/m1", '{"erledigt":true}']);
  expect(
    await screen.findByText(
      "Meldung erledigt. Die Kopie des Textes ist gelöscht.",
    ),
  ).toBeOnTheScreen();
});

test("ein Serverfehler steht als Text, «letzter Admin» mit dem Text der Verwaltung", async () => {
  const spion = dialog();
  antwort = () =>
    json(409, {
      code: "LETZTER_ADMIN",
      message: "Der letzte Admin lässt sich nicht entfernen.",
    });
  offene = [meldung(1)];
  await starte();

  await fireEvent.press(
    await screen.findByRole("button", { name: "Konto deaktivieren" }),
  );
  await bestaetige(spion);

  expect(
    await screen.findByText("Der letzte Admin lässt sich nicht entfernen."),
  ).toBeOnTheScreen();
});

test("ohne Netz sagt die App es und ändert nichts", async () => {
  offene = [meldung(1)];
  await starte();
  const knopf = await screen.findByRole("button", { name: "Erledigt" });

  await act(async () => onlineManager.setOnline(false));
  await fireEvent.press(knopf);

  expect(aufrufe).toEqual([]);
  expect(
    screen.getAllByText(
      "Keine Internetverbindung. Bearbeiten geht erst wieder mit Internet.",
    ).length,
  ).toBeGreaterThan(0);
});

test("weitere Seiten lassen sich nachladen", async () => {
  seiten[""] = { meldungen: [meldung(2)], naechster: "m2" };
  seiten["m2"] = { meldungen: [meldung(1)], naechster: null };
  await starte();

  await fireEvent.press(
    await screen.findByRole("button", { name: "Weitere Meldungen laden" }),
  );

  expect(await screen.findByText("Gemeldeter Text 1")).toBeOnTheScreen();
  expect(screen.getByText("Gemeldeter Text 2")).toBeOnTheScreen();
  expect(
    screen.queryByRole("button", { name: "Weitere Meldungen laden" }),
  ).toBeNull();
});
