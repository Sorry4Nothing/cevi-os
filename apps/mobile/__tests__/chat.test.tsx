import { onlineManager, QueryClientProvider } from "@tanstack/react-query";
import { Slot } from "expo-router";
import {
  act,
  fireEvent,
  renderRouter,
  screen,
  waitFor,
} from "expo-router/testing-library";
import { AccessibilityInfo, Alert } from "react-native";

import Detail from "../app/(tabs)/chat/[id]";
import Liste from "../app/(tabs)/chat/index";
import type { Chat, Nachricht } from "../src/api/chats";
import { queryClient } from "../src/api/client";
import { json, netz, PERSONAS } from "./hilfen/programme";

function Wurzel() {
  return (
    <QueryClientProvider client={queryClient}>
      <Slot />
    </QueryClientProvider>
  );
}

const starteListe = () =>
  renderRouter(
    {
      _layout: Wurzel,
      "chat/index": Liste,
      "chat/[id]": Detail,
      "programme/[id]": () => null,
    },
    { initialUrl: "/chat" },
  );
const starteChat = () =>
  renderRouter(
    {
      _layout: Wurzel,
      "chat/index": Liste,
      "chat/[id]": Detail,
      "programme/[id]": () => null,
    },
    { initialUrl: "/chat/c1" },
  );

const LEITUNG = [
  { id: "sl1", name: "Berta Leiterin" },
  { id: "sl2", name: "Chris Leiter" },
];
const CHAT: Chat = {
  id: "c1",
  typ: "stufe",
  stufe: { id: "s1", name: "Falken", kuerzel: "F" },
  eltern: null,
  stufenleitung: LEITUNG,
};
const EINZEL: Chat = {
  id: "e1",
  typ: "direkt",
  stufe: { id: "s1", name: "Falken", kuerzel: "F" },
  eltern: { id: "u1", name: "Anna Muster" },
  stufenleitung: LEITUNG,
};

// Die IDs ordnen sich wie UUIDv7 nach der Zeit
function nachricht(nr: number, aenderung: Partial<Nachricht> = {}): Nachricht {
  return {
    id: `n${String(nr).padStart(4, "0")}`,
    text: `Text ${nr}`,
    erstelltAm: "2026-10-31T13:30:00.000Z",
    autor: { id: "u2", name: "Anna Muster" },
    programm: null,
    eigene: false,
    ausgeblendet: false,
    ...aenderung,
  };
}

// Der Server liefert jede Seite neueste zuerst
type Seite = { nachrichten: Nachricht[]; naechster: string | null };
let seiten: Record<string, Seite>;
let gesendet: unknown[];
let sendeAntwort: () => Response;
let chatListe: Chat[];
let ichAntwort: unknown;
let beginnen: unknown[];
let beginnenAntwort: () => Response;
let moderiert: string[];
let moderationAntwort: () => Response;

beforeEach(() => {
  jest
    .mocked(AccessibilityInfo.announceForAccessibilityWithOptions)
    .mockClear();
  queryClient.clear();
  netz.mockClear();
  gesendet = [];
  sendeAntwort = () => json(201, { id: "n9999" });
  chatListe = [CHAT];
  ichAntwort = { ...PERSONAS.eltern, id: "u1" };
  beginnen = [];
  beginnenAntwort = () => json(200, { id: "e1" });
  moderiert = [];
  moderationAntwort = () => new Response(null, { status: 204 });
  seiten = { "": { nachrichten: [], naechster: null } };
  netz.mockImplementation(async (eingabe: unknown, init?: RequestInit) => {
    const url = new URL(
      String(eingabe instanceof Request ? eingabe.url : eingabe),
    );
    if (url.pathname.endsWith("/chats")) {
      return json(200, { chats: chatListe });
    }
    if (url.pathname.endsWith("/ich")) return json(200, ichAntwort);
    if (url.pathname.endsWith("/chats/direkt")) {
      beginnen.push(JSON.parse(init?.body as string));
      return beginnenAntwort();
    }
    if (/\/nachrichten\/[^/]+\/(melden|ausblenden)$/.test(url.pathname)) {
      const [, id, aktion] = url.pathname.match(/([^/]+)\/([^/]+)$/)!;
      moderiert.push(`${aktion} ${id}`);
      return moderationAntwort();
    }
    if (url.pathname.endsWith("/chats/e1/nachrichten")) {
      return json(200, seiten[""]);
    }
    if (url.pathname.endsWith("/chats/c1/nachrichten")) {
      if (init?.method === "POST") {
        gesendet.push(JSON.parse(init.body as string));
        return sendeAntwort();
      }
      return json(200, seiten[url.searchParams.get("vor") ?? ""]);
    }
    throw new Error(`Kein Netz im Test: ${url}`);
  });
});
afterEach(() => {
  jest.restoreAllMocks();
  onlineManager.setOnline(true);
});

