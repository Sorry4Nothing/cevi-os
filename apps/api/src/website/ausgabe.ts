import { randomBytes } from "node:crypto";
import {
  mkdir,
  readdir,
  rename,
  rm,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

// Wohin die erzeugten Dateien der Website gehen (#351). Das Hosting bleibt austauschbar: Heute schreibt die Umsetzung ins Dateisystem, später liesse sich ein Bucket einsetzen.
// Pfade sind immer relativ, mit «/» getrennt, und stammen aus geprüften Adressen (a-z, 0-9, «-»); jede Umsetzung lehnt alles andere ab.
export interface Ausgabe {
  // Legt die Datei an oder ersetzt sie; ein Leser sieht nie eine halbe Datei
  // Text oder Bytes (die Schrift der Website ist eine Binärdatei)
  schreibe(pfad: string, inhalt: string | Uint8Array): Promise<void>;
  // Eine fehlende Datei ist kein Fehler
  loesche(pfad: string): Promise<void>;
  // Alle Dateien (relative Pfade), die diese Umsetzung kennt
  liste(): Promise<string[]>;
}

// Ein Pfadstück: a-z, 0-9 und «-» (wie eine Adresse), dahinter höchstens Endungen mit «.»; nie ein Punkt am Anfang, nie «..»
const STUECK = /^[a-z0-9-]+(?:\.[a-z0-9]+)*$/;
const MAX_STUECKE = 8;
const MAX_PFAD = 400;

export function istAusgabePfad(pfad: string): boolean {
  if (pfad.length === 0 || pfad.length > MAX_PFAD) return false;
  const stuecke = pfad.split("/");
  return stuecke.length <= MAX_STUECKE && stuecke.every((s) => STUECK.test(s));
}

function pruefe(pfad: string) {
  if (!istAusgabePfad(pfad)) throw new Error("ausgabe: ungueltiger Pfad");
}

// Dateisystem unter «wurzel» (ein eigenes Verzeichnis nur für die Website; der Abgleich löscht dort Seitendateien, die nicht mehr gebraucht werden)
export function dateisystemAusgabe(wurzel: string): Ausgabe {
  const basis = resolve(wurzel);
  // Zweite Sperre neben der Pfadprüfung: Das Ziel liegt in jedem Fall unter der Wurzel
  const ziel = (pfad: string) => {
    pruefe(pfad);
    const voll = resolve(basis, ...pfad.split("/"));
    if (!voll.startsWith(basis + sep)) {
      throw new Error("ausgabe: Pfad ausserhalb der Wurzel");
    }
    return voll;
  };

  return {
    async schreibe(pfad, inhalt) {
      const datei = ziel(pfad);
      await mkdir(dirname(datei), { recursive: true });
      // Erst daneben schreiben, dann umbenennen (atomar im selben Verzeichnis). Der Name beginnt mit einem Punkt: Er passt nie auf einen Pfad
      const vorlaeufig = join(
        dirname(datei),
        `.tmp-${randomBytes(6).toString("hex")}`,
      );
      try {
        await writeFile(vorlaeufig, inhalt, { encoding: "utf8", flag: "wx" });
        await rename(vorlaeufig, datei);
      } catch (fehler) {
        await rm(vorlaeufig, { force: true }).catch(() => {});
        throw fehler;
      }
    },

    async loesche(pfad) {
      const datei = ziel(pfad);
      try {
        await unlink(datei);
      } catch (fehler) {
        if ((fehler as NodeJS.ErrnoException).code !== "ENOENT") throw fehler;
      }
      // Leere Ordner räumen, von innen nach aussen bis zur Wurzel; ein volles Verzeichnis lässt rmdir scheitern, das ist gewollt
      for (let ordner = dirname(datei); ordner !== basis;) {
        try {
          await rmdir(ordner);
        } catch {
          break;
        }
        ordner = dirname(ordner);
      }
    },

    async liste() {
      const gefunden: string[] = [];
      const lauf = async (ordner: string, vorne: string, tiefe: number) => {
        if (tiefe >= MAX_STUECKE) return;
        let eintraege;
        try {
          eintraege = await readdir(ordner, { withFileTypes: true });
        } catch (fehler) {
          // Noch nichts geschrieben
          if ((fehler as NodeJS.ErrnoException).code === "ENOENT") return;
          throw fehler;
        }
        for (const e of eintraege) {
          const pfad = vorne + e.name;
          // Verknüpfungen und fremde Namen zählen nicht (und werden nie gelöscht)
          if (e.isDirectory() && STUECK.test(e.name)) {
            await lauf(join(ordner, e.name), `${pfad}/`, tiefe + 1);
          } else if (e.isFile() && istAusgabePfad(pfad)) {
            gefunden.push(pfad);
          }
        }
      };
      await lauf(basis, "", 0);
      return gefunden.sort();
    },
  };
}
