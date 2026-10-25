import { render, screen } from "@testing-library/react-native";
import { useColorScheme } from "react-native";

import Start from "../app/index";
import { farben } from "../src/ui/tokens";

afterEach(() => jest.mocked(useColorScheme).mockReset());

test("zeigt «Cevi OS» als Überschrift", async () => {
  await render(<Start />);

  expect(screen.getByRole("header", { name: "Cevi OS" })).toBeOnTheScreen();
});

test.each([
  ["light", farben.hell],
  ["dark", farben.dunkel],
] as const)(
  "im Modus %s malt die App Hintergrund und Überschrift aus den Tokens",
  async (modus, palette) => {
    jest.mocked(useColorScheme).mockReturnValue(modus);

    await render(<Start />);

    expect(screen.root).toHaveStyle({ backgroundColor: palette.hintergrund });
    expect(screen.getByRole("header", { name: "Cevi OS" })).toHaveStyle({
      color: palette.text,
    });
  },
);
