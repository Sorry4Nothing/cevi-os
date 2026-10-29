import { QueryClientProvider } from "@tanstack/react-query";
import { Slot } from "expo-router";
import {
  act,
  fireEvent,
  renderRouter,
  screen,
} from "expo-router/testing-library";
import { AccessibilityInfo } from "react-native";

import Detail from "../app/(tabs)/programme/[id]";
import Liste from "../app/(tabs)/programme/index";
import NichtZugeordnet from "../app/(tabs)/programme/nicht-zugeordnet";
import { queryClient } from "../src/api/client";
import type { Auswahlstand } from "../src/api/programme";
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

const starte = (url = "/programme/p1") =>
  renderRouter(
    {
      _layout: Wurzel,
      "programme/index": Liste,
      "programme/nicht-zugeordnet": NichtZugeordnet,
      "programme/[id]": Detail,
    },
    { initialUrl: url },
  );

const STUFEN = {
  stufen: [
    { ...FALKEN, kuerzel: "F", reihenfolge: 1 },
    { ...PINGUINE, kuerzel: "P", reihenfolge: 2 },
  ],
};
const NEU = programm({
  id: "p1",
  titel: "Neuer Termin",
  sichtbarkeit: "intern",
});
const OHNE_BERECHTIGUNG = {
  code: "KEINE_BERECHTIGUNG",
  message: "Keine Berechtigung.",
};
const NICHT_GEFUNDEN = { code: "NICHT_GEFUNDEN", message: "Nicht gefunden." };

const netzHorcher = (
  jest.requireMock("expo-network") as {
    __netzHorcher: Set<(stand: { isConnected: boolean }) => void>;
  }
).__netzHorcher;

// Die PUT-Anfragen an die Zuordnung, wie sie das Netz erreichten
const puts = () =>
  netz.mock.calls
    .map(([url, init]) => [String(url), init as RequestInit] as const)
    .filter(([, init]) => init.method === "PUT");
const putKoerper = () =>
  puts().map(([, init]) => JSON.parse(init.body as string));
const aufrufe = (endung: string) =>
  netz.mock.calls.filter(
    ([url, init]) =>
      String(url).endsWith(endung) && (init?.method ?? "GET") === "GET",
  ).length;

// Der Stand auf dem Server, den die Attrappe beim PUT ändert
function server(
  persona: keyof typeof PERSONAS,
  start: Partial<Parameters<typeof programm>[0]> = {},
  zuordnung: () => Response = () => new Response(null, { status: 204 }),
  // Was der Server aus der Auswahl macht; sonst übernimmt er sie
  speichere = (koerper: Auswahlstand) => koerper,
) {
  let stand = { ...NEU, ...start };
  mockeNetz({
    "/ich": () => json(200, PERSONAS[persona]),
    "/stufen": () => json(200, STUFEN),
    "/programme": () => json(200, { programme: [stand] }),
    "/programme/p1": () => json(200, stand),
    "/programme/p1/zuordnung": () => {
      const antwort = zuordnung();
      if (antwort.ok) {
        const koerper = speichere(putKoerper().at(-1));
        stand = {
          ...stand,
          sichtbarkeit: koerper.sichtbarkeit,
          stufen: STUFEN.stufen
            .filter((s) => koerper.stufen.includes(s.id))
            .map(({ id, name }) => ({ id, name })),
        };
      }
      return antwort;
    },
  });
}

// beforeEach, nicht afterEach: Die automatische Abräumung von RNTL hängt den Baum erst nach den afterEach-Hooks aus
beforeEach(() => {
  jest.clearAllMocks();
  netzHorcher.forEach((melden) => melden({ isConnected: true }));
  queryClient.clear();
});
afterEach(() => jest.restoreAllMocks());

const waehle = async (name: string) =>
  fireEvent.press(await screen.findByRole("button", { name }));
const speichern = () => waehle("Zuordnung speichern");

