import { useRouter } from "expo-router";
import { StyleSheet, Text } from "react-native";

import { useStufen } from "../../../../src/api/stufen";
import { Bildschirm } from "../../../../src/ui/Bildschirm";
import { Button } from "../../../../src/ui/Button";
import { Listenzeile } from "../../../../src/ui/Listenzeile";
import { schrift, useFarben } from "../../../../src/ui/tokens";

export default function Stufen() {
  const farben = useFarben();
  const router = useRouter();
  const stufen = useStufen();

  return (
    <Bildschirm
      titel="Stufen"
      zustand={stufen.data ? "bereit" : stufen.isPending ? "laden" : "fehler"}
      onNeuLaden={() => void stufen.refetch()}
      onZurueck={() => router.back()}
    >
      {stufen.data?.stufen.map((stufe) => (
        <Listenzeile
          key={stufe.id}
          titel={stufe.name}
          text={`Kürzel ${stufe.kuerzel}`}
          onPress={() => router.push(`/verwaltung/stufen/${stufe.id}`)}
        />
      ))}
      {/* Kein zustand «leer»: Er blendete den Knopf aus */}
      {stufen.data?.stufen.length === 0 ? (
        <Text style={[styles.text, { color: farben.text }]}>
          Noch keine Stufen.
        </Text>
      ) : null}
      <Button
        titel="Stufe anlegen"
        onPress={() => router.push("/verwaltung/stufen/neu")}
      />
    </Bildschirm>
  );
}

const styles = StyleSheet.create({
  text: { fontSize: schrift.text },
});
