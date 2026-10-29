import { useMutation } from "@tanstack/react-query";
import { Alert } from "react-native";

import { abmelden, api } from "./client";

// Das Passwort ist die Variable und lebt nur so lange wie die Mutation (gcTime 0).
// networkMode always: Offline pausierte TanStack die Anfrage und schickte das Passwort später ungefragt
export function useKontoLoeschen() {
  return useMutation({
    gcTime: 0,
    networkMode: "always",
    mutationFn: (passwort: string) =>
      api.api.v1.ich.$delete({ json: { passwort } }),
    // Hier statt in mutate(): Dessen Callbacks entfallen, sobald der Bildschirm mit der Sitzung verschwindet
    onSuccess: async () => {
      // Leert den Secure Store und den Cache; der native Dialog bleibt über «Anmelden» stehen, bis «OK» (Checkliste 8.2)
      await abmelden();
      Alert.alert("Das Konto ist gelöscht.");
    },
  });
}
