import { fireEvent, render, screen } from "@testing-library/react-native";
import { Platform } from "react-native";

import { Auswahl } from "../src/ui/Auswahl";

afterEach(() => jest.restoreAllMocks());

const OPTIONEN = [
  { wert: "keine", text: "Keine" },
  { wert: "leitung", text: "Leitung" },
  { wert: "stufenleitung", text: "Stufenleitung" },
] as const;

const kontext = "Stufe A";

test("iOS: die gewählte Option ist selected, alle sind Knöpfe mit 48er-Ziel", async () => {
  await render(
    <Auswahl
      optionen={OPTIONEN}
      wert="leitung"
      onWahl={jest.fn()}
      kontext={kontext}
    />,
  );

  const antworten = [
    screen.getByRole("button", { name: `Keine, ${kontext}`, selected: false }),
    screen.getByRole("button", { name: `Leitung, ${kontext}`, selected: true }),
    screen.getByRole("button", {
      name: `Stufenleitung, ${kontext}`,
      selected: false,
    }),
  ];
  for (const antwort of antworten) {
    expect(antwort).toHaveStyle({ minHeight: 48, minWidth: 48 });
    // Mit checked hängt RN auf iOS die englischen Wörter «checked» bzw. «unchecked» an
    expect(antwort.props.accessibilityState.checked).toBeUndefined();
  }
});

test("Android: die gewählte Option ist ein radio mit checked", async () => {
  jest.replaceProperty(Platform, "OS", "android");
  await render(
    <Auswahl
      optionen={OPTIONEN}
      wert="stufenleitung"
      onWahl={jest.fn()}
      kontext={kontext}
    />,
  );

  expect(
    screen.getByRole("radio", {
      name: `Stufenleitung, ${kontext}`,
      checked: true,
    }),
  ).toBeOnTheScreen();
  expect(
    screen.getByRole("radio", { name: `Leitung, ${kontext}`, checked: false }),
  ).toBeOnTheScreen();
});

test("bei wert null ist nichts gewählt", async () => {
  await render(
    <Auswahl
      optionen={OPTIONEN}
      wert={null}
      onWahl={jest.fn()}
      kontext={kontext}
    />,
  );

  for (const option of OPTIONEN) {
    expect(
      screen.getByRole("button", {
        name: `${option.text}, ${kontext}`,
        selected: false,
      }),
    ).toBeOnTheScreen();
  }
});

test("meldet die gewählte Option", async () => {
  const onWahl = jest.fn();
  await render(
    <Auswahl
      optionen={OPTIONEN}
      wert="keine"
      onWahl={onWahl}
      kontext={kontext}
    />,
  );

  await fireEvent.press(
    screen.getByRole("button", { name: `Leitung, ${kontext}` }),
  );
  expect(onWahl).toHaveBeenCalledWith("leitung");
});
