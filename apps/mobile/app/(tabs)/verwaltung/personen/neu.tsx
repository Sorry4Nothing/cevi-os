import { useRouter } from "expo-router";
import { useState } from "react";

import { ApiFehler } from "../../../../src/api/client";
import { fehlertext } from "../../../../src/api/fehlertexte";
import { usePersonAnlegen, usePersonen } from "../../../../src/api/personen";
import { Bildschirm } from "../../../../src/ui/Bildschirm";
import { Button } from "../../../../src/ui/Button";
import { Fehlermeldung } from "../../../../src/ui/Fehlermeldung";
import { Textfeld } from "../../../../src/ui/Textfeld";
import {
  BENUTZERNAME_FEHLER,
  benutzernameGueltig,
  schlageBenutzernameVor,
} from "../../../../src/verwaltung/benutzername";
import {
  Rollenwahl,
  type Stufenrolle,
} from "../../../../src/verwaltung/Rollenwahl";
import { Startpasswort } from "../../../../src/verwaltung/Startpasswort";

export default function PersonAnlegen() {
  const router = useRouter();
  const personen = usePersonen();
  const anlegen = usePersonAnlegen();
  const [vorname, setVorname] = useState("");
  const [nachname, setNachname] = useState("");
  // Solange niemand das Feld anfasst, folgt der Vorschlag den Namen
  const [eigener, setEigener] = useState<string>();
  const [admin, setAdmin] = useState(false);
  const [rollen, setRollen] = useState<Stufenrolle[]>([]);
  const [elternteilVon, setElternteilVon] = useState<string[]>([]);
  const [feldfehler, setFeldfehler] = useState<string>();

  const vergeben =
    personen.data?.personen.map((person) => person.benutzername ?? "") ?? [];
  const benutzername =
    eigener ?? schlageBenutzernameVor(vorname, nachname, vergeben);

  function anlegenGedrueckt() {
    setFeldfehler(undefined);
    // Die eigene Kopie der Server-Regel, vor dem Senden (Checkliste 9.9)
    if (!benutzernameGueltig(benutzername)) {
      setFeldfehler(BENUTZERNAME_FEHLER);
      return;
    }
    anlegen.mutate(
      { vorname, nachname, benutzername, admin, rollen, elternteilVon },
      {
        onError: (fehler) => {
          if (
            fehler instanceof ApiFehler &&
            fehler.code === "BENUTZERNAME_VERGEBEN"
          ) {
            setFeldfehler(fehlertext(fehler));
          }
        },
      },
    );
  }

  // Das Startpasswort erscheint genau einmal, nur aus der Antwort im Bildschirm-Zustand
  if (anlegen.data) {
    return (
      <Bildschirm titel="Person anlegen">
        <Startpasswort
          benutzername={anlegen.data.benutzername ?? ""}
          startpasswort={anlegen.data.startpasswort}
          onFertig={() => router.back()}
        />
      </Bildschirm>
    );
  }

  const allgemeinerFehler =
    anlegen.error && !feldfehler
      ? fehlertext(anlegen.error instanceof ApiFehler ? anlegen.error : null)
      : undefined;

  return (
    <Bildschirm
      titel="Person anlegen"
      zustand={
        personen.data ? "bereit" : personen.isPending ? "laden" : "fehler"
      }
      onNeuLaden={() => void personen.refetch()}
      onZurueck={() => router.back()}
    >
      {/* Ohne Autofill: Hier geht es um eine fremde Person, nie um die Daten des Admins */}
      <Textfeld
        label="Vorname"
        value={vorname}
        onChangeText={setVorname}
        autoComplete="off"
        textContentType="none"
        autoCorrect={false}
      />
      <Textfeld
        label="Nachname"
        value={nachname}
        onChangeText={setNachname}
        autoComplete="off"
        textContentType="none"
        autoCorrect={false}
      />
      <Textfeld
        label="Benutzername"
        value={benutzername}
        onChangeText={setEigener}
        fehler={feldfehler}
        autoComplete="off"
        textContentType="none"
        autoCorrect={false}
        autoCapitalize="none"
      />
      <Rollenwahl
        stufen={personen.data?.stufen ?? []}
        kinder={personen.data?.kinder ?? []}
        admin={admin}
        rollen={rollen}
        elternteilVon={elternteilVon}
        onAdmin={setAdmin}
        onRollen={setRollen}
        onElternteilVon={setElternteilVon}
      />
      <Fehlermeldung text={allgemeinerFehler} />
      <Button
        titel="Person anlegen"
        onPress={anlegenGedrueckt}
        disabled={anlegen.isPending}
      />
    </Bildschirm>
  );
}
