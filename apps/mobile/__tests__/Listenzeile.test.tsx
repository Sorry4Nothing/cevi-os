import { fireEvent, render, screen } from "@testing-library/react-native";

import { Listenzeile } from "../src/ui/Listenzeile";

test("hat die Rolle Button; der Name beginnt mit dem Titel", async () => {
  const onPress = jest.fn();
  await render(
    <Listenzeile titel="Waldtag" text="Samstag, 14 Uhr" onPress={onPress} />,
  );

  const zeile = screen.getByRole("button", {
    name: "Waldtag, Samstag, 14 Uhr",
    disabled: false,
  });
  expect(zeile).toHaveStyle({ minHeight: 48, minWidth: 48 });

  await fireEvent.press(zeile);
  expect(onPress).toHaveBeenCalledTimes(1);
});

test("ohne Zweitzeile ist der Titel der Name", async () => {
  await render(<Listenzeile titel="Waldtag" onPress={jest.fn()} />);

  expect(screen.getByRole("button", { name: "Waldtag" })).toBeOnTheScreen();
});

test("ein Badge steht zwischen Titel und Text und wird in dieser Reihenfolge angesagt", async () => {
  await render(
    <Listenzeile
      titel="Waldtag"
      badge={{ text: "Abgesagt", art: "negativ" }}
      text="Samstag, 14 Uhr"
      onPress={jest.fn()}
    />,
  );

  expect(
    screen.getByRole("button", { name: "Waldtag, Abgesagt, Samstag, 14 Uhr" }),
  ).toBeOnTheScreen();
  expect(screen.getByText("Abgesagt")).toBeOnTheScreen();
});
