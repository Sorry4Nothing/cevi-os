import { QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  renderRouter,
  screen,
} from "expo-router/testing-library";
import { Slot } from "expo-router";

import Liste from "../app/(tabs)/programme/index";
import { queryClient } from "../src/api/client";
import { tagInZuerich } from "../src/programme/zeit";
import {
  FALKEN,
  json,
  mockeNetz,
  netz,
  PERSONAS,
  PINGUINE,
  programm,
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
    { _layout: Wurzel, "programme/index": Liste },
    { initialUrl: "/programme" },
  );

const WALD = programm({ id: "p1", titel: "Waldtag", stufen: [FALKEN] });
const LAGER = programm({
  id: "p2",
  titel: "Herbstlager",
  ganztaegig: true,
  beginn: null,
  ende: null,
  tagVon: "2026-10-10",
  tagBis: "2026-10-17",
  stufen: [FALKEN, PINGUINE],
});
const ABGESAGT = programm({
  id: "p3",
  titel: "Nachtwanderung",
  status: "abgesagt",
  stufen: [PINGUINE],
});
const OHNE_STUFE = programm({
  id: "p4",
  titel: "Leitungsanlass",
  sichtbarkeit: "leitende",
});

const WALD_ZEIT = "Samstag, 31. Oktober 2026, 14:00 bis 17:00 Uhr";
const netzHorcher = (
  jest.requireMock("expo-network") as {
    __netzHorcher: Set<(stand: { isConnected: boolean }) => void>;
  }
).__netzHorcher;

// beforeEach, nicht afterEach: Die automatische Abräumung von RNTL hängt den Baum erst nach den afterEach-Hooks aus
beforeEach(() => {
  netzHorcher.forEach((melden) => melden({ isConnected: true }));
  queryClient.clear();
});

test("Eltern sehen die Zeilen nach API-Reihenfolge, ohne Stufenfilter", async () => {
  mockeNetz({
    "/ich": () => json(200, PERSONAS.eltern),
    "/programme": () => json(200, { programme: [WALD, LAGER] }),
  });
  await starte();

  expect(
    await screen.findByRole("button", {
      name: `Waldtag, ${WALD_ZEIT}, Falken`,
    }),
  ).toBeOnTheScreen();
  expect(
    screen.getByRole("button", {
      name: "Herbstlager, Samstag, 10. Oktober 2026 bis Samstag, 17. Oktober 2026, Falken, Pinguine",
    }),
  ).toBeOnTheScreen();
  // Die Liste hält zwei Stufen, aber Eltern bekommen keinen Filter
  expect(screen.queryByText("Stufe")).toBeNull();
});

test("die Liste fragt das Fenster heute bis heute + 400 Tage ab", async () => {
  mockeNetz({
    "/ich": () => json(200, PERSONAS.eltern),
    "/programme": () => json(200, { programme: [] }),
  });
  await starte();
  await screen.findByText("Keine kommenden Programme.");

  const aufruf = netz.mock.calls
    .map(([eingabe]) =>
      String(eingabe instanceof Request ? eingabe.url : eingabe),
    )
    .find((url) => new URL(url).pathname.endsWith("/programme"));
  const abfrage = new URL(aufruf!).searchParams;
  expect(abfrage.get("von")).toBe(tagInZuerich(new Date()));
  expect(abfrage.get("bis")).toBe(
    tagInZuerich(new Date(Date.now() + 400 * 86_400_000)),
  );
});

test("Leitende filtern die geladene Liste nach Stufe; ohne Stufe zählt nur «Alle»", async () => {
  mockeNetz({
    "/ich": () => json(200, PERSONAS.leitende),
    "/programme": () =>
      json(200, { programme: [WALD, LAGER, ABGESAGT, OHNE_STUFE] }),
  });
  await starte();

  expect(await screen.findByText("Stufe")).toBeOnTheScreen();
  // Abgesagte bleiben sichtbar, mit Hinweis im Namen
  expect(
    screen.getByRole("button", {
      name: `Nachtwanderung, Abgesagt, ${WALD_ZEIT}, Pinguine`,
    }),
  ).toBeOnTheScreen();

  await fireEvent.press(
    screen.getByRole("button", { name: "Pinguine, Stufenfilter" }),
  );
  // Ein Programm mit mehreren Stufen erscheint unter jeder
  expect(screen.getByText("Herbstlager")).toBeOnTheScreen();
  expect(screen.getByText("Nachtwanderung")).toBeOnTheScreen();
  expect(screen.queryByText("Waldtag")).toBeNull();
  expect(screen.queryByText("Leitungsanlass")).toBeNull();

  await fireEvent.press(
    screen.getByRole("button", { name: "Alle, Stufenfilter" }),
  );
  expect(screen.getByText("Waldtag")).toBeOnTheScreen();
  expect(screen.getByText("Leitungsanlass")).toBeOnTheScreen();
});

test("mit nur einer Stufe in der Liste gibt es keinen Filter", async () => {
  mockeNetz({
    "/ich": () => json(200, PERSONAS.sl),
    "/programme": () => json(200, { programme: [WALD] }),
  });
  await starte();

  await screen.findByText("Waldtag");
  expect(screen.queryByText("Stufe")).toBeNull();
});

test.each(["sl", "admin"] as const)(
  "%s sieht den Stufenfilter ab zwei Stufen",
  async (persona) => {
    mockeNetz({
      "/ich": () => json(200, PERSONAS[persona]),
      "/programme": () => json(200, { programme: [WALD, ABGESAGT] }),
    });
    await starte();

    expect(await screen.findByText("Stufe")).toBeOnTheScreen();
  },
);

test("beim Laden steht «Wird geladen …»", async () => {
  mockeNetz({ "/ich": () => json(200, PERSONAS.eltern) });
  netz.mockImplementation(() => new Promise(() => {}));
  await starte();

  expect(screen.getByText("Wird geladen …")).toBeOnTheScreen();
});

test("ein Fehler zeigt «Nochmals versuchen», und der Knopf lädt neu", async () => {
  mockeNetz({
    "/ich": () => json(200, PERSONAS.eltern),
    "/programme": () =>
      json(400, { code: "UNGUELTIGE_EINGABE", message: "Ungültige Eingabe" }),
  });
  await starte();
  expect(
    await screen.findByText("Das Laden hat nicht geklappt."),
  ).toBeOnTheScreen();

  mockeNetz({
    "/ich": () => json(200, PERSONAS.eltern),
    "/programme": () => json(200, { programme: [WALD] }),
  });
  await fireEvent.press(
    screen.getByRole("button", { name: "Nochmals versuchen" }),
  );
  expect(await screen.findByText("Waldtag")).toBeOnTheScreen();
});

test("offline bleiben die geladenen Zeilen stehen, mit Meldung", async () => {
  mockeNetz({
    "/ich": () => json(200, PERSONAS.eltern),
    "/programme": () => json(200, { programme: [WALD] }),
  });
  await starte();
  await screen.findByText("Waldtag");

  await act(async () =>
    netzHorcher.forEach((melden) => melden({ isConnected: false })),
  );

  expect(
    await screen.findByText(
      "Keine Internetverbindung. Die App zeigt die zuletzt geladenen Daten. Ändern geht erst wieder mit Internet.",
    ),
  ).toBeOnTheScreen();
  expect(screen.getByText("Waldtag")).toBeOnTheScreen();
});
