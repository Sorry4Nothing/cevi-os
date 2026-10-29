import { useLocalSearchParams, useRouter } from "expo-router";
import { useIsFocused } from "expo-router/react-navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";

import {
  useChats,
  useEinzelchatBeginnen,
  useNachrichtAusblenden,
  useNachrichten,
  useNachrichtMelden,
  useNachrichtSenden,
  type Nachricht,
} from "../../../src/api/chats";
import { ApiFehler, useOnline } from "../../../src/api/client";
import { fehlertext, KEIN_NETZ } from "../../../src/api/fehlertexte";
import { useIch } from "../../../src/api/ich";
import { EINZELCHAT_HINWEIS, liestText } from "../../../src/chat/liest";
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

const OFFLINE_MODERATION =
  "Keine Internetverbindung. Melden und Ausblenden gehen erst wieder mit Internet.";

const OFFLINE_BEGINNEN =
  "Keine Internetverbindung. Der Einzelchat lässt sich erst wieder mit Internet öffnen.";

export default function Chat() {
  const farben = useFarben();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const online = useOnline();
  const offen = useIsFocused();
  const chats = useChats();
  const ich = useIch();
  const nachrichten = useNachrichten(id, offen);
  const senden = useNachrichtSenden(id);
  const beginnen = useEinzelchatBeginnen();
  const melden = useNachrichtMelden();
  const ausblenden = useNachrichtAusblenden();
  const [aktionFehler, setAktionFehler] = useState<string>();
  const [beginnenFehler, setBeginnenFehler] = useState<string>();
  const [entwurf, setEntwurf] = useState("");
  const [sendeFehler, setSendeFehler] = useState<string>();
  const [ansage, setAnsage] = useState<{ text: string; nr: number }>();

  const chat = chats.data?.find((c) => c.id === id);
  const einzel = chat?.typ === "direkt";
  const leitung = chat?.stufenleitung ?? [];
  // Wer nicht zur Stufenleitung gehört, ist hier Elternteil; ohne das eigene Profil bleibt beides offen
  const ichId = ich.data?.id;
  const istSl = leitung.some((l) => l.id === ichId);
  const titel = !chat
    ? "Chat"
    : !einzel
      ? `Gruppenchat ${chat.stufe.name}`
      : istSl
        ? `Einzelchat mit ${chat.eltern?.name ?? "Elternteil"}`
        : `Einzelchat mit der Stufenleitung ${chat.stufe.name}`;
  // shortcut: nur Eltern, die in den geladenen Nachrichten schreiben; eine Liste aller Eltern der Stufe braucht eine eigene Route, sobald die SL stille Familien erreichen müssen
  const eltern = istSl
    ? [
        ...new Map(
          (nachrichten.data?.pages ?? [])
            .flatMap((s) => s.nachrichten)
            .filter(
              (n) => !n.eigene && !leitung.some((l) => l.id === n.autor.id),
            )
            .map((n) => [n.autor.id, n.autor.name] as const),
        ),
      ]
    : [];

  function einzelchatOeffnen(elternUserId?: string) {
    if (!chat) return;
    setBeginnenFehler(undefined);
    if (!online) {
      setBeginnenFehler(OFFLINE_BEGINNEN);
      return;
    }
    beginnen.mutate(
      { stufeId: chat.stufe.id, ...(elternUserId && { elternUserId }) },
      {
        onSuccess: (neueId) => router.push(`/chat/${neueId}`),
        onError: (fehler) =>
          setBeginnenFehler(
            fehler instanceof ApiFehler ? fehlertext(fehler) : KEIN_NETZ,
          ),
      },
    );
  }
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

  // Der Dialog verweist bei Grenzverletzungen auf die Hilfe; die App ist kein Ort für Falldokumentation
  function meldenGedrueckt(n: Nachricht) {
    setAktionFehler(undefined);
    if (!online) {
      setAktionFehler(OFFLINE_MODERATION);
      return;
    }
    Alert.alert(
      "Nachricht melden?",
      "Die Admins der Abteilung lesen die Nachricht und entscheiden, was geschieht. Sie bekommen eine Kopie des Textes. Die Kopie wird gelöscht, sobald die Meldung erledigt ist, spätestens nach 30 Tagen.\n\nBei Grenzverletzungen melde dich bitte zusätzlich bei einer Vertrauensperson der Abteilung. Die Anlaufstellen stehen unter «Hilfe» im Profil. Diese App ist kein Ort, um Vorfälle zu dokumentieren.",
      [
        { text: "Abbrechen", style: "cancel" },
        {
          text: "Melden",
          onPress: () =>
            melden.mutate(n.id, {
              onSuccess: () => ansagen("Nachricht gemeldet."),
              onError: aktionFehlgeschlagen,
            }),
        },
      ],
    );
  }

  function ausblendenGedrueckt(n: Nachricht) {
    setAktionFehler(undefined);
    if (!online) {
      setAktionFehler(OFFLINE_MODERATION);
      return;
    }
    Alert.alert(
      "Nachricht ausblenden?",
      `Die Nachricht von ${n.autor.name} verschwindet für alle ausser für ${n.autor.name}. Sie oder er sieht den Hinweis «von der Stufenleitung ausgeblendet» und kann das melden. Die Ausblendung steht im Protokoll der Admins.`,
      [
        { text: "Abbrechen", style: "cancel" },
        {
          text: "Ausblenden",
          style: "destructive",
          onPress: () =>
            ausblenden.mutate(n.id, {
              onSuccess: () => ansagen("Nachricht ausgeblendet."),
              onError: aktionFehlgeschlagen,
            }),
        },
      ],
    );
  }

  function aktionFehlgeschlagen(fehler: unknown) {
    setAktionFehler(
      fehler instanceof ApiFehler ? fehlertext(fehler) : KEIN_NETZ,
    );
    // 404: Die Nachricht ist inzwischen weg oder ausgeblendet
    if (fehler instanceof ApiFehler && fehler.status === 404) {
      void nachrichten.refetch();
    }
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
            <Fehlermeldung text={aktionFehler} />
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
      {einzel ? (
        // Wer mitliest, steht über dem Verlauf: Es gibt keinen Kanal zu einer einzelnen Person
        <View style={styles.abschnitt}>
          <Text style={[styles.kopf, { color: farben.text }]}>
            {liestText(leitung.length)}
          </Text>
          {leitung.length > 0 ? (
            <Text style={[styles.text, { color: farben.text }]}>
              {leitung.map((l) => l.name).join(", ")}
            </Text>
          ) : null}
          <Text style={[styles.text, { color: farben.textLeise }]}>
            {EINZELCHAT_HINWEIS}
          </Text>
        </View>
      ) : chat && ichId ? (
        <View style={styles.abschnitt}>
          <Text
            accessibilityRole="header"
            style={[styles.kopf, { color: farben.text }]}
          >
            Stufenleitung
          </Text>
          {leitung.length === 0 ? (
            <Text style={[styles.text, { color: farben.text }]}>
              Zurzeit niemand.
            </Text>
          ) : (
            leitung.map((l) => (
              <Text key={l.id} style={[styles.text, { color: farben.text }]}>
                {l.name}
              </Text>
            ))
          )}
          <Fehlermeldung text={beginnenFehler} />
          {istSl ? (
            eltern.length > 0 ? (
              <>
                <Text
                  accessibilityRole="header"
                  style={[styles.kopf, { color: farben.text }]}
                >
                  Einzelchat mit Eltern
                </Text>
                {eltern.map(([elternId, name]) => (
                  <Listenzeile
                    key={elternId}
                    titel={`Einzelchat mit ${name}`}
                    hinweis="Öffnet den Einzelchat, die ganze Stufenleitung liest mit"
                    onPress={() => einzelchatOeffnen(elternId)}
                  />
                ))}
              </>
            ) : null
          ) : (
            <Button
              titel="Einzelchat mit der Stufenleitung"
              hinweis="Alle Personen der Stufenleitung lesen mit"
              onPress={() => einzelchatOeffnen()}
              disabled={beginnen.isPending}
            />
          )}
        </View>
      ) : null}
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
          onMelden={() => meldenGedrueckt(n)}
          // Die SL blendet nur im Gruppenchat aus, nie im Einzelchat, und keine eigenen Nachrichten
          onAusblenden={
            istSl && !einzel && !n.eigene
              ? () => ausblendenGedrueckt(n)
              : undefined
          }
        />
      ))}
    </Bildschirm>
  );
}

