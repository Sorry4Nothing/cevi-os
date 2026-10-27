import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { masse, schrift, useFarben } from "./tokens";

type Option<W extends string> = { wert: W; text: string };

type Props<W extends string> = {
  optionen: readonly Option<W>[];
  // null heisst: noch nichts gewählt (#19 nutzt das für Felder ohne Vorauswahl)
  wert: W | null;
  onWahl: (wert: W) => void;
  // Steht im Namen nach der Antwort, z. B. «Leitung, Stufe A»
  kontext: string;
  // Nur, wenn die Folge nicht schon aus dem Namen hervorgeht
  hinweis?: string;
};

// Eine Antwort pro Option; JaNeinAuswahl baut darauf auf
export function Auswahl<W extends string>({
  optionen,
  wert,
  onWahl,
  kontext,
  hinweis,
}: Props<W>) {
  return (
    <View style={styles.auswahl}>
      {optionen.map((option) => (
        <Antwort
          key={option.wert}
          text={option.text}
          gewaehlt={wert === option.wert}
          onPress={() => onWahl(option.wert)}
          kontext={kontext}
          hinweis={hinweis}
        />
      ))}
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
