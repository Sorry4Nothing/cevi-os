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
  netz,
  PERSONAS,
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

const WALD = programmDetail({
  id: "p1",
  titel: "Waldtag",
  stufen: [FALKEN],
  googleOrt: "Bahnhof Aarau",
});
const NICHT_ERLAUBT = "Diese Änderung ist nicht erlaubt.";
const NICHT_GESPEICHERT =
  "Die Ergänzungen sind nicht gespeichert. Bitte nochmals versuchen.";
const OFFLINE =
  "Keine Internetverbindung. Die Ergänzungen sind nicht gespeichert.";
const ZEIT_FEHLER = "Bitte eine Uhrzeit wie 16:30 eingeben.";
const FELDER = [
  "Treffpunkt",
  "Schlussort",
  "Schlusszeit, z. B. 16:30",
  "Mitnehmen",
  "Info für Eltern",
];

const netzHorcher = (
  jest.requireMock("expo-network") as {
    __netzHorcher: Set<(stand: { isConnected: boolean }) => void>;
  }
).__netzHorcher;

// Der Stand auf dem Server; GET und PATCH treffen denselben Pfad, darum entscheidet die Methode.
// Ein PATCH mit 204 übernimmt den Körper in den Stand, wie es die API tut
function server(
  start: Partial<Parameters<typeof programmDetail>[0]> & {
    darfErgaenzen?: boolean;
  },
  patch: () => Response = () => new Response(null, { status: 204 }),
) {
  const stand = { ...WALD, darfErgaenzen: true, ...start } as Record<
    string,
    unknown
  >;
  netz.mockImplementation(async (eingabe: unknown, init?: RequestInit) => {
    const pfad = new URL(String(eingabe)).pathname;
    if (pfad.endsWith("/ich")) return json(200, PERSONAS.eltern);
    if (!pfad.endsWith("/programme/p1")) throw new Error(`Kein Netz: ${pfad}`);
    if (init?.method === "PATCH") {
      const antwort = patch();
      if (antwort.ok) {
        Object.assign(stand, JSON.parse(init.body as string));
      }
      return antwort;
    }
    return json(200, stand);
  });
  return stand;
}

// Die PATCH-Anfragen, wie sie das Netz erreichten
const patches = () =>
  netz.mock.calls.filter(([, init]) => init?.method === "PATCH");
const patchKoerper = () =>
  patches().map(([, init]) => JSON.parse((init as RequestInit).body as string));
const aufrufeGet = () =>
  netz.mock.calls.filter(
    ([url, init]) =>
      String(url).endsWith("/programme/p1") && init?.method !== "PATCH",
  ).length;

const fokusse = (text: string) =>
  jest
    .mocked(AccessibilityInfo.sendAccessibilityEvent)
    .mock.calls.filter(
      ([element, art]) =>
        art === "focus" &&
        (element as unknown as { props: { children: string } }).props
          .children === text,
    ).length;

// beforeEach, nicht afterEach: Die automatische Abräumung von RNTL hängt den Baum erst nach den afterEach-Hooks aus
beforeEach(() => {
  jest.clearAllMocks();
  netzHorcher.forEach((melden) => melden({ isConnected: true }));
  queryClient.clear();
});
afterEach(() => jest.restoreAllMocks());

const feld = (name: string) => screen.findByLabelText(name);
const tippe = async (name: string, text: string) =>
  fireEvent.changeText(await feld(name), text);
const speichern = async () =>
  fireEvent.press(
    await screen.findByRole("button", { name: "Ergänzungen speichern" }),
  );

