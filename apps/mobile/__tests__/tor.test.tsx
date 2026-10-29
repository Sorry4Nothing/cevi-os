import {
  act,
  fireEvent,
  renderRouter,
  screen,
} from "expo-router/testing-library";

jest.mock("../src/api/client", () => {
  const { useSyncExternalStore } = jest.requireActual("react");
  const { QueryClient } = jest.requireActual("@tanstack/react-query");
  const horcher = new Set<() => void>();
  const zustand = {
    veraltet: false,
    sitzung: { data: null, isPending: false, error: null, refetch: jest.fn() },
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
    __zustand: zustand,
    __setze(aenderung: Partial<typeof zustand>) {
      Object.assign(zustand, aenderung);
      horcher.forEach((melden) => melden());
    },
    useIchMock: () => useSyncExternalStore(abonniere, () => zustand.ich),
    useAppVeraltet: () =>
      useSyncExternalStore(abonniere, () => zustand.veraltet),
    authClient: {
      useSession: () => useSyncExternalStore(abonniere, () => zustand.sitzung),
      signIn: { username: jest.fn() },
      changePassword: jest.fn(),
      revokeSessions: jest.fn(),
    },
    queryClient: new QueryClient(),
    abmelden: jest.fn(),
    useOnline: () => true,
    api: {
      api: {
        v1: {
          ich: { datenschutz: { $post: jest.fn() } },
          programme: {
            $get: jest.fn(async () => ({
              json: async () => ({ programme: [] }),
            })),
          },
        },
      },
    },
    ApiFehler: class ApiFehler extends Error {},
  };
});
jest.mock("../src/api/ich", () => ({
  useIch: () =>
    (
      jest.requireMock("../src/api/client") as { useIchMock: () => unknown }
    ).useIchMock(),
}));

type Klient = {
  __setze: (aenderung: object) => void;
  queryClient: import("@tanstack/react-query").QueryClient;
};
const klient = jest.requireMock("../src/api/client") as Klient;

const SITZUNG = {
  data: { user: { id: "u1" } },
  isPending: false,
  error: null,
  refetch: jest.fn(),
};
const ICH_BEREIT = {
  data: {
    name: "Eltern A",
    benutzername: "eltern.a",
    admin: false,
    mussPasswortAendern: false,
    datenschutzGelesenAm: "2026-10-01T00:00:00.000Z",
    rollen: [],
    stufen: [],
    kinder: [],
  },
  isPending: false,
  isError: false,
  refetch: jest.fn(),
};

beforeEach(() => {
  klient.queryClient.clear();
  klient.__setze({
    veraltet: false,
    sitzung: { data: null, isPending: false, error: null, refetch: jest.fn() },
    ich: {
      data: undefined,
      isPending: false,
      isError: false,
      refetch: jest.fn(),
    },
  });
});

test("ohne Sitzung landet jede Adresse auf «Anmelden»", async () => {
  await renderRouter("./app", { initialUrl: "/" });

  expect(screen).toHavePathname("/anmelden");
  expect(screen.getByRole("header", { name: "Anmelden" })).toBeOnTheScreen();
});

test("mit offenem Pflichtwechsel zeigt die App nur «Passwort setzen»", async () => {
  klient.__setze({
    sitzung: SITZUNG,
    ich: {
      ...ICH_BEREIT,
      data: { ...ICH_BEREIT.data, mussPasswortAendern: true },
    },
  });
  await renderRouter("./app", { initialUrl: "/" });

  expect(screen).toHavePathname("/passwort-setzen");
});

test("nach dem Pflichtwechsel folgt der Datenschutz-Hinweis, erst gelesen öffnen sich die Tabs", async () => {
  klient.__setze({
    sitzung: SITZUNG,
    ich: {
      ...ICH_BEREIT,
      data: { ...ICH_BEREIT.data, datenschutzGelesenAm: null },
    },
  });
  await renderRouter("./app", { initialUrl: "/" });
  expect(screen).toHavePathname("/datenschutz");

  // «/» leitet auf den ersten Tab weiter
  await act(async () => klient.__setze({ ich: ICH_BEREIT }));
  expect(screen).toHavePathname("/programme");
  expect(
    await screen.findByRole("header", { name: "Programme" }),
  ).toBeOnTheScreen();
});

test("solange Sitzung oder «ich» laden, steht «Wird geladen …»", async () => {
  klient.__setze({ sitzung: { ...SITZUNG, data: null, isPending: true } });
  await renderRouter("./app", { initialUrl: "/" });

  expect(screen.getByText("Wird geladen …")).toBeOnTheScreen();
});

test("ein Fehler ohne Daten zeigt «Nochmals versuchen», nicht «Anmelden»", async () => {
  const neuLaden = jest.fn();
  klient.__setze({
    sitzung: {
      data: null,
      isPending: false,
      error: new Error("offline"),
      refetch: neuLaden,
    },
  });
  await renderRouter("./app", { initialUrl: "/" });

  expect(screen.queryByRole("header", { name: "Anmelden" })).toBeNull();
  await fireEvent.press(
    screen.getByRole("button", { name: "Nochmals versuchen" }),
  );
  expect(neuLaden).toHaveBeenCalled();
});

test("426 legt sich als «Bitte App aktualisieren» über alles", async () => {
  klient.__setze({ sitzung: SITZUNG, ich: ICH_BEREIT, veraltet: true });
  await renderRouter("./app", { initialUrl: "/" });

  expect(
    screen.getByRole("header", { name: "Bitte App aktualisieren" }),
  ).toBeOnTheScreen();
});

test("endet die Sitzung, leert das Tor den Query-Cache (geteilte Handys)", async () => {
  klient.__setze({ sitzung: SITZUNG, ich: ICH_BEREIT });
  await renderRouter("./app", { initialUrl: "/" });
  klient.queryClient.setQueryData(["ich"], ICH_BEREIT.data);

  await act(async () =>
    klient.__setze({
      sitzung: {
        data: null,
        isPending: false,
        error: null,
        refetch: jest.fn(),
      },
    }),
  );

  expect(screen).toHavePathname("/anmelden");
  expect(klient.queryClient.getQueryData(["ich"])).toBeUndefined();
});
