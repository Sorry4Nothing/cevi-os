import type { ComponentProps } from "react";
import { Pressable, StyleSheet, Text } from "react-native";

import { Badge } from "./Badge";
import { masse, schrift, useFarben } from "./tokens";

type Props = {
  titel: string;
  text?: string;
  // Zwischen Titel und Text, und in dieser Reihenfolge im Namen
  badge?: ComponentProps<typeof Badge>;
  onPress: () => void;
  // Nur, wenn die Folge nicht schon aus dem Namen hervorgeht
  hinweis?: string;
};

export function Listenzeile({ titel, text, badge, onPress, hinweis }: Props) {
  const farben = useFarben();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[titel, badge?.text, text].filter(Boolean).join(", ")}
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
      {badge ? <Badge {...badge} /> : null}
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
