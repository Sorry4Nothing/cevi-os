import { QueryClientProvider } from "@tanstack/react-query";
import { Slot } from "expo-router";
import { fireEvent, renderRouter, screen } from "expo-router/testing-library";
import { AccessibilityInfo } from "react-native";

import TabLayout from "../app/(tabs)/_layout";
import Detail from "../app/(tabs)/programme/[id]";
import ProgrammeLayout from "../app/(tabs)/programme/_layout";
import Liste from "../app/(tabs)/programme/index";
import Profil from "../app/(tabs)/profil";
import { queryClient } from "../src/api/client";
import { SperreProvider } from "../src/sperre/SperreProvider";
import {
  FALKEN,
  json,
  mockeNetz,
  PERSONAS,
  programm,
} from "./hilfen/programme";

function Wurzel() {
  return (
    <QueryClientProvider client={queryClient}>
      <SperreProvider anfangsAus={false}>
        <Slot />
      </SperreProvider>
    </QueryClientProvider>
  );
}

const WALD = programm({
  id: "p1",
  titel: "Waldtag",
  googleOrt: "Dorfplatz",
  stufen: [FALKEN],
});

beforeEach(() => {
  jest.clearAllMocks();
  queryClient.clear();
  mockeNetz({
    "/ich": () => json(200, PERSONAS.eltern),
    "/programme": () => json(200, { programme: [WALD] }),
    "/programme/p1": () => json(200, WALD),
  });
});

function letzterFokus() {
  const [element] = jest
    .mocked(AccessibilityInfo.sendAccessibilityEvent)
    .mock.calls.at(-1)!;
  return (element as unknown as { props: { children: unknown } }).props
    .children;
}

// Checkliste 6.1: Nach jeder Navigation liegt der Fokus auf der Überschrift des neuen Bildschirms
test("Liste → Detail → «Zurück» und Tabwechsel setzen den Fokus auf die Überschrift", async () => {
  await renderRouter(
    {
      _layout: Wurzel,
      "(tabs)/_layout": TabLayout,
      "(tabs)/programme/_layout": ProgrammeLayout,
      "(tabs)/programme/index": Liste,
      "(tabs)/programme/[id]": Detail,
      "(tabs)/profil": Profil,
    },
    { initialUrl: "/programme" },
  );

  const zeile = await screen.findByRole("button", { name: /Waldtag/ });
  expect(letzterFokus()).toBe("Programme");

  await fireEvent.press(zeile);
  expect(screen).toHavePathname("/programme/p1");
  expect(
    await screen.findByRole("header", { name: "Waldtag" }),
  ).toBeOnTheScreen();
  expect(letzterFokus()).toBe("Waldtag");

  await fireEvent.press(screen.getByRole("button", { name: "Zurück" }));
  expect(screen).toHavePathname("/programme");
  expect(letzterFokus()).toBe("Programme");

  // Tabwechsel hin und zurück
  await fireEvent.press(screen.getByLabelText(/Profil/));
  expect(
    await screen.findByRole("header", { name: "Profil" }),
  ).toBeOnTheScreen();
  expect(letzterFokus()).toBe("Profil");

  await fireEvent.press(screen.getByLabelText(/Programme/));
  expect(
    await screen.findByRole("header", { name: "Programme" }),
  ).toBeOnTheScreen();
  expect(letzterFokus()).toBe("Programme");
});
