import { and, eq, inArray } from "drizzle-orm";
import { istAbteilungsleitungSql } from "../admins.js";
import { nachCommit, type Db } from "../db/client.js";
import { lager, lagerMitglied, session, user } from "../db/schema.js";
import type { LagerRolle } from "./rechte-katalog.js";
import { registriereSchreibHaken } from "./sync.js";

// Ereignisverteiler der offenen Ansichten (#367): Eine Verbindung (Server-Sent Events) erfährt, dass es im Lager Neues gibt, und holt es dann über den Änderungsfeed (#366), wo die Rechte der Rolle gelten. Eine Meldung trägt nur die Folgenummer und die Objekttypen, die die Rolle lesen darf; nie IDs, Namen oder Inhalte (Zeilenfilter kosten eine Abfrage je Verbindung, der Feed filtert danach).
//
// Geringe Datenbanklast: Die Verbindungen liegen im Speicher dieser Instanz, die Meldungen kommen aus dem Schreibpfad (Haken von lager/sync.ts, nach dem Commit), nicht aus Abfragen im Takt. Der Herzschlag fasst die Datenbank nicht an. Gebündelt prüft eine Kontrolle alle fünf Minuten mit zwei Abfragen für alle Verbindungen dieser Instanz, ob Sitzung, Konto und Rolle noch stimmen; ohne offene Verbindung läuft kein Zeitgeber. Mitglieder- und Rechteänderungen der Verwaltung beenden die betroffenen Verbindungen sofort (beendeLager, beendePerson).
// shortcut: eine API-Instanz. Schreibt eine zweite Instanz ins selbe Lager, erfahren die Verbindungen der ersten nichts davon. Bei mehreren Instanzen: der Haken sendet pg_notify im Schreibvorgang (kommt erst beim Commit an), und jede Instanz hört mit einer Verbindung auf LISTEN und ruft melde() auf; beendeLager und beendePerson gingen denselben Weg. Ein Rate-Limit je Konto bräuchte dann ebenfalls einen gemeinsamen Zähler

export type Grenzen = {
  // Mehr als so viele Verbindungen eines Kontos: Die älteste endet (ein Gerät, das nach einem Netzabbruch neu verbindet, wird so nicht ausgesperrt, solange die tote Verbindung noch offen ist)
  proKonto: number;
  // Mehr als so viele je Lager oder je Instanz: Die neue wird abgelehnt (429)
  proLager: number;
  proInstanz: number;
  herzschlagMs: number;
  kontrolleMs: number;
  // Schreibvorgänge innerhalb dieser Zeit ergeben eine Meldung
  entprellMs: number;
};

export const STANDARD_GRENZEN: Grenzen = {
  proKonto: 3,
  proLager: 100,
  proInstanz: 200,
  herzschlagMs: 25_000,
  kontrolleMs: 5 * 60_000,
  entprellMs: 50,
};

// Wohin eine Verbindung schreibt. senden gibt false zurück, wenn der Client nicht mehr abholt: Dann endet die Verbindung
export type Ausgabe = {
  senden(text: string): boolean;
  schliesse(): void;
};

export type VerbindungsInfo = {
  lagerId: string;
  personId: string;
  sitzungId: string;
  // Wirksame Rolle beim Verbinden (die Abteilungsleitung ist Lagerleitung)
  rolle: LagerRolle;
  // Objekttypen, deren Leserecht die Rolle hat
  lesbar: ReadonlySet<string>;
  // Folgenummer des Lagers, als die Verbindung ihr Lager gelesen hat
  seq: number;
};

export type Verbindung = VerbindungsInfo & {
  readonly ausgabe: Ausgabe;
  offen: boolean;
};

type Ausstehend = {
  seq: number;
  tabellen: Set<string>;
  zeitgeber: ReturnType<typeof setTimeout>;
};

// Eine SSE-Nachricht; die Daten sind JSON in einer Zeile
export function sseNachricht(ereignis: string, daten: unknown, id?: number) {
  return `${id === undefined ? "" : `id: ${id}\n`}event: ${ereignis}\ndata: ${JSON.stringify(daten)}\n\n`;
}

// Ein Zeitgeber, der den Prozess nicht am Beenden hindert; node:* ist hier nicht erlaubt, darum der Typ-Umweg
function ohneHalten<T>(zeitgeber: T): T {
  (zeitgeber as { unref?: () => void }).unref?.();
  return zeitgeber;
}

export class Ereignisverteiler {
  private readonly alle = new Set<Verbindung>();
  private readonly jeLager = new Map<string, Set<Verbindung>>();
  private readonly jeKonto = new Map<string, Set<Verbindung>>();
  private readonly ausstehend = new Map<string, Ausstehend>();
  // Höchste gemeldete Folgenummer je Lager seit dem Start: Schliesst die Lücke zwischen dem Lesen des Lagers und dem Anmelden einer Verbindung (eine Meldung in dieser Zeit ginge sonst verloren). Eine Zahl je Lager, das in dieser Instanz geschrieben wurde
  private readonly gesehen = new Map<string, number>();
  private herzschlag: ReturnType<typeof setInterval> | undefined;
  private kontrolle: ReturnType<typeof setInterval> | undefined;
  private db: Db | undefined;
  private kontrolleLaeuft = false;
  readonly grenzen: Grenzen;

