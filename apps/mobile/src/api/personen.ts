import { useMutation, useQuery } from "@tanstack/react-query";
import type { InferRequestType, InferResponseType } from "hono/client";

import { api, queryClient } from "./client";

const route = api.api.v1.admin.personen;

export type PersonenAntwort = InferResponseType<typeof route.$get, 200>;
export type PersonZeile = PersonenAntwort["personen"][number];
export type NeuePerson = InferRequestType<typeof route.$post>["json"];
export type PersonAenderung = InferRequestType<
  (typeof route)[":id"]["$patch"]
>["json"];

// Alle Personen, Stufen und Kinder der Abteilung; nur für Admins, nur im Arbeitsspeicher
export function usePersonen() {
  return useQuery({
    queryKey: ["admin", "personen"],
    queryFn: async () => {
      const antwort = await route.$get();
      return antwort.json() as Promise<PersonenAntwort>;
    },
  });
}

// Das Startpasswort lebt nur im Zustand dieser Mutation (gcTime 0): nie im Query-Cache, in Routen-Parametern oder im Secure Store
export function usePersonAnlegen() {
  return useMutation({
    gcTime: 0,
    mutationFn: async (json: NeuePerson) => {
      const antwort = await route.$post({ json });
      // Jede Nicht-OK-Antwort wirft im Client, hier ist es die 201
      return antwort.json() as Promise<
        InferResponseType<typeof route.$post, 201>
      >;
    },
    onSuccess: () => queryClient.invalidateQueries(),
  });
}

export function useNeuesStartpasswort() {
  return useMutation({
    gcTime: 0,
    mutationFn: async (id: string) => {
      const antwort = await route[":id"].startpasswort.$post({
        param: { id },
      });
      return antwort.json() as Promise<
        InferResponseType<(typeof route)[":id"]["startpasswort"]["$post"], 200>
      >;
    },
    onSuccess: () => queryClient.invalidateQueries(),
  });
}

// Ohne Filter: Name, Rollen und admin stecken auch in GET /ich, und eine Selbst-Zurückstufung blendet den Tab aus
export function usePersonAendern() {
  return useMutation({
    mutationFn: ({ id, ...json }: { id: string } & PersonAenderung) =>
      route[":id"].$patch({ param: { id }, json }),
    onSuccess: () => queryClient.invalidateQueries(),
  });
}

export function usePersonDeaktivieren() {
  return useMutation({
    mutationFn: (id: string) =>
      route[":id"].deaktivieren.$post({ param: { id } }),
    onSuccess: () => queryClient.invalidateQueries(),
  });
}

export function usePersonAktivieren() {
  return useMutation({
    mutationFn: (id: string) =>
      route[":id"].aktivieren.$post({ param: { id } }),
    onSuccess: () => queryClient.invalidateQueries(),
  });
}

export function usePersonLoeschen() {
  return useMutation({
    mutationFn: (id: string) => route[":id"].$delete({ param: { id } }),
    onSuccess: () => queryClient.invalidateQueries(),
  });
}
