import { Pressable, StyleSheet, Text } from "react-native";

import { masse, schrift, useFarben } from "./tokens";

type Props = {
  titel: string;
  text?: string;
  onPress: () => void;
  // Nur, wenn die Folge nicht schon aus dem Namen hervorgeht
  hinweis?: string;
};

export function Listenzeile({ titel, text, onPress, hinweis }: Props) {
  const farben = useFarben();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={text ? `${titel}, ${text}` : titel}
      accessibilityHint={hinweis}
      accessibilityState={{ disabled: false }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.zeile,
        { borderColor: farben.rand },
        pressed && { backgroundColor: farben.flaeche },
      ]}
    >
      <Text style={[styles.titel, { color: farben.text }]}>{titel}</Text>
      {text ? (
        <Text style={[styles.text, { color: farben.textLeise }]}>{text}</Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  zeile: {
    minHeight: masse.ziel,
    minWidth: masse.ziel,
    justifyContent: "center",
    paddingVertical: masse.luecke,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  titel: { fontSize: schrift.text },
  text: { fontSize: schrift.klein },
});