describe.each([["iOS"], ["Android"]] as const)(
  "%s: Formular nach Recht",
  (os) => {
    beforeEach(() => {
      if (os === "Android") jest.replaceProperty(Platform, "OS", "android");
    });

    test("mit darfErgaenzen: Überschrift, fünf Felder und Knopf", async () => {
      server({});
      await starte();

      expect(
        await screen.findByRole("header", { name: "Ergänzungen bearbeiten" }),
      ).toBeOnTheScreen();
      for (const name of FELDER) {
        expect(await feld(name)).toBeOnTheScreen();
      }
      expect(
        screen.getByRole("button", { name: "Ergänzungen speichern" }),
      ).toBeOnTheScreen();
    });

    test("ohne darfErgaenzen (Eltern, SL einer anderen Stufe): nichts davon", async () => {
      server({ darfErgaenzen: false, mitnehmen: "Znüni" });
      await starte();

      await screen.findByText("Znüni");
      expect(
        screen.queryByRole("header", { name: "Ergänzungen bearbeiten" }),
      ).toBeNull();
      for (const name of FELDER) {
        expect(screen.queryByLabelText(name)).toBeNull();
      }
      expect(
        screen.queryByRole("button", { name: "Ergänzungen speichern" }),
      ).toBeNull();
    });

    test("fehlt der Schlüssel (ältere Antwort), zeigt die App das Formular nicht", async () => {
      server({ darfErgaenzen: undefined });
      await starte();

      await screen.findByRole("header", { name: "Waldtag" });
      expect(
        screen.queryByRole("button", { name: "Ergänzungen speichern" }),
      ).toBeNull();
    });
  },
);

describe("Felder", () => {
  test("Treffpunkt bleibt leer, der Hinweis nennt den Ort aus Google", async () => {
    server({});
    await starte();

    expect((await feld("Treffpunkt")).props.value).toBe("");
    expect(
      screen.getByText(
        "Ohne Treffpunkt zeigt die App den Ort aus dem Kalender: Bahnhof Aarau.",
      ),
    ).toBeOnTheScreen();
  });

  test("ohne Ort aus Google kein Hinweis", async () => {
    server({ googleOrt: null });
    await starte();

    await feld("Treffpunkt");
    expect(screen.queryByText(/Ort aus dem Kalender/)).toBeNull();
  });

  test("die Felder zeigen den gespeicherten Stand, die Zeit als HH:MM", async () => {
    server({
      treffpunkt: "Waldhütte",
      schlussOrt: "Bahnhof",
      schlussZeit: "16:30:00",
      mitnehmen: "Znüni",
      infoEltern: "Bei Regen drinnen",
    });
    await starte();

    expect((await feld("Treffpunkt")).props.value).toBe("Waldhütte");
    expect((await feld("Schlussort")).props.value).toBe("Bahnhof");
    expect((await feld("Schlusszeit, z. B. 16:30")).props.value).toBe("16:30");
    expect((await feld("Mitnehmen")).props.value).toBe("Znüni");
    expect((await feld("Info für Eltern")).props.value).toBe(
      "Bei Regen drinnen",
    );
  });

  test("Längen und Tastatur", async () => {
    server({});
    await starte();

    expect((await feld("Treffpunkt")).props.maxLength).toBe(200);
    expect((await feld("Schlussort")).props.maxLength).toBe(200);
    const zeit = await feld("Schlusszeit, z. B. 16:30");
    expect(zeit.props.maxLength).toBe(5);
    expect(zeit.props.keyboardType).toBe("numbers-and-punctuation");
    expect((await feld("Mitnehmen")).props.maxLength).toBe(2000);
    expect((await feld("Info für Eltern")).props.multiline).toBe(true);
  });
});

