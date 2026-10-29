import { useRouter } from "expo-router";
import { StyleSheet, Text } from "react-native";

import { useChats } from "../../../src/api/chats";
import { useOnline } from "../../../src/api/client";
import { useIch } from "../../../src/api/ich";
import { liestText } from "../../../src/chat/liest";
import { Bildschirm } from "../../../src/ui/Bildschirm";
import { Listenzeile } from "../../../src/ui/Listenzeile";
import { schrift, useFarben } from "../../../src/ui/tokens";

export default function Chats() {
  const router = useRouter();
  const farben = useFarben();
  const chats = useChats();
  const ich = useIch();
  const online = useOnline();

  // Die Liste kommt mit den Gruppenchats zuerst
  const gruppen = (chats.data ?? []).filter((c) => c.typ === "stufe");
  const einzel = (chats.data ?? []).filter((c) => c.typ === "direkt");

  return (
    <Bildschirm
      titel="Chat"
      zustand={
        chats.data
          ? chats.data.length === 0
            ? "leer"
            : "bereit"
          : chats.isPending
            ? "laden"
            : "fehler"
      }
      offline={!online}
      leerText="Hier erscheinen die Chats deiner Stufen."
      onNeuLaden={() => void chats.refetch()}
    >
      {einzel.length > 0 ? (
        <Text
          accessibilityRole="header"
          style={[styles.abschnitt, { color: farben.text }]}
        >
          Gruppenchats
        </Text>
      ) : null}
      {gruppen.map((chat) => (
        <Listenzeile
          key={chat.id}
          titel={`Gruppenchat ${chat.stufe.name}`}
          text="Stufenleitung und Eltern"
          onPress={() => router.push(`/chat/${chat.id}`)}
        />
      ))}
      {einzel.length > 0 ? (
        <Text
          accessibilityRole="header"
          style={[styles.abschnitt, { color: farben.text }]}
        >
          Einzelchats
        </Text>
      ) : null}
      {einzel.map((chat) => (
        <Listenzeile
          key={chat.id}
          // Das Elternteil schreibt immer der ganzen Stufenleitung; die SL sehen den Namen der Familie
          titel={
            ich.data && chat.eltern?.id === ich.data.id
              ? `Stufenleitung ${chat.stufe.name}`
              : `${chat.eltern?.name ?? "Elternteil"}, ${chat.stufe.name}`
          }
          text={liestText(chat.stufenleitung.length)}
          onPress={() => router.push(`/chat/${chat.id}`)}
        />
      ))}
    </Bildschirm>
  );
}

const styles = StyleSheet.create({
  abschnitt: { fontSize: schrift.text, fontWeight: "700" },
});
