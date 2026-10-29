import { StyleSheet, Text, View } from "react-native";

import { masse, schrift, useFarben } from "./tokens";

const symbole = { positiv: "✓", negativ: "✕", neutral: "○" };

type Props = { text: string; art: keyof typeof symbole };

// Ein Zustand zeigt sich mit Symbol und Text, nie nur über Farbe (Checkliste 5.6)
export function Badge({ text, art }: Props) {
  const farben = useFarben();
  const farbe = {
    positiv: farben.erfolg,
    negativ: farben.fehler,
    neutral: farben.textLeise,
  }[art];

  return (
    <View style={[styles.badge, { borderColor: farbe }]}>
      <Text aria-hidden style={[styles.text, { color: farbe }]}>
        {symbole[art]}
      </Text>
      <Text style={[styles.text, styles.umbruch, { color: farbe }]}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignSelf: "flex-start",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: masse.luecke,
    paddingVertical: 2,
    borderWidth: 1,
    borderRadius: masse.radius,
  },
  text: { fontSize: schrift.klein },
  umbruch: { flexShrink: 1 },
});
