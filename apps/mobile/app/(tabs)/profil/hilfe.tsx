import { useRouter } from "expo-router";
import { Linking, StyleSheet, Text } from "react-native";

import { useHilfe } from "../../../src/api/hilfe";
import { ANLAUFSTELLEN } from "../../../src/hilfe/anlaufstellen";
import { Bildschirm } from "../../../src/ui/Bildschirm";
import { Button } from "../../../src/ui/Button";
import { Karte } from "../../../src/ui/Karte";
import { schrift, useFarben } from "../../../src/ui/tokens";

// Die Anlaufstellen stehen im Code und damit auch ohne Netz da; nur der Text der Abteilung kommt vom Server
export default function Hilfe() {
  const farben = useFarben();
  const router = useRouter();
  const hilfe = useHilfe();
  const text = hilfe.data?.vertrauenspersonen?.trim();

  return (
    <Bildschirm titel="Hilfe" onZurueck={() => router.back()}>
      <Text style={[styles.text, { color: farben.text }]}>
        Wenn etwas nicht stimmt oder jemand eine Grenze überschreitet: Sprich
        mit einer Vertrauensperson oder wende dich an eine Anlaufstelle.
      </Text>
      <Text
        accessibilityRole="header"
        style={[styles.abschnitt, { color: farben.text }]}
      >
        Vertrauenspersonen der Abteilung
      </Text>
      <Karte>
        {hilfe.isPending ? (
          <Text style={[styles.text, { color: farben.text }]}>
            Wird geladen …
          </Text>
        ) : hilfe.isError ? (
          <>
            <Text style={[styles.text, { color: farben.fehler }]}>
              Der Text liess sich nicht laden.
            </Text>
            <Button
              titel="Nochmals versuchen"
              onPress={() => void hilfe.refetch()}
            />
          </>
        ) : (
          <Text style={[styles.text, { color: farben.text }]}>
            {text ||
              "Die Abteilung hat noch keine Vertrauenspersonen eingetragen."}
          </Text>
        )}
      </Karte>
      <Text
        accessibilityRole="header"
        style={[styles.abschnitt, { color: farben.text }]}
      >
        Weitere Anlaufstellen
      </Text>
      {ANLAUFSTELLEN.map((stelle) => (
        <Karte key={stelle.name}>
          <Text style={[styles.titel, { color: farben.text }]}>
            {stelle.name}
          </Text>
          {stelle.beschreibung ? (
            <Text style={[styles.text, { color: farben.textLeise }]}>
              {stelle.beschreibung}
            </Text>
          ) : null}
          {stelle.nummer ? (
            <Button
              titel={`${stelle.nummer} anrufen`}
              hinweis="Öffnet die Telefon-App"
              onPress={() => void Linking.openURL(`tel:${stelle.nummer}`)}
            />
          ) : (
            <Text style={[styles.text, { color: farben.textLeise }]}>
              Die Nummer wird geprüft und hier ergänzt.
            </Text>
          )}
        </Karte>
      ))}
    </Bildschirm>
  );
}

const styles = StyleSheet.create({
  text: { fontSize: schrift.text },
  titel: { fontSize: schrift.text, fontWeight: "700" },
  abschnitt: { fontSize: schrift.text, fontWeight: "700", marginTop: 8 },
});
