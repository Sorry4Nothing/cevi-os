import { useEffect, useRef, type ReactNode } from "react";
import {
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
  useColorScheme,
  type HostInstance,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Ansage } from "./Ansage";
import { Button } from "./Button";
import { fokussieren } from "./fokus";
import { masse, schrift, useFarben } from "./tokens";

type Props = {
  titel: string;
  zustand?: "laden" | "leer" | "fehler" | "bereit";
  // Ohne Netz bleibt der zuletzt geladene Inhalt sichtbar
  offline?: boolean;
  leerText?: string;
  fehlerText?: string;
  onNeuLaden?: () => void;
  children?: ReactNode;
};

export function Bildschirm({
  titel,
  zustand = "bereit",
  offline = false,
  leerText = "Hier gibt es noch nichts.",
  fehlerText = "Das Laden hat nicht geklappt.",
  onNeuLaden,
  children,
}: Props) {
  const farben = useFarben();
  const dunkel = useColorScheme() === "dark";
  const ueberschrift = useRef<HostInstance>(null);
  const fehler = useRef<HostInstance>(null);

  // Fokus nach einer Navigation auf der Überschrift, nach einem Fehler auf der Meldung (Checkliste 6.1, 6.3)
  useEffect(() => fokussieren(ueberschrift.current), []);
  useEffect(() => {
    if (zustand === "fehler") fokussieren(fehler.current);
  }, [zustand]);

  const status =
    zustand === "laden"
      ? "Wird geladen …"
      : zustand === "leer"
        ? leerText
        : undefined;

  return (
    <SafeAreaView
      style={[styles.bildschirm, { backgroundColor: farben.hintergrund }]}
    >
      {/* Android färbt die Symbole der Statusleiste nicht selbst passend zum Hintergrund */}
      <StatusBar barStyle={dunkel ? "light-content" : "dark-content"} />
      <ScrollView contentContainerStyle={styles.inhalt}>
        <Text
          ref={ueberschrift}
          accessibilityRole="header"
          style={[styles.titel, { color: farben.text }]}
        >
          {titel}
        </Text>
        <Ansage
          text={
            offline
              ? "Keine Internetverbindung. Die App zeigt die zuletzt geladenen Daten. Ändern geht erst wieder mit Internet."
              : undefined
          }
          stil={[
            styles.text,
            styles.meldung,
            styles.offline,
            { color: farben.text, backgroundColor: farben.flaeche },
          ]}
        />
        <Ansage
          text={status}
          stil={[styles.text, styles.meldung, { color: farben.text }]}
        />
        {zustand === "fehler" ? (
          <View style={styles.block}>
            <Text ref={fehler} style={[styles.text, { color: farben.fehler }]}>
              {fehlerText}
            </Text>
            {onNeuLaden ? (
              <Button titel="Nochmals versuchen" onPress={onNeuLaden} />
            ) : null}
          </View>
        ) : null}
        {zustand === "bereit" ? (
          <View style={styles.block}>{children}</View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  bildschirm: { flex: 1 },
  inhalt: { padding: masse.abstand },
  titel: { fontSize: schrift.titel, fontWeight: "700" },
  text: { fontSize: schrift.text },
  // Abstand an der Meldung statt im Container, damit leere Live-Regionen keinen Platz brauchen
  meldung: { marginTop: masse.abstand },
  offline: { padding: masse.abstand, borderRadius: masse.radius },
  block: { marginTop: masse.abstand, gap: masse.abstand },
});
