import { Pressable, StyleSheet, Text, View } from "react-native";

import { masse, schrift, useFarben } from "./tokens";

type Props = {
  label: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
};

// Kästchen mit ✓ und Beschriftung; der Zustand steht im Symbol, die Zustandsworte sagt das Gerät an (Checkliste 5.6, 9.8)
export function Schalter({ label, checked, onChange, disabled }: Props) {
  const farben = useFarben();

  return (
    <Pressable
      // switch statt checkbox: Beide Systeme sagen Rolle und Zustand in der Sprache des Geräts an
      accessibilityRole="switch"
      accessibilityLabel={label}
      // Kein Hinweis: Der Name sagt die Folge schon; die Lint-Regel verlangt nur den Prop
      accessibilityHint={undefined}
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={onChange}
      style={[styles.schalter, disabled && styles.gedimmt]}
    >
      <View
        aria-hidden
        style={[
          styles.kaestchen,
          { borderColor: farben.rand },
          checked && {
            backgroundColor: farben.akzent,
            borderColor: farben.akzent,
          },
        ]}
      >
        {checked ? (
          <Text style={[styles.haken, { color: farben.aufAkzent }]}>✓</Text>
        ) : null}
      </View>
      <Text style={[styles.text, { color: farben.text }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  schalter: {
    minHeight: masse.ziel,
    minWidth: masse.ziel,
    flexDirection: "row",
    alignItems: "center",
    gap: masse.luecke,
  },
  gedimmt: { opacity: 0.5 },
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