describe("Speichern", () => {
  test("gesendet wird nur, was sich geändert hat, getrimmt; «9.30» wird «09:30»", async () => {
    server({ mitnehmen: "Znüni" });
    await starte();

    await tippe("Treffpunkt", "  Waldhütte ");
    await tippe("Schlusszeit, z. B. 16:30", "9.30");
    await speichern();

    expect(
      await screen.findByText("Ergänzungen gespeichert."),
    ).toBeOnTheScreen();
    expect(patchKoerper()).toEqual([
      { treffpunkt: "Waldhütte", schlussZeit: "09:30" },
    ]);
  });

  test("ein geleertes Feld geht als null raus", async () => {
    server({ treffpunkt: "Waldhütte", mitnehmen: "Znüni" });
    await starte();

    await tippe("Treffpunkt", "   ");
    await speichern();

    await screen.findByText("Ergänzungen gespeichert.");
    expect(patchKoerper()).toEqual([{ treffpunkt: null }]);
  });

  test("nach dem Speichern gelten die gesendeten Werte als Start: kein zweites Senden ohne Änderung", async () => {
    server({});
    await starte();

    await tippe("Mitnehmen", " Znüni ");
    await speichern();
    await screen.findByText("Ergänzungen gespeichert.");
    expect((await feld("Mitnehmen")).props.value).toBe("Znüni");

    await speichern();
    expect(
      await screen.findByText("Keine Änderung zum Speichern."),
    ).toBeOnTheScreen();
    expect(patches()).toHaveLength(1);
  });

  test("keine Änderung: keine Anfrage, dafür eine Ansage", async () => {
    server({ mitnehmen: "Znüni" });
    await starte();

    await tippe("Mitnehmen", "  Znüni  ");
    await speichern();

    expect(
      await screen.findByText("Keine Änderung zum Speichern."),
    ).toBeOnTheScreen();
    expect(patches()).toHaveLength(0);
  });

  test("Erfolg lädt das Detail neu, der Text bleibt stehen", async () => {
    server({});
    await starte();
    await feld("Treffpunkt");
    expect(aufrufeGet()).toBe(1);

    await tippe("Treffpunkt", "Waldhütte");
    await speichern();

    expect(
      await screen.findByText("Ergänzungen gespeichert."),
    ).toBeOnTheScreen();
    await act(async () => {});
    expect(aufrufeGet()).toBe(2);
    // Das Detail oben zeigt jetzt den Treffpunkt
    expect(await screen.findByText("Waldhütte")).toBeOnTheScreen();
    expect(screen.getByText("Ergänzungen gespeichert.")).toBeOnTheScreen();
  });

  test("Knopf gesperrt, solange gesendet wird", async () => {
    let fertig!: () => void;
    const wartet = new Promise<void>((weiter) => (fertig = weiter));
    const stand = server({});
    const basis = netz.getMockImplementation()!;
    netz.mockImplementation(async (url: unknown, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        await wartet;
        Object.assign(stand, JSON.parse(init.body as string));
        return new Response(null, { status: 204 });
      }
      return basis(url, init);
    });
    await starte();

    await tippe("Mitnehmen", "Znüni");
    await speichern();

    expect(
      await screen.findByRole("button", {
        name: "Ergänzungen speichern",
        disabled: true,
      }),
    ).toBeOnTheScreen();
    await act(async () => fertig());
    expect(
      await screen.findByRole("button", {
        name: "Ergänzungen speichern",
        disabled: false,
      }),
    ).toBeOnTheScreen();
  });
});

describe("Zeit", () => {
  test("«25:00»: Fehler am Feld mit Fokus, keine Anfrage, bei jedem Druck neu", async () => {
    server({});
    await starte();

    await tippe("Schlusszeit, z. B. 16:30", "25:00");
    await speichern();
    expect(await screen.findByText(ZEIT_FEHLER)).toBeOnTheScreen();
    expect(fokusse(ZEIT_FEHLER)).toBe(1);

    await speichern();
    expect(fokusse(ZEIT_FEHLER)).toBe(2);
    expect(patches()).toHaveLength(0);

    // Korrigiert: Der Fehler verschwindet, gesendet wird
    await tippe("Schlusszeit, z. B. 16:30", "16:30");
    await speichern();
    await screen.findByText("Ergänzungen gespeichert.");
    expect(screen.queryByText(ZEIT_FEHLER)).toBeNull();
    expect(patchKoerper()).toEqual([{ schlussZeit: "16:30" }]);
  });

  test("ein ungültiger Wert hält auch die anderen Felder zurück", async () => {
    server({});
    await starte();

    await tippe("Mitnehmen", "Znüni");
    await tippe("Schlusszeit, z. B. 16:30", "abc");
    await speichern();

    expect(await screen.findByText(ZEIT_FEHLER)).toBeOnTheScreen();
    expect(patches()).toHaveLength(0);
  });
});

