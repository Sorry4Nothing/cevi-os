import { fireEvent, render, screen } from "@testing-library/react-native";

import { Schalter } from "../src/ui/Schalter";

// Das Kästchen ist für Screenreader versteckt, das Häkchen darin sieht man trotzdem
const HIDDEN = { includeHiddenElements: true };

test("ein Schalter mit Name, angesagtem Zustand und 48 × 48 Zielgrösse", async () => {
  const wechseln = jest.fn();
  const { rerender } = await render(
    <Schalter label="App-Sperre" checked={false} onChange={wechseln} />,
  );

  const schalter = screen.getByRole("switch", { name: "App-Sperre" });
  expect(schalter).not.toBeChecked();
  expect(schalter).toHaveStyle({ minHeight: 48, minWidth: 48 });
  // Der Zustand steht nicht nur in der Farbe: An zeigt ein Häkchen
  expect(screen.queryByText("✓", HIDDEN)).toBeNull();

  await fireEvent.press(schalter);
  expect(wechseln).toHaveBeenCalledTimes(1);

  await rerender(<Schalter label="App-Sperre" checked onChange={wechseln} />);
  expect(screen.getByRole("switch", { name: "App-Sperre" })).toBeChecked();
  expect(screen.getByText("✓", HIDDEN)).toBeOnTheScreen();
});
