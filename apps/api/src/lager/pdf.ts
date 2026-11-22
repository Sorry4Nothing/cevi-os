import PDFDocument from "pdfkit";

// PDF-Erzeugung für die Aushänge (#405). Eine kleine, fest gebaute Seitenvorlage: Titel, Abschnitte mit Überschrift und Tabelle, getaggte Struktur (Document, H1, H2, Table, TR, TH, TD) in Lesereihenfolge, Titel, Sprache de-CH. Die Schrift ist die Standard-Helvetica des PDF-Formats (WinAnsi, nicht eingebettet): Umlaute und die Zeichen von Westeuropa stimmen, andere Zeichen werden zu «?». Es gibt keine externen Abrufe, nichts wird gespeichert; die Bytes gehen an den Aufrufer.

export type Tabelle = { spalten: string[]; zeilen: string[][] };
export type Abschnitt = {
  titel: string;
  hinweis?: string;
  tabelle?: Tabelle;
};
export type Aushang = {
  titel: string;
  abschnitte: Abschnitt[];
  querformat?: boolean;
  // Türschild: ein Abschnitt je Seite, grosse Schrift, die Zeilen der Tabelle (eine Spalte) als Liste
  schilder?: boolean;
};

// Grenzen (SR-71): so viele Zeilen und Abschnitte nimmt ein Aushang höchstens, so viele Seiten und so viele Millisekunden darf die Erzeugung brauchen
export const MAX_ZEILEN = 2000;
export const MAX_ABSCHNITTE = 300;
export const MAX_SEITEN = 100;
const MAX_MS = 10_000;

export class AushangZuGross extends Error {}

// Was die Standard-Helvetica abbildet (Latin-1 und die Zeichen von Windows-1252): alles andere wird zu «?», damit nie ein leeres Feld oder ein falsches Zeichen entsteht
const NICHT_ABBILDBAR = /[^\x20-\x7e\xa0-\xff€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/gu;
export const sauber = (text: string, max = 200) =>
  text
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .replace(NICHT_ABBILDBAR, "?");

const SCHWARZ = "#000000";
const GRAU = "#404040";

export function erzeugePdf(aushang: Aushang): Promise<Buffer> {
  const zeilen = aushang.abschnitte.reduce(
    (n, a) => n + (a.tabelle?.zeilen.length ?? 0),
    0,
  );
  if (zeilen > MAX_ZEILEN || aushang.abschnitte.length > MAX_ABSCHNITTE) {
    return Promise.reject(new AushangZuGross());
  }
  const titel = sauber(aushang.titel);
  return new Promise<Buffer>((fertig, fehler) => {
    const frist = setTimeout(() => {
      fehler(new AushangZuGross());
    }, MAX_MS);
    const teile: Buffer[] = [];
    const doc = new PDFDocument({
      size: "A4",
      layout: aushang.querformat ? "landscape" : "portrait",
      margin: 48,
      font: "Helvetica",
      tagged: true,
      lang: "de-CH",
      displayTitle: true,
      pdfVersion: "1.7",
      info: {
        Title: titel,
        Author: "Cevi OS",
        Creator: "Cevi OS",
        Producer: "Cevi OS",
      },
    });
    doc.on("data", (t: Buffer) => teile.push(t));
    doc.on("end", () => {
      clearTimeout(frist);
      fertig(Buffer.concat(teile));
    });
    doc.on("error", (e: Error) => {
      clearTimeout(frist);
      fehler(e);
    });
    try {
      zeichne(doc, aushang, titel);
      doc.end();
    } catch (e) {
      clearTimeout(frist);
      fehler(e);
    }
  });
}

function zeichne(doc: PDFKit.PDFDocument, aushang: Aushang, titel: string) {
  let seiten = 1;
  doc.on("pageAdded", () => {
    if (++seiten > MAX_SEITEN) throw new AushangZuGross();
  });
  const wurzel = doc.struct("Document");
  doc.addStructure(wurzel);
  const links = doc.page.margins.left;
  const breite = doc.page.width - links - doc.page.margins.right;
  const unten = () => doc.page.height - doc.page.margins.bottom;
  const schreibe = (
    text: string,
    x: number,
    y: number,
    optionen: PDFKit.Mixins.TextOptions & { structType: string },
  ) => {
    doc.text(text, x, y, { structParent: wurzel, ...optionen });
  };
  const absatz = (
    text: string,
    schrift: string,
    groesse: number,
    structType: string,
    farbe = SCHWARZ,
  ) => {
    doc.font(schrift).fontSize(groesse).fillColor(farbe);
    const h = doc.heightOfString(text, { width: breite });
    if (doc.y + h > unten() && doc.y > doc.page.margins.top) doc.addPage();
    schreibe(text, links, doc.y, { width: breite, structType });
    doc.moveDown(0.4);
  };

  if (!aushang.schilder) {
    doc.y = doc.page.margins.top;
    absatz(titel, "Helvetica-Bold", 20, "H1");
  }
  aushang.abschnitte.forEach((a, nr) => {
    if (aushang.schilder) {
      if (nr > 0) doc.addPage();
      doc.y = doc.page.margins.top + 40;
      absatz(sauber(a.titel, 60), "Helvetica-Bold", 56, "H1");
      doc.moveDown(0.6);
      for (const [name] of a.tabelle?.zeilen ?? []) {
        absatz(sauber(name ?? "", 60), "Helvetica", 34, "P");
      }
      return;
    }
    doc.moveDown(0.6);
    absatz(sauber(a.titel, 100), "Helvetica-Bold", 14, "H2");
    if (a.hinweis) absatz(sauber(a.hinweis, 300), "Helvetica", 10, "P", GRAU);
    if (a.tabelle) tabelle(a.tabelle);
  });

  function tabelle({ spalten, zeilen }: Tabelle) {
    const struktur = doc.struct("Table");
    wurzel.add(struktur);
    const spaltenBreite = breite / spalten.length;
    const reihe = (zellen: string[], kopf: boolean) => {
      doc.font(kopf ? "Helvetica-Bold" : "Helvetica").fontSize(10);
      const texte = spalten.map((_, i) => sauber(zellen[i] ?? ""));
      const hoehe = Math.max(
        ...texte.map((t) =>
          doc.heightOfString(t, { width: spaltenBreite - 8 }),
        ),
      );
      if (doc.y + hoehe > unten() && doc.y > doc.page.margins.top) {
        doc.addPage();
      }
      const y = doc.y;
      const tr = doc.struct("TR");
      struktur.add(tr);
      texte.forEach((t, i) => {
        doc.font(kopf ? "Helvetica-Bold" : "Helvetica").fillColor(SCHWARZ);
        doc.text(t, links + i * spaltenBreite, y, {
          width: spaltenBreite - 8,
          structParent: tr,
          structType: kopf ? "TH" : "TD",
        });
      });
      tr.end();
      doc.y = y + hoehe + 4;
    };
    reihe(spalten, true);
    for (const z of zeilen) reihe(z, false);
    struktur.end();
    doc.moveDown(0.4);
  }

  wurzel.end();
}
