import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import { Alert, StyleSheet, Text, type HostInstance } from "react-native";

import {
  abmelden,
  ApiFehler,
  authClient,
  useOnline,
} from "../../../src/api/client";
import { fehlertext, KEIN_NETZ } from "../../../src/api/fehlertexte";
import { useIch, usePushEinstellung } from "../../../src/api/ich";
import { useKontoLoeschen } from "../../../src/api/konto";
import { Bildschirm } from "../../../src/ui/Bildschirm";
import { Button } from "../../../src/ui/Button";
import { Fehlermeldung } from "../../../src/ui/Fehlermeldung";
import { fokussieren } from "../../../src/ui/fokus";
import { Passwortfeld } from "../../../src/ui/Passwortfeld";
import { Passwortwechsel } from "../../../src/ui/Passwortwechsel";
import { Schalter } from "../../../src/ui/Schalter";
import { schrift, useFarben } from "../../../src/ui/tokens";

// Zeigt den Wert sofort wie ein Systemschalter; schlägt das Speichern fehl, steht wieder der Wert des Servers da und die Meldung bleibt bis zum nächsten Tipp
function PushSchalter({
  schluessel,
  label,
  wert,
  offline,
}: {
  schluessel: "pushChat" | "pushProgramme";
  label: string;
  wert: boolean;
  offline: boolean;
}) {
  const speichern = usePushEinstellung(schluessel);
  const angezeigt = speichern.isPending ? speichern.variables : wert;
  return (
    <>
      <Schalter
        label={label}
        checked={angezeigt}
        disabled={offline}
        onChange={() => {
          if (!speichern.isPending) speichern.mutate(!angezeigt);
        }}
      />
      <Fehlermeldung
        text={
          speichern.isError
            ? "Die Einstellung liess sich nicht speichern."
            : undefined
        }
      />
    </>
  );
}

