import { useMutation, useQuery } from "@tanstack/react-query";

import { api, queryClient } from "./client";

// Der Text der Abteilung für die Hilfe-Seite; die Route steht allen angemeldeten Personen offen
export function useHilfe() {
  return useQuery({
    queryKey: ["hilfe"],
    queryFn: async () => {
      const antwort = await api.api.v1.hilfe.$get();
      return antwort.json();
    },
  });
}

// Nur für Admins; ein leerer Text löscht den Eintrag
export function useVertrauenspersonenSpeichern() {
  return useMutation({
    mutationFn: (vertrauenspersonen: string) =>
      api.api.v1.admin.abteilung.$patch({ json: { vertrauenspersonen } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["hilfe"] }),
  });
}
