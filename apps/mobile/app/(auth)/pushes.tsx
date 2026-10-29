import * as Notifications from "expo-notifications";
import { useState } from "react";
import { StyleSheet, Text } from "react-native";

import { kanaeleAnlegen, schliesseSchrittAb } from "../../src/push";
import { Bildschirm } from "../../src/ui/Bildschirm";
import { Button } from "../../src/ui/Button";
import { schrift, useFarben } from "../../src/ui/tokens";

// Kurze Erklärung vor der Systemfrage; entscheiden tut der System-Dialog, nicht die App
const ERKLAERUNG = [
  "Pushes melden zum Beispiel, wenn sich ein Programm ändert oder abgesagt wird oder im Chat eine neue Nachricht ankommt.",
  "Ein Push enthält nie den Text einer Nachricht und nie Namen von Kindern.",
  "Nach «Weiter» fragt das Handy, ob Cevi OS Pushes schicken darf. Das lässt sich später in den Einstellungen des Handys ändern.",
];

export default function Pushes() {
  const farben = useFarben();
  const [laeuft, setLaeuft] = useState(false);

  // Kanäle vor der Frage (Android 13+ fragt sonst gar nicht); zu den Tabs geht es, was immer das System antwortet
  async function weiter() {
    setLaeuft(true);
    try {
      await kanaeleAnlegen();
      await Notifications.requestPermissionsAsync();
    } catch {
      // Auch ohne Antwort des Systems endet der Schritt; registriert wird nur mit Erlaubnis
    }
    schliesseSchrittAb();
  }

  return (
    <Bildschirm titel="Pushes">
      {ERKLAERUNG.map((satz) => (
        <Text key={satz} style={[styles.text, { color: farben.text }]}>
          {satz}
        </Text>
      ))}
      <Button titel="Weiter" onPress={() => void weiter()} disabled={laeuft} />
    </Bildschirm>
  );
}

const styles = StyleSheet.create({
  text: { fontSize: schrift.text },
});
