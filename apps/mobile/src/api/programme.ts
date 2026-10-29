import { useMutation, useQuery } from "@tanstack/react-query";
import type { InferRequestType, InferResponseType } from "hono/client";

import { tagInZuerich } from "../programme/zeit";
import { api, ApiFehler, queryClient } from "./client";

export type Programm = InferResponseType<
  typeof api.api.v1.programme.$get
>["programme"][number];

// Mit eigeneAnmeldung nur für Leitende und SL der Stufen des Programms; für alle anderen fehlt der Schlüssel
export type ProgrammDetail = InferResponseType<
  (typeof api.api.v1.programme)[":id"]["$get"],
  200
>;

// Das Sync-Fenster: heute bis heute + 400 Tage, in Schweizer Kalendertagen (die API verlangt beide)
function fenster() {
  const jetzt = Date.now();
  return {
    von: tagInZuerich(new Date(jetzt)),
    bis: tagInZuerich(new Date(jetzt + 400 * 86_400_000)),
  };
}

// gcTime Infinity auf beiden: Die App zeigt die zuletzt geladenen Daten, solange sie läuft; queryClient.clear() leert sie trotzdem
export function useProgramme() {
  return useQuery({
    queryKey: ["programme", "liste"],
    gcTime: Infinity,
    queryFn: async () => {
      const antwort = await api.api.v1.programme.$get({ query: fenster() });
      return (await antwort.json()).programme;
    },
  });
}

export function useProgramm(id: string) {
  return useQuery({
    queryKey: ["programme", id],
    gcTime: Infinity,
    queryFn: async (): Promise<ProgrammDetail | null> => {
      try {
        const antwort = await api.api.v1.programme[":id"].$get({
          param: { id },
        });
        return await antwort.json();
      } catch (fehler) {
        // 404 leert die betroffenen Daten: null heisst «nicht mehr sichtbar», und jede gecachte Liste verliert den Eintrag
        if (fehler instanceof ApiFehler && fehler.status === 404) {
          queryClient.setQueriesData<Programm[]>(
            { queryKey: ["programme", "liste"] },
            (alt) => alt?.filter((programm) => programm.id !== id),
          );
          return null;
        }
        throw fehler;
      }
    },
  });
}

// networkMode always: Offline pausierte TanStack die Anfrage und schickte sie später, womöglich nach dem Programmbeginn
export function useLeitungAnmelden(id: string) {
  return useMutation({
    networkMode: "always",
    mutationFn: (status: "ja" | "nein") =>
      api.api.v1.programme[":id"].leitung.$put({
        param: { id },
        json: { status },
      }),
    // Das Detail kommt neu: bei 204 mit dem neuen Stand, bei 404 leert useProgramm die Daten
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["programme"] }),
    onError: (fehler) => {
      if (fehler instanceof ApiFehler && fehler.status === 404) {
        void queryClient.invalidateQueries({ queryKey: ["programme", id] });
      }
    },
  });
}

export type Auswahlstand = InferRequestType<
  (typeof api.api.v1.programme)[":id"]["zuordnung"]["$put"]
>["json"];

// networkMode always: Offline pausierte TanStack die Anfrage und schickte sie später, womöglich gegen einen dann anderen Stand
export function useZuordnen(id: string) {
  return useMutation({
    networkMode: "always",
    mutationFn: (json: Auswahlstand) =>
      api.api.v1.programme[":id"].zuordnung.$put({ param: { id }, json }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["programme"] }),
    onError: (fehler) => {
      if (!(fehler instanceof ApiFehler)) return;
      // 404: das Detail kommt als «nicht mehr sichtbar»; 403: Jemand hat es geändert, oder die Rollen haben sich geändert
      if (fehler.status === 404 || fehler.status === 403) {
        void queryClient.invalidateQueries({ queryKey: ["programme", id] });
      }
      if (fehler.status === 403) {
        void queryClient.invalidateQueries({ queryKey: ["ich"] });
      }
    },
  });
}

export type Ergaenzungen = InferRequestType<
  (typeof api.api.v1.programme)[":id"]["$patch"]
>["json"];

// networkMode always: Offline pausierte TanStack das Speichern und schickte es später ab; die Meldung «nicht gespeichert» muss stimmen
export function useErgaenzen(id: string) {
  return useMutation({
    networkMode: "always",
    mutationFn: (json: Ergaenzungen) =>
      api.api.v1.programme[":id"].$patch({ param: { id }, json }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["programme"] }),
    onError: (fehler) => {
      // 404: das Detail kommt als «nicht mehr sichtbar». Bei 403 kein Neuladen: Das Flag könnte das Formular samt Meldung ausblenden
      if (fehler instanceof ApiFehler && fehler.status === 404) {
        void queryClient.invalidateQueries({ queryKey: ["programme", id] });
      }
    },
  });
}
