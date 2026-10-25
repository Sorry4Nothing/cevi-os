import { fireEvent, render, screen } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";

import { Textfeld } from "../src/ui/Textfeld";
import { farben } from "../src/ui/tokens";

beforeEach(() => jest.clearAllMocks());

test("die sichtbare Beschriftung ist der Name des Felds und bleibt beim Tippen stehen", async () => {
  await render(<Textfeld label="Benutzername" value="beispiel" />);

  expect(screen.getByLabelText("Benutzername")).toHaveStyle({ minHeight: 48 });
  // Screenreader hören die Beschriftung am Feld, nicht ein zweites Mal davor
  expect(screen.queryByText("Benutzername")).toBeNull();
  expect(
    screen.getByText("Benutzername", { includeHiddenElements: true }),
  ).toBeOnTheScreen();
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
