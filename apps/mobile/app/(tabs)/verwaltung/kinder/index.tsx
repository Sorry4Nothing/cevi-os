import { useRouter } from "expo-router";
import { StyleSheet, Text } from "react-native";

import { useKinder } from "../../../../src/api/kinder";
import { useStufen } from "../../../../src/api/stufen";
import { Bildschirm } from "../../../../src/ui/Bildschirm";
import { Button } from "../../../../src/ui/Button";
import { Listenzeile } from "../../../../src/ui/Listenzeile";
import { schrift, useFarben } from "../../../../src/ui/tokens";

export default function Kinder() {
  const farben = useFarben();
  const router = useRouter();
  const kinder = useKinder();
  const stufen = useStufen();
  const bereit = kinder.data && stufen.data;

  return (
    <Bildschirm
      titel="Kinder"
      zustand={
        bereit
          ? "bereit"
          : kinder.isPending || stufen.isPending
            ? "laden"
            : "fehler"
      }
      onNeuLaden={() => {
        void kinder.refetch();
        void stufen.refetch();
      }}
      onZurueck={() => router.back()}
    >
      {kinder.data?.kinder.map((kind) => (
        <Listenzeile
          key={kind.id}
          titel={`${kind.vorname} ${kind.nachname}`}
          text={`${kind.aktiv ? "" : "inaktiv, "}${
            stufen.data?.stufen.find((s) => s.id === kind.stufeId)?.name ?? ""
          }`}
          onPress={() => router.push(`/verwaltung/kinder/${kind.id}`)}
        />
      ))}
      {/* Kein zustand «leer»: Er blendete den Knopf aus */}
      {kinder.data?.kinder.length === 0 ? (
        <Text style={[styles.text, { color: farben.text }]}>
          Noch keine Kinder.
        </Text>
      ) : null}
      <Button
        titel="Kind erfassen"
        onPress={() => router.push("/verwaltung/kinder/neu")}
      />
    </Bildschirm>
  );
}

const styles = StyleSheet.create({
  text: { fontSize: schrift.text },
});
