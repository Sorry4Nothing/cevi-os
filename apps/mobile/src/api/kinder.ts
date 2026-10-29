import { useMutation, useQuery } from "@tanstack/react-query";
import type { InferRequestType, InferResponseType } from "hono/client";

import { api, queryClient } from "./client";

const route = api.api.v1.admin.kinder;

export type KinderAntwort = InferResponseType<typeof route.$get, 200>;
export type KindZeile = KinderAntwort["kinder"][number];
export type NeuesKind = InferRequestType<typeof route.$post>["json"];
export type KindAenderung = InferRequestType<
  (typeof route)[":id"]["$patch"]
>["json"];

// Alle Kinder der Abteilung, auch inaktive; nur für Admins, nur im Arbeitsspeicher
export function useKinder() {
  return useQuery({
    queryKey: ["admin", "kinder"],
    queryFn: async () => {
      const antwort = await route.$get();
      return antwort.json() as Promise<KinderAntwort>;
    },
  });
}

// Ohne Filter: Kindernamen stehen auch in GET /ich und in der Personenliste
export function useKindAnlegen() {
  return useMutation({
    mutationFn: (json: NeuesKind) => route.$post({ json }),
    onSuccess: () => queryClient.invalidateQueries(),
  });
}

export function useKindAendern() {
  return useMutation({
    mutationFn: ({ id, ...json }: { id: string } & KindAenderung) =>
      route[":id"].$patch({ param: { id }, json }),
    onSuccess: () => queryClient.invalidateQueries(),
  });
}

export function useKindLoeschen() {
  return useMutation({
    mutationFn: (id: string) => route[":id"].$delete({ param: { id } }),
    onSuccess: () => queryClient.invalidateQueries(),
  });
}
