import {
  onlineManager,
  QueryClientProvider,
  type QueryClient,
} from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { type ReactNode } from "react";
import { AccessibilityInfo } from "react-native";

import Profil from "../app/(tabs)/profil";
import { queryClient } from "../src/api/client";
import { usePushEinstellung } from "../src/api/ich";
import { json, netz, PERSONAS } from "./hilfen/programme";

jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));

const FEHLER = "Die Einstellung liess sich nicht speichern.";

// Wie der Server: GET /ich zeigt, was erfolgreiche PATCH-Aufrufe geschrieben haben; der Body jedes PATCH wird aufgezeichnet
function mockeIch(
  person: (typeof PERSONAS)[keyof typeof PERSONAS],
  patch: (n: number) => Response | Promise<Response> = () =>
    new Response(null, { status: 204 }),
) {
  const patches: unknown[] = [];
  let aktuell = { ...person };
  netz.mockImplementation(async (_url: unknown, init?: RequestInit) => {
    if (init?.method === "PATCH") {
      const body = JSON.parse(String(init.body));
      patches.push(body);
      const antwort = await patch(patches.length);
      if (antwort.ok) aktuell = { ...aktuell, ...body };
      return antwort;
    }
    return json(200, aktuell);
  });
  return patches;
}

function Rahmen({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient as QueryClient}>
      {children}
    </QueryClientProvider>
  );
}

const chat = () => screen.getByRole("switch", { name: /^Chat-Pushes/ });
const programme = () =>
  screen.getByRole("switch", { name: /^Programm-Pushes/ });

beforeEach(() => {
  jest.clearAllMocks();
  queryClient.clear();
  onlineManager.setOnline(true);
});

describe.each(Object.entries(PERSONAS))("%s", (_rolle, person) => {
  test("beide Schalter haben Name, Rolle und Zustand aus GET /ich", async () => {
    mockeIch({ ...person, pushProgramme: false });
    await render(<Profil />, { wrapper: Rahmen });

    await screen.findByText(person.name);
    expect(chat()).toBeChecked();
    expect(programme()).not.toBeChecked();
    expect(chat()).toHaveStyle({ minHeight: 48, minWidth: 48 });
    expect(screen.getByRole("header", { name: "Pushes" })).toBeOnTheScreen();
  });

  test("ein Tipp sendet nur diesen Schlüssel und der Schalter bleibt, wie getippt", async () => {
    const patches = mockeIch(person);
    await render(<Profil />, { wrapper: Rahmen });
    await screen.findByText(person.name);

    await fireEvent.press(chat());
    await waitFor(() => expect(patches).toEqual([{ pushChat: false }]));
    await waitFor(() =>
      expect(
        queryClient.getQueryData<{ pushChat: boolean }>(["ich"]),
      ).toMatchObject({
        pushChat: false,
        pushProgramme: true,
      }),
    );
    await waitFor(() => expect(chat()).not.toBeChecked());
    expect(programme()).toBeChecked();
    expect(screen.queryByText(FEHLER)).toBeNull();

    await fireEvent.press(programme());
    await waitFor(() =>
      expect(patches).toEqual([{ pushChat: false }, { pushProgramme: false }]),
    );
    await waitFor(() => expect(programme()).not.toBeChecked());
  });

  test("scheitert das Speichern, steht wieder der Wert des Servers da, mit Meldung und Fokus; der nächste Tipp räumt sie weg", async () => {
    let zweite!: () => void;
    const patches = mockeIch(person, (n) =>
      n === 1
        ? json(500, { code: "INTERNER_FEHLER", message: "x" })
        : new Promise((fertig) => {
            zweite = () => fertig(json(500, { code: "X", message: "x" }));
          }),
    );
    await render(<Profil />, { wrapper: Rahmen });
    await screen.findByText(person.name);

    await fireEvent.press(programme());
    const meldung = await screen.findByText(FEHLER);
    expect(programme()).toBeChecked();
    const [element] = jest
      .mocked(AccessibilityInfo.sendAccessibilityEvent)
      .mock.calls.at(-1)!;
    expect(
      (element as unknown as { props: { children: unknown } }).props.children,
    ).toBe(meldung.props.children);

    // Der zweite Versuch läuft noch: Die alte Meldung ist weg
    await fireEvent.press(programme());
    await waitFor(() => expect(screen.queryByText(FEHLER)).toBeNull());
    await act(() => zweite());
    await screen.findByText(FEHLER);
    expect(patches).toHaveLength(2);
  });

  test("ohne Netz sind beide Schalter gesperrt und senden nichts", async () => {
    const patches = mockeIch(person);
    await render(<Profil />, { wrapper: Rahmen });
    await screen.findByText(person.name);

    await act(() => onlineManager.setOnline(false));

    expect(chat()).toBeDisabled();
    expect(programme()).toBeDisabled();
    await fireEvent.press(chat());
    expect(patches).toEqual([]);
  });
});

test("Taps während des Speicherns zählen nicht", async () => {
  let antworten!: () => void;
  const patches: unknown[] = [];
  netz.mockImplementation(async (_url: unknown, init?: RequestInit) => {
    if (init?.method !== "PATCH") return json(200, PERSONAS.eltern);
    patches.push(JSON.parse(String(init.body)));
    await new Promise<void>((fertig) => (antworten = fertig));
    return new Response(null, { status: 204 });
  });
  await render(<Profil />, { wrapper: Rahmen });
  await screen.findByText(PERSONAS.eltern.name);

  await fireEvent.press(chat());
  await waitFor(() => expect(patches).toHaveLength(1));
  // Noch ohne Antwort zeigt der Schalter schon den neuen Zustand
  await waitFor(() => expect(chat()).not.toBeChecked());
  await fireEvent.press(chat());
  await act(() => antworten());

  await waitFor(() =>
    expect(queryClient.getQueryData(["ich"])).toMatchObject({
      pushChat: false,
    }),
  );
  expect(patches).toEqual([{ pushChat: false }]);
});

// Counter-Check für networkMode: TanStack pausierte das Schreiben offline und schickte es später
test("das Schreiben wartet nicht auf die Netzmeldung von TanStack", async () => {
  const patches = mockeIch(PERSONAS.eltern);
  const { result } = await renderHook(() => usePushEinstellung("pushChat"), {
    wrapper: Rahmen,
  });
  // Erst nach dem Abonnieren: Der Netz-Horcher meldet beim Start einmal «online»
  await act(() => onlineManager.setOnline(false));

  await act(() => result.current.mutate(false));

  await waitFor(() => expect(patches).toEqual([{ pushChat: false }]));
});
