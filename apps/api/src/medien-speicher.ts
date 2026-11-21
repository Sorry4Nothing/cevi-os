// Der Speicher für Medien (Bilder und PDFs) im S3; die Umsetzung mit dem SDK steht in medien-speicher-sdk.ts, damit die App ohne die Typen von Node prüft. Im Test eine Attrappe
export type Medienspeicher = {
  // Legt den Inhalt unter einem zufälligen Schlüssel ab und gibt ihn zurück; der Schlüssel enthält nie einen Dateinamen der Nutzer
  ablegen(inhalt: Uint8Array, typ: string): Promise<string>;
  // shortcut: der ganze Inhalt im Arbeitsspeicher (höchstens 20 MB); als Strom, sobald grössere Dateien oder viele gleichzeitige Abrufe dazukommen
  holen(schluessel: string): Promise<Uint8Array>;
  loeschen(schluessel: string): Promise<void>;
};
