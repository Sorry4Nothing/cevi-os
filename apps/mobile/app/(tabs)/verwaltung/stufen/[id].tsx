import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet } from "react-native";

import { ApiFehler, queryClient } from "../../../../src/api/client";
import { fehlertext } from "../../../../src/api/fehlertexte";
import {
  useStufeAendern,
  useStufen,
  type StufeZeile,
} from "../../../../src/api/stufen";
import { Ansage } from "../../../../src/ui/Ansage";
import { Bildschirm } from "../../../../src/ui/Bildschirm";
import { Button } from "../../../../src/ui/Button";
import { Fehlermeldung } from "../../../../src/ui/Fehlermeldung";
import { Textfeld } from "../../../../src/ui/Textfeld";
import { schrift, useFarben } from "../../../../src/ui/tokens";
import {
  pruefeStufenfelder,
  type Stufenfehler,
} from "../../../../src/verwaltung/stufe";

export default function StufeDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const stufen = useStufen();
  const stufe = stufen.data?.stufen.find((s) => s.id === id);

  if (!stufen.data || !stufe) {
    return (
      <Bildschirm
        titel="Stufe"
        zustand={stufen.isPending ? "laden" : stufen.data ? "leer" : "fehler"}
        leerText="Diese Stufe gibt es nicht mehr."
        onNeuLaden={() => void stufen.refetch()}
        onZurueck={() => router.back()}
      />
    );
  }
  return <Formular key={stufe.id} stufe={stufe} />;
}

function Formular({ stufe }: { stufe: StufeZeile }) {
  const farben = useFarben();
  const router = useRouter();
  const [name, setName] = useState(stufe.name);
  const [kuerzel, setKuerzel] = useState(stufe.kuerzel);
  const [reihenfolge, setReihenfolge] = useState(String(stufe.reihenfolge));
  const [fehler, setFehler] = useState<Stufenfehler>({});
  const [erfolg, setErfolg] = useState<string>();
  const speichern = useStufeAendern();

  function speichernGedrueckt() {
    setErfolg(undefined);
    const pruefung = pruefeStufenfelder({ name, kuerzel, reihenfolge });
    setFehler(pruefung.fehler);
    if (!pruefung.werte) return;
    speichern.mutate(
      { id: stufe.id, ...pruefung.werte },
      {
        onSuccess: () => setErfolg("Gespeichert."),
        // 404: Die Stufe gibt es nicht mehr, Daten neu laden und zurück zur Liste
        onError: (e) => {
          if (e instanceof ApiFehler && e.status === 404) {
            void queryClient.invalidateQueries();
            router.back();
          }
        },
      },
    );
  }

  return (
    <Bildschirm titel={stufe.name} onZurueck={() => router.back()}>
      {/* Die Erfolgsmeldung bleibt stehen (Checkliste 8.2) */}
      <Ansage text={erfolg} stil={[styles.text, { color: farben.erfolg }]} />
      <Textfeld
        label="Name"
        value={name}
        onChangeText={setName}
        fehler={fehler.name}
        autoComplete="off"
        textContentType="none"
        autoCorrect={false}
      />
      <Textfeld
        label="Kürzel"
        value={kuerzel}
        onChangeText={setKuerzel}
        fehler={fehler.kuerzel}
        autoComplete="off"
        textContentType="none"
        autoCorrect={false}
      />
      <Textfeld
        label="Reihenfolge"
        value={reihenfolge}
        onChangeText={setReihenfolge}
        fehler={fehler.reihenfolge}
        keyboardType="number-pad"
        autoComplete="off"
        textContentType="none"
      />
      <Fehlermeldung
        text={
          speichern.error
            ? fehlertext(
                speichern.error instanceof ApiFehler ? speichern.error : null,
              )
            : undefined
        }
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
