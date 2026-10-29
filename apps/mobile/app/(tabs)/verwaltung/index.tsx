import { useRouter } from "expo-router";
import { StyleSheet, Text } from "react-native";

import { usePersonen } from "../../../src/api/personen";
import { Bildschirm } from "../../../src/ui/Bildschirm";
import { Karte } from "../../../src/ui/Karte";
import { Listenzeile } from "../../../src/ui/Listenzeile";
import { schrift, useFarben } from "../../../src/ui/tokens";
import { warnungen } from "../../../src/verwaltung/status";

export default function Verwaltung() {
  const farben = useFarben();
  const router = useRouter();
  const personen = usePersonen();
  const meldungen = personen.data ? warnungen(personen.data) : [];

  return (
    <Bildschirm
      titel="Verwaltung"
      zustand={
        personen.data ? "bereit" : personen.isPending ? "laden" : "fehler"
      }
      onNeuLaden={() => void personen.refetch()}
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
      <Listenzeile
        titel="Vertrauenspersonen"
        onPress={() => router.push("/verwaltung/vertrauenspersonen")}
      />
    </Bildschirm>
  );
}

const styles = StyleSheet.create({
  text: { fontSize: schrift.text },
});
