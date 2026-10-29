import { useId, useState } from "react";
import {
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";

import { Fehlermeldung } from "./Fehlermeldung";
import { masse, schrift, useFarben } from "./tokens";

// Einfügen bleibt erlaubt, die Schrift wächst mit, und den Namen gibt nur die sichtbare Beschriftung (Checkliste 9.6, 5.3, 4.1).
// Hinweis, Zustand und Platzhalterfarbe setzt das Feld selbst; die aria-Props kämen durch den Spread darüber (TextInput mischt sie vor den eigenen Zustand)
type Props = Omit<
  TextInputProps,
  | "style"
  | "contextMenuHidden"
  | "allowFontScaling"
  | "maxFontSizeMultiplier"
  | "accessibilityLabel"
  | "aria-label"
  | "accessibilityLabelledBy"
  | "aria-labelledby"
  | "aria-disabled"
  | "aria-busy"
  | "aria-checked"
  | "aria-expanded"
  | "aria-selected"
  | "accessibilityHint"
  | "accessibilityState"
  | "placeholderTextColor"
> & {
  label: string;
  fehler?: string;
  // Mehrzeilige Felder wachsen bis hierhin und scrollen dann in sich
  maxHoehe?: number;
};

export function Textfeld({
  label,
  fehler,
  maxHoehe,
  onFocus,
  onBlur,
  ...eingabe
}: Props) {
  const farben = useFarben();
  const [fokus, setFokus] = useState(false);
  const beschriftungId = useId();
  const ios = Platform.OS === "ios";

  return (
    <View style={styles.feld}>
      {/* iOS: VoiceOver hört die Beschriftung am Feld selbst, nicht zweimal */}
      <Text
        nativeID={beschriftungId}
        aria-hidden={ios}
        style={[styles.text, { color: farben.text }]}
      >
        {label}
      </Text>
      <TextInput
        {...eingabe}
        // Android: Ein Name würde zur contentDescription, die Accessibility Scanner bei Eingabefeldern als Fehler meldet (Checkliste 4.1)
        accessibilityLabel={ios ? label : undefined}
        aria-labelledby={ios ? undefined : beschriftungId}
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
            maxHeight: maxHoehe,
            // Fokus und Fehler machen den Rand je 1 dicker, so bleibt der Fokus auch bei einem Fehler sichtbar
            borderWidth: 1 + (fokus ? 1 : 0) + (fehler ? 1 : 0),
            borderColor: fehler
              ? farben.fehler
              : fokus
                ? farben.akzent
                : farben.rand,
          },
        ]}
      />
      <Fehlermeldung text={fehler} />
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
