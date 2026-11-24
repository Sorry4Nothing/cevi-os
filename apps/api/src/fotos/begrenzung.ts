// Begrenzung je Konto (#690): Ein Konto darf die Fotos nicht in einem Zug leerziehen oder den Server mit Bildabrufen fluten. Ein festes Fenster im Speicher (nach einem Neustart leer); es zählt nur, was Flickr oder den Server kostet.
// Eine Seite mit vielen Bildern lädt auf einmal viele Dateien: Die Grenze für Bilder liegt darum hoch, die für Listen niedrig.
export type Begrenzung = (schluessel: string) => boolean;

export function erstelleBegrenzung({
  max,
  fensterMs,
  jetzt = Date.now,
}: {
  max: number;
  fensterMs: number;
  jetzt?: () => number;
}): Begrenzung {
  const fenster = new Map<string, { start: number; n: number }>();
  return (schluessel) => {
    const t = jetzt();
    const f = fenster.get(schluessel);
    if (!f || t - f.start >= fensterMs) {
      fenster.set(schluessel, { start: t, n: 1 });
      // Abgelaufene Fenster fliegen mit, damit die Tabelle nicht mit den Konten wächst
      if (fenster.size > 5000) {
        for (const [k, v] of fenster)
          if (t - v.start >= fensterMs) fenster.delete(k);
      }
      return true;
    }
    f.n += 1;
    return f.n <= max;
  };
}