  constructor(grenzen: Partial<Grenzen> = {}) {
    this.grenzen = { ...STANDARD_GRENZEN, ...grenzen };
  }

  get anzahl() {
    return this.alle.size;
  }
  anzahlKonto(personId: string) {
    return this.jeKonto.get(personId)?.size ?? 0;
  }
  anzahlLager(lagerId: string) {
    return this.jeLager.get(lagerId)?.size ?? 0;
  }

  // Meldet eine Verbindung an. «lager» und «instanz» heissen: abgelehnt (Obergrenze). Die Folgenummer, ab der die Verbindung gilt, steht in seq: der grössere Wert aus dem gelesenen Lager und den Meldungen seither
  verbinde(
    db: Db,
    info: VerbindungsInfo,
    ausgabe: Ausgabe,
  ): { verbindung: Verbindung; seq: number } | "lager" | "instanz" {
    if (this.alle.size >= this.grenzen.proInstanz) return "instanz";
    if (this.anzahlLager(info.lagerId) >= this.grenzen.proLager) return "lager";
    const konto = this.jeKonto.get(info.personId);
    // Die älteste Verbindung des Kontos weicht
    while (konto && konto.size >= this.grenzen.proKonto) {
      this.beende(konto.values().next().value!, "neu-verbinden");
    }
    const verbindung: Verbindung = { ...info, ausgabe, offen: true };
    this.alle.add(verbindung);
    this.eintrag(this.jeLager, info.lagerId).add(verbindung);
    this.eintrag(this.jeKonto, info.personId).add(verbindung);
    this.db = db;
    this.starteZeitgeber();
    return {
      verbindung,
      seq: Math.max(info.seq, this.gesehen.get(info.lagerId) ?? 0),
    };
  }

  private eintrag(karte: Map<string, Set<Verbindung>>, schluessel: string) {
    let menge = karte.get(schluessel);
    if (!menge) karte.set(schluessel, (menge = new Set()));
    return menge;
  }

  // Beendet eine Verbindung; mit Grund sagt der Server dem Client vorher, dass er neu verbinden soll
  beende(verbindung: Verbindung, grund?: "neu-verbinden") {
    if (!verbindung.offen) return;
    verbindung.offen = false;
    this.alle.delete(verbindung);
    for (const [karte, schluessel] of [
      [this.jeLager, verbindung.lagerId],
      [this.jeKonto, verbindung.personId],
    ] as const) {
      const menge = karte.get(schluessel);
      menge?.delete(verbindung);
      if (menge?.size === 0) karte.delete(schluessel);
    }
    if (grund) verbindung.ausgabe.senden(sseNachricht("ende", { grund }));
    verbindung.ausgabe.schliesse();
    if (this.alle.size === 0) this.stoppeZeitgeber();
  }

  // Nach dem Commit eines Schreibvorgangs (Haken unten). Ohne Verbindung im Lager passiert nichts
  melde(lagerId: string, seq: number, tabelle: string) {
    this.gesehen.set(lagerId, Math.max(seq, this.gesehen.get(lagerId) ?? 0));
    if (!this.anzahlLager(lagerId)) return;
    const offen = this.ausstehend.get(lagerId);
    if (offen) {
      offen.seq = Math.max(offen.seq, seq);
      offen.tabellen.add(tabelle);
      return;
    }
    this.ausstehend.set(lagerId, {
      seq,
      tabellen: new Set([tabelle]),
      zeitgeber: ohneHalten(
        setTimeout(() => this.verteile(lagerId), this.grenzen.entprellMs),
      ),
    });
  }

  private verteile(lagerId: string) {
    const meldung = this.ausstehend.get(lagerId);
    this.ausstehend.delete(lagerId);
    if (!meldung) return;
    for (const v of [...(this.jeLager.get(lagerId) ?? [])]) {
      // Nur Typen, die die Rolle lesen darf; ändert sich nichts Lesbares, kommt nichts
      const objekttypen = [...meldung.tabellen]
        .filter((t) => v.lesbar.has(t))
        .sort();
      if (objekttypen.length === 0) continue;
      this.sende(
        v,
        sseNachricht(
          "aenderung",
          { bis: meldung.seq, objekttypen },
          meldung.seq,
        ),
      );
    }
  }

  sende(verbindung: Verbindung, text: string) {
    if (!verbindung.offen) return;
    if (!verbindung.ausgabe.senden(text)) this.beende(verbindung);
  }

  // Rechte eines Lagers geändert: Alle Verbindungen des Lagers verbinden neu und bekommen dabei ihre neuen lesbaren Typen
  beendeLager(lagerId: string) {
    for (const v of [...(this.jeLager.get(lagerId) ?? [])]) {
      this.beende(v, "neu-verbinden");
    }
  }