describe("Abschnitt «Zuordnung» nach Rolle", () => {
  test.each(["leitende", "eltern"] as const)(
    "%s sehen ihn nicht und laden die Stufen nicht",
    async (persona) => {
      server(persona);
      await starte();

      await screen.findByRole("header", { name: "Neuer Termin" });
      await act(async () => {});
      expect(screen.queryByRole("header", { name: "Zuordnung" })).toBeNull();
      expect(
        screen.queryByRole("button", { name: "Zuordnung speichern" }),
      ).toBeNull();
      expect(aufrufe("/stufen")).toBe(0);
    },
  );

  test("SL: nur die Stufe, für die sie SL ist, und die Sichtbarkeit", async () => {
    server("sl");
    await starte();

    expect(
      await screen.findByRole("header", { name: "Zuordnung" }),
    ).toBeOnTheScreen();
    expect(
      await screen.findByRole("button", {
        name: "Ja, Falken",
        selected: false,
      }),
    ).toBeOnTheScreen();
    expect(
      screen.getByRole("button", { name: "Nein, Falken" }),
    ).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: /Pinguine/ })).toBeNull();
    expect(
      screen.getByRole("button", {
        name: "Intern, Sichtbarkeit",
        selected: true,
      }),
    ).toBeOnTheScreen();
    expect(
      screen.getByText(
        "Intern: nur Admins und SL. Leitende: dazu die Leitenden der gewählten Stufen. Eltern: dazu die Eltern mit einem Kind in einer gewählten Stufe.",
      ),
    ).toBeOnTheScreen();
    expect(
      screen.getByRole("button", { name: "Zuordnung speichern" }),
    ).toBeOnTheScreen();
  });

  test("Admin: jede Stufe, auch zu einem Programm mit mehreren Stufen, und die Sichtbarkeit", async () => {
    server("admin", { stufen: [FALKEN, PINGUINE], sichtbarkeit: "leitende" });
    await starte();

    expect(
      await screen.findByRole("button", { name: "Ja, Falken", selected: true }),
    ).toBeOnTheScreen();
    expect(
      screen.getByRole("button", { name: "Ja, Pinguine", selected: true }),
    ).toBeOnTheScreen();
    expect(
      screen.getByRole("button", {
        name: "Leitende, Sichtbarkeit",
        selected: true,
      }),
    ).toBeOnTheScreen();
    expect(screen.queryByText(/Auch zugeordnet/)).toBeNull();
  });

  test("SL auf einem Programm einer anderen Stufe: nur lesen, was ihr nicht gehört", async () => {
    server("sl", { stufen: [PINGUINE], sichtbarkeit: "eltern" });
    await starte();

    expect(
      await screen.findByText("Auch zugeordnet: Pinguine"),
    ).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: /Pinguine/ })).toBeNull();
    expect(screen.getByText("Sichtbarkeit: Eltern")).toBeOnTheScreen();
    expect(
      screen.getByText(
        "Die Sichtbarkeit ändern hier nur Admins, weil das Programm auch anderen Stufen gehört.",
      ),
    ).toBeOnTheScreen();
    expect(
      screen.queryByRole("button", { name: /, Sichtbarkeit$/ }),
    ).toBeNull();

    // Ihre Stufe kommt dazu, die fremde bleibt in der Auswahl
    await waehle("Ja, Falken");
    await speichern();
    await act(async () => {});
    expect(putKoerper()).toEqual([
      { stufen: [PINGUINE.id, FALKEN.id], sichtbarkeit: "eltern" },
    ]);
  });

  test("SL darf bei einem Programm ohne Stufe auch die Sichtbarkeit setzen", async () => {
    server("sl");
    await starte();

    expect(
      await screen.findByRole("button", { name: "Eltern, Sichtbarkeit" }),
    ).toBeOnTheScreen();
    expect(screen.queryByText(/Auch zugeordnet/)).toBeNull();
  });
});

