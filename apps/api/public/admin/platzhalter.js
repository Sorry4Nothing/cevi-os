// Seite im Aufbau: Eine Unterseite aus navigation.js ohne eigenes Modul zeigt diese Karte. Wer die Ansicht baut, trägt in navigation.js den Pfad seines Moduls ein; dann entfällt der Platzhalter.
import { leerKarte } from "./zustaende.js";

export function zeige(bereich, ctx) {
  bereich.append(
    leerKarte(
      `«${ctx.seite.unter.name}» ist noch nicht umgesetzt. Die Ansicht folgt mit dem Neuaufbau der Verwaltung.`,
    ),
  );
}
