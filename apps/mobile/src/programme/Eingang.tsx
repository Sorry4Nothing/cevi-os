import { useRouter } from "expo-router";
import { Text } from "react-native";

import { useOnline } from "../api/client";
import { useIch } from "../api/ich";
import { useProgramme } from "../api/programme";
import { Bildschirm } from "../ui/Bildschirm";
import { schrift, useFarben } from "../ui/tokens";
import { Programmzeile } from "./Programmzeile";
import { istNichtZugeordnet, istZuPruefen, siehtEingaenge } from "./zuordnen";

export const EINGAENGE = {
  nichtZugeordnet: {
    titel: "Nicht zugeordnet",
    filter: istNichtZugeordnet,
    leerText: "Keine Programme ohne Stufe.",
    hinweis:
      "Neue Termine aus dem Kalender sind intern und keiner Stufe zugeordnet. Leitende und Eltern sehen sie erst nach der Zuordnung.",
  },
  pruefen: {
    titel: "Prüfen",
    filter: istZuPruefen,
    leerText: "Keine Programme zum Prüfen.",
    hinweis:
      "Diese Termine fehlen im Kalender, und es gibt keinen passenden neuen Termin. Bitte im Kalender nachsehen.",
  },
} as const;

export function Eingang({ art }: { art: keyof typeof EINGAENGE }) {
  const router = useRouter();
  const farben = useFarben();
  const ich = useIch();
  const programme = useProgramme();
  const online = useOnline();
  const eingang = EINGAENGE[art];

  // Wer keinen Eingang sehen darf, bekommt auch bei einem Direktlink keine Zeilen
  const zeilen =
    ich.data && siehtEingaenge(ich.data)
      ? (programme.data ?? []).filter(eingang.filter)
      : [];

  return (
    <Bildschirm
      titel={eingang.titel}
      zustand={
        programme.data && ich.data
          ? zeilen.length === 0
            ? "leer"
            : "bereit"
          : programme.isPending || ich.isPending
            ? "laden"
            : "fehler"
      }
      offline={!online}
      leerText={eingang.leerText}
      onNeuLaden={() => {
        void programme.refetch();
        void ich.refetch();
      }}
      onZurueck={() => router.back()}
    >
      <Text style={{ fontSize: schrift.text, color: farben.text }}>
        {eingang.hinweis}
      </Text>
      {/* shortcut: renders every row, switch to a virtualized list when long lists lag */}
      {zeilen.map((programm) => (
        <Programmzeile key={programm.id} programm={programm} />
      ))}
    </Bildschirm>
  );
}