describe("Zuordnen und freigeben", () => {
  test("SL: Eingang → Programm → Stufe und Eltern → speichern; der Eingang leert sich, die Ansage bleibt", async () => {
    server("sl");
    await starte("/programme");

    await fireEvent.press(
      await screen.findByRole("button", {
        name: "Nicht zugeordnet, 1 Programm",
      }),
    );
    await fireEvent.press(await screen.findByText("Neuer Termin"));
    await screen.findByRole("header", { name: "Zuordnung" });
    await waehle("Ja, Falken");
    await waehle("Eltern, Sichtbarkeit");
    await speichern();

    expect(await screen.findByText("Zuordnung gespeichert.")).toBeOnTheScreen();
    expect(putKoerper()).toEqual([
      { stufen: [FALKEN.id], sichtbarkeit: "eltern" },
    ]);
    expect(puts()[0][0]).toBe(
      "https://cevi-os.invalid/api/v1/programme/p1/zuordnung",
    );
    await fireEvent.press(screen.getByRole("button", { name: "Zurück" }));
    expect(
      await screen.findByText("Keine Programme ohne Stufe."),
    ).toBeOnTheScreen();
  });

  test("der Stand vom Server ersetzt die Auswahl, die Ansage bleibt", async () => {
    server("sl", {}, undefined, () => ({
      stufen: [FALKEN.id],
      sichtbarkeit: "leitende",
    }));
    await starte();
    await waehle("Eltern, Sichtbarkeit");
    await waehle("Ja, Falken");
    await speichern();

    expect(
      await screen.findByRole("button", {
        name: "Leitende, Sichtbarkeit",
        selected: true,
      }),
    ).toBeOnTheScreen();
    expect(screen.getByText("Zuordnung gespeichert.")).toBeOnTheScreen();
  });

  test("die Ansage verschwindet, sobald die Auswahl sich ändert", async () => {
    server("sl");
    await starte();
    await fireEvent.press(
      await screen.findByRole("button", { name: "Ja, Falken" }),
    );
    await speichern();
    await screen.findByText("Zuordnung gespeichert.");

    await waehle("Nein, Falken");

    expect(screen.queryByText("Zuordnung gespeichert.")).toBeNull();
  });

  test("ohne Änderung geht die ganze Auswahl trotzdem raus", async () => {
    server("sl", { stufen: [FALKEN], sichtbarkeit: "leitende" });
    await starte();
    await screen.findByRole("button", { name: "Ja, Falken", selected: true });

    await speichern();

    await screen.findByText("Zuordnung gespeichert.");
    expect(putKoerper()).toEqual([
      { stufen: [FALKEN.id], sichtbarkeit: "leitende" },
    ]);
  });

  test("während des Sendens ist der Knopf gesperrt", async () => {
    server("sl");
    await starte();
    await screen.findByRole("button", { name: "Ja, Falken" });
    const basis = netz.getMockImplementation()!;
    netz.mockImplementation((url: unknown, init?: RequestInit) =>
      init?.method === "PUT" ? new Promise(() => {}) : basis(url, init),
    );

    await speichern();

    expect(
      await screen.findByRole("button", {
        name: "Zuordnung speichern",
        disabled: true,
      }),
    ).toBeOnTheScreen();
  });
});

