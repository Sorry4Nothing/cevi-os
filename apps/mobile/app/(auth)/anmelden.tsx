import { useState } from "react";

import { authClient } from "../../src/api/client";
import { fehlertext, KEIN_NETZ } from "../../src/api/fehlertexte";
import { Bildschirm } from "../../src/ui/Bildschirm";
import { Button } from "../../src/ui/Button";
import { Fehlermeldung } from "../../src/ui/Fehlermeldung";
import { Passwortfeld } from "../../src/ui/Passwortfeld";
import { Textfeld } from "../../src/ui/Textfeld";

export default function Anmelden() {
  const [benutzername, setBenutzername] = useState("");
  const [passwort, setPasswort] = useState("");
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string>();

  // Nach dem Erfolg übernimmt das Tor in app/_layout.tsx; eine twoFactorRedirect-Antwort gibt es erst mit #23
  async function anmelden() {
    setFehler(undefined);
    setLaeuft(true);
    try {
      const ergebnis = await authClient.signIn.username({
        username: benutzername,
        password: passwort,
      });
      if (ergebnis.error) setFehler(fehlertext(ergebnis.error));
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
      {/* Der Anmeldefehler gehört zu keinem Feld und steht über dem Knopf */}
      <Fehlermeldung text={fehler} />
      <Button
        titel="Anmelden"
        onPress={() => void anmelden()}
        disabled={laeuft}
      />
    </Bildschirm>
  );
}
