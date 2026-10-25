import { fireEvent, render, screen } from "@testing-library/react-native";
import { Platform } from "react-native";

import { JaNeinAuswahl } from "../src/ui/JaNeinAuswahl";

afterEach(() => jest.restoreAllMocks());

const kontext = "Testkind, Waldtag";
const werte = [
  [true, true, false],
  [false, false, true],
  [null, false, false],
] as const;

test.each(werte)(
  "iOS: bei Wert %s ist Ja ausgewählt: %s, Nein ausgewählt: %s",
  async (wert, ja, nein) => {
    await render(
      <JaNeinAuswahl wert={wert} onWahl={jest.fn()} kontext={kontext} />,
    );

    const antworten = [
      screen.getByRole("button", { name: `Ja, ${kontext}`, selected: ja }),
      screen.getByRole("button", { name: `Nein, ${kontext}`, selected: nein }),
    ];
    for (const antwort of antworten) {
      expect(antwort).toHaveStyle({ minHeight: 48, minWidth: 48 });
      // Mit checked hängt RN auf iOS die englischen Wörter «checked» bzw. «unchecked» an
      expect(antwort.props.accessibilityState.checked).toBeUndefined();
    }
  },
);

test.each(werte)(
  "Android: bei Wert %s ist Ja gewählt: %s, Nein gewählt: %s",
  async (wert, ja, nein) => {
    jest.replaceProperty(Platform, "OS", "android");
    await render(
      <JaNeinAuswahl wert={wert} onWahl={jest.fn()} kontext={kontext} />,
    );

    expect(
      screen.getByRole("radio", { name: `Ja, ${kontext}`, checked: ja }),
    ).toHaveStyle({ minHeight: 48, minWidth: 48 });
    expect(
      screen.getByRole("radio", { name: `Nein, ${kontext}`, checked: nein }),
    ).toHaveStyle({ minHeight: 48, minWidth: 48 });
  },
);

test("meldet die gewählte Antwort", async () => {
  const onWahl = jest.fn();
  await render(<JaNeinAuswahl wert={null} onWahl={onWahl} kontext={kontext} />);

  await fireEvent.press(
    screen.getByRole("button", { name: `Nein, ${kontext}` }),
  );
  expect(onWahl).toHaveBeenCalledWith(false);
});

test("die gewählte Antwort trägt ein Häkchen, das Screenreader überspringen", async () => {
  await render(<JaNeinAuswahl wert onWahl={jest.fn()} kontext={kontext} />);

  expect(screen.queryByText("✓")).toBeNull();
  expect(
    screen.getByText("✓", { includeHiddenElements: true }),
  ).toBeOnTheScreen();
});
