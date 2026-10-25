import { render, screen } from "@testing-library/react-native";

import Start from "../app/index";

test("zeigt «Cevi OS» als Überschrift", async () => {
  await render(<Start />);

  expect(screen.getByRole("header", { name: "Cevi OS" })).toBeOnTheScreen();
});
