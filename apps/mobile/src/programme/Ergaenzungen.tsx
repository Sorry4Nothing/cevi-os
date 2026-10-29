import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { ApiFehler } from "../api/client";
import {
  useErgaenzen,
  type Ergaenzungen as Aenderung,
  type ProgrammDetail,
} from "../api/programme";
import { Ansage } from "../ui/Ansage";
import { Button } from "../ui/Button";
import { Fehlermeldung } from "../ui/Fehlermeldung";
import { Textfeld } from "../ui/Textfeld";
import { masse, schrift, useFarben } from "../ui/tokens";
import { schlussZeitEingabe } from "./zeit";

const OFFLINE =
  "Keine Internetverbindung. Die Ergänzungen sind nicht gespeichert.";
const NICHT_ERLAUBT = "Diese Änderung ist nicht erlaubt.";
const NICHT_GESPEICHERT =
  "Die Ergänzungen sind nicht gespeichert. Bitte nochmals versuchen.";
const ZEIT_FEHLER = "Bitte eine Uhrzeit wie 16:30 eingeben.";

const FELDER = [
  "treffpunkt",
  "schlussOrt",
  "schlussZeit",
  "mitnehmen",
  "infoEltern",
] as const;
type Feld = (typeof FELDER)[number];
type Werte = Record<Feld, string>;
// start: zuletzt bekannter Stand auf dem Server, text: was in den Feldern steht
type Stand = { start: Werte; text: Werte };

// Der Stand auf dem Server als Feldtext; die API liefert die Zeit als HH:MM:SS
const vomServer = (p: ProgrammDetail): Werte => ({
  treffpunkt: p.treffpunkt ?? "",
  schlussOrt: p.schlussOrt ?? "",
  schlussZeit: p.schlussZeit?.slice(0, 5) ?? "",
  mitnehmen: p.mitnehmen ?? "",
  infoEltern: p.infoEltern ?? "",
});

// Was gesendet würde: getrimmt, die Zeit als HH:MM; null bei einer ungültigen Zeit
const bereinigt = (feld: Feld, text: string) =>
  feld === "schlussZeit" ? schlussZeitEingabe(text) : text.trim();

function uebernehme(alt: Stand, server: Werte): Stand {
  const start = { ...alt.start };
  const text = { ...alt.text };
  for (const f of FELDER) {
    if (bereinigt(f, alt.text[f]) === alt.start[f]) {
      start[f] = server[f];
      text[f] = server[f];
    }
  }
  return { start, text };
}

type Fehler = { text: string; nr: number };

// Formular für Leitende, SL und Admins; ob es erscheint und ob gespeichert werden darf, sagt der Server (darfErgaenzen)
export function Ergaenzungen({ programm }: { programm: ProgrammDetail }) {
  const farben = useFarben();
  const ergaenzen = useErgaenzen(programm.id);
  const server = vomServer(programm);
  // Nie aus dem Server abgeleitet: Ein Neuladen darf Entwürfe und Meldungen nicht wegnehmen (Checkliste 7.2, 8.2)
  const [stand, setStand] = useState<Stand>({ start: server, text: server });
  const [fehler, setFehler] = useState<Fehler>();
  // nr zählt weiter, auch ohne Text: Derselbe Fehler im selben Druck bräuchte sonst denselben key und nähme den Fokus nicht neu
  const [zeitFehler, setZeitFehler] = useState({ text: "", nr: 0 });
  const [gespeichert, setGespeichert] = useState<string>();

  // Neuer Stand vom Server: Ein Feld, das noch dem Start entspricht, übernimmt ihn; ein bearbeitetes behält den Entwurf
  const serverSchluessel = JSON.stringify(FELDER.map((f) => server[f]));
  const [gesehen, setGesehen] = useState(serverSchluessel);
  if (gesehen !== serverSchluessel) {
    setGesehen(serverSchluessel);
    setStand(uebernehme(stand, server));
  }

  const melde = (alt: Fehler | undefined, text: string): Fehler => ({
    text,
    nr: (alt?.nr ?? 0) + 1,
  });

  function speichern() {
    setFehler(undefined);
    setGespeichert(undefined);
    setZeitFehler((alt) => ({ text: "", nr: alt.nr }));
    const json: Aenderung = {};
    const gesendet: Partial<Werte> = {};
    for (const f of FELDER) {
      const neu = bereinigt(f, stand.text[f]);
      if (neu === null) {
        return setZeitFehler((alt) => melde(alt, ZEIT_FEHLER));
      }
      if (neu !== stand.start[f]) {
        json[f] = neu || null;
        gesendet[f] = neu;
      }
    }
    if (Object.keys(json).length === 0) {
      return setGespeichert("Keine Änderung zum Speichern.");
    }
    ergaenzen.mutate(json, {
      onSuccess: () => {
        setGespeichert("Ergänzungen gespeichert.");
        // Das Gesendete ist der neue Start; der Text zeigt es normalisiert, falls er seither nicht geändert wurde
        setStand((alt) => {
          const text = { ...alt.text };
          for (const f of FELDER) {
            const neu = gesendet[f];
            if (neu !== undefined && bereinigt(f, alt.text[f]) === neu) {
              text[f] = neu;
            }
          }
          return { start: { ...alt.start, ...gesendet }, text };
        });
      },
      onError: (e) =>
        setFehler((alt) =>
          melde(
            alt,
            e instanceof ApiFehler
              ? e.status === 403
                ? NICHT_ERLAUBT
                : NICHT_GESPEICHERT
              : OFFLINE,
          ),
        ),
    });
  }

  const eingabe = (f: Feld) => ({
    value: stand.text[f],
    onChangeText: (text: string) =>
      setStand((alt) => ({ ...alt, text: { ...alt.text, [f]: text } })),
  });
  const textStil = { fontSize: schrift.text, color: farben.text };
  const googleOrt = programm.googleOrt?.trim();

  return (
    <View style={styles.abschnitt}>
      <Text accessibilityRole="header" style={[styles.ueberschrift, textStil]}>
        Ergänzungen bearbeiten
      </Text>
      {googleOrt ? (
        <Text style={textStil}>
          Ohne Treffpunkt zeigt die App den Ort aus dem Kalender: {googleOrt}.
        </Text>
      ) : null}
      <Textfeld label="Treffpunkt" maxLength={200} {...eingabe("treffpunkt")} />
      <Textfeld label="Schlussort" maxLength={200} {...eingabe("schlussOrt")} />
      <Textfeld
        label="Schlusszeit, z. B. 16:30"
        maxLength={5}
        keyboardType="numbers-and-punctuation"
        fehler={zeitFehler.text}
        fehlerSchluessel={zeitFehler.nr}
        {...eingabe("schlussZeit")}
      />
      <Textfeld
        label="Mitnehmen"
        multiline
        maxLength={2000}
        {...eingabe("mitnehmen")}
      />
      <Textfeld
        label="Info für Eltern"
        multiline
        maxLength={2000}
        {...eingabe("infoEltern")}
      />
      <Fehlermeldung key={fehler?.nr} text={fehler?.text} />
      <Ansage text={gespeichert} stil={textStil} />
      <Button
        titel="Ergänzungen speichern"
        onPress={speichern}
        disabled={ergaenzen.isPending}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  abschnitt: { gap: masse.luecke },
  ueberschrift: { fontWeight: "700" },
});
