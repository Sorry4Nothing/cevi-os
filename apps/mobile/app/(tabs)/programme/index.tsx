import { useRouter } from "expo-router";
import { useState } from "react";
import { Text } from "react-native";

import { useOnline } from "../../../src/api/client";
import { useIch } from "../../../src/api/ich";
import { useProgramme } from "../../../src/api/programme";
import { Programmzeile } from "../../../src/programme/Programmzeile";
import {
  anzahlText,
  istNichtZugeordnet,
  istZuPruefen,
  siehtEingaenge,
} from "../../../src/programme/zuordnen";
import { Auswahl } from "../../../src/ui/Auswahl";
import { Bildschirm } from "../../../src/ui/Bildschirm";
import { Karte } from "../../../src/ui/Karte";
import { Listenzeile } from "../../../src/ui/Listenzeile";
import { schrift, useFarben } from "../../../src/ui/tokens";

const ALLE = "Alle";

export default function Programme() {
  const router = useRouter();
  const farben = useFarben();
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
      {/* Die Eingänge zählen über alle Programme, der Stufenfilter gilt für sie nicht */}
      {ich.data && siehtEingaenge(ich.data) ? (
        <Karte>
          <Text
            accessibilityRole="header"
            style={{
              fontSize: schrift.text,
              fontWeight: "700",
              color: farben.text,
            }}
          >
            Eingänge
          </Text>
          <Listenzeile
            titel="Nicht zugeordnet"
            text={anzahlText(alle.filter(istNichtZugeordnet).length)}
            onPress={() => router.push("/programme/nicht-zugeordnet")}
          />
          <Listenzeile
            titel="Prüfen"
            text={anzahlText(alle.filter(istZuPruefen).length)}
            onPress={() => router.push("/programme/pruefen")}
          />
        </Karte>
      ) : null}
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
        <Programmzeile key={programm.id} programm={programm} />
      ))}
    </Bildschirm>
  );
}
