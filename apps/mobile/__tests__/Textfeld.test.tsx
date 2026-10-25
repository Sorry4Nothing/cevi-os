import { fireEvent, render, screen } from "@testing-library/react-native";
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

test("ein Fehler steht beim Feld, wird angesagt und am Feld vorgelesen", async () => {
  await render(<Textfeld label="Passwort" fehler="Das Passwort fehlt." />);

  expect(screen.getByText("Das Passwort fehlt.")).toHaveStyle({
    color: farben.hell.fehler,
  });
  expect(
    AccessibilityInfo.announceForAccessibilityWithOptions,
  ).toHaveBeenCalledWith("Das Passwort fehlt.", { queue: true });
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
