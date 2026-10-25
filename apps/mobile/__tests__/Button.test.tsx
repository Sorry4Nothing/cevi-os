import { fireEvent, render, screen } from "@testing-library/react-native";

import { Button } from "../src/ui/Button";

test("hat die Rolle Button und den sichtbaren Text als Namen", async () => {
  const onPress = jest.fn();
  await render(<Button titel="Speichern" onPress={onPress} />);

  const button = screen.getByRole("button", {
    name: "Speichern",
    disabled: false,
  });
  expect(button).toHaveStyle({ minHeight: 48, minWidth: 48 });

  await fireEvent.press(button);
  expect(onPress).toHaveBeenCalledTimes(1);
});

test("gesperrt sagt er den Zustand an und löst nichts aus", async () => {
  const onPress = jest.fn();
  await render(<Button titel="Speichern" onPress={onPress} disabled />);

  await fireEvent.press(
    screen.getByRole("button", { name: "Speichern", disabled: true }),
  );
  expect(onPress).not.toHaveBeenCalled();
});

test("gibt den Hinweis an Screenreader weiter", async () => {
  await render(
    <Button
      titel="Nochmals versuchen"
      onPress={jest.fn()}
      hinweis="Lädt die Programme neu"
    />,
  );

  expect(screen.getByRole("button", { name: "Nochmals versuchen" })).toHaveProp(
    "accessibilityHint",
    "Lädt die Programme neu",
  );
});
