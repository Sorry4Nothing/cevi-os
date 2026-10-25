import { Pressable, StyleSheet, Text } from "react-native";

import { masse, schrift, useFarben } from "./tokens";

type Props = {
  titel: string;
  onPress: () => void;
  disabled?: boolean;
  // Nur, wenn die Folge nicht schon aus dem Namen hervorgeht
  hinweis?: string;
};

export function Button({ titel, onPress, disabled = false, hinweis }: Props) {
  const farben = useFarben();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={titel}
      accessibilityHint={hinweis}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        // Gedrückt tauschen Fläche und Schrift auf ein belegtes Paar, statt blasser zu werden
        { backgroundColor: pressed ? farben.text : farben.akzent },
        disabled && styles.gesperrt,
      ]}
    >
      {({ pressed }) => (
        <Text
          style={[
            styles.titel,
            { color: pressed ? farben.hintergrund : farben.aufAkzent },
          ]}
        >
          {titel}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: masse.ziel,
    minWidth: masse.ziel,
    justifyContent: "center",
    paddingHorizontal: masse.abstand,
    paddingVertical: masse.luecke,
    borderRadius: masse.radius,
  },
  titel: { fontSize: schrift.text, fontWeight: "600", textAlign: "center" },
  gesperrt: { opacity: 0.5 },
});
