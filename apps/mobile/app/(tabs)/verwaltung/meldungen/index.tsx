import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, StyleSheet, Text } from "react-native";

import { ApiFehler, useOnline } from "../../../../src/api/client";
import { fehlertext, KEIN_NETZ } from "../../../../src/api/fehlertexte";
import { useNachrichtAusblenden } from "../../../../src/api/chats";
import {
  useMeldungen,
  useMeldungErledigen,
  type MeldungZeile,
} from "../../../../src/api/meldungen";
import { usePersonDeaktivieren } from "../../../../src/api/personen";
import { Ansage } from "../../../../src/ui/Ansage";
import { Badge } from "../../../../src/ui/Badge";
import { Bildschirm } from "../../../../src/ui/Bildschirm";
import { Button } from "../../../../src/ui/Button";
import { Fehlermeldung } from "../../../../src/ui/Fehlermeldung";
import { Karte } from "../../../../src/ui/Karte";
import { nachrichtZeitText } from "../../../../src/programme/zeit";
import { schrift, useFarben } from "../../../../src/ui/tokens";

const OFFLINE =
  "Keine Internetverbindung. Bearbeiten geht erst wieder mit Internet.";

export default function Meldungen() {
  const farben = useFarben();
  const router = useRouter();
  const online = useOnline();
  const meldungen = useMeldungen();
  const ausblenden = useNachrichtAusblenden();
  const deaktivieren = usePersonDeaktivieren();
  const erledigen = useMeldungErledigen();
  const [fehler, setFehler] = useState<string>();
  const [ansage, setAnsage] = useState<{ text: string; nr: number }>();

  const zeilen = meldungen.data?.pages.flatMap((s) => s.meldungen) ?? [];

  function melde(text: string) {
    setAnsage((alt) => ({ text, nr: (alt?.nr ?? 0) + 1 }));
  }
  function beiFehler(e: unknown) {
    setFehler(e instanceof ApiFehler ? fehlertext(e) : KEIN_NETZ);
    // 404: Die Meldung oder Nachricht gibt es nicht mehr, der Eingang lädt neu
    if (e instanceof ApiFehler && e.status === 404) void meldungen.refetch();
  }
  // Alle drei Aktionen schreiben; ohne Netz sagt die App es, statt still zu scheitern
  function pruefeOnline() {
    setFehler(undefined);
    if (online) return true;
    setFehler(OFFLINE);
    return false;
  }

  function ausblendenGedrueckt(m: MeldungZeile) {
    if (!pruefeOnline() || !m.nachrichtId) return;
    const nachrichtId = m.nachrichtId;
    Alert.alert(
      "Nachricht ausblenden?",
      "Die Nachricht verschwindet für alle ausser für die Autorin oder den Autor. Die Ausblendung steht im Protokoll.",
      [
        { text: "Abbrechen", style: "cancel" },
        {
          text: "Ausblenden",
          style: "destructive",
          onPress: () =>
            ausblenden.mutate(nachrichtId, {
              onSuccess: () => melde("Nachricht ausgeblendet."),
              onError: beiFehler,
            }),
        },
      ],
    );
  }

  function deaktivierenGedrueckt(m: MeldungZeile) {
    if (!pruefeOnline() || !m.autor) return;
    const { id, name } = m.autor;
    Alert.alert(
      "Konto deaktivieren?",
      `${name} kann sich nicht mehr anmelden, und alle Sitzungen enden. Du kannst das Konto in der Verwaltung wieder aktivieren.`,
      [
        { text: "Abbrechen", style: "cancel" },
        {
          text: "Deaktivieren",
          style: "destructive",
          onPress: () =>
            deaktivieren.mutate(id, {
              onSuccess: () => melde(`${name} ist deaktiviert.`),
              onError: beiFehler,
            }),
        },
      ],
    );
  }

  function erledigenGedrueckt(m: MeldungZeile) {
    if (!pruefeOnline()) return;
    erledigen.mutate(m.id, {
      onSuccess: () =>
        melde("Meldung erledigt. Die Kopie des Textes ist gelöscht."),
      onError: beiFehler,
    });
  }

  const beschaeftigt =
    ausblenden.isPending || deaktivieren.isPending || erledigen.isPending;

  return (
    <Bildschirm
      titel="Meldungen"
      zustand={
        meldungen.data ? "bereit" : meldungen.isPending ? "laden" : "fehler"
      }
      offline={!online}
      onNeuLaden={() => void meldungen.refetch()}
      onZurueck={() => router.back()}
    >
      {/* Die Meldung bleibt stehen (Checkliste 8.2) */}
      <Ansage
        text={ansage && ansage.text + (ansage.nr % 2 === 0 ? "​" : "")}
        stil={[styles.text, { color: farben.erfolg }]}
      />
      <Fehlermeldung text={fehler} />
      {zeilen.length === 0 ? (
        <Text style={[styles.text, { color: farben.text }]}>
          Keine offenen Meldungen.
        </Text>
      ) : null}
      {zeilen.map((m) => (
        <Karte key={m.id}>
          <Text
            accessibilityRole="header"
            style={[styles.kopf, { color: farben.text }]}
          >
            {m.autor?.name ?? "Konto gelöscht"},{" "}
            {nachrichtZeitText(m.erstelltAm)}
          </Text>
          <Text style={[styles.klein, { color: farben.textLeise }]}>
            {m.chat
              ? `${m.chat.typ === "stufe" ? "Gruppenchat" : "Einzelchat"} ${m.chat.stufe.name}`
              : "Nachricht gelöscht"}
            {m.gemeldetVon ? `, gemeldet von ${m.gemeldetVon}` : ""}
          </Text>
          {m.ausgeblendet ? <Badge text="ausgeblendet" art="neutral" /> : null}
          <Text style={[styles.text, { color: farben.text }]}>
            {m.text ?? "Die Kopie des Textes ist gelöscht."}
          </Text>
          {m.nachrichtId && !m.ausgeblendet ? (
            <Button
              titel="Nachricht ausblenden"
              hinweis={`Meldung vom ${nachrichtZeitText(m.erstelltAm)}`}
              onPress={() => ausblendenGedrueckt(m)}
              disabled={beschaeftigt}
            />
          ) : null}
          {m.autor && !m.autor.deaktiviert ? (
            <Button
              titel="Konto deaktivieren"
              hinweis={`Sperrt das Konto von ${m.autor.name}`}
              onPress={() => deaktivierenGedrueckt(m)}
              disabled={beschaeftigt}
            />
          ) : null}
          <Button
            titel="Erledigt"
            hinweis="Löscht die Kopie des Textes"
            onPress={() => erledigenGedrueckt(m)}
            disabled={beschaeftigt}
          />
        </Karte>
      ))}
      {meldungen.hasNextPage ? (
        <>
          <Fehlermeldung
            text={
              meldungen.isFetchNextPageError
                ? "Weitere Meldungen liessen sich nicht laden."
                : undefined
            }
          />
          <Button
            titel="Weitere Meldungen laden"
            onPress={() => void meldungen.fetchNextPage()}
            disabled={meldungen.isFetchingNextPage}
          />
        </>
      ) : null}
    </Bildschirm>
  );
}

const styles = StyleSheet.create({
  text: { fontSize: schrift.text },
  klein: { fontSize: schrift.klein },
  kopf: { fontSize: schrift.klein, fontWeight: "700" },
});
