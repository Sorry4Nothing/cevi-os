import { parseArgs } from "node:util";
import { isNotNull } from "drizzle-orm";
import { fotoEinstellung } from "../db/schema.js";
import { erstelleFlickr } from "../fotos/flickr.js";
import { erstelleFlickrOriginal } from "../fotos/flickr-original.js";
import { QuellFehler } from "../fotos/quelle.js";
import {
  ersetzeAusFlickr,
  vorschlaege,
  type Ersatz,
} from "../medien-flickr.js";
import { verbindeMedien } from "./medien-gemeinsam.js";

// Ersetzt Medienbilder durch das Original auf Flickr (#868). Die ID des Mediums bleibt, Seiten und Logo zeigen danach das neue Bild (Website: beim nächsten Abgleich, spätestens nach 10 Minuten). Im Container:
//   node --import tsx src/cli/medium-aus-flickr.ts --medium <medium-id> --foto <flickr-foto-id>
//   node --import tsx src/cli/medium-aus-flickr.ts --vorschlaege [--anwenden]
// Mit --abteilung <id>, wenn mehr als eine Abteilung ein Flickr-Konto hat. Nur Medien der Abteilung, nur Fotos ihres Kontos. Die Ausgabe nennt IDs, Zahlen und in der Vorschlagsliste den Anfang des Alt-Texts, damit man das Bild erkennt.
const VERWENDUNG = `Verwendung:
  node --import tsx src/cli/medium-aus-flickr.ts --medium <medium-id> --foto <flickr-foto-id>
  node --import tsx src/cli/medium-aus-flickr.ts --vorschlaege [--anwenden]
  (dazu --abteilung <id>, wenn mehrere Abteilungen ein Flickr-Konto haben)`;

function leseArgumente() {
  try {
    const { values } = parseArgs({
      options: {
        medium: { type: "string" },
        foto: { type: "string" },
        vorschlaege: { type: "boolean" },
        anwenden: { type: "boolean" },
        abteilung: { type: "string" },
      },
      strict: true,
      allowPositionals: false,
    });
    const einzeln = values.medium !== undefined && values.foto !== undefined;
    if (einzeln === Boolean(values.vorschlaege)) return null;
    if (values.anwenden && !values.vorschlaege) return null;
    return values;
  } catch {
    return null;
  }
}

const masse = (m: { breite: number; hoehe: number }) =>
  `${m.breite} × ${m.hoehe}`;
const zeile = (e: Ersatz) =>
  e.ersetzt
    ? `ersetzt, ${masse(e.vorher)} → ${masse(e.nachher)}, Abstand ${e.abstand}${e.waisen > 0 ? `, ${e.waisen} alte Dateien blieben im Speicher` : ""}`
    : `unverändert: Das Foto auf Flickr ist nicht grösser (Abstand ${e.abstand})`;

const args = leseArgumente();
if (!args) {
  console.error(VERWENDUNG);
  process.exitCode = 1;
} else {
  let verbindung: ReturnType<typeof verbindeMedien> | undefined;
  try {
    verbindung = verbindeMedien();
    const { db, speicher, konfiguration: k } = verbindung;
    if (!k.FLICKR_API_KEY) throw new Error("Ohne FLICKR_API_KEY kein Flickr");
    const optionen = {
      apiKey: k.FLICKR_API_KEY,
      apiSecret: k.FLICKR_API_SECRET,
      token: k.FLICKR_OAUTH_TOKEN,
      tokenSecret: k.FLICKR_OAUTH_TOKEN_SECRET,
      tokenKonto: k.FLICKR_KONTO,
      apiBasis: k.FLICKR_API_BASIS,
      bildBasis: k.FLICKR_BILD_BASIS,
    };
    // Die Abteilung und ihr Konto aus den Einstellungen der Fotos (#690)
    const konten = (
      await db
        .select({
          abteilungId: fotoEinstellung.abteilungId,
          konto: fotoEinstellung.flickrKonto,
        })
        .from(fotoEinstellung)
        .where(isNotNull(fotoEinstellung.flickrKonto))
    ).filter((z) => !args.abteilung || z.abteilungId === args.abteilung);
    if (konten.length !== 1) {
      throw new Error(
        "Ohne eindeutige Abteilung mit Flickr-Konto: --abteilung <id> angeben",
      );
    }
    const { abteilungId, konto } = konten[0]!;
    const flickr = erstelleFlickrOriginal(optionen);
    const ersetze = (mediumId: string, fotoId: string) =>
      ersetzeAusFlickr({
        db,
        speicher,
        flickr,
        abteilungId,
        konto: konto!,
        mediumId,
        fotoId,
      });

    if (args.medium && args.foto) {
      console.log(
        `${args.medium}: ${zeile(await ersetze(args.medium, args.foto))}`,
      );
    } else {
      const liste = await vorschlaege({
        db,
        speicher,
        quelle: erstelleFlickr(optionen),
        abteilungId,
        konto: konto!,
        melde: (n) => {
          if (n % 100 === 0) console.error(`${n} Fotos verglichen …`);
        },
      });
      const sortiert = liste.sort(
        (a, b) => (a.abstand ?? 999) - (b.abstand ?? 999),
      );
      console.log("Medium-ID | Alt-Text | Flickr-Foto-ID | Abstand | Urteil");
      for (const v of sortiert) {
        const alt = (v.altText ?? "(dekorativ)").replace(/\s+/g, " ");
        console.log(
          [
            v.mediumId,
            alt.length > 40 ? `${alt.slice(0, 39)}…` : alt,
            v.fotoId ?? "–",
            v.abstand ?? "–",
            v.urteil,
          ].join(" | "),
        );
      }
      const sicher = sortiert.filter((v) => v.urteil === "sicher");
      console.log(
        `Medien: ${liste.length}, sicher: ${sicher.length}, unsicher: ${liste.filter((v) => v.urteil === "unsicher").length}`,
      );
      if (args.anwenden) {
        let fehler = 0;
        for (const v of sicher) {
          try {
            console.log(
              `${v.mediumId}: ${zeile(await ersetze(v.mediumId, v.fotoId!))}`,
            );
          } catch (f) {
            fehler++;
            console.error(
              `${v.mediumId}: fehlgeschlagen${f instanceof QuellFehler ? ` (${f.art})` : ""}`,
            );
          }
        }
        if (fehler > 0) process.exitCode = 1;
      }
    }
  } catch (fehler) {
    // Nie die Meldung von Flickr oder S3: Sie könnte eine Adresse mit Schlüssel enthalten
    console.error(
      `Fehlgeschlagen: ${
        fehler instanceof QuellFehler
          ? `Flickr (${fehler.art}${fehler.code ? `, ${fehler.code}` : ""})`
          : fehler instanceof Error &&
              /^(Ohne|Fehlende|Kein Medienbild|Das Medium)/.test(fehler.message)
            ? fehler.message
            : "Fehler beim Lesen oder Schreiben"
      }`,
    );
    process.exitCode = 1;
  } finally {
    await verbindung?.sql.end({ timeout: 5 });
  }
}
