import { QueryClientProvider } from "@tanstack/react-query";
import { Redirect, Slot, useSegments } from "expo-router";
import { enableAppSwitcherProtectionAsync } from "expo-screen-capture";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Platform, StyleSheet, Text } from "react-native";

import {
  authClient,
  queryClient,
  useAppVeraltet,
  useOnline,
} from "../src/api/client";
import { useIch } from "../src/api/ich";
import { usePushSchritt } from "../src/push";
import { SperreProvider } from "../src/sperre/SperreProvider";
import { Sperrschicht } from "../src/sperre/Sperrschicht";
import {
  alteEintraegeLoeschen,
  SPERRE_SCHLUESSEL,
  speicher,
} from "../src/speicher";
import { Bildschirm } from "../src/ui/Bildschirm";
import { schrift, useFarben } from "../src/ui/tokens";

// Ohne native Kopfzeile: Deren Titel wächst auf iOS nicht mit der Schriftgrösse (Checkliste 5.10)
export default function Layout() {
  return (
    <QueryClientProvider client={queryClient}>
      <Start>
        {(aus) => (
          <SperreProvider anfangsAus={aus}>
            <Sperrschicht>
              <Tor />
            </Sperrschicht>
          </SperreProvider>
        )}
      </Start>
    </QueryClientProvider>
  );
}

// Vor jeder Anfrage: alte Einträge nach einer Neuinstallation löschen, Sperre-Einstellung lesen, App-Umschalter verdecken. Scheitert das, bleibt die App zu
function Start({ children }: { children: (aus: boolean) => ReactNode }) {
  const [stand, setStand] = useState<boolean | "fehler">();
  const [versuch, setVersuch] = useState(0);

  useEffect(() => {
    let aktuell = true;
    (async () => {
      await alteEintraegeLoeschen();
      const wert = await speicher.getItemAsync(SPERRE_SCHLUESSEL);
      // Blur 1: Mit dem Standard 0.5 bliebe grosse Schrift im Umschalter lesbar; auf Android wirft das Modul
      if (Platform.OS === "ios") await enableAppSwitcherProtectionAsync(1);
      return wert === "aus";
    })().then(
      (aus) => aktuell && setStand(aus),
      () => aktuell && setStand("fehler"),
    );
    return () => {
      aktuell = false;
    };
  }, [versuch]);

  if (stand === undefined) {
    return <Bildschirm titel="Cevi OS" zustand="laden" />;
  }
  if (stand === "fehler") {
    return (
      <Bildschirm
        titel="Cevi OS"
        zustand="fehler"
        onNeuLaden={() => {
          setStand(undefined);
          setVersuch((anzahl) => anzahl + 1);
        }}
      />
    );
  }
  return children(stand);
}

// Das Tor entscheidet, was die App zeigt: erst nach Anmeldung, Pflichtwechsel und Datenschutz-Hinweis die Tabs
function Tor() {
  const farben = useFarben();
  const veraltet = useAppVeraltet();
  const online = useOnline();
  const sitzung = authClient.useSession();
  const userId = sitzung.data?.user.id ?? null;
  const ich = useIch(userId !== null);
  // Ohne typedRoutes kennt der Router nur das erste Segment; hier zählt der ganze Pfad
  const segmente: string[] = useSegments();
  // Der Schritt «Pushes» kommt zuletzt im Startablauf; er hängt an der Geräte-Erlaubnis, nicht am Profil
  const bereit =
    userId !== null &&
    ich.data !== undefined &&
    !ich.data.mussPasswortAendern &&
    ich.data.datenschutzGelesenAm !== null;
  const pushes = usePushSchritt(bereit);

  // Geteilte Handys: Wechselt oder endet die Sitzung, fliegen alle Serverdaten aus dem Speicher
  const vorherigeId = useRef(userId);
  useEffect(() => {
    if (vorherigeId.current !== null && vorherigeId.current !== userId) {
      queryClient.clear();
    }
    vorherigeId.current = userId;
  }, [userId]);

  if (veraltet) {
    return (
      <Bildschirm titel="Bitte App aktualisieren">
        <Text style={[styles.text, { color: farben.text }]}>
          Diese Version der App ist zu alt und kann keine Daten mehr laden.
          Bitte die App aktualisieren und neu starten.
        </Text>
      </Bildschirm>
    );
  }
  // Offline pausiert «ich» statt zu scheitern: Die Meldung erklärt das Warten
  if (
    sitzung.isPending ||
    (userId !== null && ich.isPending) ||
    pushes === "laden"
  ) {
    return <Bildschirm titel="Cevi OS" zustand="laden" offline={!online} />;
  }
  // Fehler ohne Daten (kalter Start ohne Netz, 5xx): nochmals versuchen, nicht abmelden
  if (sitzung.error && !sitzung.data) {
    return (
      <Bildschirm
        titel="Cevi OS"
        zustand="fehler"
        offline={!online}
        onNeuLaden={() => sitzung.refetch()}
      />
    );
  }
  if (userId !== null && ich.isError && !ich.data) {
    return (
      <Bildschirm
        titel="Cevi OS"
        zustand="fehler"
        offline={!online}
        onNeuLaden={() => void ich.refetch()}
      />
    );
  }

  let ziel:
    "/anmelden" | "/passwort-setzen" | "/datenschutz" | "/pushes" | null = null;
  if (userId === null) ziel = "/anmelden";
  else if (ich.data?.mussPasswortAendern) ziel = "/passwort-setzen";
  else if (ich.data && ich.data.datenschutzGelesenAm === null) {
    ziel = "/datenschutz";
  } else if (pushes === true) ziel = "/pushes";

  // «/» ist die Weiterleitung auf den ersten Tab (app/index.tsx): durchlassen
  const amZiel =
    ziel === null
      ? segmente[0] === "(tabs)" || segmente.length === 0
      : segmente[1] === ziel.slice(1);
  if (!amZiel) return <Redirect href={ziel ?? "/"} />;
  return <Slot />;
}

const styles = StyleSheet.create({
  text: { fontSize: schrift.text },
});
