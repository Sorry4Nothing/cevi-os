import { useLocalSearchParams, useRouter } from "expo-router";
import { useIsFocused } from "expo-router/react-navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  useChats,
  useNachrichten,
  useNachrichtSenden,
  type Nachricht,
} from "../../../src/api/chats";
import { ApiFehler, useOnline } from "../../../src/api/client";
import { fehlertext, KEIN_NETZ } from "../../../src/api/fehlertexte";
import { nachrichtZeitText } from "../../../src/programme/zeit";
import { Ansage } from "../../../src/ui/Ansage";
import { Bildschirm } from "../../../src/ui/Bildschirm";
import { Button } from "../../../src/ui/Button";
import { Fehlermeldung } from "../../../src/ui/Fehlermeldung";
import { Listenzeile } from "../../../src/ui/Listenzeile";
import { Textfeld } from "../../../src/ui/Textfeld";
import { masse, schrift, useFarben } from "../../../src/ui/tokens";

const MAX_ZEICHEN = 2000;
const OFFLINE_SENDEN =
  "Keine Internetverbindung. Senden geht erst wieder mit Internet. Deine Nachricht bleibt stehen.";

export default function Gruppenchat() {
  const farben = useFarben();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const online = useOnline();
  const offen = useIsFocused();
  const chats = useChats();
  const nachrichten = useNachrichten(id, offen);
  const senden = useNachrichtSenden(id);
  const [entwurf, setEntwurf] = useState("");
  const [sendeFehler, setSendeFehler] = useState<string>();
  const [ansage, setAnsage] = useState<{ text: string; nr: number }>();

  const chat = chats.data?.find((c) => c.id === id);
  const titel = chat ? `Gruppenchat ${chat.stufe.name}` : "Gruppenchat";
  // Die Seiten kommen neueste zuerst, jede Seite ebenso; gelesen wird von alt nach neu
  const alle = useMemo(
    () =>
      (nachrichten.data?.pages ?? []).flatMap((s) => s.nachrichten).reverse(),
    [nachrichten.data],
  );

  // Gesammelt ansagen, was seit dem letzten Abruf dazukam; das Laden älterer Seiten zählt nicht, und eigene Nachrichten auch nicht (Checkliste 1.8)
  const neuesteId = useRef<string>(undefined);
  useEffect(() => {
    if (!nachrichten.data) return;
    if (neuesteId.current === undefined) {
      neuesteId.current = alle.at(-1)?.id ?? "";
      return;
    }
    const neu = alle.filter((n) => n.id > neuesteId.current!);
    if (neu.length === 0) return;
    neuesteId.current = neu.at(-1)!.id;
    const fremde = neu.filter((n) => !n.eigene).length;
    if (offen && fremde > 0) {
      ansagen(`${fremde} neue Nachricht${fremde === 1 ? "" : "en"}`);
    }
  }, [alle, nachrichten.data, offen]);

  // Dieselbe Meldung zweimal hintereinander: Der Wechsel des unsichtbaren Zeichens lässt Android sie erneut ansagen
  function ansagen(text: string) {
    setAnsage((alt) => ({ text, nr: (alt?.nr ?? 0) + 1 }));
  }

  function absenden() {
    setSendeFehler(undefined);
    if (!online) {
      setSendeFehler(OFFLINE_SENDEN);
      return;
    }
    senden.mutate(entwurf, {
      onSuccess: () => {
        setEntwurf("");
        ansagen("Nachricht gesendet.");
      },
      onError: (fehler) =>
        setSendeFehler(
          fehler instanceof ApiFehler ? fehlertext(fehler) : KEIN_NETZ,
        ),
    });
  }

  const nichtMehrDa =
    nachrichten.error instanceof ApiFehler && nachrichten.error.status === 404;
  const bereit = !nichtMehrDa && !!nachrichten.data;

  return (
    <Bildschirm
      titel={titel}
      zustand={
        nichtMehrDa
          ? "leer"
          : nachrichten.data
            ? "bereit"
            : nachrichten.isPending
              ? "laden"
              : "fehler"
      }
      offline={!online}
      leerText="Dieser Chat ist nicht mehr sichtbar."
      onNeuLaden={() => void nachrichten.refetch()}
      onZurueck={() => router.back()}
      ansEnde
      fuss={
        bereit ? (
          // Unter dem scrollenden Verlauf: Der Fokus liegt so nie unter der Eingabezeile (Checkliste 6.4)
          <View
            style={[
              styles.eingabe,
              { backgroundColor: farben.hintergrund, borderColor: farben.rand },
            ]}
          >
            <Ansage
              text={ansage && ansage.text + (ansage.nr % 2 === 0 ? "​" : "")}
              stil={[styles.text, { color: farben.text }]}
            />
            <Fehlermeldung text={sendeFehler} />
            <Textfeld
              label="Nachricht"
              value={entwurf}
              onChangeText={setEntwurf}
              multiline
              maxLength={MAX_ZEICHEN}
              maxHoehe={masse.ziel * 3}
            />
            <Button
              titel="Senden"
              onPress={absenden}
              disabled={senden.isPending || entwurf.trim() === ""}
            />
          </View>
        ) : undefined
      }
    >
      {nachrichten.hasNextPage ? (
        <>
          <Fehlermeldung
            text={
              nachrichten.isFetchNextPageError
                ? "Frühere Nachrichten liessen sich nicht laden."
                : undefined
            }
          />
          <Button
            titel="Frühere Nachrichten laden"
            onPress={() => void nachrichten.fetchNextPage()}
            disabled={nachrichten.isFetchingNextPage}
          />
        </>
      ) : null}
      {alle.length === 0 ? (
        <Text style={[styles.text, { color: farben.text }]}>
          Noch keine Nachrichten.
        </Text>
      ) : null}
      {/* shortcut: renders every loaded message, switch to a virtualized list when long chats lag */}
      {alle.map((n) => (
        <NachrichtZeile
          key={n.id}
          nachricht={n}
          onProgramm={(programmId) => router.push(`/programme/${programmId}`)}
        />
      ))}
    </Bildschirm>
  );
}

// Nur Text: Der Inhalt steht als Text im Baum, nie als HTML oder Markdown
function NachrichtZeile({
  nachricht,
  onProgramm,
}: {
  nachricht: Nachricht;
  onProgramm: (programmId: string) => void;
}) {
  const farben = useFarben();
  return (
    <View style={[styles.nachricht, { borderColor: farben.rand }]}>
      {/* Als Überschrift, damit Screenreader von Nachricht zu Nachricht springen können; «Du» statt Farbe oder Seite für die eigenen */}
      <Text
        accessibilityRole="header"
        style={[styles.kopf, { color: farben.text }]}
      >
        {nachricht.eigene ? "Du" : nachricht.autor.name},{" "}
        {nachrichtZeitText(nachricht.erstelltAm)}
      </Text>
      <Text style={[styles.text, { color: farben.text }]}>
        {nachricht.text}
      </Text>
      {nachricht.programm ? (
        <Listenzeile
          titel={`Programm: ${nachricht.programm.titel}`}
          hinweis="Öffnet das Programm"
          onPress={() => onProgramm(nachricht.programm!.id)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  text: { fontSize: schrift.text },
  kopf: { fontSize: schrift.klein, fontWeight: "700" },
  nachricht: {
    gap: masse.luecke / 2,
    paddingBottom: masse.luecke,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  eingabe: {
    gap: masse.luecke,
    padding: masse.abstand,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
