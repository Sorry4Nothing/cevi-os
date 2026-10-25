import { fireEvent, render, screen } from "@testing-library/react-native";

import { JaNeinAuswahl } from "../src/ui/JaNeinAuswahl";

test.each([
  [true, true, false],
  [false, false, true],
  [null, false, false],
])(
  "bei Wert %s ist Ja gewählt: %s, Nein gewählt: %s",
  async (wert, ja, nein) => {
    await render(
      <JaNeinAuswahl
        wert={wert}
        onWahl={jest.fn()}
        kontext="Testkind, Waldtag"
      />,
    );

    expect(
      screen.getByRole("radio", { name: "Ja, Testkind, Waldtag", checked: ja }),
    ).toHaveStyle({ minHeight: 48, minWidth: 48 });
    expect(
      screen.getByRole("radio", {
        name: "Nein, Testkind, Waldtag",
        checked: nein,
      }),
    ).toHaveStyle({ minHeight: 48, minWidth: 48 });
  },
);

test("meldet die gewählte Antwort", async () => {
  const onWahl = jest.fn();
  await render(
    <JaNeinAuswahl wert={null} onWahl={onWahl} kontext="Testkind, Waldtag" />,
  );

  await fireEvent.press(
    screen.getByRole("radio", { name: "Nein, Testkind, Waldtag" }),
  );
  expect(onWahl).toHaveBeenCalledWith(false);
});

test("die gewählte Antwort trägt ein Häkchen, das Screenreader überspringen", async () => {
  await render(
    <JaNeinAuswahl wert onWahl={jest.fn()} kontext="Testkind, Waldtag" />,
  );

  expect(screen.queryByText("✓")).toBeNull();
  expect(
    screen.getByText("✓", { includeHiddenElements: true }),
  ).toBeOnTheScreen();
});
