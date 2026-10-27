import { useEffect, useRef } from "react";
import {
  Text,
  type HostInstance,
  type StyleProp,
  type TextStyle,
} from "react-native";

import { fokussieren } from "./fokus";
import { schrift, useFarben } from "./tokens";

type Props = { text?: string; stil?: StyleProp<TextStyle> };

// Fehlertext, der beim Erscheinen den Fokus nimmt (Checkliste 6.3); eine Ansage obendrauf würde ihn doppelt vorlesen
export function Fehlermeldung({ text, stil }: Props) {
  const ref = useRef<HostInstance>(null);
  const farben = useFarben();

  useEffect(() => {
    if (text) fokussieren(ref.current);
  }, [text]);

  if (!text) return null;
  return (
    <Text
      ref={ref}
      style={[{ fontSize: schrift.text, color: farben.fehler }, stil]}
    >
      {text}
    </Text>
  );
}
