import { StyleSheet, Text } from "react-native";

import { authClient, queryClient } from "../../src/api/client";
import { Bildschirm } from "../../src/ui/Bildschirm";
import { Passwortwechsel } from "../../src/ui/Passwortwechsel";
import { schrift, useFarben } from "../../src/ui/tokens";

export default function PasswortSetzen() {
  const farben = useFarben();

  return (
    <Bildschirm titel="Passwort setzen">
      <Text style={[styles.text, { color: farben.text }]}>
        Das Startpasswort gilt nur für die erste Anmeldung. Bitte ein eigenes
        Passwort mit mindestens 12 Zeichen setzen. Danach zeigt die App die
        Daten.
      </Text>
      <Passwortwechsel
        bisherigesLabel="Startpasswort"
        knopfTitel="Passwort setzen"
        senden={async (bisheriges, neues) =>
          // Der Server erzwingt revokeOtherSessions und löscht das Flag; das neue Cookie kommt mit der Antwort
          (
            await authClient.changePassword({
              currentPassword: bisheriges,
              newPassword: neues,
            })
          ).error
        }
        onErfolg={() =>
          void queryClient.invalidateQueries({ queryKey: ["ich"] })
        }
      />
    </Bildschirm>
  );
}

const styles = StyleSheet.create({
  text: { fontSize: schrift.text },
});
