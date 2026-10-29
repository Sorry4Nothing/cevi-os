import { useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text } from "react-native";

import { ApiFehler } from "../../../../src/api/client";
import { fehlertext } from "../../../../src/api/fehlertexte";
import { useKindAnlegen } from "../../../../src/api/kinder";
import { useStufen } from "../../../../src/api/stufen";
import { Ansage } from "../../../../src/ui/Ansage";
import { OptionenAuswahl } from "../../../../src/ui/Auswahl";
import { Bildschirm } from "../../../../src/ui/Bildschirm";
import { Button } from "../../../../src/ui/Button";
import { Fehlermeldung } from "../../../../src/ui/Fehlermeldung";
import { Textfeld } from "../../../../src/ui/Textfeld";
import { schrift, useFarben } from "../../../../src/ui/tokens";
import {
  pruefeKindfelder,
  type Kindfehler,
} from "../../../../src/verwaltung/kind";

export default function KindErfassen() {
  const farben = useFarben();
  const router = useRouter();
  const stufen = useStufen();
  const anlegen = useKindAnlegen();
  const [vorname, setVorname] = useState("");
  const [nachname, setNachname] = useState("");
  // Ohne Vorauswahl: Eine falsche Stufe öffnete den falschen Gruppenchat
  const [stufeId, setStufeId] = useState<string | null>(null);
  const [fehler, setFehler] = useState<Kindfehler>({});
  const [erfolg, setErfolg] = useState<string>();

  function erfassenGedrueckt() {
    setErfolg(undefined);
    // Die eigene Kopie der Server-Regeln, vor dem Senden (Checkliste 9.9)
    const pruefung = pruefeKindfelder({ vorname, nachname, stufeId });
    setFehler(pruefung.fehler);
    if (!pruefung.werte) return;
    const { vorname: v, nachname: n } = pruefung.werte;
    anlegen.mutate(pruefung.werte, {
      // Der Admin erfasst viele Kinder hintereinander: Die Stufe bleibt, die Namen werden leer
      onSuccess: () => {
        setVorname("");
        setNachname("");
        setErfolg(`${v} ${n} ist erfasst.`);
      },
    });
  }

  return (
    <Bildschirm
      titel="Kind erfassen"
      zustand={
        !stufen.data
          ? stufen.isPending
            ? "laden"
            : "fehler"
          : stufen.data.stufen.length === 0
            ? "leer"
            : "bereit"
      }
      leerText="Zuerst eine Stufe anlegen."
      onNeuLaden={() => void stufen.refetch()}
      onZurueck={() => router.back()}
    >
      {/* Die Erfolgsmeldung bleibt stehen (Checkliste 8.2) */}
      <Ansage text={erfolg} stil={[styles.text, { color: farben.erfolg }]} />
      {/* Ohne Autofill: Hier geht es um ein fremdes Kind, nie um die Daten des Admins */}
      <Textfeld
        label="Vorname"
        value={vorname}
        onChangeText={setVorname}
        fehler={fehler.vorname}
        autoComplete="off"
        textContentType="none"
        autoCorrect={false}
      />
      <Textfeld
        label="Nachname"
        value={nachname}
        onChangeText={setNachname}
        fehler={fehler.nachname}
        autoComplete="off"
        textContentType="none"
        autoCorrect={false}
      />
      <Text style={[styles.label, { color: farben.text }]}>Stufe</Text>
      <OptionenAuswahl
        optionen={(stufen.data?.stufen ?? []).map((stufe) => ({
          wert: stufe.id,
          text: stufe.name,
        }))}
        wert={stufeId}
        onWahl={setStufeId}
        kontext="Stufe"
      />
      <Fehlermeldung text={fehler.stufe} />
      <Fehlermeldung
        text={
          anlegen.error
            ? fehlertext(
                anlegen.error instanceof ApiFehler ? anlegen.error : null,
              )
            : undefined
        }
      />
      <Button
        titel="Kind erfassen"
        onPress={erfassenGedrueckt}
        disabled={anlegen.isPending}
      />
    </Bildschirm>
  );
}

const styles = StyleSheet.create({
  text: { fontSize: schrift.text },
  label: { fontSize: schrift.text, fontWeight: "600" },
});
