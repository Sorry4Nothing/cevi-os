import { SecurityLevel } from "expo-local-authentication";
import { useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text } from "react-native";

import { abmelden, authClient } from "../../../src/api/client";
import { fehlertext, KEIN_NETZ } from "../../../src/api/fehlertexte";
import { useIch } from "../../../src/api/ich";
import { istVorgegeben } from "../../../src/sperre/sperrzustand";
import { useSperre } from "../../../src/sperre/SperreProvider";
import { Bildschirm } from "../../../src/ui/Bildschirm";
import { Button } from "../../../src/ui/Button";
import { Fehlermeldung } from "../../../src/ui/Fehlermeldung";
import { Listenzeile } from "../../../src/ui/Listenzeile";
import { Passwortwechsel } from "../../../src/ui/Passwortwechsel";
import { Schalter } from "../../../src/ui/Schalter";
import { schrift, useFarben } from "../../../src/ui/tokens";

export default function Profil() {
  const farben = useFarben();
  const router = useRouter();
  const ich = useIch();
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string>();
  const { niveau, aus, setzeAus } = useSperre();
  const [sperreFehler, setSperreFehler] = useState<string>();

  async function sperreUmschalten() {
    setSperreFehler(undefined);
    try {
      await setzeAus(!aus);
    } catch {
      setSperreFehler(
        "Die Einstellung konnte nicht gespeichert werden. Bitte nochmals versuchen.",
      );
    }
  }

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

  return (
    <Bildschirm
      titel="Profil"
      zustand={ich.data ? "bereit" : ich.isPending ? "laden" : "fehler"}
      onNeuLaden={() => void ich.refetch()}
    >
      <Text style={[styles.text, { color: farben.text }]}>
        {ich.data?.name}
      </Text>
      <Text style={[styles.text, { color: farben.textLeise }]}>
        Benutzername: {ich.data?.benutzername}
      </Text>
      <Listenzeile
        titel="Hilfe"
        text="Vertrauenspersonen und Anlaufstellen"
        onPress={() => router.push("/profil/hilfe")}
      />
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
        App-Sperre
      </Text>
      {ich.data && istVorgegeben(ich.data) ? (
        <Text style={[styles.text, { color: farben.text }]}>
          Für Leitende, SL und Admins ist die App-Sperre immer an.
        </Text>
      ) : (
        <>
          <Schalter
            label="App-Sperre"
            checked={!aus}
            onChange={() => void sperreUmschalten()}
          />
          {niveau !== undefined && niveau < SecurityLevel.SECRET ? (
            <Text style={[styles.text, { color: farben.textLeise }]}>
              Die App-Sperre wirkt erst, wenn das Gerät mit einem Geräte-Code
              gesichert ist.
            </Text>
          ) : null}
          <Fehlermeldung text={sperreFehler} />
        </>
      )}
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
    </Bildschirm>
  );
}

const styles = StyleSheet.create({
  text: { fontSize: schrift.text },
  abschnitt: { fontSize: schrift.text, fontWeight: "700", marginTop: 8 },
});