export default function Profil() {
  const farben = useFarben();
  const router = useRouter();
  const ich = useIch();
  const online = useOnline();
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string>();
  const loeschen = useKontoLoeschen();
  const [loeschPasswort, setLoeschPasswort] = useState("");
  // Zählt die Drücke ohne Passwort: Ein neuer Schlüssel zeigt die gleiche Meldung neu und nimmt den Fokus wieder
  const [leerDruecke, setLeerDruecke] = useState(0);
  const loeschKnopf = useRef<HostInstance>(null);

  async function abmeldenGedrueckt() {
    setLaeuft(true);
    try {
      // Offline gilt: Das Gerät ist abgemeldet, die Server-Sitzung endet mit ihrem Ablauf
      await abmelden();
    } finally {
      setLaeuft(false);
    }
  }

  async function ueberallAbmelden() {
    setFehler(undefined);
    setLaeuft(true);
    try {
      const { error } = await authClient.revokeSessions();
      if (error) {
        setFehler(fehlertext(error));
        return;
      }
      await abmelden();
    } catch {
      // Offline bleibt die Person angemeldet: Ohne Server endet keine fremde Sitzung
      setFehler(KEIN_NETZ);
    } finally {
      setLaeuft(false);
    }
  }

  function loeschenGedrueckt() {
    // Ein Fehler aufs Mal: Der Fehler des letzten Versuchs geht, bevor ein neuer erscheint
    loeschen.reset();
    if (!loeschPasswort) {
      setLeerDruecke((n) => n + 1);
      return;
    }
    setLeerDruecke(0);
    Alert.alert(
      "Konto löschen?",
      "Das Konto wird mit allen Rollen, Zuordnungen zu Kindern und eigenen Nachrichten gelöscht. Bei Eltern verschwinden auch die Einzelchats mit der Stufenleitung. Das lässt sich nicht rückgängig machen.",
      [
        {
          text: "Abbrechen",
          style: "cancel",
          onPress: () => fokussieren(loeschKnopf.current),
        },
        {
          text: "Löschen",
          style: "destructive",
          onPress: () => loeschen.mutate(loeschPasswort),
        },
      ],
    );
  }

  // Ein falsches Passwort steht am Feld, alles andere über dem Knopf; nur ein Fehler aufs Mal
  const loeschFehler = loeschen.error;
  const passwortFalsch =
    loeschFehler instanceof ApiFehler &&
    loeschFehler.code === "PASSWORT_FALSCH";
  const loeschMeldung =
    loeschFehler && !passwortFalsch
      ? loeschFehler instanceof ApiFehler
        ? fehlertext(loeschFehler)
        : KEIN_NETZ
      : undefined;

  return (
    <Bildschirm
      titel="Profil"
      zustand={ich.data ? "bereit" : ich.isPending ? "laden" : "fehler"}
      offline={!online}
      onNeuLaden={() => void ich.refetch()}
    >
      <Text style={[styles.text, { color: farben.text }]}>
        {ich.data?.name}
      </Text>
      <Text style={[styles.text, { color: farben.textLeise }]}>
        Benutzername: {ich.data?.benutzername}
      </Text>
      <Text
        accessibilityRole="header"
        style={[styles.abschnitt, { color: farben.text }]}
      >
        Passwort ändern
      </Text>
      <Passwortwechsel
        bisherigesLabel="Bisheriges Passwort"
        knopfTitel="Passwort ändern"
        senden={async (bisheriges, neues) =>
          // Der Server erzwingt revokeOtherSessions: Alle anderen Sitzungen enden
          (
            await authClient.changePassword({
              currentPassword: bisheriges,
              newPassword: neues,
            })
          ).error
        }
        erfolgText="Das Passwort ist geändert. Alle anderen Geräte sind abgemeldet."
      />
      {ich.data?.admin ? (
        <>
          <Text
            accessibilityRole="header"
            style={[styles.abschnitt, { color: farben.text }]}
          >
            Zweiter Faktor
          </Text>
          {ich.data.zweiterFaktor ? (
            <Text style={[styles.text, { color: farben.text }]}>
              Zweiter Faktor eingerichtet
            </Text>
          ) : (
            <Button
              titel="Zweiten Faktor einrichten"
              onPress={() => router.push("/profil/zweiter-faktor")}
            />
          )}
        </>
      ) : null}
      <Text
        accessibilityRole="header"
        style={[styles.abschnitt, { color: farben.text }]}
      >
        Pushes
      </Text>
      {ich.data ? (
        <>
          <PushSchalter
            schluessel="pushChat"
            label="Chat-Pushes"
            wert={ich.data.pushChat}
            offline={!online}
          />
          <PushSchalter
            schluessel="pushProgramme"
            label="Programm-Pushes"
            wert={ich.data.pushProgramme}
            offline={!online}
          />
        </>
      ) : null}
      <Text
        accessibilityRole="header"
        style={[styles.abschnitt, { color: farben.text }]}
      >
        Abmelden
      </Text>
      <Fehlermeldung text={fehler} />
      <Button
        titel="Abmelden"
        onPress={() => void abmeldenGedrueckt()}
        disabled={laeuft}
      />
      <Button
        titel="Überall abmelden"
        hinweis="Beendet die Sitzungen auf allen Geräten"
        onPress={() => void ueberallAbmelden()}
        disabled={laeuft}
      />
      <Text
        accessibilityRole="header"
        style={[styles.abschnitt, { color: farben.text }]}
      >
        Konto löschen
      </Text>
      <Passwortfeld
        label="Passwort"
        value={loeschPasswort}
        onChangeText={(text) => {
          setLoeschPasswort(text);
          setLeerDruecke(0);
        }}
        autoComplete="current-password"
        textContentType="password"
        fehlerSchluessel={leerDruecke}
        fehler={
          leerDruecke > 0
            ? "Bitte das Passwort eingeben."
            : passwortFalsch
              ? fehlertext(loeschFehler)
              : undefined
        }
      />
      <Fehlermeldung text={loeschMeldung} />
      <Button
        ref={loeschKnopf}
        titel="Konto löschen"
        onPress={loeschenGedrueckt}
        disabled={loeschen.isPending}
      />
    </Bildschirm>
  );
}

const styles = StyleSheet.create({
  text: { fontSize: schrift.text },
  abschnitt: { fontSize: schrift.text, fontWeight: "700", marginTop: 8 },
});
