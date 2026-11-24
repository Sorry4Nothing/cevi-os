// Wer ist die Person? Eine Quelle für die ganze Verwaltung: die Felder «abteilungsleitung» und «entwickler» aus GET /api/v1/ich (#737). Es gibt keine Rolle «Admin» mehr. Das hier steuert nur die Anzeige; jede Route prüft auf dem Server selbst

export const istAbteilungsleitung = (person) =>
  person?.abteilungsleitung === true;

export const istEntwickler = (person) => person?.entwickler === true;

// Sicht, kein Recht: Die Abteilungsleitung und der Entwickler sehen jeden Bereich der Abteilung (Bereiche, Plattform, Kacheln, Termine, Seiten-Editor)
export const siehtAlles = (person) =>
  istAbteilungsleitung(person) || istEntwickler(person);