const tippe = (text: string) =>
  fireEvent.changeText(screen.getByLabelText("Nachricht"), text);
const sendeknopf = () => screen.getByRole("button", { name: "Senden" });
const pollen = () =>
  act(async () => {
    await queryClient.refetchQueries({
      queryKey: ["chats", "c1", "nachrichten"],
    });
  });

describe("Liste", () => {
  test("zeigt den Gruppenchat der Stufe und öffnet ihn", async () => {
    await starteListe();

    await fireEvent.press(
      await screen.findByRole("button", {
        name: "Gruppenchat Falken, Stufenleitung und Eltern",
      }),
    );

    expect(screen).toHavePathname("/chat/c1");
  });

  test("Einzelchats stehen unter dem Gruppenchat, für das Elternteil mit der Stufenleitung", async () => {
    chatListe = [CHAT, EINZEL];
    await starteListe();

    const knopf = await screen.findByRole("button", {
      name: "Stufenleitung Falken, Liest: 2 Personen",
    });
    expect(
      screen.getByRole("header", { name: "Einzelchats" }),
    ).toBeOnTheScreen();
    expect(
      screen.getByRole("header", { name: "Gruppenchats" }),
    ).toBeOnTheScreen();
    await fireEvent.press(knopf);
    expect(screen).toHavePathname("/chat/e1");
  });

  test("die SL sieht den Namen des Elternteils", async () => {
    ichAntwort = { ...PERSONAS.sl, id: "sl1" };
    chatListe = [CHAT, EINZEL];
    await starteListe();

    expect(
      await screen.findByRole("button", {
        name: "Anna Muster, Falken, Liest: 2 Personen",
      }),
    ).toBeOnTheScreen();
  });

  test("ohne Einzelchat gibt es keine Abschnittsüberschriften", async () => {
    await starteListe();
    await screen.findByRole("button", { name: /^Gruppenchat Falken/ });

    expect(screen.queryByRole("header", { name: "Einzelchats" })).toBeNull();
  });

  test("ohne Chat steht ein Hinweis", async () => {
    netz.mockImplementation(async () => json(200, { chats: [] }));
    await starteListe();

    expect(
      await screen.findByText("Hier erscheinen die Chats deiner Stufen."),
    ).toBeOnTheScreen();
  });
});