// Nur Text: Der Inhalt steht als Text im Baum, nie als HTML oder Markdown
function NachrichtZeile({
  nachricht,
  onProgramm,
  onMelden,
  onAusblenden,
}: {
  nachricht: Nachricht;
  onProgramm: (programmId: string) => void;
  onMelden: () => void;
  onAusblenden?: () => void;
}) {
  const farben = useFarben();
  // Die eigene, nicht ausgeblendete Nachricht lässt sich nicht melden
  const meldbar = !nachricht.eigene || nachricht.ausgeblendet;
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
      {nachricht.ausgeblendet ? (
        // Nur die Autorin bekommt diese Zeile; der Text selbst kommt nicht mehr vom Server
        <Text style={[styles.text, { color: farben.textLeise }]}>
          Von der Stufenleitung ausgeblendet.
        </Text>
      ) : (
        <Text style={[styles.text, { color: farben.text }]}>
          {nachricht.text}
        </Text>
      )}
      {nachricht.programm ? (
        <Listenzeile
          titel={`Programm: ${nachricht.programm.titel}`}
          hinweis="Öffnet das Programm"
          onPress={() => onProgramm(nachricht.programm!.id)}
        />
      ) : null}
      {meldbar || onAusblenden ? (
        <View style={styles.aktionen}>
          {meldbar ? (
            <Button
              titel="Melden"
              hinweis={
                nachricht.ausgeblendet
                  ? "Meldet das Ausblenden dieser Nachricht an die Admins"
                  : `Meldet die Nachricht von ${nachricht.autor.name} an die Admins`
              }
              onPress={onMelden}
            />
          ) : null}
          {onAusblenden ? (
            <Button
              titel="Ausblenden"
              hinweis={`Blendet die Nachricht von ${nachricht.autor.name} für alle aus`}
              onPress={onAusblenden}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  text: { fontSize: schrift.text },
  abschnitt: { gap: masse.luecke },
  kopf: { fontSize: schrift.klein, fontWeight: "700" },
  nachricht: {
    gap: masse.luecke / 2,
    paddingBottom: masse.luecke,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  aktionen: { flexDirection: "row", flexWrap: "wrap", gap: masse.luecke },
  eingabe: {
    gap: masse.luecke,
    padding: masse.abstand,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
