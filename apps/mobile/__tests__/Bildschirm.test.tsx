import { fireEvent, render, screen } from "@testing-library/react-native";
import { NavigationContext } from "expo-router/react-navigation";
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

test("endet das Laden in einem Fehler, bekommt die Meldung den Fokus", async () => {
  const { rerender } = await render(
    <Bildschirm titel="Programme" zustand="laden" />,
  );
  await rerender(<Bildschirm titel="Programme" zustand="fehler" />);

  expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledTimes(2);
  expect(letzterFokus()).toEqual({
    props: expect.objectContaining({
      children: "Das Laden hat nicht geklappt.",
    }),
    art: "focus",
  });
});

test("nach dem ersten Laden bekommt die Überschrift den Fokus nicht ein zweites Mal", async () => {
  const { rerender } = await render(
    <Bildschirm titel="Programme" zustand="laden" />,
  );
  await rerender(<Bildschirm titel="Programme" zustand="bereit" />);

  expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledTimes(1);
});

test.each(["bereit", "leer"] as const)(
  "endet «Nochmals versuchen» im Zustand %s, bekommt die Überschrift den Fokus",
  async (ende) => {
    const onNeuLaden = jest.fn();
    const { rerender } = await render(
      <Bildschirm titel="Programme" zustand="fehler" onNeuLaden={onNeuLaden} />,
    );
    await fireEvent.press(
      screen.getByRole("button", { name: "Nochmals versuchen" }),
    );
    await rerender(
      <Bildschirm titel="Programme" zustand="laden" onNeuLaden={onNeuLaden} />,
    );
    await rerender(
      <Bildschirm titel="Programme" zustand={ende} onNeuLaden={onNeuLaden} />,
    );

    // Beim Anzeigen Überschrift und Fehler, nach dem Laden wieder die Überschrift
    expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledTimes(3);
    expect(letzterFokus()).toEqual({
      props: expect.objectContaining({
        accessibilityRole: "header",
        children: "Programme",
      }),
      art: "focus",
    });
  },
);

test("endet «Nochmals versuchen» wieder im Fehler, bekommt die Meldung den Fokus", async () => {
  const onNeuLaden = jest.fn();
  const { rerender } = await render(
    <Bildschirm titel="Programme" zustand="fehler" onNeuLaden={onNeuLaden} />,
  );
  await fireEvent.press(
    screen.getByRole("button", { name: "Nochmals versuchen" }),
  );
  await rerender(
    <Bildschirm titel="Programme" zustand="laden" onNeuLaden={onNeuLaden} />,
  );
  await rerender(
    <Bildschirm
      titel="Programme"
      zustand="fehler"
      fehlerText="Keine Verbindung zum Server."
      onNeuLaden={onNeuLaden}
    />,
  );

  expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledTimes(3);
  expect(letzterFokus()).toEqual({
    props: expect.objectContaining({
      children: "Keine Verbindung zum Server.",
    }),
    art: "focus",
  });

  // Ein späteres Laden ohne «Nochmals versuchen» lässt den Fokus, wo er ist
  await rerender(
    <Bildschirm titel="Programme" zustand="laden" onNeuLaden={onNeuLaden} />,
  );
  await rerender(
    <Bildschirm titel="Programme" zustand="bereit" onNeuLaden={onNeuLaden} />,
  );
  expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledTimes(3);
});

test("mit onZurueck steht «Zurück» über der Überschrift, der Fokus bleibt beim Öffnen auf ihr", async () => {
  const onZurueck = jest.fn();
  await render(<Bildschirm titel="Personen" onZurueck={onZurueck} />);

  await fireEvent.press(screen.getByRole("button", { name: "Zurück" }));
  expect(onZurueck).toHaveBeenCalledTimes(1);
  // Checkliste 6.1: Beim Öffnen liegt der Fokus auf der Überschrift, nicht auf dem Knopf
  expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledTimes(1);
  expect(letzterFokus()).toEqual({
    props: expect.objectContaining({
      accessibilityRole: "header",
      children: "Personen",
    }),
    art: "focus",
  });
});

test("ohne onZurueck gibt es keinen Knopf «Zurück»", async () => {
  await render(<Bildschirm titel="Personen" />);

  expect(screen.queryByRole("button", { name: "Zurück" })).toBeNull();
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

test.each(["laden", "leer", "fehler"] as const)(
  "offline im Zustand %s verspricht die Meldung keine Daten, die nicht zu sehen sind",
  async (zustand) => {
    await render(
      <Bildschirm titel="Programme" zustand={zustand} offline>
        <Text>Waldtag</Text>
      </Bildschirm>,
    );

    const meldung =
      "Keine Internetverbindung. Ändern geht erst wieder mit Internet.";
    expect(screen.getByText(meldung)).toBeOnTheScreen();
    expect(screen.queryByText(/zuletzt geladenen Daten/)).toBeNull();
    expect(screen.queryByText("Waldtag")).toBeNull();
    expect(
      AccessibilityInfo.announceForAccessibilityWithOptions,
    ).toHaveBeenCalledWith(meldung, { queue: true });
  },
);

test("mit onZurueck steht ein Knopf «Zurück» über der Überschrift", async () => {
  const onZurueck = jest.fn();
  await render(<Bildschirm titel="Waldtag" onZurueck={onZurueck} />);

  await fireEvent.press(screen.getByRole("button", { name: "Zurück" }));
  expect(onZurueck).toHaveBeenCalledTimes(1);
});

test("ohne onZurueck gibt es keinen Knopf «Zurück»", async () => {
  await render(<Bildschirm titel="Programme" />);

  expect(screen.queryByRole("button", { name: "Zurück" })).toBeNull();
});

test("im Navigator fokussiert jedes focus-Ereignis die Überschrift, aber nur einmal pro Fokus", async () => {
  const horcher: Record<string, (() => void)[]> = { focus: [], blur: [] };
  const navigation = {
    addListener: (typ: "focus" | "blur", melden: () => void) => {
      horcher[typ].push(melden);
      return () => {};
    },
  };
  await render(
    <NavigationContext.Provider value={navigation as never}>
      <Bildschirm titel="Programme" />
    </NavigationContext.Provider>,
  );

  // Beim Einhängen einmal; das erste focus-Ereignis des Navigators ist damit verbraucht
  expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledTimes(1);
  horcher.focus.forEach((melden) => melden());
  expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledTimes(1);

  // Nach «Zurück» oder einem Tabwechsel: blur, dann focus
  horcher.blur.forEach((melden) => melden());
  horcher.focus.forEach((melden) => melden());
  expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledTimes(2);
  expect(letzterFokus()).toEqual({
    props: expect.objectContaining({
      accessibilityRole: "header",
      children: "Programme",
    }),
    art: "focus",
  });
});

test("ein Knopf bekommt den ersten Tipp auch bei offener Tastatur", async () => {
  await render(<Bildschirm titel="Anmelden" />);

  // Mit «never» (Vorgabe) schliesst der erste Tipp nur die Tastatur
  const [scrollView] = screen.container.queryAll(
    (element) => element.type === "RCTScrollView",
  );
  expect(scrollView).toHaveProp("keyboardShouldPersistTaps", "handled");
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
