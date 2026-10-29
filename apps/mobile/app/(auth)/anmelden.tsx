import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";

import { authClient } from "../../src/api/client";
import { fehlertext, KEIN_NETZ } from "../../src/api/fehlertexte";
import { Bildschirm } from "../../src/ui/Bildschirm";
import { Button } from "../../src/ui/Button";
import { Fehlermeldung } from "../../src/ui/Fehlermeldung";
import { Passwortfeld } from "../../src/ui/Passwortfeld";
import { Textfeld } from "../../src/ui/Textfeld";

const NOCHMALS = "Bitte nochmals anmelden.";

export default function Anmelden() {
  const router = useRouter();
  const { hinweis } = useLocalSearchParams<{ hinweis?: string }>();
  const [benutzername, setBenutzername] = useState("");
  const [passwort, setPasswort] = useState("");
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string>();

  // Ohne zweiten Faktor übernimmt nach dem Erfolg das Tor in app/_layout.tsx; sonst folgt der Code-Schritt
  async function anmelden() {
    setFehler(undefined);
    setLaeuft(true);
    try {
      const ergebnis = await authClient.signIn.username({
        username: benutzername,
        password: passwort,
      });
      if (ergebnis.error) setFehler(fehlertext(ergebnis.error));
      else if (
        (ergebnis.data as { twoFactorRedirect?: boolean } | null)
          ?.twoFactorRedirect
      ) {
        // Ersetzen statt schieben: Das Passwort bleibt nicht im Zustand dieses Bildschirms zurück
        router.replace("/code");
      }
    } catch {
      setFehler(KEIN_NETZ);
    } finally {
      setLaeuft(false);
    }
  }

  return (
    <Bildschirm titel="Anmelden">
      <Textfeld
        label="Benutzername"
        value={benutzername}
        onChangeText={setBenutzername}
        autoComplete="username"
        textContentType="username"
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Passwortfeld
        label="Passwort"
        value={passwort}
        onChangeText={setPasswort}
        autoComplete="current-password"
        textContentType="password"
      />
      {/* Der Anmeldefehler gehört zu keinem Feld und steht über dem Knopf; der Hinweis ist ein fester Text, nie einer aus der Adresse */}
      <Fehlermeldung
        text={fehler ?? (hinweis === "nochmals" ? NOCHMALS : undefined)}
      />
      <Button
        titel="Anmelden"
        onPress={() => void anmelden()}
        disabled={laeuft}
      />
    </Bildschirm>
  );
}
