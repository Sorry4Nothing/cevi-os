import { useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text } from "react-native";

import { authClient } from "../../src/api/client";
import { fehlertext, KEIN_NETZ } from "../../src/api/fehlertexte";
import { Bildschirm } from "../../src/ui/Bildschirm";
import { Button } from "../../src/ui/Button";
import { Fehlermeldung } from "../../src/ui/Fehlermeldung";
import { Textfeld } from "../../src/ui/Textfeld";
import { schrift, useFarben } from "../../src/ui/tokens";

// Der Zwischenschritt ist abgelaufen oder aufgebraucht: Das Passwort muss nochmals geprüft werden
const NOCHMALS = new Set([
  "INVALID_TWO_FACTOR_COOKIE",
  "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE",
]);
const FALSCH = new Set(["INVALID_CODE", "INVALID_BACKUP_CODE"]);

export default function Code() {
  const router = useRouter();
  const farben = useFarben();
  const [ersatz, setErsatz] = useState(false);
  const [code, setCode] = useState("");
  const [laeuft, setLaeuft] = useState(false);
  const [feldFehler, setFeldFehler] = useState<string>();
  const [fehler, setFehler] = useState<string>();

  // Nach dem Erfolg übernimmt das Tor in app/_layout.tsx: Die Sitzung ist da, sobald das Plugin sie aufgefrischt hat
  async function senden() {
    setFeldFehler(undefined);
    setFehler(undefined);
    setLaeuft(true);
    try {
      const { error } = ersatz
        ? await authClient.twoFactor.verifyBackupCode({ code })
        : await authClient.twoFactor.verifyTotp({ code });
      if (!error) return;
      if (error.code && NOCHMALS.has(error.code)) {
        router.replace({
          pathname: "/anmelden",
          params: { hinweis: "nochmals" },
        });
      } else if (error.code && FALSCH.has(error.code)) {
        setFeldFehler(fehlertext(error));
      } else {
        setFehler(fehlertext(error));
      }
    } catch {
      setFehler(KEIN_NETZ);
    } finally {
      setLaeuft(false);
    }
  }

  return (
    <Bildschirm
      titel="Code eingeben"
      onZurueck={() => router.replace("/anmelden")}
    >
      {ersatz ? (
        // Gross- und Kleinschreibung zählen: nie ändern, was die Tastatur daraus macht
        <>
          <Textfeld
            key="ersatz"
            label="Ersatzcode"
            value={code}
            onChangeText={setCode}
            fehler={feldFehler}
            autoComplete="off"
            textContentType="none"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text style={[styles.text, { color: farben.textLeise }]}>
            Gross- und Kleinschreibung beachten.
          </Text>
        </>
      ) : (
        <Textfeld
          key="app"
          label="Code aus der App"
          value={code}
          onChangeText={setCode}
          fehler={feldFehler}
          // 2fa-app-otp: Android reicht es nativ weiter; «one-time-code» würde dort zum SMS-Hinweis
          autoComplete="2fa-app-otp"
          textContentType="oneTimeCode"
          keyboardType="number-pad"
        />
      )}
      <Fehlermeldung text={fehler} />
      <Button
        titel="Anmelden"
        onPress={() => void senden()}
        disabled={laeuft}
      />
      <Button
        titel={ersatz ? "Code aus der App verwenden" : "Ersatzcode verwenden"}
        onPress={() => {
          setErsatz((wert) => !wert);
          setCode("");
          setFeldFehler(undefined);
          setFehler(undefined);
        }}
      />
    </Bildschirm>
  );
}

const styles = StyleSheet.create({
  text: { fontSize: schrift.text },
});