describe("Neuladen", () => {
  test("ein unberührtes Feld übernimmt den neuen Stand, der Entwurf bleibt", async () => {
    const stand = server({});
    await starte();
    await tippe("Mitnehmen", "Znüni und Wasser");

    // Jemand anders ergänzt den Treffpunkt und das Mitnehmen; die App lädt neu
    stand.treffpunkt = "Waldhütte";
    stand.mitnehmen = "Regenjacke";
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ["programme"] });
    });

    expect(await screen.findByDisplayValue("Waldhütte")).toBe(
      await feld("Treffpunkt"),
    );
    expect(await feld("Mitnehmen")).toHaveDisplayValue("Znüni und Wasser");
  });

  test("ein Neuladen nimmt die Meldung nicht weg", async () => {
    server({});
    await starte();
    await tippe("Mitnehmen", "Znüni");
    await speichern();
    await screen.findByText("Ergänzungen gespeichert.");

    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ["programme"] });
    });

    expect(screen.getByText("Ergänzungen gespeichert.")).toBeOnTheScreen();
  });
});

describe("Fehler", () => {
  test("403: Text mit Fokus, kein Neuladen, das Formular bleibt", async () => {
    server({}, () =>
      json(403, { code: "KEINE_BERECHTIGUNG", message: "Keine Berechtigung." }),
    );
    await starte();
    await tippe("Mitnehmen", "Znüni");
    await feld("Mitnehmen");
    const vorher = aufrufeGet();

    await speichern();

    expect(await screen.findByText(NICHT_ERLAUBT)).toBeOnTheScreen();
    expect(fokusse(NICHT_ERLAUBT)).toBe(1);
    await act(async () => {});
    expect(aufrufeGet()).toBe(vorher);
    expect((await feld("Mitnehmen")).props.value).toBe("Znüni");
    // Der Entwurf geht beim nächsten Druck nochmals raus, die Meldung nimmt den Fokus wieder
    await speichern();
    await waitForFokus(NICHT_ERLAUBT, 2);
  });

  test("500: allgemeiner Text", async () => {
    server({}, () => json(500, { code: "FEHLER", message: "Fehler" }));
    await starte();
    await tippe("Mitnehmen", "Znüni");

    await speichern();

    expect(await screen.findByText(NICHT_GESPEICHERT)).toBeOnTheScreen();
    expect(fokusse(NICHT_GESPEICHERT)).toBe(1);
  });

  test("404: Das Programm gilt als nicht mehr sichtbar", async () => {
    let sichtbar = true;
    server({}, () => {
      sichtbar = false;
      return json(404, { code: "NICHT_GEFUNDEN", message: "Nicht gefunden." });
    });
    const basis = netz.getMockImplementation()!;
    netz.mockImplementation((url: unknown, init?: RequestInit) =>
      !sichtbar && String(url).endsWith("/programme/p1")
        ? json(404, { code: "NICHT_GEFUNDEN", message: "Nicht gefunden." })
        : basis(url, init),
    );
    await starte();
    await tippe("Mitnehmen", "Znüni");

    await speichern();

    expect(
      await screen.findByText("Dieses Programm ist nicht mehr sichtbar."),
    ).toBeOnTheScreen();
  });

  test("offline: Der Text steht sofort da und hat den Fokus, die Anfrage wurde versucht", async () => {
    server({}, () => {
      throw new TypeError("Network request failed");
    });
    await starte();
    await tippe("Mitnehmen", "Znüni");
    await act(async () =>
      netzHorcher.forEach((melden) => melden({ isConnected: false })),
    );

    await speichern();

    expect(await screen.findByText(OFFLINE)).toBeOnTheScreen();
    expect(fokusse(OFFLINE)).toBe(1);
    expect(patches()).toHaveLength(1);
    // Nichts wartet auf Netz: Der Knopf ist wieder frei
    expect(
      screen.getByRole("button", {
        name: "Ergänzungen speichern",
        disabled: false,
      }),
    ).toBeOnTheScreen();
  });
});

// Der zweite Fokus kommt nach dem nächsten Render
async function waitForFokus(text: string, anzahl: number) {
  await screen.findByText(text);
  await act(async () => {});
  expect(fokusse(text)).toBe(anzahl);
}
