import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ComponentProps } from "react";
import { AccessibilityInfo, Platform } from "react-native";

import { Textfeld } from "../src/ui/Textfeld";
import { farben } from "../src/ui/tokens";

beforeEach(() => jest.clearAllMocks());
afterEach(() => jest.restoreAllMocks());

test("iOS: die sichtbare Beschriftung ist der Name des Felds und bleibt beim Tippen stehen", async () => {
  await render(<Textfeld label="Benutzername" value="beispiel" />);

  const feld = screen.getByLabelText("Benutzername");
  expect(feld).toHaveStyle({ minHeight: 48 });
  expect(feld).toHaveProp("accessibilityLabel", "Benutzername");
  // VoiceOver hört die Beschriftung am Feld, nicht ein zweites Mal davor
  expect(screen.queryByText("Benutzername")).toBeNull();
  expect(
    screen.getByText("Benutzername", { includeHiddenElements: true }),
  ).toBeOnTheScreen();
});

test("Android: das Feld verweist auf die sichtbare Beschriftung, ohne eigenen Namen", async () => {
  jest.replaceProperty(Platform, "OS", "android");
  await render(<Textfeld label="Benutzername" value="beispiel" />);

  const beschriftung = screen.getByText("Benutzername");
  const feld = screen.getByLabelText("Benutzername");
  expect(beschriftung).toHaveProp("nativeID", expect.any(String));
  expect(feld).toHaveProp("aria-labelledby", beschriftung.props.nativeID);
  // Ein Name würde zur contentDescription des Eingabefelds (Checkliste 4.1)
  expect(feld.props.accessibilityLabel).toBeUndefined();
});

test("reicht autoComplete und textContentType weiter", async () => {
  await render(
    <Textfeld
      label="Passwort"
      autoComplete="current-password"
      textContentType="password"
      secureTextEntry
    />,
  );

  const feld = screen.getByLabelText("Passwort");
  expect(feld).toHaveProp("autoComplete", "current-password");
  expect(feld).toHaveProp("textContentType", "password");
  expect(feld).toHaveProp("secureTextEntry", true);
});

test("ein Fehler steht beim Feld, nimmt den Fokus und wird am Feld vorgelesen", async () => {
  await render(<Textfeld label="Passwort" fehler="Das Passwort fehlt." />);

  expect(screen.getByText("Das Passwort fehlt.")).toHaveStyle({
    color: farben.hell.fehler,
  });
  // Der Fokus liegt auf der Meldung (Checkliste 6.3); eine Ansage obendrauf würde sie doppelt vorlesen
  const [element, art] = jest
    .mocked(AccessibilityInfo.sendAccessibilityEvent)
    .mock.calls.at(-1)!;
  expect(art).toBe("focus");
  expect(
    (element as unknown as { props: { children: string } }).props.children,
  ).toBe("Das Passwort fehlt.");
  expect(screen.getByLabelText("Passwort")).toHaveProp(
    "accessibilityHint",
    "Das Passwort fehlt.",
  );
});

test("der Fokus zeigt sich mit einem dickeren Rand in der Akzentfarbe", async () => {
  await render(<Textfeld label="Benutzername" />);
  const feld = screen.getByLabelText("Benutzername");
  expect(feld).toHaveStyle({ borderWidth: 1, borderColor: farben.hell.rand });

  await fireEvent(feld, "focus");
  expect(feld).toHaveStyle({ borderWidth: 2, borderColor: farben.hell.akzent });

  await fireEvent(feld, "blur");
  expect(feld).toHaveStyle({ borderWidth: 1, borderColor: farben.hell.rand });
});

test("mit einem Fehler zeigt sich der Fokus mit einem noch dickeren Rand", async () => {
  await render(<Textfeld label="Passwort" fehler="Das Passwort fehlt." />);
  const feld = screen.getByLabelText("Passwort");
  expect(feld).toHaveStyle({ borderWidth: 2, borderColor: farben.hell.fehler });

  await fireEvent(feld, "focus");
  expect(feld).toHaveStyle({ borderWidth: 3, borderColor: farben.hell.fehler });

  await fireEvent(feld, "blur");
  expect(feld).toHaveStyle({ borderWidth: 2, borderColor: farben.hell.fehler });
});

test("nimmt keinen eigenen Namen an, der die sichtbare Beschriftung ersetzen würde", () => {
  // Geprüft von npm run typecheck: Jede Zeile scheitert, sobald Textfeld den Prop wieder annimmt.
  // Das Feld setzt accessibilityLabel und aria-labelledby nach dem Spread selbst; nur aria-label käme durch und schlüge sie
  const verboten: ComponentProps<typeof Textfeld>[] = [
    // @ts-expect-error bliebe wirkungslos, das Feld setzt seinen eigenen Wert danach
    { label: "Name", accessibilityLabel: "Anders" },
    // @ts-expect-error TextInput zieht aria-label jedem anderen Namen vor
    { label: "Name", "aria-label": "Anders" },
    // @ts-expect-error das gesetzte aria-labelledby des Felds gewinnt, der Prop täuschte nur
    { label: "Name", accessibilityLabelledBy: "anders" },
    // @ts-expect-error bliebe wirkungslos, das Feld setzt seinen eigenen Wert danach
    { label: "Name", "aria-labelledby": "anders" },
  ];
  expect(verboten).toHaveLength(4);
});

test("nimmt Hinweis, Zustand und aria-Zustände nicht an: Das Feld setzt sie selbst", () => {
  // TextInput mischte die aria-Props über den Zustand des Felds (TextInput.js 533–538)
  const verboten: ComponentProps<typeof Textfeld>[] = [
    // @ts-expect-error der Hinweis trägt den Fehlertext des Felds
    { label: "Name", accessibilityHint: "Anders" },
    // @ts-expect-error der Zustand kommt aus editable
    { label: "Name", accessibilityState: { disabled: true } },
    // @ts-expect-error käme durch den Spread über den eigenen Zustand
    { label: "Name", "aria-disabled": true },
    // @ts-expect-error käme durch den Spread über den eigenen Zustand
    { label: "Name", "aria-busy": true },
    // @ts-expect-error käme durch den Spread über den eigenen Zustand
    { label: "Name", "aria-checked": true },
    // @ts-expect-error käme durch den Spread über den eigenen Zustand
    { label: "Name", "aria-expanded": true },
    // @ts-expect-error käme durch den Spread über den eigenen Zustand
    { label: "Name", "aria-selected": true },
    // @ts-expect-error die Platzhalterfarbe kommt aus den Tokens (Kontrast)
    { label: "Name", placeholderTextColor: "#FFF" },
  ];
  expect(verboten).toHaveLength(8);
});
