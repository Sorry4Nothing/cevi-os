import { useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text } from "react-native";

import { ApiFehler } from "../../../src/api/client";
import { fehlertext, KEIN_NETZ } from "../../../src/api/fehlertexte";
import {
  useHilfe,
  useVertrauenspersonenSpeichern,
} from "../../../src/api/hilfe";
import { Ansage } from "../../../src/ui/Ansage";
import { Bildschirm } from "../../../src/ui/Bildschirm";
import { Button } from "../../../src/ui/Button";
import { Fehlermeldung } from "../../../src/ui/Fehlermeldung";
import { Textfeld } from "../../../src/ui/Textfeld";
import { schrift, useFarben } from "../../../src/ui/tokens";

// Die Obergrenze der API (VERTRAUENSPERSONEN_MAX)
const MAX = 2000;

export default function Vertrauenspersonen() {
  const farben = useFarben();
  const router = useRouter();
  const hilfe = useHilfe();
  const speichern = useVertrauenspersonenSpeichern();
  // Bis die Person tippt, steht der gespeicherte Text im Feld
  const [eingabe, setEingabe] = useState<string>();
  const [gespeichert, setGespeichert] = useState<string>();
  const text = eingabe ?? hilfe.data?.vertrauenspersonen ?? "";

  function speichernGedrueckt() {
    setGespeichert(undefined);
    speichern.mutate(text, {
      onSuccess: () => {
        setEingabe(undefined);
        setGespeichert("Gespeichert.");
      },
    });
  }

  return (
    <Bildschirm
      titel="Vertrauenspersonen"
      zustand={hilfe.data ? "bereit" : hilfe.isPending ? "laden" : "fehler"}
      onNeuLaden={() => void hilfe.refetch()}
      onZurueck={() => router.back()}
    >
      <Text style={[styles.text, { color: farben.text }]}>
        Name, Funktion und Erreichbarkeit der Vertrauenspersonen. Alle
        angemeldeten Personen sehen den Text unter «Profil», «Hilfe». Mindestens
        eine Person gehört keinem SL-Team an.
      </Text>
      <Textfeld
        label="Text für die Hilfe-Seite"
        value={text}
        onChangeText={setEingabe}
        multiline
        maxLength={MAX}
        maxHoehe={320}
        autoComplete="off"
        textContentType="none"
      />
      <Fehlermeldung
        text={
          speichern.error
            ? speichern.error instanceof ApiFehler
              ? fehlertext(speichern.error)
              : KEIN_NETZ
            : undefined
        }
      />
      <Ansage
        text={gespeichert}
        stil={[styles.text, { color: farben.erfolg }]}
      />
      <Button
        titel="Speichern"
        onPress={speichernGedrueckt}
        disabled={speichern.isPending}
      />
    </Bildschirm>
  );
}

const styles = StyleSheet.create({
  text: { fontSize: schrift.text },
});
