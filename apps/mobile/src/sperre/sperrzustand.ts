import { SecurityLevel } from "expo-local-authentication";

export type Sperrzustand = "frei" | "gesperrt" | "code-fehlt";

type Ich = { admin: boolean; rollen: readonly unknown[] };

// Wer Kinder anderer betreut oder verwaltet, kann die Sperre nicht abschalten (auch Leitende, die zugleich Elternteil sind)
export function istVorgegeben(ich: Ich) {
  return ich.admin || ich.rollen.length > 0;
}

// niveau, nicht stufe: Stufe heisst im Cevi etwas anderes. Verglichen wird nur mit SECRET, iOS kennt nur 0, 1 und 3
export function sperrzustand({
  ich,
  niveau,
  gesperrt,
  aus,
}: {
  ich: Ich | undefined;
  niveau: SecurityLevel | undefined;
  gesperrt: boolean;
  aus: boolean;
}): Sperrzustand {
  // Ohne «ich» zeigt das Tor keine Serverdaten
  if (!ich) return "frei";
  const vorgegeben = istVorgegeben(ich);
  // Bis zur ersten Antwort des Geräts bleibt es zu
  if (niveau === undefined) {
    return gesperrt && (vorgegeben || !aus) ? "gesperrt" : "frei";
  }
  if (niveau < SecurityLevel.SECRET) return vorgegeben ? "code-fehlt" : "frei";
  if (!vorgegeben && aus) return "frei";
  return gesperrt ? "gesperrt" : "frei";
}
