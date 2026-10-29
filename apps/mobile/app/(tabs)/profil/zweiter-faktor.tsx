import { useRouter } from "expo-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Linking,
  Share,
  StyleSheet,
  Text,
  type HostInstance,
} from "react-native";

import { authClient, queryClient } from "../../../src/api/client";
import { fehlertext, KEIN_NETZ } from "../../../src/api/fehlertexte";
import { useIch } from "../../../src/api/ich";
import { Bildschirm } from "../../../src/ui/Bildschirm";
import { Button } from "../../../src/ui/Button";
import { fokussieren } from "../../../src/ui/fokus";
import { Fehlermeldung } from "../../../src/ui/Fehlermeldung";
import { Karte } from "../../../src/ui/Karte";
import { Passwortfeld } from "../../../src/ui/Passwortfeld";
import { Textfeld } from "../../../src/ui/Textfeld";
import { schrift, useFarben } from "../../../src/ui/tokens";

const ERSATZ_HINWEIS =
  "Jeder Code gilt einmal. Bewahre sie sicher auf, zum Beispiel im Passwort-Manager. Du siehst sie nur jetzt.";

// Jeder Schritt nimmt beim Erscheinen den Fokus (Checkliste 6.1); der key am Aufruf hängt ihn pro Schritt neu ein
function Schritt({ titel, children }: { titel: string; children: ReactNode }) {
  const farben = useFarben();
  const ueberschrift = useRef<HostInstance>(null);
  useEffect(() => fokussieren(ueberschrift.current), []);
  return (
    <>
      <Text
        ref={ueberschrift}
        accessibilityRole="header"
        style={[styles.abschnitt, { color: farben.text }]}
      >
        {titel}
      </Text>
      {children}
    </>
  );
}

// Buchstabiert für Screenreader, gruppenweise; mit gross: Grossbuchstaben ausdrücklich, denn Ersatzcodes unterscheiden Gross und Klein, der Schlüssel nicht
const buchstabiert = (gruppen: string[], gross: boolean) =>
  gruppen
    .map((gruppe) =>
      gruppe
        .split("")
        .map((zeichen) =>
          gross && /[A-Z]/.test(zeichen) ? `gross ${zeichen}` : zeichen,
        )
        .join(" "),
    )
    .join(", ");

