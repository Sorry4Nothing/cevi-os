import { onlineManager, QueryClientProvider } from "@tanstack/react-query";
import { Slot } from "expo-router";
import {
  act,
  fireEvent,
  renderRouter,
  screen,
} from "expo-router/testing-library";
import { AccessibilityInfo } from "react-native";

import Detail from "../app/(tabs)/chat/[id]";
import Liste from "../app/(tabs)/chat/index";
import type { Chat, Nachricht } from "../src/api/chats";
import { queryClient } from "../src/api/client";
import { json, netz } from "./hilfen/programme";

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

const CHAT: Chat = {
  id: "c1",
  typ: "stufe",
  stufe: { id: "s1", name: "Falken", kuerzel: "F" },
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
    ...aenderung,
  };
}

// Der Server liefert jede Seite neueste zuerst
type Seite = { nachrichten: Nachricht[]; naechster: string | null };
let seiten: Record<string, Seite>;
let gesendet: unknown[];
let sendeAntwort: () => Response;

beforeEach(() => {
  jest
    .mocked(AccessibilityInfo.announceForAccessibilityWithOptions)
    .mockClear();
  queryClient.clear();
  netz.mockClear();
  gesendet = [];
  sendeAntwort = () => json(201, { id: "n9999" });
  seiten = { "": { nachrichten: [], naechster: null } };
  netz.mockImplementation(async (eingabe: unknown, init?: RequestInit) => {
    const url = new URL(
      String(eingabe instanceof Request ? eingabe.url : eingabe),
    );
    if (url.pathname.endsWith("/chats")) return json(200, { chats: [CHAT] });
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
