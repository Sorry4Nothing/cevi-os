import { useState } from "react";
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";

import { Ansage } from "./Ansage";
import { masse, schrift, useFarben } from "./tokens";

// Einfügen bleibt erlaubt und die Schrift wächst mit (Checkliste 9.6, 5.3)
type Props = Omit<
  TextInputProps,
  "style" | "contextMenuHidden" | "allowFontScaling" | "maxFontSizeMultiplier"
> & {
  label: string;
  fehler?: string;
};

export function Textfeld({
  label,
  fehler,
  onFocus,
  onBlur,
  ...eingabe
}: Props) {
  const farben = useFarben();
  const [fokus, setFokus] = useState(false);

  return (
    <View style={styles.feld}>
      {/* Screenreader hören die Beschriftung am Feld selbst, nicht zweimal */}
      <Text aria-hidden style={[styles.text, { color: farben.text }]}>
        {label}
      </Text>
      <TextInput
        {...eingabe}
        accessibilityLabel={label}
        accessibilityHint={fehler}
        accessibilityState={{ disabled: eingabe.editable === false }}
        onFocus={(event) => {
          setFokus(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFokus(false);
          onBlur?.(event);
        }}
        placeholderTextColor={farben.textLeise}
        style={[
          styles.text,
          styles.eingabe,
          {
            color: farben.text,
            borderWidth: fehler || fokus ? 2 : 1,
            borderColor: fehler
              ? farben.fehler
              : fokus
                ? farben.akzent
                : farben.rand,
          },
        ]}
      />
      <Ansage text={fehler} stil={[styles.text, { color: farben.fehler }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  feld: { gap: masse.luecke },
  text: { fontSize: schrift.text },
  eingabe: {
    minHeight: masse.ziel,
    paddingHorizontal: 12,
    paddingVertical: masse.luecke,
    borderRadius: masse.radius,
  },
});
