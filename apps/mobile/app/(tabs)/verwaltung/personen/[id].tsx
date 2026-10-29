import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Alert, StyleSheet, Text } from "react-native";

import { ApiFehler, queryClient } from "../../../../src/api/client";
import { fehlertext } from "../../../../src/api/fehlertexte";
import { useIch } from "../../../../src/api/ich";
import {
  useNeuesStartpasswort,
  usePersonAendern,
  usePersonAktivieren,
  usePersonDeaktivieren,
  usePersonen,
  usePersonLoeschen,
  type PersonZeile,
  type PersonenAntwort,
} from "../../../../src/api/personen";
import { Ansage } from "../../../../src/ui/Ansage";
import { Bildschirm } from "../../../../src/ui/Bildschirm";
import { Button } from "../../../../src/ui/Button";
import { Fehlermeldung } from "../../../../src/ui/Fehlermeldung";
import { Textfeld } from "../../../../src/ui/Textfeld";
import { schrift, useFarben } from "../../../../src/ui/tokens";
import {
  Rollenwahl,
  type Stufenrolle,
} from "../../../../src/verwaltung/Rollenwahl";
import { Startpasswort } from "../../../../src/verwaltung/Startpasswort";
import { statusText } from "../../../../src/verwaltung/status";

export default function PersonDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const ich = useIch();
  const personen = usePersonen();
  const person = personen.data?.personen.find((p) => p.id === id);

  if (!personen.data || !person) {
    return (
      <Bildschirm
        titel="Person"
        zustand={
          personen.isPending ? "laden" : personen.data ? "leer" : "fehler"
        }
        leerText="Diese Person gibt es nicht mehr."
        onNeuLaden={() => void personen.refetch()}
        onZurueck={() => router.back()}
      />
    );
  }
  return (
    <Formular
      key={person.id}
      person={person}
      stufen={personen.data.stufen}
      kinder={personen.data.kinder}
      eigenes={ich.data?.id === person.id}
    />
  );
}

function Formular({
  person,
  stufen,
  kinder,
  eigenes,
}: {
  person: PersonZeile;
  stufen: PersonenAntwort["stufen"];
  kinder: PersonenAntwort["kinder"];
  eigenes: boolean;
}) {
  const farben = useFarben();
  const router = useRouter();
  const [name, setName] = useState(person.name);
  const [admin, setAdmin] = useState(person.admin);
  const [rollen, setRollen] = useState<Stufenrolle[]>(person.rollen);
  const [elternteilVon, setElternteilVon] = useState<string[]>(
    person.elternteilVon,
  );
  const [erfolg, setErfolg] = useState<string>();
  const speichern = usePersonAendern();
  const startpasswort = useNeuesStartpasswort();
  const deaktivieren = usePersonDeaktivieren();
  const aktivieren = usePersonAktivieren();
  const loeschen = usePersonLoeschen();

  // 404: Die Person gibt es nicht mehr — Daten neu laden und zurück zur Liste
  function beiFehler(fehler: unknown) {
    if (fehler instanceof ApiFehler && fehler.status === 404) {
      void queryClient.invalidateQueries();
      router.back();
    }
  }

  function loeschenGedrueckt() {
    Alert.alert(
      "Person löschen?",
      `${person.name} und alle Verknüpfungen werden endgültig gelöscht.`,
      [
        { text: "Abbrechen", style: "cancel" },
        {
          text: "Löschen",
          style: "destructive",
          onPress: () =>
            loeschen.mutate(person.id, {
              onSuccess: () => router.back(),
              onError: beiFehler,
            }),
        },
      ],
    );
  }

  const text = (fehler: unknown) =>
    fehler
      ? fehlertext(fehler instanceof ApiFehler ? fehler : null)
      : undefined;

  return (
    <Bildschirm titel={person.name} onZurueck={() => router.back()}>
      <Text style={[styles.text, { color: farben.textLeise }]}>
        Benutzername: {person.benutzername}
      </Text>
      <Text style={[styles.text, { color: farben.text }]}>
        {statusText(person)}
      </Text>
      {/* Die Erfolgsmeldung bleibt stehen (Checkliste 8.2) */}
      <Ansage text={erfolg} stil={[styles.text, { color: farben.erfolg }]} />
      <Textfeld
        label="Name"
        value={name}
        onChangeText={setName}
        autoComplete="off"
        textContentType="none"
        autoCorrect={false}
      />
      <Rollenwahl
        stufen={stufen}
        kinder={kinder}
        admin={admin}
        rollen={rollen}
        elternteilVon={elternteilVon}
        onAdmin={setAdmin}
        onRollen={setRollen}
        onElternteilVon={setElternteilVon}
      />
      <Fehlermeldung text={text(speichern.error)} />
      <Button
        titel="Speichern"
        onPress={() =>
          speichern.mutate(
            { id: person.id, name, admin, rollen, elternteilVon },
            { onSuccess: () => setErfolg("Gespeichert."), onError: beiFehler },
          )
        }
        disabled={speichern.isPending}
      />
      {startpasswort.data ? (
        <Startpasswort
          benutzername={person.benutzername ?? ""}
          startpasswort={startpasswort.data.startpasswort}
          onFertig={() => startpasswort.reset()}
        />
      ) : null}
      {eigenes ? null : (
        <>
          <Fehlermeldung text={text(startpasswort.error)} />
          <Button
            titel="Neues Startpasswort"
            hinweis="Beendet alle Sitzungen der Person"
            onPress={() =>
              startpasswort.mutate(person.id, { onError: beiFehler })
            }
            disabled={startpasswort.isPending}
          />
          <Fehlermeldung text={text(deaktivieren.error ?? aktivieren.error)} />
          {person.deaktiviert ? (
            <Button
              titel="Aktivieren"
              onPress={() =>
                aktivieren.mutate(person.id, {
                  onSuccess: () => setErfolg("Aktiviert."),
                  onError: beiFehler,
                })
              }
              disabled={aktivieren.isPending}
            />
          ) : (
            <Button
              titel="Deaktivieren"
              hinweis="Sperrt den Login und beendet alle Sitzungen"
              onPress={() =>
                deaktivieren.mutate(person.id, {
                  onSuccess: () => setErfolg("Deaktiviert."),
                  onError: beiFehler,
                })
              }
              disabled={deaktivieren.isPending}
            />
          )}
          <Fehlermeldung text={text(loeschen.error)} />
          <Button
            titel="Löschen"
            onPress={loeschenGedrueckt}
            disabled={loeschen.isPending}
          />
        </>
      )}
    </Bildschirm>
  );
}

const styles = StyleSheet.create({
  text: { fontSize: schrift.text },
});