describe("Verlauf", () => {
  test("zeigt die Nachrichten von alt nach neu mit Name und Zeit in Schweizer Zeit", async () => {
    seiten[""] = {
      nachrichten: [
        nachricht(2, { eigene: true, autor: { id: "u1", name: "Ich" } }),
        nachricht(1),
      ],
      naechster: null,
    };
    await starteChat();

    expect(
      await screen.findByRole("header", { name: "Gruppenchat Falken" }),
    ).toBeOnTheScreen();
    const kopf = screen.getAllByRole("header", {
      name: /, 31\. Oktober, 14:30 Uhr$/,
    });
    // Die eigene Nachricht heisst «Du», nicht nur eine Farbe oder Seite zeigt sie
    expect(kopf.map((k) => k.props.children.join(""))).toEqual([
      "Anna Muster, 31. Oktober, 14:30 Uhr",
      "Du, 31. Oktober, 14:30 Uhr",
    ]);
    expect(screen.getByText("Text 1")).toBeOnTheScreen();
    expect(screen.getByText("Text 2")).toBeOnTheScreen();
  });

  test("rendert nur Text: HTML bleibt sichtbar als Zeichen", async () => {
    seiten[""] = {
      nachrichten: [nachricht(1, { text: "<b>Hallo</b> <img src=x>" })],
      naechster: null,
    };
    await starteChat();

    expect(
      await screen.findByText("<b>Hallo</b> <img src=x>"),
    ).toBeOnTheScreen();
  });

  test("ein leerer Chat sagt es", async () => {
    await starteChat();

    expect(
      await screen.findByText("Noch keine Nachrichten."),
    ).toBeOnTheScreen();
  });

  test("ein Programm-Bezug öffnet das Programm", async () => {
    seiten[""] = {
      nachrichten: [nachricht(1, { programm: { id: "p1", titel: "Waldtag" } })],
      naechster: null,
    };
    await starteChat();

    await fireEvent.press(
      await screen.findByRole("button", { name: "Programm: Waldtag" }),
    );

    expect(screen).toHavePathname("/programme/p1");
  });

  test("ältere Nachrichten laden mit dem Cursor der Seite und stehen oben", async () => {
    seiten[""] = {
      nachrichten: [nachricht(3), nachricht(2)],
      naechster: "n0002",
    };
    seiten["n0002"] = { nachrichten: [nachricht(1)], naechster: null };
    await starteChat();

    await fireEvent.press(
      await screen.findByRole("button", { name: "Frühere Nachrichten laden" }),
    );

    expect(await screen.findByText("Text 1")).toBeOnTheScreen();
    const abfragen = netz.mock.calls.map(([e]) =>
      new URL(String(e instanceof Request ? e.url : e)).searchParams.get("vor"),
    );
    expect(abfragen).toContain("n0002");
    // Am Anfang des Verlaufs gibt es den Knopf nicht mehr
    expect(
      screen.queryByRole("button", { name: "Frühere Nachrichten laden" }),
    ).toBeNull();
    const texte = screen.getAllByText(/^Text \d$/).map((t) => t.props.children);
    expect(texte).toEqual(["Text 1", "Text 2", "Text 3"]);
  });

  test("404 zeigt «nicht mehr sichtbar»", async () => {
    netz.mockImplementation(async (eingabe: unknown) => {
      const pfad = new URL(
        String(eingabe instanceof Request ? eingabe.url : eingabe),
      ).pathname;
      if (pfad.endsWith("/nachrichten")) {
        return json(404, { code: "NICHT_GEFUNDEN", message: "Nicht gefunden" });
      }
      return json(200, { chats: [] });
    });
    await starteChat();

    expect(
      await screen.findByText("Dieser Chat ist nicht mehr sichtbar."),
    ).toBeOnTheScreen();
    expect(screen.queryByLabelText("Nachricht")).toBeNull();
  });
});

