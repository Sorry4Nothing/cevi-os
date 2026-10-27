import { Auswahl } from "./Auswahl";

type Props = {
  wert: boolean | null;
  onWahl: (wert: boolean) => void;
  // Steht im Namen nach der Antwort, z. B. «Ja, <Kind>, <Programm>»
  kontext: string;
  // Nur, wenn die Folge nicht schon aus dem Namen hervorgeht
  hinweis?: string;
};

const OPTIONEN = [
  { wert: "ja", text: "Ja" },
  { wert: "nein", text: "Nein" },
] as const;

export function JaNeinAuswahl({ wert, onWahl, kontext, hinweis }: Props) {
  return (
    <Auswahl
      optionen={OPTIONEN}
      wert={wert === null ? null : wert ? "ja" : "nein"}
      onWahl={(wahl) => onWahl(wahl === "ja")}
      kontext={kontext}
      hinweis={hinweis}
    />
  );
}
