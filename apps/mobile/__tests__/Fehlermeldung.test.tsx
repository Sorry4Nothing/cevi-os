import { render, screen } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";

import { Fehlermeldung } from "../src/ui/Fehlermeldung";
import { farben } from "../src/ui/tokens";

beforeEach(() => jest.clearAllMocks());

test("ohne Text steht da nichts und nichts wird fokussiert", async () => {
  await render(<Fehlermeldung />);

  expect(screen.toJSON()).toBeNull();
  expect(AccessibilityInfo.sendAccessibilityEvent).not.toHaveBeenCalled();
});

test("erscheint der Text, nimmt er den Fokus (Checkliste 6.3)", async () => {
  const { rerender } = await render(<Fehlermeldung />);
  await rerender(<Fehlermeldung text="Das hat nicht geklappt." />);

  expect(screen.getByText("Das hat nicht geklappt.")).toHaveStyle({
    color: farben.hell.fehler,
  });
  const [element, art] = jest
    .mocked(AccessibilityInfo.sendAccessibilityEvent)
    .mock.calls.at(-1)!;
  expect(art).toBe("focus");
  expect(
    (element as unknown as { props: { children: string } }).props.children,
  ).toBe("Das hat nicht geklappt.");
});
