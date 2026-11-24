// Liest einen Event-Stream aus einer Antwort von app.request, Block für Block (#367)
export type SseBlock = {
  event?: string;
  id?: string;
  retry?: string;
  data?: unknown;
  // Rohtext des Blocks, für Prüfungen auf Inhalte
  roh: string;
  kommentar?: string;
};

export function parseBlock(roh: string): SseBlock {
  const block: SseBlock = { roh };
  for (const zeile of roh.split("\n")) {
    if (zeile.startsWith(":")) block.kommentar = zeile.slice(1).trim();
    else if (zeile.startsWith("event: ")) block.event = zeile.slice(7);
    else if (zeile.startsWith("id: ")) block.id = zeile.slice(4);
    else if (zeile.startsWith("retry: ")) block.retry = zeile.slice(7);
    else if (zeile.startsWith("data: "))
      block.data = JSON.parse(zeile.slice(6));
  }
  return block;
}

export function leseStrom(antwort: Response) {
  const leser = antwort.body!.getReader();
  const dekoder = new TextDecoder();
  let puffer = "";
  let offen: ReturnType<typeof leser.read> | undefined;
  let fertig = false;

  // Der nächste Block; undefined nach der Wartezeit ohne Block, "ende", wenn der Server die Verbindung geschlossen hat
  async function naechster(
    wartezeitMs = 2000,
  ): Promise<SseBlock | "ende" | undefined> {
    for (;;) {
      const i = puffer.indexOf("\n\n");
      if (i >= 0) {
        const roh = puffer.slice(0, i);
        puffer = puffer.slice(i + 2);
        return parseBlock(roh);
      }
      if (fertig) return "ende";
      offen ??= leser.read();
      let zeitgeber: ReturnType<typeof setTimeout> | undefined;
      const ergebnis = await Promise.race([
        offen,
        new Promise<"zeit">((weiter) => {
          zeitgeber = setTimeout(() => weiter("zeit"), wartezeitMs);
        }),
      ]);
      clearTimeout(zeitgeber);
      if (ergebnis === "zeit") return undefined;
      offen = undefined;
      if (ergebnis.done) fertig = true;
      else puffer += dekoder.decode(ergebnis.value, { stream: true });
    }
  }

  // Die nächsten Blöcke, bis einer nicht nur ein Herzschlag ist
  async function naechstesEreignis(wartezeitMs = 2000) {
    for (;;) {
      const block = await naechster(wartezeitMs);
      if (typeof block === "object" && block.kommentar !== undefined) continue;
      return block;
    }
  }

  return {
    naechster,
    naechstesEreignis,
    schliesse: () => leser.cancel().catch(() => {}),
  };
}
