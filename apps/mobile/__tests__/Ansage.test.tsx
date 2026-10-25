import { render, screen } from "@testing-library/react-native";
import { AccessibilityInfo, Platform } from "react-native";

import { Ansage } from "../src/ui/Ansage";

beforeEach(() => jest.clearAllMocks());
afterEach(() => jest.restoreAllMocks());

test("iOS sagt eine neue Meldung an, ohne eine laufende Ansage abzubrechen", async () => {
  const { rerender } = await render(<Ansage />);
  expect(
    AccessibilityInfo.announceForAccessibilityWithOptions,
  ).not.toHaveBeenCalled();

  await rerender(<Ansage text="Keine Internetverbindung." />);

  expect(screen.getByText("Keine Internetverbindung.")).toBeOnTheScreen();
  expect(
    AccessibilityInfo.announceForAccessibilityWithOptions,
  ).toHaveBeenCalledWith("Keine Internetverbindung.", { queue: true });
});

test("Android sagt die Meldung über die Live-Region an, die schon vorher im Baum steht", async () => {
  jest.replaceProperty(Platform, "OS", "android");
  const { rerender } = await render(<Ansage />);
  const region = screen.root;

  await rerender(<Ansage text="Benutzername fehlt" />);

  expect(screen.getByText("Benutzername fehlt").parent).toBe(region);
  expect(region).toHaveProp("accessibilityLiveRegion", "polite");
  expect(
    AccessibilityInfo.announceForAccessibilityWithOptions,
  ).not.toHaveBeenCalled();
});
