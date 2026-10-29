import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";

import { ApiFehler, queryClient } from "../../../../src/api/client";
import { fehlertext } from "../../../../src/api/fehlertexte";
import {
  useKindAendern,
  useKinder,
  useKindLoeschen,
  type KindZeile,
} from "../../../../src/api/kinder";
import {
  usePersonen,
  type PersonenAntwort,
} from "../../../../src/api/personen";
import { useStufen, type StufeZeile } from "../../../../src/api/stufen";
import { Ansage } from "../../../../src/ui/Ansage";
import { OptionenAuswahl } from "../../../../src/ui/Auswahl";
import { Bildschirm } from "../../../../src/ui/Bildschirm";
import { Button } from "../../../../src/ui/Button";
import { Fehlermeldung } from "../../../../src/ui/Fehlermeldung";
import { JaNeinAuswahl } from "../../../../src/ui/JaNeinAuswahl";
import { Textfeld } from "../../../../src/ui/Textfeld";
import { masse, schrift, useFarben } from "../../../../src/ui/tokens";
import {
  pruefeKindfelder,
  type Kindfehler,
} from "../../../../src/verwaltung/kind";

export default function KindDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const kinder = useKinder();
  const stufen = useStufen();
  const personen = usePersonen();
  const kind = kinder.data?.kinder.find((k) => k.id === id);

  if (!kinder.data || !stufen.data || !personen.data || !kind) {
    return (
      <Bildschirm
        titel="Kind"
        zustand={
          kinder.isPending || stufen.isPending || personen.isPending
            ? "laden"
            : kinder.data && stufen.data && personen.data
              ? "leer"
              : "fehler"
        }
        leerText="Dieses Kind gibt es nicht mehr."
        onNeuLaden={() => {
          void kinder.refetch();
          void stufen.refetch();
          void personen.refetch();
        }}
        onZurueck={() => router.back()}
      />
    );
  }
  return (
    <Formular
      key={kind.id}
      kind={kind}
      stufen={stufen.data.stufen}
      personen={personen.data.personen}
    />
  );
}

function Formular({
  kind,
  stufen,
  personen,
}: {
  kind: KindZeile;
  stufen: StufeZeile[];
  personen: PersonenAntwort["personen"];
}) {
  const farben = useFarben();
  const router = useRouter();
  const [vorname, setVorname] = useState(kind.vorname);
  const [nachname, setNachname] = useState(kind.nachname);
  const [stufeId, setStufeId] = useState<string | null>(kind.stufeId);
  const [aktiv, setAktiv] = useState(kind.aktiv);
  const [eltern, setEltern] = useState<string[]>(kind.eltern);
  // Einmal beim Laden: Verknüpfte zuerst, dann nach Name; die Zeilen springen beim Umschalten nicht
  const [reihe] = useState(() =>
    [...personen].sort(
      (a, b) =>
        Number(kind.eltern.includes(b.id)) -
          Number(kind.eltern.includes(a.id)) || a.name.localeCompare(b.name),
    ),
  );
  const [fehler, setFehler] = useState<Kindfehler>({});
  const [erfolg, setErfolg] = useState<string>();
  const speichern = useKindAendern();
  const loeschen = useKindLoeschen();

  // 404: Das Kind gibt es nicht mehr, Daten neu laden und zurück zur Liste
  function beiFehler(e: unknown) {
    if (e instanceof ApiFehler && e.status === 404) {
      void queryClient.invalidateQueries();
      router.back();
    }
  }

  const text = (e: unknown) =>
    e ? fehlertext(e instanceof ApiFehler ? e : null) : undefined;

  function speichernGedrueckt() {
    setErfolg(undefined);
    const pruefung = pruefeKindfelder({ vorname, nachname, stufeId });
    setFehler(pruefung.fehler);
    if (!pruefung.werte) return;
    speichern.mutate(
      { id: kind.id, ...pruefung.werte, aktiv, eltern },
      { onSuccess: () => setErfolg("Gespeichert."), onError: beiFehler },
    );
  }

  function loeschenGedrueckt() {
    Alert.alert(
      "Kind löschen?",
      `${kind.vorname} ${kind.nachname} und die Verknüpfungen mit den Eltern werden endgültig gelöscht.`,
      [
        { text: "Abbrechen", style: "cancel" },
        {
          text: "Löschen",
          style: "destructive",
          onPress: () =>
            loeschen.mutate(kind.id, {
              onSuccess: () => router.back(),
              onError: beiFehler,
            }),
        },
      ],
    );
  }

  return (
    <Bildschirm
      titel={`${kind.vorname} ${kind.nachname}`}
      onZurueck={() => router.back()}
    >
      {/* Die Erfolgsmeldung bleibt stehen (Checkliste 8.2) */}
      <Ansage text={erfolg} stil={[styles.text, { color: farben.erfolg }]} />
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
        optionen={stufen.map((stufe) => ({ wert: stufe.id, text: stufe.name }))}
        wert={stufeId}
        onWahl={setStufeId}
        kontext="Stufe"
      />
      <Fehlermeldung text={fehler.stufe} />
      <Text style={[styles.label, { color: farben.text }]}>Aktiv</Text>
      <JaNeinAuswahl wert={aktiv} onWahl={setAktiv} kontext="Aktiv" />
      <Text
        accessibilityRole="header"
        style={[styles.abschnitt, { color: farben.text }]}
      >
        Eltern
      </Text>
      <Text style={[styles.text, { color: farben.text }]}>
        Eltern nur auf Angabe der Erziehungsberechtigten verknüpfen. Bei einem
        Obhuts- oder Kontaktverbot die Verknüpfung sofort lösen.
      </Text>
      {reihe.map((person) => (
        <View key={person.id} style={styles.gruppe}>
          <Text style={[styles.text, { color: farben.text }]}>
            {person.name}
          </Text>
          <JaNeinAuswahl
            wert={eltern.includes(person.id)}
            onWahl={(ja) =>
              setEltern(
                ja
                  ? [...eltern, person.id]
                  : eltern.filter((id) => id !== person.id),
              )
            }
            kontext={`Elternteil ${person.name}`}
          />
        </View>
      ))}
      <Fehlermeldung text={text(speichern.error)} />
      <Button
        titel="Speichern"
        onPress={speichernGedrueckt}
        disabled={speichern.isPending}
      />
      <Fehlermeldung text={text(loeschen.error)} />
      <Button
        titel="Löschen"
        onPress={loeschenGedrueckt}
        disabled={loeschen.isPending}
      />
    </Bildschirm>
  );
}

const styles = StyleSheet.create({
  text: { fontSize: schrift.text },
  label: { fontSize: schrift.text, fontWeight: "600" },
  abschnitt: { fontSize: schrift.text, fontWeight: "700", marginTop: 8 },
  gruppe: { gap: masse.luecke },
});
