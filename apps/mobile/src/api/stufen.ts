import { useMutation, useQuery } from "@tanstack/react-query";
import type { InferRequestType, InferResponseType } from "hono/client";

import { api, queryClient } from "./client";

const route = api.api.v1.stufen;
const adminRoute = api.api.v1.admin.stufen;

export type StufenAntwort = InferResponseType<typeof route.$get, 200>;
export type StufeZeile = StufenAntwort["stufen"][number];
export type NeueStufe = InferRequestType<typeof adminRoute.$post>["json"];
export type StufeAenderung = InferRequestType<
  (typeof adminRoute)[":id"]["$patch"]
>["json"];

// Alle Stufen der Abteilung, nach Reihenfolge; auch Eltern dürfen sie lesen
export function useStufen() {
  return useQuery({
    queryKey: ["stufen"],
    queryFn: async () => {
      const antwort = await route.$get();
      return antwort.json() as Promise<StufenAntwort>;
    },
  });
}

// Ohne Filter: Der Stufenname steht auch in GET /ich und in der Personenliste
export function useStufeAnlegen() {
  return useMutation({
    mutationFn: (json: NeueStufe) => adminRoute.$post({ json }),
    onSuccess: () => queryClient.invalidateQueries(),
  });
}

export function useStufeAendern() {
  return useMutation({
    mutationFn: ({ id, ...json }: { id: string } & StufeAenderung) =>
      adminRoute[":id"].$patch({ param: { id }, json }),
    onSuccess: () => queryClient.invalidateQueries(),
  });
}
