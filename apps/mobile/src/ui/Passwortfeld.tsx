import { useState, type ComponentProps } from "react";
import { StyleSheet, View } from "react-native";

import { Schalter } from "./Schalter";
import { Textfeld } from "./Textfeld";
import { masse } from "./tokens";

// Kein Feld zum Wiederholen, dafür «Passwort anzeigen» mit angesagtem Zustand (Checkliste 9.7, 9.8)
type Props = Omit<
  ComponentProps<typeof Textfeld>,
  "secureTextEntry" | "autoCapitalize" | "autoCorrect"
>;

export function Passwortfeld(eingabe: Props) {
  const [sichtbar, setSichtbar] = useState(false);

  return (
    <View style={styles.feld}>
      <Textfeld
        {...eingabe}
        secureTextEntry={!sichtbar}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Schalter
        label="Passwort anzeigen"
        checked={sichtbar}
        onChange={() => setSichtbar((wert) => !wert)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  feld: { gap: masse.luecke },
});
