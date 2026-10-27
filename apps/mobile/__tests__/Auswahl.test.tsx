import { fireEvent, render, screen } from "@testing-library/react-native";
import { Platform } from "react-native";

import { Auswahl } from "../src/ui/Auswahl";

afterEach(() => jest.restoreAllMocks());

const optionen = ["Alle", "Falken", "Pinguine"];

test("Android: Radios mit checked, die Beschriftung ist sichtbar", async () => {
  jest.replaceProperty(Platform, "OS", "android");
  const onWahl = jest.fn();
  await render(
    <Auswahl
      label="Stufe"
      optionen={optionen}
      wert="Alle"
      onWahl={onWahl}
      kontext="Stufenfilter"
    />,
  );

  expect(screen.getByText("Stufe")).toBeOnTheScreen();
  expect(
    screen.getByRole("radio", { name: "Alle, Stufenfilter", checked: true }),
  ).toHaveStyle({ minHeight: 48, minWidth: 48 });
  expect(
    screen.getByRole("radio", { name: "Falken, Stufenfilter", checked: false }),
  ).toBeOnTheScreen();

  await fireEvent.press(
    screen.getByRole("radio", { name: "Pinguine, Stufenfilter" }),
  );
  expect(onWahl).toHaveBeenCalledWith("Pinguine");
});

test("iOS: Knöpfe mit selected", async () => {
  await render(
    <Auswahl
      label="Stufe"
      optionen={optionen}
      wert="Falken"
      onWahl={jest.fn()}
      kontext="Stufenfilter"
    />,
  );

  const gewaehlt = screen.getByRole("button", {
    name: "Falken, Stufenfilter",
    selected: true,
  });
  expect(gewaehlt).toBeOnTheScreen();
  // Mit checked hängt RN auf iOS englische Wörter an
  expect(gewaehlt.props.accessibilityState.checked).toBeUndefined();
  expect(
    screen.getByRole("button", { name: "Alle, Stufenfilter", selected: false }),
  ).toBeOnTheScreen();
});