describe("Senden", () => {
  test("sendet den Text, leert das Feld, lädt neu und sagt «gesendet» an", async () => {
    await starteChat();
    await screen.findByText("Noch keine Nachrichten.");
    seiten[""] = {
      nachrichten: [
        nachricht(1, {
          eigene: true,
          text: "Wir kommen",
          autor: { id: "u1", name: "Ich" },
        }),
      ],
      naechster: null,
    };

    await tippe("Wir kommen");
    await fireEvent.press(sendeknopf());

    expect(await screen.findByText("Nachricht gesendet.")).toBeOnTheScreen();
    expect(gesendet).toEqual([{ text: "Wir kommen" }]);
    expect(screen.getByLabelText("Nachricht").props.value).toBe("");
    expect(await screen.findByText("Wir kommen")).toBeOnTheScreen();
    expect(
      AccessibilityInfo.announceForAccessibilityWithOptions,
    ).toHaveBeenCalledWith("Nachricht gesendet.", { queue: true });
  });

  test("ein leeres Feld lässt sich nicht senden", async () => {
    await starteChat();
    await screen.findByText("Noch keine Nachrichten.");

    expect(sendeknopf()).toBeDisabled();
    await tippe("   ");
    expect(sendeknopf()).toBeDisabled();
    await tippe("Hallo");
    expect(sendeknopf()).toBeEnabled();
  });

  test("das Feld begrenzt auf 2000 Zeichen", async () => {
    await starteChat();
    await screen.findByText("Noch keine Nachrichten.");

    expect(screen.getByLabelText("Nachricht").props.maxLength).toBe(2000);
  });

  test("ohne Internet erscheint die Meldung, nichts geht raus und der Entwurf bleibt", async () => {
    await starteChat();
    await screen.findByText("Noch keine Nachrichten.");
    await tippe("Kommen wir?");
    await act(async () => onlineManager.setOnline(false));

    await fireEvent.press(sendeknopf());

    expect(
      await screen.findByText(
        "Keine Internetverbindung. Senden geht erst wieder mit Internet. Deine Nachricht bleibt stehen.",
      ),
    ).toBeOnTheScreen();
    expect(gesendet).toEqual([]);
    expect(screen.getByLabelText("Nachricht").props.value).toBe("Kommen wir?");
  });

  test("429 zeigt den Text des Servers-Codes, der Entwurf bleibt", async () => {
    sendeAntwort = () =>
      json(429, { code: "ZU_VIELE_ANFRAGEN", message: "Zu viele Anfragen" });
    await starteChat();
    await screen.findByText("Noch keine Nachrichten.");
    await tippe("Hallo");

    await fireEvent.press(sendeknopf());

    expect(
      await screen.findByText(
        "Zu viele Anfragen. Bitte später nochmals versuchen.",
      ),
    ).toBeOnTheScreen();
    expect(screen.getByLabelText("Nachricht").props.value).toBe("Hallo");
  });
});

describe("neue Nachrichten ansagen", () => {
  const angesagt = () =>
    jest
      .mocked(AccessibilityInfo.announceForAccessibilityWithOptions)
      .mock.calls.map(([text]) => text);

  test("der erste Abruf sagt nichts an, später Dazugekommene gesammelt", async () => {
    seiten[""] = { nachrichten: [nachricht(1)], naechster: null };
    await starteChat();
    await screen.findByText("Text 1");
    jest
      .mocked(AccessibilityInfo.announceForAccessibilityWithOptions)
      .mockClear();

    seiten[""] = {
      nachrichten: [nachricht(3), nachricht(2), nachricht(1)],
      naechster: null,
    };
    await pollen();

    expect(await screen.findByText("2 neue Nachrichten")).toBeOnTheScreen();
    expect(angesagt()).toEqual(["2 neue Nachrichten"]);

    seiten[""] = {
      nachrichten: [nachricht(4), nachricht(3), nachricht(2), nachricht(1)],
      naechster: null,
    };
    await pollen();

    // Der Singular, und ein anderer Text als vorher
    expect(await screen.findByText(/^1 neue Nachricht​?$/)).toBeOnTheScreen();
    expect(angesagt().at(-1)).toMatch(/^1 neue Nachricht​?$/);
  });

  test("eigene Nachrichten und das Laden älterer Seiten zählen nicht", async () => {
    seiten[""] = { nachrichten: [nachricht(3)], naechster: "n0003" };
    seiten["n0003"] = { nachrichten: [nachricht(1)], naechster: null };
    await starteChat();
    await fireEvent.press(
      await screen.findByRole("button", { name: "Frühere Nachrichten laden" }),
    );
    await screen.findByText("Text 1");
    seiten[""] = {
      nachrichten: [nachricht(4, { eigene: true }), nachricht(3)],
      naechster: "n0003",
    };
    await pollen();
    await screen.findByText("Text 4");

    expect(angesagt().filter((t) => /neue/.test(t))).toEqual([]);
  });
});

