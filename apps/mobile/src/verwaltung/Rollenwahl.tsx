import { StyleSheet, Text, View } from "react-native";

import type { PersonenAntwort } from "../api/personen";
import { OptionenAuswahl } from "../ui/Auswahl";
import { JaNeinAuswahl } from "../ui/JaNeinAuswahl";
import { masse, schrift, useFarben } from "../ui/tokens";

export type Stufenrolle = { stufeId: string; typ: "leitung" | "stufenleitung" };

type Props = {
  stufen: PersonenAntwort["stufen"];
  kinder: PersonenAntwort["kinder"];
  admin: boolean;
  rollen: Stufenrolle[];
  elternteilVon: string[];
  onAdmin: (admin: boolean) => void;
  onRollen: (rollen: Stufenrolle[]) => void;
  onElternteilVon: (elternteilVon: string[]) => void;
};

const STUFENROLLEN = [
  { wert: "keine", text: "Keine" },
  { wert: "leitung", text: "Leitung" },
  { wert: "stufenleitung", text: "Stufenleitung" },
] as const;

// Der Rollen-Editor für Anlegen und Detail: Admin, eine Rolle pro Stufe, Elternteil pro Kind
export function Rollenwahl({
  stufen,
  kinder,
  admin,
  rollen,
  elternteilVon,
  onAdmin,
  onRollen,
  onElternteilVon,
}: Props) {
  const farben = useFarben();

  return (
    <View style={styles.rollen}>
      <Text
        accessibilityRole="header"
        style={[styles.abschnitt, { color: farben.text }]}
      >
        Rollen
      </Text>
      <Text style={[styles.text, { color: farben.text }]}>Admin</Text>
      <JaNeinAuswahl wert={admin} onWahl={onAdmin} kontext="Admin" />
      {stufen.map((stufe) => (
        <View key={stufe.id} style={styles.gruppe}>
          <Text style={[styles.text, { color: farben.text }]}>
            {stufe.name}
          </Text>
          <OptionenAuswahl
            optionen={STUFENROLLEN}
            wert={rollen.find((r) => r.stufeId === stufe.id)?.typ ?? "keine"}
            onWahl={(wahl) =>
              onRollen([
                ...rollen.filter((r) => r.stufeId !== stufe.id),
                ...(wahl === "keine" ? [] : [{ stufeId: stufe.id, typ: wahl }]),
              ])
            }
            kontext={stufe.name}
          />
        </View>
      ))}
      {kinder.map((kind) => {
        const kontext = `Elternteil von ${kind.vorname} ${kind.nachname}${
          kind.inaktivSeit ? ", inaktiv" : ""
        }`;
        return (
          <View key={kind.id} style={styles.gruppe}>
            <Text style={[styles.text, { color: farben.text }]}>{kontext}</Text>
            <JaNeinAuswahl
              wert={elternteilVon.includes(kind.id)}
              onWahl={(wert) =>
                onElternteilVon(
                  wert
                    ? [...elternteilVon, kind.id]
                    : elternteilVon.filter((id) => id !== kind.id),
                )
              }
              kontext={kontext}
            />
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  rollen: { gap: masse.luecke },
  gruppe: { gap: masse.luecke },
  abschnitt: { fontSize: schrift.text, fontWeight: "700", marginTop: 8 },
  text: { fontSize: schrift.text },
});
