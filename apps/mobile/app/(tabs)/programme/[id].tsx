import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Linking, Platform, StyleSheet, Text } from "react-native";

import { queryClient, useOnline } from "../../../src/api/client";
import { useProgramm, type Programm } from "../../../src/api/programme";
import { schlussZeitText, zeitText } from "../../../src/programme/zeit";
import { Badge } from "../../../src/ui/Badge";
import { Bildschirm } from "../../../src/ui/Bildschirm";
import { Fehlermeldung } from "../../../src/ui/Fehlermeldung";
import { Listenzeile } from "../../../src/ui/Listenzeile";
import { schrift, useFarben } from "../../../src/ui/tokens";

export default function ProgrammDetail() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const programm = useProgramm(id);
  const online = useOnline();
  const [kartenFehler, setKartenFehler] = useState<string>();

  const detail = programm.data;
  // Bis das Detail geladen ist, steht der Titel aus der gecachten Liste, sonst «Programm»
  const ausListe = queryClient
    .getQueriesData<Programm[]>({ queryKey: ["programme", "liste"] })
    .flatMap(([, daten]) => daten ?? [])
    .find((p) => p.id === id);
  const titel = detail?.titel ?? ausListe?.titel ?? "Programm";

  async function kartenApp(ort: string) {
    setKartenFehler(undefined);
    // Ohne Karten-SDK: Android über den geo-Intent, iOS über Apple-Map-Links
    const url =
      Platform.OS === "android"
        ? `geo:0,0?q=${encodeURIComponent(ort)}`
        : `https://maps.apple.com/?q=${encodeURIComponent(ort)}`;
    try {
      await Linking.openURL(url);
    } catch {
      setKartenFehler("Die Karten-App liess sich nicht öffnen.");
    }
  }

  // Solange niemand einen Treffpunkt ergänzt hat, zeigt die App den Ort aus Google
  const treffpunkt = detail?.treffpunkt?.trim()
    ? detail.treffpunkt
    : detail?.googleOrt;
  const schluss = detail
    ? [
        detail.schlussZeit ? `${schlussZeitText(detail.schlussZeit)} Uhr` : "",
        detail.schlussOrt ?? "",
      ]
        .filter(Boolean)
        .join(", ")
    : "";

  return (
    <Bildschirm
      titel={titel}
      zustand={
        detail === null
          ? "leer"
          : detail
            ? "bereit"
            : programm.isPending
              ? "laden"
              : "fehler"
      }
      offline={!online}
      leerText="Dieses Programm ist nicht mehr sichtbar."
      onNeuLaden={() => void programm.refetch()}
      onZurueck={() => router.back()}
    >
      {detail ? (
        <>
          {detail.status === "abgesagt" ? (
            <Badge text="Abgesagt" art="negativ" />
          ) : null}
          <Feld label="Zeit" wert={zeitText(detail)} />
          {treffpunkt ? (
            <>
              <Fehlermeldung text={kartenFehler} />
              <Listenzeile
                titel="Treffpunkt"
                text={treffpunkt}
                hinweis="Öffnet die Karten-App"
                onPress={() => void kartenApp(treffpunkt)}
              />
            </>
          ) : null}
          <Feld label="Schluss" wert={schluss} />
          <Feld label="Mitnehmen" wert={detail.mitnehmen ?? ""} />
          <Feld label="Info" wert={detail.infoEltern ?? ""} />
          {/* Der Server liefert sie nur mit Leitungssicht; die App entscheidet nie nach Rolle */}
          <Feld
            label="Interne Beschreibung"
            wert={detail.googleBeschreibung ?? ""}
          />
        </>
      ) : null}
    </Bildschirm>
  );
}

// Ein Feld mit sichtbarer Beschriftung; leere Felder fallen weg
function Feld({ label, wert }: { label: string; wert: string }) {
  const farben = useFarben();
  if (!wert) return null;
  return (
    <>
      <Text
        accessibilityRole="header"
        style={[styles.label, { color: farben.text }]}
      >
        {label}
      </Text>
      <Text style={[styles.wert, { color: farben.text }]}>{wert}</Text>
    </>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: schrift.text, fontWeight: "700" },
  wert: { fontSize: schrift.text },
});