describe("Fehler", () => {
  // Wie oft eine Meldung den Fokus bekam
  const fokusse = (text: string) =>
    jest
      .mocked(AccessibilityInfo.sendAccessibilityEvent)
      .mock.calls.filter(
        ([element, art]) =>
          art === "focus" &&
          (element as unknown as { props: { children: string } }).props
            .children === text,
      ).length;

  test("keine Stufe, aber Eltern: Text bei der Sichtbarkeit, keine Anfrage, Fokus jedes Mal", async () => {
    const text = "Ohne Stufe ist nur die Sichtbarkeit Intern möglich.";
    server("sl");
    await starte();
    await waehle("Eltern, Sichtbarkeit");

    await speichern();
    expect(screen.getByText(text)).toBeOnTheScreen();
    expect(fokusse(text)).toBe(1);
    await speichern();
    expect(screen.getByText(text)).toBeOnTheScreen();
    expect(fokusse(text)).toBe(2);
    expect(puts()).toHaveLength(0);

    // Mit Stufe geht es raus, und der Text verschwindet
    await waehle("Ja, Falken");
    await speichern();
    await screen.findByText("Zuordnung gespeichert.");
    expect(screen.queryByText(text)).toBeNull();
  });

  test("offline: Der Text steht da und hat den Fokus, die Anfrage wurde versucht", async () => {
    const text =
      "Keine Internetverbindung. Die Zuordnung ist nicht gespeichert.";
    server("sl", {}, () => {
      throw new TypeError("Network request failed");
    });
    await starte();
    await waehle("Ja, Falken");
    await act(async () =>
      netzHorcher.forEach((melden) => melden({ isConnected: false })),
    );

    await speichern();

    expect(await screen.findByText(text)).toBeOnTheScreen();
    expect(fokusse(text)).toBe(1);
    expect(puts()).toHaveLength(1);
    // Nichts wartet auf Netz: Der Knopf ist wieder frei
    expect(
      screen.getByRole("button", {
        name: "Zuordnung speichern",
        disabled: false,
      }),
    ).toBeOnTheScreen();
  });

  test("403: Text, Detail und Profil laden neu", async () => {
    server("sl", {}, () => json(403, OHNE_BERECHTIGUNG));
    await starte();
    await waehle("Ja, Falken");
    expect([aufrufe("/programme/p1"), aufrufe("/ich")]).toEqual([1, 1]);

    await speichern();

    expect(
      await screen.findByText("Diese Änderung ist nicht erlaubt."),
    ).toBeOnTheScreen();
    await act(async () => {});
    expect([aufrufe("/programme/p1"), aufrufe("/ich")]).toEqual([2, 2]);
  });

  test("404: Das Programm gilt als nicht mehr sichtbar", async () => {
    let sichtbar = true;
    server("sl", {}, () => {
      sichtbar = false;
      return json(404, NICHT_GEFUNDEN);
    });
    const basis = netz.getMockImplementation()!;
    netz.mockImplementation((url: unknown, init?: RequestInit) =>
      !sichtbar && String(url).endsWith("/programme/p1")
        ? json(404, NICHT_GEFUNDEN)
        : basis(url, init),
    );
    await starte();
    await waehle("Ja, Falken");

    await speichern();

    expect(
      await screen.findByText("Dieses Programm ist nicht mehr sichtbar."),
    ).toBeOnTheScreen();
  });

  test("anderer Fehler: allgemeiner Text", async () => {
    server("sl", {}, () =>
      json(400, { code: "UNGUELTIGE_EINGABE", message: "Ungültig." }),
    );
    await starte();
    await waehle("Ja, Falken");

    await speichern();

    expect(
      await screen.findByText(
        "Die Zuordnung ist nicht gespeichert. Bitte nochmals versuchen.",
      ),
    ).toBeOnTheScreen();
  });
});

describe("Stufen laden", () => {
  test("solange sie laden, steht ein Text", async () => {
    server("sl");
    const basis = netz.getMockImplementation()!;
    netz.mockImplementation((url: unknown, init?: RequestInit) =>
      String(url).endsWith("/stufen")
        ? new Promise(() => {})
        : basis(url, init),
    );
    await starte();

    expect(
      await screen.findByText("Die Stufen werden geladen …"),
    ).toBeOnTheScreen();
    expect(
      screen.queryByRole("button", { name: "Zuordnung speichern" }),
    ).toBeNull();
  });

  test("scheitert das Laden, hilft «Nochmals versuchen»", async () => {
    server("sl");
    const basis = netz.getMockImplementation()!;
    let geht = false;
    netz.mockImplementation((url: unknown, init?: RequestInit) =>
      String(url).endsWith("/stufen") && !geht
        ? json(400, { code: "UNGUELTIGE_EINGABE", message: "Fehler" })
        : basis(url, init),
    );
    await starte();
    expect(
      await screen.findByText("Die Stufen liessen sich nicht laden."),
    ).toBeOnTheScreen();

    geht = true;
    await fireEvent.press(
      screen.getByRole("button", { name: "Nochmals versuchen" }),
    );

    expect(
      await screen.findByRole("button", { name: "Ja, Falken" }),
    ).toBeOnTheScreen();
  });
});
