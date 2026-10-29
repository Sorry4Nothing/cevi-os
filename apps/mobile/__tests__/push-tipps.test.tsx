import { QueryClientProvider } from "@tanstack/react-query";
import * as Notifications from "expo-notifications";
import { Slot, Stack, useFocusEffect, useRouter } from "expo-router";
import { Tabs } from "expo-router/js-tabs";
import {
  act,
  fireEvent,
  renderRouter,
  screen,
} from "expo-router/testing-library";
import { useCallback } from "react";
import { Text } from "react-native";

import TabLayout from "../app/(tabs)/_layout";
import Detail from "../app/(tabs)/programme/[id]";
import ProgrammeLayout, {
  unstable_settings as programmeEinstellungen,
} from "../app/(tabs)/programme/_layout";
import Liste from "../app/(tabs)/programme/index";
import Profil from "../app/(tabs)/profil";
import { queryClient } from "../src/api/client";
import { pushHandler, setzeOffenenChat, usePushTipps } from "../src/push";
import { Bildschirm } from "../src/ui/Bildschirm";
import {
  FALKEN,
  json,
  mockeNetz,
  PERSONAS,
  programm,
} from "./hilfen/programme";

const PROGRAMM_ID = "0192f7a0-1b2c-7d3e-8f4a-5b6c7d8e9f01";
const CHAT_ID = "0192f7a0-1b2c-7d3e-8f4a-5b6c7d8e9f02";

function Wurzel() {
  return (
    <QueryClientProvider client={queryClient}>
      <Slot />
    </QueryClientProvider>
  );
}

// Die Chat-Route kommt mit dem Gruppenchat; diese Attrappen haben ihre Form: Stack mit Anker, Liste, Chat mit setzeOffenenChat bei Fokus
function ChatLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
const chatEinstellungen = { anchor: "index" };
function ChatListe() {
  return <Bildschirm titel="Chats" />;
}
function ChatAnsicht() {
  const router = useRouter();
  useFocusEffect(
    useCallback(() => {
      setzeOffenenChat(CHAT_ID);
      return () => setzeOffenenChat(null);
    }, []),
  );
  return (
    <Bildschirm titel="Chat" onZurueck={() => router.back()}>
      <Text>Gruppenchat</Text>
    </Bildschirm>
  );
}

// Der echte Tab-Rahmen kennt noch keinen Tab «Chat» und blendet unbekannte Routen aus; mit dem Gruppenchat steht er dort
function TabsMitChat() {
  usePushTipps();
  return (
    <Tabs screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="programme" />
      <Tabs.Screen name="profil" />
      <Tabs.Screen name="chat" />
    </Tabs>
  );
}

const ROUTEN = {
  _layout: Wurzel,
  "(tabs)/_layout": TabLayout,
  "(tabs)/programme/_layout": {
    default: ProgrammeLayout,
    unstable_settings: programmeEinstellungen,
  },
  "(tabs)/programme/index": Liste,
  "(tabs)/programme/[id]": Detail,
  "(tabs)/profil": Profil,
  "(tabs)/chat/_layout": {
    default: ChatLayout,
    unstable_settings: chatEinstellungen,
  },
  "(tabs)/chat/index": ChatListe,
  "(tabs)/chat/[id]": ChatAnsicht,
};

const holeLetzten = jest.mocked(Notifications.getLastNotificationResponse);
const loescheLetzten = jest.mocked(Notifications.clearLastNotificationResponse);
const tippe = (
  Notifications as unknown as { __tipp: (antwort: unknown) => void }
).__tipp;

function tipp(
  data: Record<string, unknown> | undefined,
  aktion: string = Notifications.DEFAULT_ACTION_IDENTIFIER,
) {
  return {
    actionIdentifier: aktion,
    notification: { request: { content: { data } } },
  };
}
const programmTipp = () => tipp({ typ: "programm", id: PROGRAMM_ID });
const chatTipp = () => tipp({ typ: "chat", id: CHAT_ID });

const WALD = programm({
  id: PROGRAMM_ID,
  titel: "Waldtag",
  googleOrt: "Dorfplatz",
  stufen: [FALKEN],
});

// Wie das native Modul: Die Antwort des Starts bleibt, bis sie gelöscht wird
let letzte: unknown = null;
function kaltstart(antwort: unknown) {
  letzte = antwort;
}

beforeEach(() => {
  jest.clearAllMocks();
  letzte = null;
  holeLetzten.mockImplementation(() => letzte as never);
  loescheLetzten.mockImplementation(() => {
    letzte = null;
  });
  queryClient.clear();
  setzeOffenenChat(null);
  mockeNetz({
    "/ich": () => json(200, PERSONAS.eltern),
    "/programme": () => json(200, { programme: [WALD] }),
    [`/programme/${PROGRAMM_ID}`]: () => json(200, WALD),
  });
});

