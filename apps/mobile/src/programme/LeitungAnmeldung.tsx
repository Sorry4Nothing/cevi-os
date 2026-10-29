import { useState } from "react";
import { StyleSheet, Text } from "react-native";

import { ApiFehler } from "../api/client";
import { useLeitungAnmelden } from "../api/programme";
import { Fehlermeldung } from "../ui/Fehlermeldung";
import { JaNeinAuswahl } from "../ui/JaNeinAuswahl";
import { schrift, useFarben } from "../ui/tokens";

const BEGONNEN =
  "Das Programm hat schon begonnen. Die Anmeldung lässt sich nicht mehr ändern.";
const NICHT_GESPEICHERT =
  "Das Speichern hat nicht geklappt. Bitte nochmals versuchen.";
const OFFLINE =
  "Keine Internetverbindung. Ändern geht erst wieder mit Internet.";

type Props = {
  programmId: string;
  titel: string;
  wert: "ja" | "nein" | "offen";
  online: boolean;
};

// Die eigene Anmeldung als Leitung; der Server entscheidet über Recht und Beginn, die App kennt keine Regel
export function LeitungAnmeldung({ programmId, titel, wert, online }: Props) {
  const farben = useFarben();
  const anmelden = useLeitungAnmelden(programmId);
  const [fehler, setFehler] = useState<{ text: string; nr: number }>();

  // Ein neuer key lässt die Meldung neu erscheinen: Auch derselbe Offline-Hinweis nimmt nochmals den Fokus (6.3)
  const zeigeFehler = (text: string) =>
    setFehler((alt) => ({ text, nr: (alt?.nr ?? 0) + 1 }));

  function waehle(ja: boolean) {
    // Nie offline absenden: Die Anfrage käme womöglich erst nach dem Beginn an
    if (!online) return zeigeFehler(OFFLINE);
    setFehler(undefined);
    anmelden.mutate(ja ? "ja" : "nein", {
      onError: (e) =>
        zeigeFehler(
          e instanceof ApiFehler
            ? e.status === 409
              ? BEGONNEN
              : NICHT_GESPEICHERT
            : OFFLINE,
        ),
    });
  }

  return (
    <>
      <Text
        accessibilityRole="header"
        style={[styles.label, { color: farben.text }]}
      >
        Anmeldung als Leitung
      </Text>
      <Fehlermeldung key={fehler?.nr} text={fehler?.text} />
      <JaNeinAuswahl
        wert={wert === "offen" ? null : wert === "ja"}
        onWahl={waehle}
        kontext={`Anmeldung als Leitung, ${titel}`}
      />
    </>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: schrift.text, fontWeight: "700" },
});
