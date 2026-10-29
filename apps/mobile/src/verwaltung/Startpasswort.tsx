import { useEffect, useRef } from "react";
import { Share, StyleSheet, Text, type HostInstance } from "react-native";

import { Button } from "../ui/Button";
import { fokussieren } from "../ui/fokus";
import { Karte } from "../ui/Karte";
import { schrift, useFarben } from "../ui/tokens";

type Props = {
  benutzername: string;
  startpasswort: string;
  onFertig: () => void;
};

const HINWEIS =
  "Nicht weiterleiten. Gilt 7 Tage und nur für die erste Anmeldung.";

// Erscheint genau einmal, aus dem Zustand der Mutation; «Fertig» räumt es weg
export function Startpasswort({
  benutzername,
  startpasswort,
  onFertig,
}: Props) {
  const farben = useFarben();
  const passwort = useRef<HostInstance>(null);
  useEffect(() => fokussieren(passwort.current), []);
  // Buchstabiert für Screenreader: «K 7 M P, Q 4 X R, T 9 W D»
  const buchstabiert = startpasswort
    .split("-")
    .map((gruppe) => gruppe.split("").join(" "))
    .join(", ");

  return (
    <Karte>
      <Text style={[styles.text, { color: farben.text }]}>
        Benutzername: {benutzername}
      </Text>
      <Text
        ref={passwort}
        accessibilityLabel={`Startpasswort: ${buchstabiert}`}
        // Kein Bedienelement: Der Warnhinweis folgt als eigener Text, ein Hint käme doppelt
        accessibilityHint={undefined}
        style={[styles.passwort, { color: farben.text }]}
      >
        Startpasswort: {startpasswort}
      </Text>
      <Text style={[styles.text, { color: farben.text }]}>{HINWEIS}</Text>
      <Button
        titel="Teilen"
        onPress={() =>
          void Share.share({
            message: `Benutzername: ${benutzername}\nStartpasswort: ${startpasswort}\n${HINWEIS}`,
          })
        }
      />
      <Button titel="Fertig" onPress={onFertig} />
    </Karte>
  );
}

const styles = StyleSheet.create({
  text: { fontSize: schrift.text },
  passwort: { fontSize: schrift.text, fontWeight: "700" },
});
