import { useQuery } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";

import { tagInZuerich } from "../programme/zeit";
import { api, ApiFehler, queryClient } from "./client";

export type Programm = InferResponseType<
  typeof api.api.v1.programme.$get
>["programme"][number];

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
    queryFn: async (): Promise<Programm | null> => {
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