  // Mitgliedschaft oder Rolle einer Person im Lager geändert
  beendePerson(lagerId: string, personId: string) {
    for (const v of [...(this.jeKonto.get(personId) ?? [])]) {
      if (v.lagerId === lagerId) this.beende(v, "neu-verbinden");
    }
  }

  private starteZeitgeber() {
    // Kein Zugriff auf die Datenbank: nur ein Kommentar, den Proxys und Clients als Lebenszeichen sehen
    this.herzschlag ??= ohneHalten(
      setInterval(() => {
        for (const v of [...this.alle]) this.sende(v, ": herzschlag\n\n");
      }, this.grenzen.herzschlagMs),
    );
    this.kontrolle ??= ohneHalten(
      setInterval(() => void this.kontrolliere(), this.grenzen.kontrolleMs),
    );
  }

  private stoppeZeitgeber() {
    clearInterval(this.herzschlag);
    clearInterval(this.kontrolle);
    this.herzschlag = this.kontrolle = undefined;
    for (const m of this.ausstehend.values()) clearTimeout(m.zeitgeber);
    this.ausstehend.clear();
  }

  // Prüft alle Verbindungen dieser Instanz mit zwei Abfragen: Sitzung noch gültig, Konto nicht gesperrt, Rolle im Lager unverändert, Lager noch da. Wer nicht mehr stimmt, verbindet neu und scheitert dann an der Anmeldung oder bekommt seine neue Rolle. Scheitert die Prüfung selbst, enden alle Verbindungen (SR-54: im Zweifel verweigern)
  async kontrolliere() {
    const db = this.db;
    if (!db || this.kontrolleLaeuft || this.alle.size === 0) return;
    this.kontrolleLaeuft = true;
    try {
      const liste = [...this.alle];
      const ungueltig = await ungueltigeVerbindungen(db, liste).catch(
        () => liste,
      );
      for (const v of ungueltig) this.beende(v, "neu-verbinden");
    } finally {
      this.kontrolleLaeuft = false;
    }
  }

  // Für Tests: alle Verbindungen schliessen
  schliesseAlle() {
    for (const v of [...this.alle]) this.beende(v);
  }
}

export async function ungueltigeVerbindungen(
  db: Db,
  verbindungen: Verbindung[],
) {
  const sitzungen = await db
    .select({
      id: session.id,
      personId: session.userId,
      laeuftAb: session.expiresAt,
      gesperrt: user.banned,
      abteilungsleitung: istAbteilungsleitungSql(user.id),
      abteilungId: user.abteilungId,
    })
    .from(session)
    .innerJoin(user, eq(user.id, session.userId))
    .where(
      inArray(session.id, [...new Set(verbindungen.map((v) => v.sitzungId))]),
    );
  const lagerListe = await db
    .select({
      id: lager.id,
      abteilungId: lager.abteilungId,
      personId: lagerMitglied.personId,
      rolle: lagerMitglied.rolle,
    })
    .from(lager)
    .leftJoin(
      lagerMitglied,
      and(
        eq(lagerMitglied.lagerId, lager.id),
        inArray(lagerMitglied.personId, [
          ...new Set(verbindungen.map((v) => v.personId)),
        ]),
      ),
    )
    .where(inArray(lager.id, [...new Set(verbindungen.map((v) => v.lagerId))]));
  const sitzungJeId = new Map(sitzungen.map((s) => [s.id, s]));
  const abteilungJeLager = new Map(
    lagerListe.map((l) => [l.id, l.abteilungId]),
  );
  const mitgliedRolle = new Map(
    lagerListe.flatMap((l) =>
      l.personId ? [[`${l.id}:${l.personId}`, l.rolle] as const] : [],
    ),
  );
  const jetzt = new Date();
  return verbindungen.filter((v) => {
    const s = sitzungJeId.get(v.sitzungId);
    if (!s || s.personId !== v.personId || s.gesperrt || s.laeuftAb <= jetzt) {
      return true;
    }
    // Wie ladeLagerZugriff: Das Lager der Abteilung der Person, die Abteilungsleitung ist Lagerleitung
    if (abteilungJeLager.get(v.lagerId) !== s.abteilungId) return true;
    const rolle = s.abteilungsleitung
      ? "lagerleitung"
      : mitgliedRolle.get(`${v.lagerId}:${v.personId}`);
    return rolle !== v.rolle;
  });
}

// Der Verteiler dieser Instanz; die Route und die Verwaltung (Mitglieder, Rechte) benutzen ihn
export const ereignisverteiler = new Ereignisverteiler();

// Nach dem Commit des Schreibvorgangs melden; eine zurückgerollte Transaktion meldet nichts. Ohne «vorher»: kein Zusatz an der Schreibabfrage
registriereSchreibHaken(
  async (tx, e) => {
    nachCommit(tx, () => ereignisverteiler.melde(e.lagerId, e.seq, e.tabelle));
  },
  { ohneVorher: true },
);