describe("Stufenleitung im Gruppenchat", () => {
  test("die Liste nennt die Stufenleitung, ohne Telefonnummer und Anruf", async () => {
    await starteChat();

    expect(
      await screen.findByRole("header", { name: "Stufenleitung" }),
    ).toBeOnTheScreen();
    expect(screen.getByText("Berta Leiterin")).toBeOnTheScreen();
    expect(screen.getByText("Chris Leiter")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: /anrufen/i })).toBeNull();
  });

  test("das Elternteil öffnet den Einzelchat mit der ganzen Stufenleitung", async () => {
    await starteChat();

    await fireEvent.press(
      await screen.findByRole("button", {
        name: "Einzelchat mit der Stufenleitung",
      }),
    );

    await waitFor(() => expect(screen).toHavePathname("/chat/e1"));
    // Nur die Stufe, nie eine einzelne Person
    expect(beginnen).toEqual([{ stufeId: "s1" }]);
  });

  test("ein Fehler beim Öffnen steht im Text, und der Chat bleibt offen", async () => {
    beginnenAntwort = () =>
      json(404, { code: "NICHT_GEFUNDEN", message: "Nicht gefunden" });
    await starteChat();

    await fireEvent.press(
      await screen.findByRole("button", {
        name: "Einzelchat mit der Stufenleitung",
      }),
    );

    expect(
      await screen.findByText(
        "Das hat nicht geklappt. Bitte später nochmals versuchen.",
      ),
    ).toBeOnTheScreen();
    expect(screen).toHavePathname("/chat/c1");
  });

  test("ohne Internet geht nichts raus und es erscheint die Meldung", async () => {
    await starteChat();
    const knopf = await screen.findByRole("button", {
      name: "Einzelchat mit der Stufenleitung",
    });
    await act(async () => onlineManager.setOnline(false));

    await fireEvent.press(knopf);

    expect(
      await screen.findByText(
        "Keine Internetverbindung. Der Einzelchat lässt sich erst wieder mit Internet öffnen.",
      ),
    ).toBeOnTheScreen();
    expect(beginnen).toEqual([]);
  });

  test("die SL hat keinen Knopf für die Stufenleitung, aber einen pro schreibendem Elternteil", async () => {
    ichAntwort = { ...PERSONAS.sl, id: "sl1" };
    seiten[""] = {
      nachrichten: [
        nachricht(3, { autor: { id: "sl2", name: "Chris Leiter" } }),
        nachricht(2, { autor: { id: "u2", name: "Anna Muster" } }),
        nachricht(1, { autor: { id: "u2", name: "Anna Muster" } }),
      ],
      naechster: null,
    };
    await starteChat();

    await screen.findByRole("button", { name: "Einzelchat mit Anna Muster" });
    expect(
      screen.queryByRole("button", {
        name: "Einzelchat mit der Stufenleitung",
      }),
    ).toBeNull();
    // Die Kollegin ist kein Elternteil, und Anna steht trotz zwei Nachrichten einmal da
    expect(screen.queryByRole("button", { name: /Chris Leiter/ })).toBeNull();
    expect(
      screen.getAllByRole("button", { name: "Einzelchat mit Anna Muster" }),
    ).toHaveLength(1);

    await fireEvent.press(
      screen.getByRole("button", { name: "Einzelchat mit Anna Muster" }),
    );

    await waitFor(() => expect(screen).toHavePathname("/chat/e1"));
    expect(beginnen).toEqual([{ stufeId: "s1", elternUserId: "u2" }]);
  });
});

