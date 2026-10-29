import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";

import { api, queryClient } from "./client";

export type Chat = InferResponseType<
  typeof api.api.v1.chats.$get
>["chats"][number];

export type Nachricht = InferResponseType<
  (typeof api.api.v1.chats)[":id"]["nachrichten"]["$get"],
  200
>["nachrichten"][number];

// shortcut: Abruf alle 30 s (Liste) und 5 s (offener Chat), auf SSE oder WebSocket umstellen, erst wenn Polling spürbar stört
export const LISTE_INTERVALL = 30_000;
export const CHAT_INTERVALL = 5_000;

// gcTime Infinity wie bei den Programmen: Die App zeigt die zuletzt geladenen Daten, solange sie läuft; queryClient.clear() leert sie trotzdem
export function useChats() {
  return useQuery({
    queryKey: ["chats", "liste"],
    gcTime: Infinity,
    refetchInterval: LISTE_INTERVALL,
    queryFn: async () => {
      const antwort = await api.api.v1.chats.$get();
      return (await antwort.json()).chats;
    },
  });
}

// Seiten zu 50, neueste zuerst; jede Seite nennt den Cursor der nächsten. Poll nur, solange der Chat offen ist
export function useNachrichten(id: string, offen: boolean) {
  return useInfiniteQuery({
    queryKey: ["chats", id, "nachrichten"],
    gcTime: Infinity,
    refetchInterval: offen ? CHAT_INTERVALL : false,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const antwort = await api.api.v1.chats[":id"].nachrichten.$get({
        param: { id },
        query: pageParam ? { vor: pageParam } : {},
      });
      return antwort.json();
    },
    getNextPageParam: (seite) => seite.naechster ?? undefined,
  });
}

// Eltern nennen nur die Stufe, eine SL zusätzlich das Elternteil; der zweite Aufruf liefert denselben Chat
export function useEinzelchatBeginnen() {
  return useMutation({
    mutationFn: async (ziel: { stufeId: string; elternUserId?: string }) => {
      const antwort = await api.api.v1.chats.direkt.$post({ json: ziel });
      return (await antwort.json()).id;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["chats", "liste"] }),
  });
}

// Nur der Text: Der Bezug auf ein Programm kommt mit dem Knopf «Kontakt» (#92)
export function useNachrichtSenden(id: string) {
  return useMutation({
    mutationFn: (text: string) =>
      api.api.v1.chats[":id"].nachrichten.$post({
        param: { id },
        json: { text },
      }),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: ["chats", id, "nachrichten"] }),
  });
}
