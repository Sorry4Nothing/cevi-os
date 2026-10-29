import { useRouter } from "expo-router";
import { StyleSheet, Text } from "react-native";

import { fehlertext } from "../../../src/api/fehlertexte";
import { useIch } from "../../../src/api/ich";
import { usePersonen } from "../../../src/api/personen";
import { Bildschirm } from "../../../src/ui/Bildschirm";
import { Button } from "../../../src/ui/Button";
import { Karte } from "../../../src/ui/Karte";
import { Listenzeile } from "../../../src/ui/Listenzeile";
import { schrift, useFarben } from "../../../src/ui/tokens";
import { warnungen } from "../../../src/verwaltung/status";

export default function Verwaltung() {
  const farben = useFarben();
  const router = useRouter();
  const ich = useIch();
  // Admin-Routen antworten ohne zweiten Faktor 403: Die Anfrage gar nicht erst stellen
  const personen = usePersonen(ich.data?.zweiterFaktor === true);
  const meldungen = personen.data ? warnungen(personen.data) : [];

  if (ich.data?.admin && !ich.data.zweiterFaktor) {
    return (
      <Bildschirm titel="Verwaltung">
        <Karte>
          <Text style={[styles.text, { color: farben.text }]}>
            {fehlertext({ code: "ZWEITER_FAKTOR_FEHLT" })}
          </Text>
          <Button
            titel="Zweiten Faktor einrichten"
            onPress={() => router.push("/profil/zweiter-faktor")}
          />
        </Karte>
      </Bildschirm>
    );
  }

  return (
    <Bildschirm
      titel="Verwaltung"
      zustand={
        personen.data
          ? "bereit"
          : // Ohne «ich» ruht die Abfrage der Personen und bleibt pending
            (personen.isPending && !ich.isError) || ich.isPending
            ? "laden"
            : "fehler"
      }
      onNeuLaden={() => {
        void ich.refetch();
        void personen.refetch();
      }}
    >
      {meldungen.length > 0 ? (
        <Karte>
          {meldungen.map((meldung) => (
            <Text key={meldung} style={[styles.text, { color: farben.text }]}>
              {meldung}
            </Text>
          ))}
        </Karte>
      ) : null}
      <Listenzeile
        titel="Personen"
        onPress={() => router.push("/verwaltung/personen")}
      />
      <Listenzeile
        titel="Kinder"
        onPress={() => router.push("/verwaltung/kinder")}
      />
      <Listenzeile
        titel="Stufen"
        onPress={() => router.push("/verwaltung/stufen")}
      />
    </Bildschirm>
  );
}

const styles = StyleSheet.create({
  text: { fontSize: schrift.text },
});
