import { render, screen } from "@testing-library/react-native";
import { useColorScheme } from "react-native";

import Start from "../app/index";

test("zeigt «Cevi OS» als Überschrift", async () => {
  await render(<Start />);

  expect(screen.getByRole("header", { name: "Cevi OS" })).toBeOnTheScreen();
});

test.each([
  ["light", "#000"],
  ["dark", "#fff"],
] as const)(
  "Überschrift im Modus %s hat die Farbe %s",
  async (modus, farbe) => {
    jest.mocked(useColorScheme).mockReturnValue(modus);

    await render(<Start />);

    expect(screen.getByRole("header", { name: "Cevi OS" })).toHaveStyle({
      color: farbe,
    });
  },
);
