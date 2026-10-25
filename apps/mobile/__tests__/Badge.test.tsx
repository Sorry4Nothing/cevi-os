import { render, screen } from "@testing-library/react-native";

import { Badge } from "../src/ui/Badge";
import { farben } from "../src/ui/tokens";

test.each([
  ["positiv", "✓", "Angemeldet", farben.hell.erfolg],
  ["negativ", "✕", "Abgemeldet", farben.hell.fehler],
  ["neutral", "○", "Offen", farben.hell.textLeise],
] as const)(
  "%s zeigt Symbol %s und Text; Screenreader lesen nur den Text",
  async (art, symbol, text, farbe) => {
    await render(<Badge art={art} text={text} />);

    expect(screen.getByText(text)).toHaveStyle({ color: farbe });
    expect(screen.queryByText(symbol)).toBeNull();
    expect(
      screen.getByText(symbol, { includeHiddenElements: true }),
    ).toHaveStyle({ color: farbe });
  },
);
