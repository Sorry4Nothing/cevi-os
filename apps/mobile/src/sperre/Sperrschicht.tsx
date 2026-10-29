import { authenticateAsync, SecurityLevel } from "expo-local-authentication";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AppState,
  BackHandler,
  Keyboard,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { authClient } from "../api/client";
import { useIch } from "../api/ich";
import { Bildschirm } from "../ui/Bildschirm";
import { Button } from "../ui/Button";
import { Fehlermeldung } from "../ui/Fehlermeldung";
import { schrift, useFarben } from "../ui/tokens";
import { sperrzustand } from "./sperrzustand";
import { useSperre } from "./SperreProvider";

const FUENF_MINUTEN = 5 * 60 * 1000;
const FEHLER = "Entsperren hat nicht geklappt. Bitte nochmals versuchen.";
const OHNE_TEXT = ["user_cancel", "system_cancel", "app_cancel"];
const CODE_WEG = ["not_enrolled", "passcode_not_set"];
const EINRICHTEN =
  Platform.OS === "ios"
    ? "Einrichten unter «Einstellungen» > «Face ID & Code» oder «Touch ID & Code»."
    : "Einrichten in den Einstellungen unter «Sicherheit» oder «Sperrbildschirm»; der Weg hängt vom Hersteller ab.";

// Das Overlay liegt neben dem Inhalt, nicht davor: Der Inhalt bleibt eingehängt, Entwürfe überleben die Sperre (Checkliste 7.2)
export function Sperrschicht({ children }: { children: ReactNode }) {
  const farben = useFarben();
  const sitzung = authClient.useSession();
  const userId = sitzung.data?.user.id ?? null;
  const ich = useIch(userId !== null);
  const { niveau, aus, setzeAus, pruefeNiveau } = useSperre();
  // «zu» beim Einhängen: Der erste Frame ist der Kaltstart. «versucht»: Die Abfrage lief schon, danach gibt es nur den Knopf,
  // sonst fragt Android nach dem Geräte-Code-Bildschirm gleich nochmals
  const [phase, setPhase] = useState<"offen" | "zu" | "versucht">("zu");
  const [vorherAus, setVorherAus] = useState(aus);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string>();
  const hintergrundSeit = useRef<number | null>(null);
  const sitzungDa = useRef(false);

  const zustand = sperrzustand({
    ich: ich.data,
    niveau,
    gesperrt: phase !== "offen",
    aus,
  });
  const zu = zustand !== "frei";
  const sitzungWeg = !sitzung.isPending && !sitzung.error && userId === null;

  // Ohne Sitzung gibt es nichts zu sperren: Wer sich mit dem Passwort anmeldet, steht nicht gleich vor der Sperre
  if (sitzungWeg && phase !== "offen") setPhase("offen");
  // Wer die Sperre im Profil einschaltet, ist da: Sie greift erst beim nächsten Mal
  if (aus !== vorherAus) {
    setVorherAus(aus);
    if (!aus) setPhase("offen");
  }

  async function entsperren() {
    setFehler(undefined);
    setLaeuft(true);
    setPhase((alt) => (alt === "zu" ? "versucht" : alt));
    try {
      const antwort = await authenticateAsync({
        promptMessage: "Cevi OS entsperren",
        cancelLabel: "Abbrechen",
      });
      if (antwort.success) {
        setPhase("offen");
        return;
      }
      if (!OHNE_TEXT.includes(antwort.error)) setFehler(FEHLER);
      if (CODE_WEG.includes(antwort.error)) pruefeNiveau();
    } catch {
      setFehler(FEHLER);
    } finally {
      setLaeuft(false);
    }
  }

  useEffect(() => {
    sitzungDa.current = userId !== null;
  }, [userId]);

  // Nach 5 Minuten im Hintergrund; «inactive» allein (Face-ID-Abfrage, Kontrollzentrum) zählt nicht
  useEffect(() => {
    const abo = AppState.addEventListener("change", (status) => {
      if (status === "background") hintergrundSeit.current = Date.now();
      else if (status === "active") {
        if (
          hintergrundSeit.current !== null &&
          Date.now() - hintergrundSeit.current >= FUENF_MINUTEN &&
          sitzungDa.current
        ) {
          setPhase((alt) => (alt === "offen" ? "zu" : alt));
        }
        hintergrundSeit.current = null;
      }
    });
    return () => abo.remove();
  }, []);

  // Das Abmelden hat den Schlüssel gelöscht; der Zustand folgt
  useEffect(() => {
    if (sitzungWeg && aus) void setzeAus(false).catch(() => {});
  }, [sitzungWeg, aus, setzeAus]);

  // Einmal pro Sperre von selbst, sobald das Gerät einen Code meldet
  useEffect(() => {
    if (
      phase === "zu" &&
      zustand === "gesperrt" &&
      niveau !== undefined &&
      niveau >= SecurityLevel.SECRET
    ) {
      // Die Abfrage des Systems zu starten ist der Zweck dieses Effekts; sie merkt sich dabei, dass sie läuft
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void entsperren();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- entsperren liest nur Setzer
  }, [phase, zustand, niveau]);

  useEffect(() => {
    if (!zu) return;
    // Tasten dürfen kein verdecktes Feld erreichen
    Keyboard.dismiss();
    // Der zuletzt angemeldete Handler läuft zuerst: So holt «Zurück» keinen Bildschirm mit Entwurf vom Stapel
    const abo = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => abo.remove();
  }, [zu]);

  return (
    <View style={styles.wurzel}>
      {/* Ohne collapsable={false} flacht Fabric diese View ab, und jede Sperre hängte den ganzen App-Baum unter ein neues natives Elternteil um */}
      <View
        testID="sperre-inhalt"
        collapsable={false}
        importantForAccessibility={zu ? "no-hide-descendants" : "auto"}
        style={styles.inhalt}
      >
        {children}
      </View>
      {zu ? (
        <View
          testID="sperre-overlay"
          accessibilityViewIsModal
          style={StyleSheet.absoluteFill}
        >
          {zustand === "gesperrt" ? (
            <Bildschirm key="gesperrt" titel="Cevi OS ist gesperrt">
              <Fehlermeldung text={fehler} />
              <Button
                titel="Entsperren"
                onPress={() => void entsperren()}
                disabled={laeuft}
              />
            </Bildschirm>
          ) : (
            <Bildschirm key="code-fehlt" titel="Geräte-Code fehlt">
              <Text style={[styles.text, { color: farben.text }]}>
                Leitende, SL und Admins sehen die Daten erst, wenn das Gerät mit
                einem Geräte-Code gesichert ist.
              </Text>
              <Text style={[styles.text, { color: farben.text }]}>
                {EINRICHTEN}
              </Text>
              <Button titel="Nochmals prüfen" onPress={pruefeNiveau} />
            </Bildschirm>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wurzel: { flex: 1 },
  inhalt: { flex: 1 },
  text: { fontSize: schrift.text },
});
