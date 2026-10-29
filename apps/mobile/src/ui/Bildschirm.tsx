import { NavigationContext } from "expo-router/react-navigation";
import { use, useEffect, useRef, type ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
  useColorScheme,
  type HostInstance,
  type ScrollViewInstance,
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
  // «Zurück» über der Überschrift: Die Wischgeste braucht einen Knopf (Checkliste 8.1)
  onZurueck?: () => void;
  // Bleibt unter dem scrollenden Inhalt stehen und rückt über die Tastatur, z. B. die Eingabezeile eines Chats (Checkliste 6.4)
  fuss?: ReactNode;
  // Der Inhalt beginnt am Ende und folgt neuen Einträgen, solange man am Ende liest
  ansEnde?: boolean;
  children?: ReactNode;
};

export function Bildschirm({
  titel,
  zustand = "bereit",
  offline = false,
  leerText = "Hier gibt es noch nichts.",
  fehlerText = "Das Laden hat nicht geklappt.",
  onNeuLaden,
  onZurueck,
  fuss,
  ansEnde = false,
  children,
}: Props) {
  const farben = useFarben();
  const dunkel = useColorScheme() === "dark";
  const ueberschrift = useRef<HostInstance>(null);
  const fehler = useRef<HostInstance>(null);
  const nochmals = useRef(false);
  // undefined ausserhalb eines Navigators, z. B. im Tor; useFocusEffect würde dort werfen
  const navigation = use(NavigationContext);
  const fokussiert = useRef(false);
  const scroll = useRef<ScrollViewInstance>(null);
  const amEnde = useRef(true);
  // Ohne Animation: Mit «Bewegung reduzieren» soll nichts gleiten (Checkliste 5.9)
  const zumEnde = () => {
    if (ansEnde && amEnde.current)
      scroll.current?.scrollToEnd({ animated: false });
  };

  // Fokus nach einer Navigation auf der Überschrift, nach einem Fehler auf der Meldung (Checkliste 6.1, 6.3)
  useEffect(() => {
    // Beim Einhängen ist der Bildschirm zu sehen: Das erste focus-Ereignis ist damit verbraucht
    fokussiert.current = true;
    fokussieren(ueberschrift.current);
  }, []);
  // Im Navigator auch nach «Zurück» und nach einem Tabwechsel, einmal pro Fokus
  useEffect(() => {
    if (!navigation) return;
    const beiFokus = navigation.addListener("focus", () => {
      if (fokussiert.current) return;
      fokussiert.current = true;
      fokussieren(ueberschrift.current);
    });
    const beiBlur = navigation.addListener("blur", () => {
      fokussiert.current = false;
    });
    return () => {
      beiFokus();
      beiBlur();
    };
  }, [navigation]);
  useEffect(() => {
    if (zustand === "laden") return;
    if (zustand === "fehler") fokussieren(fehler.current);
    // Der Knopf «Nochmals versuchen» verschwindet beim Laden, sein Fokus geht sonst verloren
    else if (nochmals.current) fokussieren(ueberschrift.current);
    nochmals.current = false;
  }, [zustand]);

  const Huelle = fuss ? KeyboardAvoidingView : View;
  const status =
    zustand === "laden"
      ? "Wird geladen …"
      : zustand === "leer"
        ? leerText
        : undefined;
  // Die zuletzt geladenen Daten sind nur im Zustand «bereit» zu sehen
  const offlineMeldung = !offline
    ? undefined
    : zustand === "bereit"
      ? "Keine Internetverbindung. Die App zeigt die zuletzt geladenen Daten. Ändern geht erst wieder mit Internet."
      : "Keine Internetverbindung. Ändern geht erst wieder mit Internet.";

  return (
    <SafeAreaView
      style={[styles.bildschirm, { backgroundColor: farben.hintergrund }]}
    >
      {/* Android färbt die Symbole der Statusleiste nicht selbst passend zum Hintergrund */}
      <StatusBar barStyle={dunkel ? "light-content" : "dark-content"} />
      {/* iOS schiebt den Fuss über die Tastatur; Android macht das selbst über adjustResize */}
      <Huelle
        style={styles.huelle}
        {...(fuss && Platform.OS === "ios"
          ? { behavior: "padding" as const }
          : {})}
      >
        <ScrollView
          ref={scroll}
          onContentSizeChange={zumEnde}
          onLayout={zumEnde}
          onScroll={
            ansEnde
              ? ({
                  nativeEvent: {
                    contentOffset,
                    contentSize,
                    layoutMeasurement,
                  },
                }) => {
                  amEnde.current =
                    contentOffset.y + layoutMeasurement.height >=
                    contentSize.height - 48;
                }
              : undefined
          }
          scrollEventThrottle={ansEnde ? 100 : undefined}
          // Frühere Einträge, die oben dazukommen, schieben den gelesenen Inhalt nicht weg
          maintainVisibleContentPosition={
            ansEnde ? { minIndexForVisible: 0 } : undefined
          }
          // Sonst schliesst der erste Tipp nur die Tastatur, und ein Knopf unter einem Textfeld braucht zwei
          keyboardShouldPersistTaps="handled"
          // iOS schiebt so das fokussierte Feld über die Tastatur; Android macht das selbst über adjustResize (Checkliste 6.4). Mit Fuss übernimmt ihn die Hülle
          automaticallyAdjustKeyboardInsets={!fuss}
          contentContainerStyle={styles.inhalt}
        >
          {/* Der Fokus bleibt beim Öffnen auf der Überschrift; der Rückfokus nach «Zurück» ist offen (#30) */}
          {onZurueck ? (
            <View style={styles.zurueck}>
              <Button titel="Zurück" onPress={onZurueck} />
            </View>
          ) : null}
          <Text
            ref={ueberschrift}
            accessibilityRole="header"
            style={[styles.titel, { color: farben.text }]}
          >
            {titel}
          </Text>
          <Ansage
            text={offlineMeldung}
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
              <Text
                ref={fehler}
                style={[styles.text, { color: farben.fehler }]}
              >
                {fehlerText}
              </Text>
              {onNeuLaden ? (
                <Button
                  titel="Nochmals versuchen"
                  onPress={() => {
                    nochmals.current = true;
                    onNeuLaden();
                  }}
                />
              ) : null}
            </View>
          ) : null}
          {zustand === "bereit" ? (
            <View style={styles.block}>{children}</View>
          ) : null}
        </ScrollView>
        {fuss}
      </Huelle>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  bildschirm: { flex: 1 },
  huelle: { flex: 1 },
  inhalt: { padding: masse.abstand },
  titel: { fontSize: schrift.titel, fontWeight: "700" },
  text: { fontSize: schrift.text },
  // Abstand an der Meldung statt im Container, damit leere Live-Regionen keinen Platz brauchen
  meldung: { marginTop: masse.abstand },
  offline: { padding: masse.abstand, borderRadius: masse.radius },
  block: { marginTop: masse.abstand, gap: masse.abstand },
  // Nicht gestreckt: nur so breit wie sein Titel
  zurueck: { alignSelf: "flex-start", marginBottom: masse.luecke },
});