describe("Einzelchat", () => {
  beforeEach(() => {
    chatListe = [CHAT, EINZEL];
  });
  const starteEinzel = () =>
    renderRouter(
      {
        _layout: Wurzel,
        "chat/index": Liste,
        "chat/[id]": Detail,
        "programme/[id]": () => null,
      },
      { initialUrl: "/chat/e1" },
    );

  test("der Kopf nennt, wer mitliest, und der Hinweis steht darunter", async () => {
    await starteEinzel();

    expect(
      await screen.findByRole("header", {
        name: "Einzelchat mit der Stufenleitung Falken",
      }),
    ).toBeOnTheScreen();
    expect(screen.getByText("Liest: 2 Personen")).toBeOnTheScreen();
    expect(screen.getByText("Berta Leiterin, Chris Leiter")).toBeOnTheScreen();
    expect(
      screen.getByText("Bitte nur das Nötigste schreiben, keine Diagnosen."),
    ).toBeOnTheScreen();
    // Kein Gruppenchat-Zubehör im Einzelchat
    expect(screen.queryByRole("header", { name: "Stufenleitung" })).toBeNull();
    expect(
      screen.queryByRole("button", {
        name: "Einzelchat mit der Stufenleitung",
      }),
    ).toBeNull();
  });

  test("bei einer einzigen SL steht «Liest: 1 Person»", async () => {
    chatListe = [{ ...EINZEL, stufenleitung: [LEITUNG[0]] }];
    await starteEinzel();

    expect(await screen.findByText("Liest: 1 Person")).toBeOnTheScreen();
  });

  test("die SL sieht den Namen der Familie im Titel", async () => {
    ichAntwort = { ...PERSONAS.sl, id: "sl1" };
    await starteEinzel();

    expect(
      await screen.findByRole("header", { name: "Einzelchat mit Anna Muster" }),
    ).toBeOnTheScreen();
    expect(screen.getByText("Liest: 2 Personen")).toBeOnTheScreen();
  });
});

