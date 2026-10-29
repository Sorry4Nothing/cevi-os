import { useRouter } from "expo-router";

import { useOnline } from "../../../src/api/client";
import { useChats } from "../../../src/api/chats";
import { Bildschirm } from "../../../src/ui/Bildschirm";
import { Listenzeile } from "../../../src/ui/Listenzeile";

export default function Chats() {
  const router = useRouter();
  const chats = useChats();
  const online = useOnline();

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
      {(chats.data ?? []).map((chat) => (
        <Listenzeile
          key={chat.id}
          titel={`Gruppenchat ${chat.stufe.name}`}
          text="Stufenleitung und Eltern"
          onPress={() => router.push(`/chat/${chat.id}`)}
        />
      ))}
    </Bildschirm>
  );
}
