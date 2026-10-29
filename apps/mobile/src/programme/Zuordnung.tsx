import { useState, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

import { ApiFehler } from "../api/client";
import { useIch } from "../api/ich";
import {
  useZuordnen,
  type Auswahlstand,
  type ProgrammDetail,
} from "../api/programme";
import { useStufen } from "../api/stufen";
import { Ansage } from "../ui/Ansage";
import { OptionenAuswahl } from "../ui/Auswahl";
import { Button } from "../ui/Button";
import { Fehlermeldung } from "../ui/Fehlermeldung";
import { JaNeinAuswahl } from "../ui/JaNeinAuswahl";
import { masse, schrift, useFarben } from "../ui/tokens";
import { zuordnungsRechte, type Sichtbarkeit } from "./zuordnen";

const SICHTBARKEITEN = [
  { wert: "intern", text: "Intern" },
  { wert: "leitende", text: "Leitende" },
  { wert: "eltern", text: "Eltern" },
] as const;

const OHNE_STUFE = "Ohne Stufe ist nur die Sichtbarkeit Intern möglich.";
const OFFLINE =
  "Keine Internetverbindung. Die Zuordnung ist nicht gespeichert.";
const NICHT_ERLAUBT = "Diese Änderung ist nicht erlaubt.";
const NICHT_GESPEICHERT =
  "Die Zuordnung ist nicht gespeichert. Bitte nochmals versuchen.";

type Fehler = { text: string; nr: number; ort: "sichtbarkeit" | "senden" };

// Zuordnen für SL und Admins; die Regeln sind nur gespiegelt, die API entscheidet
export function Zuordnung({ programm }: { programm: ProgrammDetail }) {
  const ich = useIch();
  if (!ich.data) return null;
  const rechte = zuordnungsRechte(ich.data, programm);
  // Die Stufen werden erst für den Abschnitt geladen, nicht für jede Rolle
  return rechte.darf ? <Abschnitt programm={programm} rechte={rechte} /> : null;
}

type Rechte = ReturnType<typeof zuordnungsRechte>;

function Abschnitt({
  programm,
  rechte,
}: {
  programm: ProgrammDetail;
  rechte: Rechte;
}) {
  const farben = useFarben();
  const stufen = useStufen();
  const zuordnen = useZuordnen(programm.id);
  const [fehler, setFehler] = useState<Fehler>();
  const [gespeichert, setGespeichert] = useState<string>();

  // Ein neues nr lässt dieselbe Meldung nochmals den Fokus nehmen (6.3)
  const zeigeFehler = (text: string, ort: Fehler["ort"]) =>
    setFehler((alt) => ({ text, nr: (alt?.nr ?? 0) + 1, ort }));

  function senden(auswahl: Auswahlstand) {
    setFehler(undefined);
    setGespeichert(undefined);
    zuordnen.mutate(auswahl, {
      onSuccess: () => setGespeichert("Zuordnung gespeichert."),
      onError: (e) =>
        zeigeFehler(
          e instanceof ApiFehler
            ? e.status === 403
              ? NICHT_ERLAUBT
              : NICHT_GESPEICHERT
            : OFFLINE,
          "senden",
        ),
    });
  }

  const textStil = { fontSize: schrift.text, color: farben.text };

  return (
    <View style={styles.abschnitt}>
      <Text accessibilityRole="header" style={[styles.ueberschrift, textStil]}>
        Zuordnung
      </Text>
      {stufen.data ? (
        <Formular
          // Neuer Stand vom Server, neue Auswahl; Meldung und Ansage bleiben dabei stehen
          key={`${programm.stufen.map((s) => s.id).join(",")}|${programm.sichtbarkeit}`}
          programm={programm}
          alleStufen={stufen.data.stufen}
          rechte={rechte}
          fehler={fehler?.ort === "sichtbarkeit" ? fehler : undefined}
          laeuft={zuordnen.isPending}
          onAenderung={() => setGespeichert(undefined)}
          onFehler={zeigeFehler}
          onSenden={senden}
        >
          <Fehlermeldung
            key={fehler?.nr}
            text={fehler?.ort === "senden" ? fehler.text : undefined}
          />
          <Ansage text={gespeichert} stil={textStil} />
        </Formular>
      ) : stufen.isPending ? (
        <Ansage text="Die Stufen werden geladen …" stil={textStil} />
      ) : (
        <>
          <Fehlermeldung text="Die Stufen liessen sich nicht laden." />
          <Button
            titel="Nochmals versuchen"
            onPress={() => void stufen.refetch()}
          />
        </>
      )}
    </View>
  );
}

type FormularProps = {
  programm: ProgrammDetail;
  alleStufen: { id: string; name: string }[];
  rechte: Rechte;
  fehler?: Fehler;
  laeuft: boolean;
  onAenderung: () => void;
  onFehler: (text: string, ort: Fehler["ort"]) => void;
  onSenden: (auswahl: Auswahlstand) => void;
  // Meldung und Ansage der Zuordnung, über dem Knopf
  children: ReactNode;
};

// Die Auswahl lebt hier, damit der key sie zurücksetzt und sonst nichts
function Formular({
  programm,
  alleStufen,
  rechte,
  fehler,
  laeuft,
  onAenderung,
  onFehler,
  onSenden,
  children,
}: FormularProps) {
  const farben = useFarben();
  const [gewaehlt, setGewaehlt] = useState(programm.stufen.map((s) => s.id));
  const [sichtbarkeit, setSichtbarkeit] = useState<Sichtbarkeit>(
    programm.sichtbarkeit,
  );

  const waehleStufe = (id: string, an: boolean) => {
    onAenderung();
    setGewaehlt((alt) => [...alt.filter((s) => s !== id), ...(an ? [id] : [])]);
  };
  const fremde = programm.stufen.filter((s) => !rechte.stufe(s.id));
  const textStil = { fontSize: schrift.text, color: farben.text };

  function speichern() {
    if (gewaehlt.length === 0 && sichtbarkeit !== "intern") {
      return onFehler(OHNE_STUFE, "sichtbarkeit");
    }
    onSenden({ stufen: gewaehlt, sichtbarkeit });
  }

  return (
    <>
      <Text style={[styles.label, textStil]}>Stufen</Text>
      {alleStufen
        .filter((stufe) => rechte.stufe(stufe.id))
        .map((stufe) => (
          <View key={stufe.id} style={styles.abschnitt}>
            <Text style={textStil}>{stufe.name}</Text>
            <JaNeinAuswahl
              wert={gewaehlt.includes(stufe.id)}
              onWahl={(an) => waehleStufe(stufe.id, an)}
              kontext={stufe.name}
            />
          </View>
        ))}
      {fremde.length > 0 ? (
        <Text style={textStil}>
          Auch zugeordnet: {fremde.map((s) => s.name).join(", ")}
        </Text>
      ) : null}
      {rechte.sichtbarkeit ? (
        <>
          <Text style={[styles.label, textStil]}>Sichtbarkeit</Text>
          <Text style={textStil}>
            Intern: nur Admins und SL. Leitende: dazu die Leitenden der
            gewählten Stufen. Eltern: dazu die Eltern mit einem Kind in einer
            gewählten Stufe.
          </Text>
          <Fehlermeldung key={fehler?.nr} text={fehler?.text} />
          <OptionenAuswahl
            optionen={SICHTBARKEITEN}
            wert={sichtbarkeit}
            onWahl={(wahl) => {
              onAenderung();
              setSichtbarkeit(wahl);
            }}
            kontext="Sichtbarkeit"
          />
        </>
      ) : (
        <>
          <Text style={textStil}>
            Sichtbarkeit:{" "}
            {SICHTBARKEITEN.find((s) => s.wert === programm.sichtbarkeit)?.text}
          </Text>
          <Text style={textStil}>
            Die Sichtbarkeit ändern hier nur Admins, weil das Programm auch
            anderen Stufen gehört.
          </Text>
        </>
      )}
      {children}
      <Button
        titel="Zuordnung speichern"
        onPress={speichern}
        disabled={laeuft}
      />
    </>
  );
}

const styles = StyleSheet.create({
  abschnitt: { gap: masse.luecke },
  ueberschrift: { fontWeight: "700" },
  label: { fontWeight: "600" },
});
