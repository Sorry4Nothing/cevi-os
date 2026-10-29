import { useRouter } from "expo-router";
import { useState } from "react";

import { ApiFehler } from "../../../../src/api/client";
import { fehlertext } from "../../../../src/api/fehlertexte";
import { useStufeAnlegen, useStufen } from "../../../../src/api/stufen";
import { Bildschirm } from "../../../../src/ui/Bildschirm";
import { Button } from "../../../../src/ui/Button";
import { Fehlermeldung } from "../../../../src/ui/Fehlermeldung";
import { Textfeld } from "../../../../src/ui/Textfeld";
import {
  pruefeStufenfelder,
  type Stufenfehler,
} from "../../../../src/verwaltung/stufe";

export default function StufeAnlegen() {
  const router = useRouter();
  const stufen = useStufen();
  const anlegen = useStufeAnlegen();
  const [name, setName] = useState("");
  const [kuerzel, setKuerzel] = useState("");
  // Solange niemand das Feld anfasst, folgt der Vorschlag der höchsten Reihenfolge
  const [eigene, setEigene] = useState<string>();
  const [fehler, setFehler] = useState<Stufenfehler>({});

  const vorschlag = String(
    Math.max(0, ...(stufen.data?.stufen.map((s) => s.reihenfolge) ?? [])) + 1,
  );
  const reihenfolge = eigene ?? vorschlag;

  function anlegenGedrueckt() {
    // Die eigene Kopie der Server-Regeln, vor dem Senden (Checkliste 9.9)
    const pruefung = pruefeStufenfelder({ name, kuerzel, reihenfolge });
    setFehler(pruefung.fehler);
    if (!pruefung.werte) return;
    anlegen.mutate(pruefung.werte, { onSuccess: () => router.back() });
  }

  return (
    <Bildschirm
      titel="Stufe anlegen"
      zustand={stufen.data ? "bereit" : stufen.isPending ? "laden" : "fehler"}
      onNeuLaden={() => void stufen.refetch()}
      onZurueck={() => router.back()}
    >
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
        onChangeText={setEigene}
        fehler={fehler.reihenfolge}
        keyboardType="number-pad"
        autoComplete="off"
        textContentType="none"
      />
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
        titel="Stufe anlegen"
        onPress={anlegenGedrueckt}
        disabled={anlegen.isPending}
      />
    </Bildschirm>
  );
}
