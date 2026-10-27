import { fireEvent, render, screen } from "@testing-library/react-native";

import { Passwortfeld } from "../src/ui/Passwortfeld";

test("«Passwort anzeigen» ist ein Schalter mit Zustand und schaltet secureTextEntry", async () => {
  await render(<Passwortfeld label="Passwort" value="geheim-geheim" />);

  const feld = screen.getByLabelText("Passwort");
  expect(feld).toHaveProp("secureTextEntry", true);

  // Der Name ist der sichtbare Text (Checkliste 1.3), der Zustand wird angesagt (9.8)
  const schalter = screen.getByRole("switch", { name: "Passwort anzeigen" });
  expect(schalter).not.toBeChecked();
  expect(schalter).toHaveStyle({ minHeight: 48, minWidth: 48 });

  await fireEvent.press(schalter);
  expect(schalter).toBeChecked();
  expect(feld).toHaveProp("secureTextEntry", false);

  await fireEvent.press(schalter);
  expect(schalter).not.toBeChecked();
  expect(feld).toHaveProp("secureTextEntry", true);
});

test("tippt klein und ohne Korrektur, Einfügen bleibt erlaubt", async () => {
  await render(
    <Passwortfeld
      label="Passwort"
      autoComplete="current-password"
      textContentType="password"
    />,
  );

  const feld = screen.getByLabelText("Passwort");
  expect(feld).toHaveProp("autoCapitalize", "none");
  expect(feld).toHaveProp("autoCorrect", false);
  expect(feld).toHaveProp("autoComplete", "current-password");
  expect(feld.props.contextMenuHidden).toBeUndefined();
});
