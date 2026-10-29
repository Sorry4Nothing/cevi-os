import { QueryClientProvider } from "@tanstack/react-query";
import { Slot } from "expo-router";
import {
  act,
  fireEvent,
  renderRouter,
  screen,
} from "expo-router/testing-library";

import Detail from "../app/(tabs)/programme/[id]";
import Liste from "../app/(tabs)/programme/index";
import NichtZugeordnet from "../app/(tabs)/programme/nicht-zugeordnet";
import Pruefen from "../app/(tabs)/programme/pruefen";
import { queryClient } from "../src/api/client";
import {
  FALKEN,
  json,
  mockeNetz,
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

const starte = (url: string) =>
  renderRouter(
    {
      _layout: Wurzel,
      "programme/index": Liste,
      "programme/nicht-zugeordnet": NichtZugeordnet,
      "programme/pruefen": Pruefen,
      "programme/[id]": Detail,
    },
    { initialUrl: url },
  );

const NEU = programm({
  id: "p1",
  titel: "Neuer Termin",
  sichtbarkeit: "intern",
});
const MIT_STUFE = programm({
  id: "p2",
  titel: "Entwurf Lager",
  sichtbarkeit: "intern",
  stufen: [FALKEN],
});
const NUR_LEITENDE = programm({
  id: "p3",
  titel: "Leitungsabend",
  sichtbarkeit: "leitende",
});
const VERSCHWUNDEN = programm({
  id: "p4",
  titel: "Verschwundener Termin",
  status: "pruefen",
  stufen: [PINGUINE],
});
const ZUM_PRUEFEN_INTERN = programm({
  id: "p5",
  titel: "Unklarer Termin",
  status: "pruefen",
  sichtbarkeit: "intern",
});
const ALLE = [NEU, MIT_STUFE, NUR_LEITENDE, VERSCHWUNDEN, ZUM_PRUEFEN_INTERN];

const netzHorcher = (
  jest.requireMock("expo-network") as {
    __netzHorcher: Set<(stand: { isConnected: boolean }) => void>;
  }
).__netzHorcher;

// beforeEach, nicht afterEach: Die automatische Abräumung von RNTL hängt den Baum erst nach den afterEach-Hooks aus
beforeEach(() => {
  jest.clearAllMocks();
  netzHorcher.forEach((melden) => melden({ isConnected: true }));
  queryClient.clear();
});
afterEach(() => jest.restoreAllMocks());

const mockeAls = (
  persona: keyof typeof PERSONAS,
  programme: ReturnType<typeof programm>[] = ALLE,
) =>
  mockeNetz({
    "/ich": () => json(200, PERSONAS[persona]),
    "/programme": () => json(200, { programme }),
  });

describe("Karte «Eingänge» in der Liste", () => {
  test.each(["admin", "sl"] as const)(
    "%s sieht beide Eingänge mit der Anzahl",
    async (persona) => {
      mockeAls(persona);
      await starte("/programme");

      expect(
        await screen.findByRole("header", { name: "Eingänge" }),
      ).toBeOnTheScreen();
      expect(
        screen.getByRole("button", { name: "Nicht zugeordnet, 2 Programme" }),
      ).toBeOnTheScreen();
      expect(
        screen.getByRole("button", { name: "Prüfen, 2 Programme" }),
      ).toBeOnTheScreen();
    },
  );

  test.each(["leitende", "eltern"] as const)(
    "%s sehen keine Eingänge",
    async (persona) => {
      mockeAls(persona);
      await starte("/programme");

      await screen.findByText("Neuer Termin");
      expect(screen.queryByText("Eingänge")).toBeNull();
      expect(screen.queryByText("Nicht zugeordnet")).toBeNull();
      expect(screen.queryByText("Prüfen")).toBeNull();
    },
  );

  test("Anzahl: eines", async () => {
    mockeAls("sl", [NEU, VERSCHWUNDEN]);
    await starte("/programme");

    expect(
      await screen.findByRole("button", {
        name: "Nicht zugeordnet, 1 Programm",
      }),
    ).toBeOnTheScreen();
    expect(
      screen.getByRole("button", { name: "Prüfen, 1 Programm" }),
    ).toBeOnTheScreen();
  });

  test("Anzahl: keine", async () => {
    mockeAls("sl", [MIT_STUFE]);
    await starte("/programme");

    expect(
      await screen.findByRole("button", {
        name: "Nicht zugeordnet, keine Programme",
      }),
    ).toBeOnTheScreen();
    expect(
      screen.getByRole("button", { name: "Prüfen, keine Programme" }),
    ).toBeOnTheScreen();
  });

  test("der Stufenfilter gilt nicht für die Eingänge", async () => {
    mockeAls("admin");
    await starte("/programme");
    await fireEvent.press(
      await screen.findByRole("button", { name: "Pinguine, Stufenfilter" }),
    );

    expect(
      screen.getByRole("button", { name: "Nicht zugeordnet, 2 Programme" }),
    ).toBeOnTheScreen();
  });

  test("eine Zeile öffnet ihren Eingang", async () => {
    mockeAls("sl");
    await starte("/programme");

    await fireEvent.press(
      await screen.findByRole("button", { name: /^Prüfen, / }),
    );

    expect(screen).toHavePathname("/programme/pruefen");
    expect(
      await screen.findByRole("header", { name: "Prüfen" }),
    ).toBeOnTheScreen();
  });
});

describe("Eingang «Nicht zugeordnet»", () => {
  test.each(["admin", "sl"] as const)(
    "%s sieht nur intern ohne Stufe, egal welcher Status, mit dem Hinweis",
    async (persona) => {
      mockeAls(persona);
      await starte("/programme/nicht-zugeordnet");

      expect(await screen.findByText("Neuer Termin")).toBeOnTheScreen();
      expect(
        screen.getByRole("header", { name: "Nicht zugeordnet" }),
      ).toBeOnTheScreen();
      expect(
        screen.getByText(
          "Neue Termine aus dem Kalender sind intern und keiner Stufe zugeordnet. Leitende und Eltern sehen sie erst nach der Zuordnung.",
        ),
      ).toBeOnTheScreen();
      expect(screen.getByText("Unklarer Termin")).toBeOnTheScreen();
      // Mit Stufe, nur für Leitende und mit Status «prüfen» plus Stufe gehören nicht hierher
      expect(screen.queryByText("Entwurf Lager")).toBeNull();
      expect(screen.queryByText("Leitungsabend")).toBeNull();
      expect(screen.queryByText("Verschwundener Termin")).toBeNull();
    },
  );

  test("Reihenfolge der API; eine Zeile öffnet das Programm", async () => {
    mockeNetz({
      "/ich": () => json(200, PERSONAS.sl),
      "/programme": () => json(200, { programme: ALLE }),
      "/programme/p1": () => json(200, NEU),
    });
    await starte("/programme/nicht-zugeordnet");
    await screen.findByText("Neuer Termin");

    expect(screen.getAllByText(/Termin$/).map((t) => t.props.children)).toEqual(
      ["Neuer Termin", "Unklarer Termin"],
    );

    await fireEvent.press(screen.getByText("Neuer Termin"));

    expect(screen).toHavePathname("/programme/p1");
  });

  test.each(["leitende", "eltern"] as const)(
    "%s sehen auch bei einem Direktlink keine Zeilen",
    async (persona) => {
      mockeAls(persona);
      await starte("/programme/nicht-zugeordnet");

      expect(
        await screen.findByText("Keine Programme ohne Stufe."),
      ).toBeOnTheScreen();
      expect(screen.queryByText("Neuer Termin")).toBeNull();
    },
  );

  test("ohne Treffer steht der Leertext", async () => {
    mockeAls("sl", [MIT_STUFE]);
    await starte("/programme/nicht-zugeordnet");

    expect(
      await screen.findByText("Keine Programme ohne Stufe."),
    ).toBeOnTheScreen();
  });
});

describe("Eingang «Prüfen»", () => {
  test.each(["admin", "sl"] as const)(
    "%s sieht jedes Programm mit Status prüfen, egal welche Sichtbarkeit oder Stufe",
    async (persona) => {
      mockeAls(persona);
      await starte("/programme/pruefen");

      expect(
        await screen.findByText("Verschwundener Termin"),
      ).toBeOnTheScreen();
      expect(screen.getByRole("header", { name: "Prüfen" })).toBeOnTheScreen();
      expect(
        screen.getByText(
          "Diese Termine fehlen im Kalender, und es gibt keinen passenden neuen Termin. Bitte im Kalender nachsehen.",
        ),
      ).toBeOnTheScreen();
      expect(screen.getByText("Unklarer Termin")).toBeOnTheScreen();
      expect(screen.queryByText("Neuer Termin")).toBeNull();
      expect(screen.queryByText("Entwurf Lager")).toBeNull();
    },
  );

  test.each(["leitende", "eltern"] as const)(
    "%s sehen keine Zeilen",
    async (persona) => {
      mockeAls(persona);
      await starte("/programme/pruefen");

      expect(
        await screen.findByText("Keine Programme zum Prüfen."),
      ).toBeOnTheScreen();
      expect(screen.queryByText("Verschwundener Termin")).toBeNull();
    },
  );

  test("ohne Treffer steht der Leertext", async () => {
    mockeAls("admin", [NEU]);
    await starte("/programme/pruefen");

    expect(
      await screen.findByText("Keine Programme zum Prüfen."),
    ).toBeOnTheScreen();
  });
});

describe.each([
  ["/programme/nicht-zugeordnet", "Nicht zugeordnet"],
  ["/programme/pruefen", "Prüfen"],
])("Zustände von %s", (pfad, titel) => {
  test("beim Laden steht «Wird geladen …»", async () => {
    mockeNetz({ "/ich": () => json(200, PERSONAS.sl) });
    jest.mocked(global.fetch).mockImplementation(() => new Promise(() => {}));
    await starte(pfad);

    expect(screen.getByText("Wird geladen …")).toBeOnTheScreen();
  });

  test("ein Fehler zeigt «Nochmals versuchen», und der Knopf lädt neu", async () => {
    mockeNetz({
      "/ich": () => json(200, PERSONAS.sl),
      "/programme": () =>
        json(400, { code: "UNGUELTIGE_EINGABE", message: "Fehler" }),
    });
    await starte(pfad);
    expect(
      await screen.findByText("Das Laden hat nicht geklappt."),
    ).toBeOnTheScreen();

    mockeAls("sl");
    await fireEvent.press(
      screen.getByRole("button", { name: "Nochmals versuchen" }),
    );

    expect(await screen.findByText("Unklarer Termin")).toBeOnTheScreen();
  });

  test("offline bleiben die Zeilen stehen, mit Meldung", async () => {
    mockeAls("sl");
    await starte(pfad);
    await screen.findByText("Unklarer Termin");

    await act(async () =>
      netzHorcher.forEach((melden) => melden({ isConnected: false })),
    );

    expect(screen.getByText("Unklarer Termin")).toBeOnTheScreen();
    expect(
      screen.getByText(/^Keine Internetverbindung\. Die App zeigt/),
    ).toBeOnTheScreen();
  });

  test("«Zurück» geht zur Liste", async () => {
    mockeAls("sl");
    await starte("/programme");
    await fireEvent.press(
      await screen.findByRole("button", { name: new RegExp(`^${titel}, `) }),
    );
    await screen.findByRole("header", { name: titel });

    await fireEvent.press(screen.getByRole("button", { name: "Zurück" }));

    expect(screen).toHavePathname("/programme");
  });
});
