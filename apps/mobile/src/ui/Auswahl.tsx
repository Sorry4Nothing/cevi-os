import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { masse, schrift, useFarben } from "./tokens";

type Props = {
  // Sichtbare Beschriftung der Auswahl
  label: string;
  optionen: readonly string[];
  wert: string;
  onWahl: (wert: string) => void;
  // Steht im Namen nach der Option, z. B. «Alle, Stufenfilter»
  kontext: string;
  // Nur, wenn die Folge nicht schon aus dem Namen hervorgeht
  hinweis?: string;
};

// Eine Auswahl aus n Optionen; genau eine ist gewählt
export function Auswahl({
  label,
  optionen,
  wert,
  onWahl,
  kontext,
  hinweis,
}: Props) {
  const farben = useFarben();

  return (
    <View style={styles.gruppe}>
      <Text style={[styles.label, { color: farben.text }]}>{label}</Text>
      <View style={styles.optionen}>
        {optionen.map((option) => (
          <Antwort
            key={option}
            text={option}
            gewaehlt={option === wert}
            onPress={() => onWahl(option)}
            kontext={kontext}
            hinweis={hinweis}
          />
        ))}
      </View>
    </View>
  );
}

type AntwortProps = {
  text: string;
  gewaehlt: boolean;
  onPress: () => void;
  kontext: string;
  hinweis?: string;
};

// iOS kennt keine Radio-Gruppe: Jede Antwort sagt über accessibilityState selbst an, ob sie gewählt ist (Checkliste 1.4)
export function Antwort({
  text,
  gewaehlt,
  onPress,
  kontext,
  hinweis,
}: AntwortProps) {
  const farben = useFarben();
  const schriftfarbe = gewaehlt ? farben.aufAkzent : farben.text;
  // Auf iOS hängt RN an radio und checked englische Wörter an; button und selected sagt VoiceOver selbst in der Sprache des Geräts
  const ios = Platform.OS === "ios";

  return (
    <Pressable
      accessibilityRole={ios ? "button" : "radio"}
      accessibilityLabel={`${text}, ${kontext}`}
      accessibilityHint={hinweis}
      accessibilityState={ios ? { selected: gewaehlt } : { checked: gewaehlt }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.antwort,
        gewaehlt
          ? { backgroundColor: farben.akzent, borderColor: farben.akzent }
          : { borderColor: farben.rand },
        !gewaehlt && pressed && { backgroundColor: farben.flaeche },
      ]}
    >
      {gewaehlt ? (
        <Text aria-hidden style={[styles.text, { color: schriftfarbe }]}>
          ✓
        </Text>
      ) : null}
      <Text style={[styles.text, { color: schriftfarbe }]}>{text}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  gruppe: { gap: masse.luecke },
  label: { fontSize: schrift.text, fontWeight: "600" },
  optionen: { flexDirection: "row", flexWrap: "wrap", gap: masse.luecke },
  antwort: {
    minHeight: masse.ziel,
    minWidth: masse.ziel,
    flexGrow: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: masse.luecke,
    paddingHorizontal: masse.abstand,
    borderWidth: 2,
    borderRadius: masse.radius,
  },
  text: { fontSize: schrift.text, fontWeight: "600" },
});
