import { useEffect } from "react";
import {
  AccessibilityInfo,
  Platform,
  Text,
  View,
  type StyleProp,
  type TextStyle,
} from "react-native";

type Props = { text?: string; stil?: StyleProp<TextStyle> };

// Sichtbare Meldung, die angesagt wird, ohne den Fokus zu verschieben (Checkliste 1.7)
export function Ansage({ text, stil }: Props) {
  useEffect(() => {
    if (text && Platform.OS === "ios") {
      AccessibilityInfo.announceForAccessibilityWithOptions(text, {
        queue: true,
      });
    }
  }, [text]);

  // Android sagt nur Änderungen in einer bestehenden Live-Region an, darum bleibt sie auch leer im Baum
  return (
    <View accessibilityLiveRegion="polite" collapsable={false}>
      {text ? <Text style={stil}>{text}</Text> : null}
    </View>
  );
}
