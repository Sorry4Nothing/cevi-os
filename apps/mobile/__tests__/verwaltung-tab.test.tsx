import { renderRouter, screen } from "expo-router/testing-library";

jest.mock("../src/api/client", () => {
  const { useSyncExternalStore } = jest.requireActual("react");
  const { QueryClient } = jest.requireActual("@tanstack/react-query");
  const horcher = new Set<() => void>();
  const zustand = {
    veraltet: false,
    sitzung: {
      data: { user: { id: "u1" } },
      isPending: false,
      error: null,
      refetch: jest.fn(),
    },
    ich: {
      data: undefined,
      isPending: false,
      isError: false,
      refetch: jest.fn(),
    },
  };
  const abonniere = (melden: () => void) => {
    horcher.add(melden);
    return () => horcher.delete(melden);
  };
  return {
    __setze(aenderung: Partial<typeof zustand>) {
      Object.assign(zustand, aenderung);
      horcher.forEach((melden) => melden());
    },
    useIchMock: () => useSyncExternalStore(abonniere, () => zustand.ich),
    useAppVeraltet: () =>
      useSyncExternalStore(abonniere, () => zustand.veraltet),
    useOnline: () => true,
    authClient: {
      useSession: () => useSyncExternalStore(abonniere, () => zustand.sitzung),
      signIn: { username: jest.fn() },
      changePassword: jest.fn(),
      revokeSessions: jest.fn(),
    },
    queryClient: new QueryClient(),
    abmelden: jest.fn(),
    api: { api: { v1: { ich: { datenschutz: { $post: jest.fn() } } } } },
    ApiFehler: class ApiFehler extends Error {},
  };
});
jest.mock("../src/api/ich", () => ({
  useIch: () =>
    (
      jest.requireMock("../src/api/client") as { useIchMock: () => unknown }
    ).useIchMock(),
}));
jest.mock("../src/api/personen", () => ({
  usePersonen: () => ({
    data: { personen: [], stufen: [], kinder: [] },
    isPending: false,
    refetch: jest.fn(),
  }),
  usePersonAnlegen: jest.fn(),
  usePersonAendern: jest.fn(),
  useNeuesStartpasswort: jest.fn(),
  usePersonDeaktivieren: jest.fn(),
  usePersonAktivieren: jest.fn(),
  usePersonLoeschen: jest.fn(),
}));

const klient = jest.requireMock("../src/api/client") as {
  __setze: (aenderung: object) => void;
};

const ich = (admin: boolean) => ({
  data: {
    name: "Person",
    benutzername: "person",
    mussPasswortAendern: false,
    datenschutzGelesenAm: "2026-10-01T00:00:00.000Z",
    admin,
  },
  isPending: false,
  isError: false,
  refetch: jest.fn(),
});

test("ohne admin aus GET /ich gibt es den Tab «Verwaltung» nicht, und /verwaltung leitet um", async () => {
  klient.__setze({ ich: ich(false) });
  await renderRouter("./app", { initialUrl: "/verwaltung" });

  expect(screen.queryByText("Verwaltung")).toBeNull();
  expect(screen).not.toHavePathname("/verwaltung");
});

test("mit admin steht der Tab «Verwaltung» nach «Profil» und öffnet die Startseite der Verwaltung", async () => {
  klient.__setze({ ich: ich(true) });
  await renderRouter("./app", { initialUrl: "/verwaltung" });

  expect(screen).toHavePathname("/verwaltung");
  expect(
    await screen.findByRole("header", { name: "Verwaltung" }),
  ).toBeOnTheScreen();
  // Die Tab-Leiste führt alle drei Tabs in dieser Reihenfolge
  const tabs = ["Programme", "Profil", "Verwaltung"].map(
    (titel) => screen.getAllByText(titel)[0],
  );
  expect(tabs.every(Boolean)).toBe(true);
});
