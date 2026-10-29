import { useRouter } from "expo-router";

import type { Programm } from "../api/programme";
import { Listenzeile } from "../ui/Listenzeile";
import { zeitText } from "./zeit";

function zeilenText(programm: Programm) {
  const zeit = zeitText(programm);
  const namen = programm.stufen.map((stufe) => stufe.name);
  return namen.length > 0 ? `${zeit}, ${namen.join(", ")}` : zeit;
}

export function Programmzeile({ programm }: { programm: Programm }) {
  const router = useRouter();
  return (
    <Listenzeile
      titel={programm.titel}
      badge={
        programm.status === "abgesagt"
          ? { text: "Abgesagt", art: "negativ" }
          : undefined
      }
      text={zeilenText(programm)}
      onPress={() => router.push(`/programme/${programm.id}`)}
    />
  );
}
