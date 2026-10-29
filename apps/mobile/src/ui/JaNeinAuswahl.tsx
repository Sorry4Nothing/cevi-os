import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { masse, schrift, useFarben } from "./tokens";

type Props = {
  wert: boolean | null;
  onWahl: (wert: boolean) => void;
  // Steht im Namen nach der Antwort, z. B. «Ja, <Kind>, <Programm>»
  kontext: string;
  // Nur, wenn die Folge nicht schon aus dem Namen hervorgeht
  hinweis?: string;
};

export function JaNeinAuswahl({ wert, onWahl, kontext, hinweis }: Props) {
  return (
    <View style={styles.auswahl}>
      <Antwort
        text="Ja"
        gewaehlt={wert === true}
        onPress={() => onWahl(true)}
        kontext={kontext}
        hinweis={hinweis}
      />
      <Antwort
        text="Nein"
        gewaehlt={wert === false}
        onPress={() => onWahl(false)}
        kontext={kontext}
        hinweis={hinweis}
      />
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
function Antwort({ text, gewaehlt, onPress, kontext, hinweis }: AntwortProps) {
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
  auswahl: { flexDirection: "row", flexWrap: "wrap", gap: masse.luecke },
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
