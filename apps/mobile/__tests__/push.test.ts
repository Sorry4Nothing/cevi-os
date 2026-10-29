import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import {
  kanaeleAnlegen,
  pushHandler,
  setzeOffenenChat,
  tokenRegistrieren,
  zielAusPush,
} from "../src/push";

const erlaubnis = jest.mocked(Notifications.getPermissionsAsync);
const kanal = jest.mocked(Notifications.setNotificationChannelAsync);
const holeToken = jest.mocked(Notifications.getExpoPushTokenAsync);
const netz = global.fetch as jest.Mock;

// In echt schreibt «eas init» die projectId in app.json; hier über die expo-constants-Attrappe
function projectId(id: string | undefined) {
  (Constants.expoConfig as { extra?: unknown }).extra =
    id === undefined ? undefined : { eas: { projectId: id } };
}

beforeEach(() => {
  jest.clearAllMocks();
  erlaubnis.mockResolvedValue({ granted: true, canAskAgain: true } as never);
  holeToken.mockResolvedValue({
    type: "expo",
    data: "ExpoPushToken[geraet]",
  } as never);
  netz.mockResolvedValue(new Response(null, { status: 204 }));
  projectId("projekt-1");
});
afterEach(() => {
  jest.restoreAllMocks();
  projectId(undefined);
});

test("Android: Kanäle «chat» und «programme» mit normaler Wichtigkeit, ohne «Nicht stören»-Umgehung, Sperrbildschirm privat", async () => {
  jest.replaceProperty(Platform, "OS", "android");
  await kanaeleAnlegen();

  // Werte als Zahlen (DEFAULT = 5, PRIVATE = 2): Zwei undefined passten sonst zusammen
  const werte = { importance: 5, bypassDnd: false, lockscreenVisibility: 2 };
  expect(kanal.mock.calls).toEqual([
    ["chat", { name: "Chat", ...werte }],
    ["programme", { name: "Programme", ...werte }],
  ]);
});

test("iOS legt keine Kanäle an", async () => {
  await kanaeleAnlegen();
  expect(kanal).not.toHaveBeenCalled();
});

test("meldet das Token der projectId mit PUT an die API", async () => {
  await tokenRegistrieren();

  expect(holeToken).toHaveBeenCalledWith({ projectId: "projekt-1" });
  expect(netz).toHaveBeenCalledTimes(1);
  const [url, init] = netz.mock.calls[0] as [string, RequestInit];
  expect(String(url)).toBe("https://cevi-os.invalid/api/v1/push-token");
  expect(init.method).toBe("PUT");
  expect(JSON.parse(init.body as string)).toEqual({
    token: "ExpoPushToken[geraet]",
    plattform: "ios",
  });
});

test("legt die Kanäle an, bevor es das Token holt, und meldet Android als Plattform", async () => {
  jest.replaceProperty(Platform, "OS", "android");
  await tokenRegistrieren();

  expect(kanal.mock.invocationCallOrder[0]).toBeLessThan(
    holeToken.mock.invocationCallOrder[0],
  );
  const [, init] = netz.mock.calls[0] as [string, RequestInit];
  expect(JSON.parse(init.body as string).plattform).toBe("android");
});

test("ohne Erlaubnis, ohne projectId oder ohne Token: kein PUT und kein Fehler", async () => {
  erlaubnis.mockResolvedValue({ granted: false, canAskAgain: true } as never);
  await tokenRegistrieren();

  erlaubnis.mockResolvedValue({ granted: true, canAskAgain: true } as never);
  projectId(undefined);
  await tokenRegistrieren();

  projectId("projekt-1");
  holeToken.mockRejectedValue(new Error("kein Push-Dienst (Emulator)"));
  await expect(tokenRegistrieren()).resolves.toBeUndefined();

  expect(netz).not.toHaveBeenCalled();
});

const ID = "0192f7a0-1b2c-7d3e-8f4a-5b6c7d8e9f01";
const ANDERE_ID = "0192f7a0-1b2c-7d3e-8f4a-5b6c7d8e9f02";

describe("zielAusPush", () => {
  test.each([
    ["Programm", { typ: "programm", id: ID }, `/programme/${ID}`],
    ["Chat", { typ: "chat", id: ID }, `/chat/${ID}`],
    [
      "Grossbuchstaben in der Id",
      { typ: "programm", id: ID.toUpperCase() },
      `/programme/${ID.toUpperCase()}`,
    ],
    ["Person (noch kein Ziel)", { typ: "person", id: ID }, null],
    ["unbekannter Typ", { typ: "admin", id: ID }, null],
    ["Id keine UUID", { typ: "programm", id: "p1" }, null],
    ["Pfad statt Id", { typ: "programm", id: "../verwaltung" }, null],
    ["Id mit Anhang", { typ: "programm", id: `${ID}/../x` }, null],
    ["Id keine Zeichenkette", { typ: "programm", id: 42 }, null],
    ["ohne Id", { typ: "programm" }, null],
    ["ohne Daten", undefined, null],
  ])("%s", (_titel, data, erwartet) => {
    expect(zielAusPush(data)).toBe(erwartet);
  });
});

describe("pushHandler", () => {
  const push = (data: Record<string, unknown> | undefined) =>
    ({ request: { content: { data } } }) as never;
  const alles = {
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  };
  const nichts = {
    shouldShowBanner: false,
    shouldShowList: false,
    shouldPlaySound: false,
    shouldSetBadge: false,
  };

  afterEach(() => setzeOffenenChat(null));

  test("zeigt jeden Push, solange kein Chat offen ist", async () => {
    expect(await pushHandler(push({ typ: "chat", id: ID }))).toEqual(alles);
  });

  test("unterdrückt den Push des offenen Chats ganz", async () => {
    setzeOffenenChat(ID);
    expect(await pushHandler(push({ typ: "chat", id: ID }))).toEqual(nichts);
  });

  test("zeigt Pushes anderer Chats, von Programmen und von Personen", async () => {
    setzeOffenenChat(ID);
    expect(await pushHandler(push({ typ: "chat", id: ANDERE_ID }))).toEqual(
      alles,
    );
    expect(await pushHandler(push({ typ: "programm", id: ID }))).toEqual(alles);
    expect(await pushHandler(push({ typ: "person", id: ID }))).toEqual(alles);
    expect(await pushHandler(push(undefined))).toEqual(alles);
  });

  test("nach dem Verlassen des Chats zeigt er wieder", async () => {
    setzeOffenenChat(ID);
    setzeOffenenChat(null);
    expect(await pushHandler(push({ typ: "chat", id: ID }))).toEqual(alles);
  });
});
