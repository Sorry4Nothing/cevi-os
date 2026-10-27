import { useRouter } from "expo-router";
import { useState } from "react";

import { useOnline } from "../../../src/api/client";
import { useIch } from "../../../src/api/ich";
import { useProgramme, type Programm } from "../../../src/api/programme";
import { zeitText } from "../../../src/programme/zeit";
import { Auswahl } from "../../../src/ui/Auswahl";
import { Bildschirm } from "../../../src/ui/Bildschirm";
import { Listenzeile } from "../../../src/ui/Listenzeile";

const ALLE = "Alle";

function zeilenText(programm: Programm) {
  const zeit = zeitText(programm);
  const namen = programm.stufen.map((stufe) => stufe.name);
  return namen.length > 0 ? `${zeit}, ${namen.join(", ")}` : zeit;
}

export default function Programme() {
  const router = useRouter();
  const ich = useIch();
  const programme = useProgramme();
  const online = useOnline();
  const [stufenwahl, setStufenwahl] = useState(ALLE);

  const alle = programme.data ?? [];
  const stufenNamen = [
    ...new Set(alle.flatMap((p) => p.stufen.map((stufe) => stufe.name))),
  ];
  // Nur für Leitende, SL und Admins, und erst wenn die Liste mehrere Stufen hält
  const mitFilter =
    (ich.data?.admin || (ich.data?.rollen.length ?? 0) > 0) &&
    stufenNamen.length >= 2;
  // Die API filtert nur das Zeitfenster; ein Programm mit mehreren Stufen erscheint unter jeder
  const zeilen =
    !mitFilter || stufenwahl === ALLE
      ? alle
      : alle.filter((p) => p.stufen.some((stufe) => stufe.name === stufenwahl));

  return (
    <Bildschirm
      titel="Programme"
      zustand={
        programme.data
          ? programme.data.length === 0
            ? "leer"
            : "bereit"
          : programme.isPending
            ? "laden"
            : "fehler"
      }
      offline={!online}
      leerText="Keine kommenden Programme."
      onNeuLaden={() => void programme.refetch()}
    >
      {mitFilter ? (
        <Auswahl
          label="Stufe"
          optionen={[ALLE, ...stufenNamen]}
          wert={stufenwahl}
          onWahl={setStufenwahl}
          kontext="Stufenfilter"
        />
      ) : null}
      {/* shortcut: renders every row, switch to a virtualized list when long lists lag */}
      {zeilen.map((programm) => (
        <Listenzeile
          key={programm.id}
          titel={programm.titel}
          badge={
            programm.status === "abgesagt"
              ? { text: "Abgesagt", art: "negativ" }
              : undefined
          }
          text={zeilenText(programm)}
          onPress={() => router.push(`/programme/${programm.id}`)}
        />
      ))}
    </Bildschirm>
  );
}
