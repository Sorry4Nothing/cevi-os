import { StyleSheet, View } from "react-native";

import { Antwort } from "./Auswahl";
import { masse } from "./tokens";

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

const styles = StyleSheet.create({
  auswahl: { flexDirection: "row", flexWrap: "wrap", gap: masse.luecke },
});