export default function ZweiterFaktor() {
  const farben = useFarben();
  const router = useRouter();
  const ich = useIch();
  const [passwort, setPasswort] = useState("");
  const [code, setCode] = useState("");
  // Link und Codes nur hier im Zustand: nie im Query-Cache, in Parametern, im Secure Store oder im Log
  const [daten, setDaten] = useState<{
    totpURI: string;
    backupCodes: string[];
  }>();
  const [aktiviert, setAktiviert] = useState(false);
  const [laeuft, setLaeuft] = useState(false);
  const [feldFehler, setFeldFehler] = useState<string>();
  const [fehler, setFehler] = useState<string>();

  // Gibt die Daten der Antwort zurück, bei einem Fehler null; der Fehler steht dann am Feld oder darüber
  async function ausfuehren<T>(
    aufruf: () => Promise<{
      data: T | null;
      error: { code?: string | undefined } | null;
    }>,
    feldCode: string,
    feldText: string,
  ) {
    setFeldFehler(undefined);
    setFehler(undefined);
    setLaeuft(true);
    try {
      const { data, error } = await aufruf();
      if (!error) return data;
      if (error.code === feldCode) setFeldFehler(feldText);
      else setFehler(fehlertext(error));
    } catch {
      setFehler(KEIN_NETZ);
    } finally {
      setLaeuft(false);
    }
    return null;
  }

  async function einrichten() {
    const antwort = await ausfuehren(
      () => authClient.twoFactor.enable({ password: passwort }),
      "INVALID_PASSWORD",
      "Das Passwort stimmt nicht.",
    );
    // method «otp» kennt der Server nicht; die Antwort mit Link ist die für «totp»
    if (antwort && "totpURI" in antwort) {
      setDaten(antwort);
      setPasswort("");
    }
  }

  async function bestaetigen() {
    const antwort = await ausfuehren(
      () => authClient.twoFactor.verifyTotp({ code }),
      "INVALID_CODE",
      fehlertext({ code: "INVALID_CODE" }),
    );
    if (antwort) {
      setAktiviert(true);
      void queryClient.invalidateQueries({ queryKey: ["ich"] });
    }
  }

  async function linkOeffnen() {
    setFehler(undefined);
    try {
      await Linking.openURL(daten!.totpURI);
    } catch {
      // Kein canOpenURL: iOS bräuchte dafür LSApplicationQueriesSchemes
      setFehler(
        "Keine passende App gefunden. Trage den Schlüssel von Hand ein.",
      );
    }
  }

  function fertig() {
    setDaten(undefined);
    setCode("");
    router.replace("/profil");
  }

  // Kein new URL: React Native kennt searchParams nicht überall
  const schluessel = /[?&]secret=([^&]+)/.exec(daten?.totpURI ?? "")?.[1] ?? "";
  const gruppen = schluessel.match(/.{1,4}/g) ?? [];

  return (
    <Bildschirm
      titel="Zweiten Faktor einrichten"
      onZurueck={() => router.replace("/profil")}
    >
      {!daten ? (
        <Schritt key="Passwort bestätigen" titel="Passwort bestätigen">
          <Passwortfeld
            label="Passwort"
            value={passwort}
            onChangeText={setPasswort}
            fehler={feldFehler}
            autoComplete="current-password"
            textContentType="password"
          />
          <Fehlermeldung text={fehler} />
          <Button
            titel="Weiter"
            onPress={() => void einrichten()}
            disabled={laeuft}
          />
        </Schritt>
      ) : !aktiviert ? (
        <Schritt key="App für Codes verbinden" titel="App für Codes verbinden">
          <Text style={[styles.text, { color: farben.text }]}>
            Öffne den Link in deinem Passwort-Manager oder in einer
            Authenticator-App. Oder trage den Schlüssel von Hand ein.
          </Text>
          <Button titel="Link öffnen" onPress={() => void linkOeffnen()} />
          <Text style={[styles.text, { color: farben.text }]}>Schlüssel</Text>
          <Text
            accessibilityLabel={`Schlüssel: ${buchstabiert(gruppen, false)}`}
            // Kein Bedienelement: Ein Hint käme zum Text doppelt
            accessibilityHint={undefined}
            selectable
            style={[styles.schluessel, { color: farben.text }]}
          >
            {gruppen.join(" ")}
          </Text>
          <Textfeld
            label="Code aus der App"
            value={code}
            onChangeText={setCode}
            fehler={feldFehler}
            autoComplete="2fa-app-otp"
            textContentType="oneTimeCode"
            keyboardType="number-pad"
          />
          <Fehlermeldung text={fehler} />
          <Button
            titel="Bestätigen"
            onPress={() => void bestaetigen()}
            disabled={laeuft}
          />
        </Schritt>
      ) : (
        <Schritt key="Ersatzcodes" titel="Ersatzcodes">
          <Text style={[styles.text, { color: farben.text }]}>
            Der zweite Faktor ist eingerichtet.
          </Text>
          <Text style={[styles.text, { color: farben.text }]}>
            {ERSATZ_HINWEIS}
          </Text>
          <Karte>
            {daten.backupCodes.map((ersatzcode) => (
              <Text
                key={ersatzcode}
                accessibilityLabel={buchstabiert(ersatzcode.split("-"), true)}
                accessibilityHint={undefined}
                selectable
                style={[styles.schluessel, { color: farben.text }]}
              >
                {ersatzcode}
              </Text>
            ))}
          </Karte>
          <Button
            titel="Teilen"
            onPress={() =>
              void Share.share({
                message: `Ersatzcodes für Cevi OS (${ich.data?.benutzername ?? ""}):\n${daten.backupCodes.join("\n")}\nJeder Code gilt einmal. Nicht weiterleiten.`,
              })
            }
          />
          <Button titel="Fertig" onPress={fertig} />
        </Schritt>
      )}
    </Bildschirm>
  );
}

const styles = StyleSheet.create({
  text: { fontSize: schrift.text },
  abschnitt: { fontSize: schrift.text, fontWeight: "700", marginTop: 8 },
  schluessel: { fontSize: schrift.text, fontWeight: "700" },
});
