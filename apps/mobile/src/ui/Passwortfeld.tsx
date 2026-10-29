import { useState, type ComponentProps } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Textfeld } from "./Textfeld";
import { masse, schrift, useFarben } from "./tokens";

// Kein Feld zum Wiederholen, dafür «Passwort anzeigen» mit angesagtem Zustand (Checkliste 9.7, 9.8)
type Props = Omit<
  ComponentProps<typeof Textfeld>,
  "secureTextEntry" | "autoCapitalize" | "autoCorrect"
>;

export function Passwortfeld(eingabe: Props) {
  const farben = useFarben();
  const [sichtbar, setSichtbar] = useState(false);

  return (
    <View style={styles.feld}>
      <Textfeld
        {...eingabe}
        secureTextEntry={!sichtbar}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Pressable
        // switch statt checkbox: Beide Systeme sagen Rolle und Zustand in der Sprache des Geräts an
        accessibilityRole="switch"
        accessibilityLabel="Passwort anzeigen"
        // Kein Hinweis: Der Name sagt die Folge schon; die Lint-Regel verlangt nur den Prop
        accessibilityHint={undefined}
        accessibilityState={{ checked: sichtbar }}
        onPress={() => setSichtbar((wert) => !wert)}
        style={styles.schalter}
      >
        <View
          aria-hidden
          style={[
            styles.kaestchen,
            { borderColor: farben.rand },
            sichtbar && {
              backgroundColor: farben.akzent,
              borderColor: farben.akzent,
            },
          ]}
        >
          {sichtbar ? (
            <Text style={[styles.haken, { color: farben.aufAkzent }]}>✓</Text>
          ) : null}
        </View>
        <Text style={[styles.text, { color: farben.text }]}>
          Passwort anzeigen
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  feld: { gap: masse.luecke },
  schalter: {
    minHeight: masse.ziel,
    minWidth: masse.ziel,
    flexDirection: "row",
    alignItems: "center",
    gap: masse.luecke,
  },
  kaestchen: {
    width: 24,
    height: 24,
    borderWidth: 2,
    borderRadius: masse.radius / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  haken: { fontSize: schrift.klein, fontWeight: "700" },
  text: { fontSize: schrift.text },
});
