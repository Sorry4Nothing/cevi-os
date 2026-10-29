// Der Kopf jedes Einzelchats: wie viele Personen der Stufenleitung mitlesen (Mehr-Augen-Prinzip)
export const liestText = (anzahl: number) =>
  `Liest: ${anzahl} ${anzahl === 1 ? "Person" : "Personen"}`;

export const EINZELCHAT_HINWEIS =
  "Bitte nur das Nötigste schreiben, keine Diagnosen.";
