import { fireEvent, render, screen } from "@testing-library/react-native";
import { AccessibilityInfo, Text, useColorScheme } from "react-native";

import { Bildschirm } from "../src/ui/Bildschirm";
import { farben } from "../src/ui/tokens";

beforeEach(() => jest.clearAllMocks());
afterEach(() => jest.mocked(useColorScheme).mockReset());

// Im Test zeigt die Ref auf die Mock-Komponente von Text; erkannt wird sie an ihren Props
function letzterFokus() {
  const [element, art] = jest
    .mocked(AccessibilityInfo.sendAccessibilityEvent)
    .mock.calls.at(-1)!;
  return { props: (element as unknown as { props: object }).props, art };
}

test("zeigt den Titel als Überschrift und setzt den Fokus darauf", async () => {
  await render(<Bildschirm titel="Programme" />);

  expect(screen.getByRole("header", { name: "Programme" })).toBeOnTheScreen();
  expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledTimes(1);
  expect(letzterFokus()).toEqual({
    props: expect.objectContaining({
      accessibilityRole: "header",
      children: "Programme",
    }),
    art: "focus",
  });
});

test("bereit zeigt den Inhalt", async () => {
  await render(
    <Bildschirm titel="Programme">
      <Text>Waldtag</Text>
    </Bildschirm>,
  );

  expect(screen.getByText("Waldtag")).toBeOnTheScreen();
});

test("beim Laden steht eine Meldung statt des Inhalts, und sie wird angesagt", async () => {
  await render(
    <Bildschirm titel="Programme" zustand="laden">
      <Text>Waldtag</Text>
    </Bildschirm>,
  );

  expect(screen.getByText("Wird geladen …")).toBeOnTheScreen();
  expect(screen.queryByText("Waldtag")).toBeNull();
  expect(
    AccessibilityInfo.announceForAccessibilityWithOptions,
  ).toHaveBeenCalledWith("Wird geladen …", { queue: true });
});

test("leer zeigt den eigenen oder den üblichen Text", async () => {
  const { rerender } = await render(
    <Bildschirm titel="Programme" zustand="leer" />,
  );
  expect(screen.getByText("Hier gibt es noch nichts.")).toBeOnTheScreen();

  await rerender(
    <Bildschirm
      titel="Programme"
      zustand="leer"
      leerText="Keine Programme geplant."
    />,
  );
  expect(screen.getByText("Keine Programme geplant.")).toBeOnTheScreen();
});

test("ein Fehler bekommt den Fokus und lässt sich nochmals versuchen", async () => {
  const onNeuLaden = jest.fn();
  await render(
    <Bildschirm titel="Programme" zustand="fehler" onNeuLaden={onNeuLaden} />,
  );

  expect(screen.getByText("Das Laden hat nicht geklappt.")).toHaveStyle({
    color: farben.hell.fehler,
  });
  expect(letzterFokus()).toEqual({
    props: expect.objectContaining({
      children: "Das Laden hat nicht geklappt.",
    }),
    art: "focus",
  });

  await fireEvent.press(
    screen.getByRole("button", { name: "Nochmals versuchen" }),
  );
  expect(onNeuLaden).toHaveBeenCalledTimes(1);
});

test("ohne onNeuLaden gibt es keinen Knopf zum nochmals Versuchen", async () => {
  await render(
    <Bildschirm
      titel="Programme"
      zustand="fehler"
      fehlerText="Keine Verbindung zum Server."
    />,
  );

  expect(screen.getByText("Keine Verbindung zum Server.")).toBeOnTheScreen();
  expect(screen.queryByRole("button")).toBeNull();
});

test("offline bleiben die Daten sichtbar, und eine Meldung sagt, dass Ändern nur online geht", async () => {
  await render(
    <Bildschirm titel="Programme" offline>
      <Text>Waldtag</Text>
    </Bildschirm>,
  );

  const meldung =
    "Keine Internetverbindung. Die App zeigt die zuletzt geladenen Daten. Ändern geht erst wieder mit Internet.";
  expect(screen.getByText(meldung)).toBeOnTheScreen();
  expect(screen.getByText("Waldtag")).toBeOnTheScreen();
  expect(
    AccessibilityInfo.announceForAccessibilityWithOptions,
  ).toHaveBeenCalledWith(meldung, { queue: true });
});

test.each(["light", "dark"] as const)(
  "malt im Modus %s den eigenen Hintergrund",
  async (modus) => {
    jest.mocked(useColorScheme).mockReturnValue(modus);
    const palette = modus === "dark" ? farben.dunkel : farben.hell;

    await render(<Bildschirm titel="Programme" />);

    expect(screen.root).toHaveStyle({ backgroundColor: palette.hintergrund });
    expect(screen.getByRole("header", { name: "Programme" })).toHaveStyle({
      color: palette.text,
    });
  },
);
