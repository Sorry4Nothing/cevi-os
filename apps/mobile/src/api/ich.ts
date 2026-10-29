import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "./client";

type Ich = NonNullable<ReturnType<typeof useIch>["data"]>;

// Das eigene Profil mit Rollen, Stufen und Kindern; nur im Arbeitsspeicher
export function useIch(aktiv = true) {
  return useQuery({
    queryKey: ["ich"],
    enabled: aktiv,
    queryFn: async () => {
      const antwort = await api.api.v1.ich.$get();
      return antwort.json();
    },
  });
}

// Ein Schalter, ein Schlüssel; das Ergebnis lebt nur im Schalter (gcTime 0). networkMode always: Offline pausierte TanStack das Schreiben und schickte es später; die Oberfläche sperrt die Schalter ohne Netz
export function usePushEinstellung(schluessel: "pushChat" | "pushProgramme") {
  const queryClient = useQueryClient();
  return useMutation({
    gcTime: 0,
    networkMode: "always",
    mutationFn: async (wert: boolean) => {
      await api.api.v1.ich.$patch({ json: { [schluessel]: wert } });
    },
    onSuccess: (_daten, wert) => {
      queryClient.setQueryData<Ich>(
        ["ich"],
        (alt) => alt && { ...alt, [schluessel]: wert },
      );
    },
  });
}
