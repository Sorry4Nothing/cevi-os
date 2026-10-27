import { useState } from "react";
import { StyleSheet, Text } from "react-native";

import { api, ApiFehler, queryClient } from "../../src/api/client";
import { fehlertext, KEIN_NETZ } from "../../src/api/fehlertexte";
import { Bildschirm } from "../../src/ui/Bildschirm";
import { Button } from "../../src/ui/Button";
import { Fehlermeldung } from "../../src/ui/Fehlermeldung";
import { schrift, useFarben } from "../../src/ui/tokens";

// Kenntnisnahme, keine Einwilligung; die Texte folgen den Grundsätzen des Bedrohungsmodells
const HINWEIS = [
  "Der Server speichert zu dir Name, Benutzername und deine Rollen; eine Telefonnummer nur, wenn du sie als Stufenleitung freiwillig angibst. Zu Kindern speichert er nur Vor- und Nachname und Stufe. Keine E-Mail-Adresse, keine Fotos.",
  "Es gibt kein Tracking und keine Analyse.",
  "Die App speichert keine Serverdaten auf dem Gerät. Sie hält sie nur im Arbeitsspeicher, solange sie läuft.",
  "Nur das Sitzungs-Token liegt im geschützten Speicher des Geräts (Secure Store).",
];

export default function Datenschutz() {
  const farben = useFarben();
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string>();

  async function gelesen() {
    setFehler(undefined);
    setLaeuft(true);
    try {
      await api.api.v1.ich.datenschutz.$post();
      await queryClient.invalidateQueries({ queryKey: ["ich"] });
    } catch (grund) {
      setFehler(grund instanceof ApiFehler ? fehlertext(grund) : KEIN_NETZ);
    } finally {
      setLaeuft(false);
    }
  }

  return (
    <Bildschirm titel="Datenschutz-Hinweis">
      {HINWEIS.map((satz) => (
        <Text key={satz} style={[styles.text, { color: farben.text }]}>
          {satz}
        </Text>
      ))}
      <Fehlermeldung text={fehler} />
      <Button
        titel="Gelesen"
        onPress={() => void gelesen()}
        disabled={laeuft}
      />
    </Bildschirm>
  );
}

const styles = StyleSheet.create({
  text: { fontSize: schrift.text },
});