describe("Moderation", () => {
  const dialog = () => jest.spyOn(Alert, "alert").mockImplementation(() => {});
  // Der zweite Knopf des Dialogs löst die Aktion aus, «Abbrechen» ist der erste
  const bestaetige = async (spion: jest.SpyInstance) => {
    const [, , knoepfe] = spion.mock.calls.at(-1)!;
    await act(async () => knoepfe[1].onPress());
  };

  test("fremde Nachrichten haben «Melden»; der Dialog verweist auf die Hilfe und meldet erst nach «Melden»", async () => {
    const spion = dialog();
    seiten[""] = { nachrichten: [nachricht(1)], naechster: null };
    await starteChat();

    await fireEvent.press(
      await screen.findByRole("button", { name: "Melden" }),
    );

    expect(moderiert).toEqual([]);
    const [titel, text, knoepfe] = spion.mock.calls[0];
    expect(titel).toBe("Nachricht melden?");
    expect(text).toContain("Vertrauensperson");
    expect(text).toContain("«Hilfe»");
    expect(knoepfe?.map((k) => k.text)).toEqual(["Abbrechen", "Melden"]);

    await bestaetige(spion);
    expect(moderiert).toEqual(["melden n0001"]);
    expect(await screen.findByText("Nachricht gemeldet.")).toBeOnTheScreen();
  });

  test("der Name des Knopfs sagt, welche Nachricht gemeint ist", async () => {
    seiten[""] = { nachrichten: [nachricht(1)], naechster: null };
    await starteChat();

    const knopf = await screen.findByRole("button", { name: "Melden" });
    expect(knopf.props.accessibilityHint).toBe(
      "Meldet die Nachricht von Anna Muster an die Admins",
    );
  });

  test("die eigene Nachricht lässt sich nicht melden", async () => {
    seiten[""] = {
      nachrichten: [nachricht(1, { eigene: true })],
      naechster: null,
    };
    await starteChat();

    await screen.findByText("Text 1");
    expect(screen.queryByRole("button", { name: "Melden" })).toBeNull();
  });

  test("die Autorin sieht statt des Textes den Hinweis und kann das melden", async () => {
    const spion = dialog();
    seiten[""] = {
      nachrichten: [
        nachricht(1, { eigene: true, ausgeblendet: true, text: null }),
      ],
      naechster: null,
    };
    await starteChat();

    expect(
      await screen.findByText("Von der Stufenleitung ausgeblendet."),
    ).toBeOnTheScreen();
    const knopf = screen.getByRole("button", { name: "Melden" });
    expect(knopf.props.accessibilityHint).toBe(
      "Meldet das Ausblenden dieser Nachricht an die Admins",
    );
    await fireEvent.press(knopf);
    await bestaetige(spion);
    expect(moderiert).toEqual(["melden n0001"]);
  });

  test("die SL hat «Ausblenden» im Gruppenchat, aber nicht an eigenen Nachrichten", async () => {
    const spion = dialog();
    ichAntwort = { ...PERSONAS.sl, id: "sl1" };
    seiten[""] = {
      nachrichten: [
        nachricht(2, {
          eigene: true,
          autor: { id: "sl1", name: "Berta Leiterin" },
        }),
        nachricht(1),
      ],
      naechster: null,
    };
    await starteChat();

    const knoepfe = await screen.findAllByRole("button", {
      name: "Ausblenden",
    });
    expect(knoepfe).toHaveLength(1);
    await fireEvent.press(knoepfe[0]);
    expect(moderiert).toEqual([]);
    expect(spion.mock.calls[0][0]).toBe("Nachricht ausblenden?");
    expect(spion.mock.calls[0][2]?.map((k) => k.text)).toEqual([
      "Abbrechen",
      "Ausblenden",
    ]);

    await bestaetige(spion);
    expect(moderiert).toEqual(["ausblenden n0001"]);
    expect(
      await screen.findByText("Nachricht ausgeblendet."),
    ).toBeOnTheScreen();
  });

  test("Eltern haben kein «Ausblenden»", async () => {
    seiten[""] = { nachrichten: [nachricht(1)], naechster: null };
    await starteChat();

    await screen.findByRole("button", { name: "Melden" });
    expect(screen.queryByRole("button", { name: "Ausblenden" })).toBeNull();
  });

  test("im Einzelchat hat auch die SL kein «Ausblenden»", async () => {
    chatListe = [CHAT, EINZEL];
    ichAntwort = { ...PERSONAS.sl, id: "sl1" };
    seiten[""] = { nachrichten: [nachricht(1)], naechster: null };
    await renderRouter(
      {
        _layout: Wurzel,
        "chat/index": Liste,
        "chat/[id]": Detail,
        "programme/[id]": () => null,
      },
      { initialUrl: "/chat/e1" },
    );

    await screen.findByText("Text 1");
    expect(screen.getByRole("button", { name: "Melden" })).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Ausblenden" })).toBeNull();
  });

  test("ohne Netz sagt die App es und öffnet keinen Dialog", async () => {
    const spion = dialog();
    seiten[""] = { nachrichten: [nachricht(1)], naechster: null };
    await starteChat();
    const knopf = await screen.findByRole("button", { name: "Melden" });

    await act(async () => onlineManager.setOnline(false));
    await fireEvent.press(knopf);

    expect(spion).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        "Keine Internetverbindung. Melden und Ausblenden gehen erst wieder mit Internet.",
      ),
    ).toBeOnTheScreen();
  });

  test("ein Fehler des Servers steht als Text, bei zu vielen Meldungen mit dem Text für 429", async () => {
    const spion = dialog();
    moderationAntwort = () =>
      json(429, { code: "ZU_VIELE_ANFRAGEN", message: "Zu viele Anfragen" });
    seiten[""] = { nachrichten: [nachricht(1)], naechster: null };
    await starteChat();

    await fireEvent.press(
      await screen.findByRole("button", { name: "Melden" }),
    );
    await bestaetige(spion);

    expect(
      await screen.findByText(
        "Zu viele Anfragen. Bitte später nochmals versuchen.",
      ),
    ).toBeOnTheScreen();
  });
});
