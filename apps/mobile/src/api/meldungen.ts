import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";

import { api, queryClient } from "./client";

const route = api.api.v1.admin.meldungen;

export type MeldungZeile = InferResponseType<
  typeof route.$get,
  200
>["meldungen"][number];

// Offene Meldungen, neueste zuerst, in Seiten zu 50; nur für Admins, nur im Arbeitsspeicher
export function useMeldungen() {
  return useInfiniteQuery({
    queryKey: ["admin", "meldungen"],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const antwort = await route.$get({
        query: pageParam ? { vor: pageParam } : {},
      });
      return antwort.json();
    },
    getNextPageParam: (seite) => seite.naechster ?? undefined,
  });
}

export function useMeldungErledigen() {
  return useMutation({
    mutationFn: (id: string) =>
      route[":id"].$patch({ param: { id }, json: { erledigt: true } }),
    onSuccess: () => queryClient.invalidateQueries(),
  });
}