test("Kaltstart: Ein Tipp auf einen Programm-Push öffnet das Programm und löscht die Antwort", async () => {
  kaltstart(programmTipp());
  await renderRouter(ROUTEN, { initialUrl: "/programme" });

  expect(
    await screen.findByRole("header", { name: "Waldtag" }),
  ).toBeOnTheScreen();
  expect(screen).toHavePathname(`/programme/${PROGRAMM_ID}`);
  expect(loescheLetzten).toHaveBeenCalledTimes(1);
});

test("Kaltstart auf dem Profil: «Zurück» im Programm führt zur Liste, nicht zum Profil", async () => {
  kaltstart(programmTipp());
  await renderRouter(ROUTEN, { initialUrl: "/profil" });

  await screen.findByRole("header", { name: "Waldtag" });
  await fireEvent.press(screen.getByRole("button", { name: "Zurück" }));

  expect(screen).toHavePathname("/programme");
  expect(
    await screen.findByRole("header", { name: "Programme" }),
  ).toBeOnTheScreen();
});

test("laufende App: Ein Tipp über den Horcher öffnet das Programm", async () => {
  await renderRouter(ROUTEN, { initialUrl: "/profil" });
  expect(loescheLetzten).not.toHaveBeenCalled();

  await act(() => tippe(programmTipp()));

  expect(
    await screen.findByRole("header", { name: "Waldtag" }),
  ).toBeOnTheScreen();
  expect(screen).toHavePathname(`/programme/${PROGRAMM_ID}`);
});

test.each([
  [
    "eine andere Aktion als der Tipp",
    () => tipp({ typ: "programm", id: PROGRAMM_ID }, "ablehnen"),
  ],
  [
    "ein Push über eine Person (noch ohne Ziel)",
    () => tipp({ typ: "person", id: PROGRAMM_ID }),
  ],
  [
    "eine Id, die keine UUID ist",
    () => tipp({ typ: "programm", id: "../verwaltung" }),
  ],
  ["ein Push ohne Daten", () => tipp(undefined)],
])("%s öffnet nichts", async (_titel, antwort) => {
  await renderRouter(ROUTEN, { initialUrl: "/profil" });

  await act(() => tippe(antwort()));

  expect(screen).toHavePathname("/profil");
});

describe("Chat", () => {
  test("Kaltstart: Der Tipp öffnet den Chat, «Zurück» führt zur Chatliste", async () => {
    kaltstart(chatTipp());
    await renderRouter(
      { ...ROUTEN, "(tabs)/_layout": TabsMitChat },
      { initialUrl: "/profil" },
    );

    await act(async () => {});
    expect(screen.getByText("Gruppenchat")).toBeOnTheScreen();
    expect(screen.getByRole("header", { name: "Chat" })).toBeOnTheScreen();
    expect(screen).toHavePathname(`/chat/${CHAT_ID}`);

    await fireEvent.press(screen.getByRole("button", { name: "Zurück" }));
    expect(screen).toHavePathname("/chat");
  });

  test("solange der Chat offen ist, bleibt sein Push stumm; nach dem Verlassen erscheint er", async () => {
    kaltstart(chatTipp());
    await renderRouter(
      { ...ROUTEN, "(tabs)/_layout": TabsMitChat },
      { initialUrl: "/profil" },
    );
    await act(async () => {});
    const push = {
      request: { content: { data: { typ: "chat", id: CHAT_ID } } },
    };

    expect(await pushHandler(push as never)).toMatchObject({
      shouldShowBanner: false,
      shouldPlaySound: false,
    });

    await fireEvent.press(screen.getByRole("button", { name: "Zurück" }));
    await screen.findByRole("header", { name: "Chats" });

    expect(await pushHandler(push as never)).toMatchObject({
      shouldShowBanner: true,
      shouldPlaySound: true,
    });
  });
});

// Zuletzt: Nach unmount() und neuem renderRouter finden die Tests des Chats ihren Bildschirm nicht mehr
test("Tabs, die nach Abmelden und Anmelden neu hängen, öffnen denselben Tipp nicht nochmals", async () => {
  kaltstart(programmTipp());

  const erste = await renderRouter(ROUTEN, { initialUrl: "/profil" });
  await screen.findByRole("header", { name: "Waldtag" });
  erste.unmount();
  await renderRouter(ROUTEN, { initialUrl: "/profil" });

  expect(
    await screen.findByRole("header", { name: "Profil" }),
  ).toBeOnTheScreen();
  expect(screen).toHavePathname("/profil");
});
