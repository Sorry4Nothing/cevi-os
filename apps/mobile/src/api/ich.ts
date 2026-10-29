import { useQuery } from "@tanstack/react-query";

import { api } from "./client";

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
