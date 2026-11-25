import { FEHLER, OutlookFehler } from "../../src/outlook/fehler.js";
import type {
  Kategorie,
  NeuerTermin,
  OutlookKalender,
  TerminKategorien,
  TerminRef,
} from "../../src/outlook/graph.js";

// Attrappe von Outlook im Speicher: kein Netz, kein Microsoft. Hält Kategorienliste und Termine, zählt die Aufrufe und lässt sich ausfallen.
export class Attrappe implements OutlookKalender {
  kategorien: Kategorie[] = [];
  // iCalUId → Kategorien; ein Termin einer Serie hat den Schlüssel «uid|beginn-ms»
  termine = new Map<string, { id: string; kategorien: string[] }>();
  aufrufe: string[] = [];
  // Wirft bei jedem Aufruf, solange gesetzt
  ausfall: OutlookFehler | null = null;
  // Wirft nur beim Schreiben von Termin-Kategorien
  schreibAusfall: OutlookFehler | null = null;
  graphKategorien: TerminKategorien[] = [];
  private n = 0;

  private zaehle(name: string) {
    this.aufrufe.push(name);
    if (this.ausfall) throw this.ausfall;
  }

  async listeKategorien() {
    this.zaehle("liste");
    return this.kategorien.map((k) => ({ ...k }));
  }
  async legeKategorieAn(name: string, farbe: string) {
    this.zaehle("anlegen");
    if (
      this.kategorien.some((k) => k.name.toLowerCase() === name.toLowerCase())
    ) {
      return null;
    }
    const id = `kat-${++this.n}`;
    this.kategorien.push({ id, name, farbe });
    return { id };
  }
  async loescheKategorie(id: string) {
    this.zaehle("loeschen");
    this.kategorien = this.kategorien.filter((k) => k.id !== id);
  }
  async leseTerminKategorien() {
    this.zaehle("lesen");
    return this.graphKategorien;
  }
  async findeTermin(ref: TerminRef) {
    this.zaehle("finde");
    const schluessel = ref.serie
      ? `${ref.iCalUId}|${ref.beginn?.getTime() ?? ref.tagVon}`
      : ref.iCalUId;
    const t = this.termine.get(schluessel);
    return t ? { id: t.id, kategorien: [...t.kategorien] } : null;
  }
  async setzeTerminKategorien(id: string, kategorien: string[]) {
    this.zaehle("setze");
    if (this.schreibAusfall) throw this.schreibAusfall;
    for (const t of this.termine.values()) {
      if (t.id === id) t.kategorien = [...kategorien];
    }
  }
  async legeTerminAn(termin: NeuerTermin) {
    void termin;
    this.zaehle("neu");
    return { id: `neu-${++this.n}` };
  }
}

export const ausfall = (code: keyof typeof FEHLER) =>
  new OutlookFehler(FEHLER[code]);
