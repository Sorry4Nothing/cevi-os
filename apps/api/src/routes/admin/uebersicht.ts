import { sql, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { bearbeitbar } from "../../bearbeiten.js";
import type { SchalterZustand } from "../../bereichsschalter.js";
import type { Db } from "../../db/client.js";
import { seite } from "../../db/schema.js";
import type { Metriken } from "../../metriken.js";
import { zweiterFaktorFehlt, type Person } from "../../rechte.js";
import { entscheidetUeberRaum } from "../../termine/raum-buchung.js";
import {
  alleTermine,
  ladeSichtTags,
  TERMIN_BEGINN,
} from "../../termine/sicht.js";
import { hatErweitertesRecht, hatWebsiteZugang } from "../../website/seiten.js";

// Übersicht der Verwaltung (#583): EINE gebündelte Route statt einer Abfrage je Kachel. Jeder Teil der Antwort hängt an seinem eigenen Recht; was die Person nicht sehen darf, fehlt (der Schlüssel ist nicht da), und die Oberfläche blendet die Kachel aus. Verlassen darf sich nur diese Route, nie die Oberfläche.
//
// Teile und Rechte (docs/rechte.md):
//   aufgaben (ausser Raumanfragen und Website), kennzahlen, betrieb, zustand.kalender, zustand.datenbank   Abteilungsleitung (Pfad /admin, zweiter Faktor)
//   aufgaben.raumanfragen                                  Abteilungsleitung oder wer den Team-Tag eines Raums trägt (entscheidetUeberRaum)
//   aufgaben.website*, zustand.website, zustand.medien     Seiten, die die Person bearbeiten darf (bearbeitbar): Abteilungsleitung, Plattformrecht, Stufenleitung an der eigenen Stufenseite, Sonderrecht
//   kinderJeStufe                                          Abteilungsleitung: alle Stufen; Stufenleitung: nur die eigenen
//   kommend                                                Termine wie «Alle Termine» (termine/sicht.ts), Lager wie «Meine Lager» (ohne Mitgliedschaft nur die Abteilungsleitung)
// Die Tür: Abteilungsleitung oder Zugang zur Verwaltung der Website (Stufenleitung, Plattformrolle, Team-Verantwortliche, Sonderrecht); alle anderen 403. Wie unter /api/v1/redaktion braucht eine Person mit erweitertem Recht den zweiten Faktor.
// Nur Zahlen, Daten und feste Texte: nie Namen von Personen, nie Adressen, nie Fehlertexte. Ein Teil, der scheitert, steht in «fehlt» und bricht die anderen nicht.
// Datenbanklast: höchstens neun Abfragen je Aufruf, unabhängig von der Datenmenge, danach 45 Sekunden Zwischenspeicher im Arbeitsspeicher je Person.
// shortcut: Der Zwischenspeicher gilt nur für diese Instanz und hält höchstens MAX_EINTRAEGE Personen; bei mehr als einer Instanz zeigt jede ihren eigenen Stand, höchstens GUELTIG_MS alt.

const GUELTIG_MS = 45_000;
// «Aktualisieren» umgeht den Zwischenspeicher, aber nie öfter als alle MIN_ABSTAND_MS je Person
const MIN_ABSTAND_MS = 10_000;
const MAX_EINTRAEGE = 200;
const WOCHEN = 8;
const W = sql.raw(String(WOCHEN));
const TAGE = sql.raw(String(WOCHEN * 7));

// Kommend oder laufend: Das Ende (bei Ganztägigen das Ende des letzten Tages, Schweizer Zeit) liegt noch vor uns
const KOMMEND = sql`coalesce(programm.ende, (programm.tag_bis + 1)::timestamp at time zone 'Europe/Zurich') > now()`;
// Ein Zeitpunkt als ISO-Text in UTC; die Oberfläche formatiert in Schweizer Zeit
const iso = (spalte: string) =>
  sql.raw(
    `to_char(${spalte} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`,
  );

type Rechte = {
  admin: boolean;
  // «alle»: jede Stufe; eine Liste: die Stufen der Stufenleitung (leer: keine Zahl)
  stufen: "alle" | string[];
};
type Eintrag = { signatur: string; am: number; koerper: object };

export function erstelleUebersichtRouten({
  db,
  metriken,
  schalter,
  jetzt = () => Date.now(),
}: {
  db: Db;
  metriken: Metriken;
  schalter: SchalterZustand;
  jetzt?: () => number;
}) {
  const speicher = new Map<string, Eintrag>();

  async function bauen(person: Person, rechte: Rechte) {
    const a = person.abteilungId;
    const fehlt: string[] = [];
    // Jeder Teil für sich: Scheitert einer, steht sein Name in «fehlt»
    const teil = async <T>(name: string, f: () => Promise<T>) => {
      try {
        return await f();
      } catch {
        fehlt.push(name);
        return undefined;
      }
    };
    const start = performance.now();
    const stufenWhere: SQL =
      rechte.stufen === "alle"
        ? sql``
        : sql`and t.id in (${sql.join(
            rechte.stufen.map((s) => sql`${s}::uuid`),
            sql`, `,
          )})`;

    const [zaehler, reihen, stufen, raum, websiteZ, medien, kommendT, lagerT] =
      await Promise.all([
        rechte.admin
          ? teil("aufgaben", async () => {
              const [z] = await db.execute<{
                vorschlaege: number;
                ohne_kategorie: number;
                bestellungen_offen: number;
                bestellungen_bereit: number;
                ohne_faktor: number;
                fristen: number;
                personen: number;
                kinder: number;
                anmeldungen: number;
                programme: number;
                eingerichtet: boolean;
                ok_am: string | null;
                fehler: string | null;
              }>(sql`select
                (select count(*) from termin_vorschlag where abteilung_id = ${a} and status = 'offen')::int as vorschlaege,
                (select count(*) from programm
                  where programm.abteilung_id = ${a} and programm.status <> 'abgesagt' and programm.sichtbarkeit <> 'intern' and ${KOMMEND}
                    and not exists (select 1 from programm_tag where programm_tag.programm_id = programm.id))::int as ohne_kategorie,
                (select count(*) from laden_bestellung where abteilung_id = ${a} and status = 'offen')::int as bestellungen_offen,
                (select count(*) from laden_bestellung where abteilung_id = ${a} and status = 'bereit')::int as bestellungen_bereit,
                (select count(*) from "user" u
                  where u.abteilung_id = ${a} and u.banned is not true and u.deaktiviert_am is null
                    and coalesce(u.two_factor_enabled, false) = false
                    and (u.role = 'admin'
                      or exists (select 1 from person_plattform_rolle r where r.user_id = u.id)
                      or exists (select 1 from plattform_entwickler e where e.user_id = u.id)))::int as ohne_faktor,
                (select count(*) from anlass
                  where abteilung_id = ${a} and art = 'anlass' and anmeldung_offen and frist > now() and frist <= now() + interval '7 days')::int as fristen,
                (select count(*) from "user" where abteilung_id = ${a} and banned is not true and deaktiviert_am is null)::int as personen,
                (select count(*) from kind where abteilung_id = ${a} and inaktiv_seit is null)::int as kinder,
                (select count(*) from anlass_anmeldung am join anlass an on an.id = am.anlass_id
                  join programm on programm.id = an.programm_id
                  where an.abteilung_id = ${a} and am.status = 'angemeldet' and ${KOMMEND})::int as anmeldungen,
                (select count(*) from programm where programm.abteilung_id = ${a} and programm.status <> 'abgesagt' and programm.sichtbarkeit <> 'intern' and ${KOMMEND})::int as programme,
                coalesce((select google_kalender_id is not null from abteilung where id = ${a}), false) as eingerichtet,
                (select ${iso("sync_ok_am")} from abteilung where id = ${a}) as ok_am,
                (select sync_fehler from abteilung where id = ${a}) as fehler`);
              return z;
            })
          : undefined,
        // Verläufe: acht Fenster zu je sieben Tagen, das letzte endet jetzt; die Personen sind der Stand am Ende jedes Fensters (heutige Konten nach Anlegedatum)
        rechte.admin
          ? teil("kennzahlen", async () => {
              const [z] = await db.execute<{
                personen: number[];
                anmeldungen: number[];
                bestellungen: number[];
              }>(sql`with w as (
                  select i, now() - make_interval(days => (${W} - i) * 7) as bis from generate_series(1, ${W}) i
                )
                select
                  array(select (select count(*) from "user" u where u.abteilung_id = ${a} and u.banned is not true and u.deaktiviert_am is null and u.created_at <= w.bis)::int from w order by i) as personen,
                  array(select (select count(*) from anlass_anmeldung am join anlass an on an.id = am.anlass_id
                    where an.abteilung_id = ${a} and am.status = 'angemeldet' and am.erstellt_am > w.bis - interval '7 days' and am.erstellt_am <= w.bis)::int from w order by i) as anmeldungen,
                  array(select (select count(*) from laden_bestellung b
                    where b.abteilung_id = ${a} and b.status <> 'storniert' and b.erstellt_am > w.bis - interval '7 days' and b.erstellt_am <= w.bis)::int from w order by i) as bestellungen`);
              return z;
            })
          : undefined,
        rechte.stufen !== "alle" && rechte.stufen.length === 0
          ? undefined
          : teil("kinderJeStufe", async () =>
              db.execute<{ name: string; kinder: number }>(sql`
                select t.name, count(k.id)::int as kinder
                from tag t left join kind k on k.stufe_id = t.id and k.inaktiv_seit is null
                where t.abteilung_id = ${a} and t.typ = 'stufe' ${stufenWhere}
                group by t.id, t.name order by kinder desc, t.name`),
            ),
        teil("raumanfragen", async () => {
          const [z] = await db.execute<{ n: number; entscheidet: boolean }>(
            sql`select
              (select count(*) from raum_buchung b join raum on raum.id = b.raum_id
                where raum.abteilung_id = ${a} and b.status = 'angefragt' and b.ende > now() and b.user_id <> ${person.id} and ${entscheidetUeberRaum(person)})::int as n,
              exists (select 1 from raum where raum.abteilung_id = ${a} and ${entscheidetUeberRaum(person)}) as entscheidet`,
          );
          return z;
        }),
        teil("website", async () => {
          const [z] = await db
            .select({
              seiten: sql<number>`count(*)::int`,
              veroeffentlicht: sql<number>`(count(*) filter (where ${seite.veroeffentlichteVersionId} is not null))::int`,
              entwuerfe: sql<number>`(count(*) filter (where ${seite.veroeffentlichteVersionId} is null))::int`,
              aenderungen: sql<number>`(count(*) filter (where ${seite.veroeffentlichteVersionId} is not null and ${seite.entwurf} is not null and ${seite.entwurf} is distinct from (select v.inhalt from seite_version v where v.id = ${seite.veroeffentlichteVersionId})))::int`,
              zuletzt: sql<
                string | null
              >`to_char(max(${seite.ausgabeAm}) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`,
            })
            .from(seite)
            .where(
              bearbeitbar(person, "seite", {
                id: seite.id,
                abteilungId: seite.abteilungId,
                stufeId: seite.tagId,
                tagId: seite.tagId,
              }),
            );
          return z;
        }),
        teil("medien", async () => {
          const [z] = await db.execute<{
            anzahl: number;
            bytes: number;
            bilder: number;
            pdf: number;
          }>(sql`select count(*)::int as anzahl, coalesce(sum(groesse), 0)::float8 as bytes,
              (count(*) filter (where mime_typ like 'image/%'))::int as bilder,
              (count(*) filter (where mime_typ = 'application/pdf'))::int as pdf
            from medium where abteilung_id = ${a}`);
          return z;
        }),
        // Termine wie «Alle Termine»: die Sicht der Person (Tags, «intern» nie)
        teil("kommend", async () => {
          const sicht = alleTermine(person, await ladeSichtTags(db, person));
          const gueltig = sql`${sicht} and programm.status <> 'abgesagt' and ${KOMMEND} and ${TERMIN_BEGINN} < now() + make_interval(days => ${TAGE})`;
          const [liste, wochen] = await Promise.all([
            db.execute<{
              titel: string;
              ganztaegig: boolean;
              beginn: string | null;
              ende: string | null;
              tag_von: string | null;
              tag_bis: string | null;
            }>(sql`select titel, ganztaegig, ${iso("beginn")} as beginn, ${iso("ende")} as ende,
                to_char(tag_von, 'YYYY-MM-DD') as tag_von, to_char(tag_bis, 'YYYY-MM-DD') as tag_bis
              from programm where ${gueltig} order by ${TERMIN_BEGINN}, id limit 8`),
            db.execute<{ woche: number; n: number }>(sql`select
                greatest(0, floor(extract(epoch from (${TERMIN_BEGINN} - now())) / 604800))::int as woche, count(*)::int as n
              from programm where ${gueltig} group by 1`),
          ]);
          const proWoche = Array.from({ length: WOCHEN }, () => 0);
          for (const w of wochen) if (w.woche < WOCHEN) proWoche[w.woche] = w.n;
          return { liste: [...liste], proWoche };
        }),
        // Lager wie «Meine Lager»: ohne Mitgliedschaft nur die Abteilungsleitung
        teil("lager", async () =>
          db.execute<{
            titel: string;
            von: string;
            bis: string;
            status: string;
          }>(sql`
            select l.titel, to_char(l.von, 'YYYY-MM-DD') as von, to_char(l.bis, 'YYYY-MM-DD') as bis, l.status
            from lager l
            where l.abteilung_id = ${a} and l.status in ('entwurf', 'aktiv') and l.bis >= current_date
              and l.von < current_date + ${TAGE}::int
              ${person.admin ? sql`` : sql`and exists (select 1 from lager_mitglied m where m.lager_id = l.id and m.person_id = ${person.id})`}
            order by l.von, l.id limit 5`),
        ),
      ]);
    const abfrageMs = Math.round(performance.now() - start);

    const body: Record<string, unknown> = {
      erzeugtAm: new Date(jetzt()).toISOString(),
    };

    const aufgaben: Record<string, number | boolean> = {};
    if (zaehler) {
      aufgaben.terminVorschlaege = zaehler.vorschlaege;
      aufgaben.termineOhneKategorie = zaehler.ohne_kategorie;
      aufgaben.bestellungenOffen = zaehler.bestellungen_offen;
      aufgaben.bestellungenBereit = zaehler.bestellungen_bereit;
      aufgaben.kontenOhneZweitenFaktor = zaehler.ohne_faktor;
      aufgaben.anmeldefristen = zaehler.fristen;
      aufgaben.kalenderFehler = zaehler.fehler !== null;
    }
    if (raum && (rechte.admin || raum.entscheidet)) {
      aufgaben.raumanfragen = raum.n;
    }
    if (websiteZ) {
      aufgaben.websiteEntwuerfe = websiteZ.entwuerfe;
      aufgaben.websiteAenderungen = websiteZ.aenderungen;
    }
    if (Object.keys(aufgaben).length > 0) body.aufgaben = aufgaben;

    if (zaehler && reihen) {
      body.kennzahlen = {
        fenster: WOCHEN,
        personen: { jetzt: zaehler.personen, verlauf: reihen.personen },
        kinder: { jetzt: zaehler.kinder },
        anmeldungen: {
          kommend: zaehler.anmeldungen,
          verlauf: reihen.anmeldungen,
        },
        bestellungen: { verlauf: reihen.bestellungen },
        programme: { kommend: zaehler.programme },
      };
    }
    if (stufen) {
      body.kinderJeStufe = [...stufen].map((s) => ({
        name: s.name,
        kinder: s.kinder,
      }));
    }
    if (kommendT || lagerT) {
      body.kommend = {
        wochen: WOCHEN,
        termine: (kommendT?.liste ?? []).map((t) => ({
          titel: t.titel,
          ganztaegig: t.ganztaegig,
          beginn: t.beginn,
          ende: t.ende,
          tagVon: t.tag_von,
          tagBis: t.tag_bis,
        })),
        termineProWoche: kommendT?.proWoche ?? null,
        lager: [...(lagerT ?? [])].map((l) => ({
          titel: l.titel,
          von: l.von,
          bis: l.bis,
          status: l.status,
        })),
      };
    }

    const zustand: Record<string, unknown> = {};
    if (websiteZ) {
      const meine = schalter.vonAbteilung(a);
      const trifft = (art: "wartung" | "sperre") =>
        meine.find(
          (e) =>
            e.art === art && (e.bereich === "website" || e.bereich === "alles"),
        );
      zustand.website = {
        seiten: websiteZ.seiten,
        veroeffentlicht: websiteZ.veroeffentlicht,
        zuletztErzeugtAm: websiteZ.zuletzt,
        wartung: trifft("wartung") !== undefined,
        wartungEndeAm: trifft("wartung")?.ende?.toISOString() ?? null,
        sperre: trifft("sperre") !== undefined,
        offline: schalter.websiteOffline(a),
      };
    }
    if (medien) zustand.medien = { ...medien };
    if (rechte.admin) {
      zustand.kalender = zaehler
        ? {
            eingerichtet: zaehler.eingerichtet,
            letzterErfolgAm: zaehler.ok_am,
            // Einer der festen Texte des Abgleichs (kalender/fehler.ts)
            fehler: zaehler.fehler,
            programme: zaehler.programme,
          }
        : undefined;
      zustand.datenbank = {
        erreichbar: Boolean(zaehler),
        antwortMs: zaehler ? abfrageMs : null,
      };
    }
    if (Object.keys(zustand).length > 0) body.zustand = zustand;

    if (rechte.admin) {
      const m = metriken.momentaufnahme();
      body.betrieb = {
        seit: m.seit,
        stunden: m.stunden.map((s) => ({
          ab: s.ab,
          anzahl: s.anzahl,
          fehler4xx: s.fehler4xx,
          fehler5xx: s.fehler5xx,
        })),
        quote5xx: m.quote5xx,
        p95Ms: m.p95Ms,
      };
    }
    body.fehlt = [...new Set(fehlt)];
    return body;
  }

  return new Hono<{ Variables: { person: Person } }>().get("/", async (c) => {
    const person = c.get("person");
    if (!person.admin && !(await hatWebsiteZugang(db, person))) {
      throw new HTTPException(403);
    }
    // Wie unter /api/v1/redaktion: Wer ein erweitertes Recht nutzt, braucht den zweiten Faktor (Stufenleitung an der eigenen Stufe nicht)
    if (!person.zweiterFaktor && (await hatErweitertesRecht(db, person))) {
      return c.json(
        zweiterFaktorFehlt(
          "Für dieses Recht braucht es zuerst einen zweiten Faktor.",
        ),
        403,
      );
    }
    const stufenDerSl = [
      ...new Set(
        person.rollen
          .filter((r) => r.typ === "stufenleitung")
          .map((r) => r.stufeId),
      ),
    ].sort();
    const rechte: Rechte = {
      admin: person.admin,
      stufen: person.admin ? "alle" : stufenDerSl,
    };
    // Die Signatur trägt, was die Person darf: Ändert sich ihr Recht, trifft ein alter Eintrag nicht mehr
    const signatur = JSON.stringify(rechte);
    const schluessel = `${person.abteilungId}:${person.id}`;
    const alt = speicher.get(schluessel);
    const alter = alt ? jetzt() - alt.am : Infinity;
    const frisch = c.req.query("frisch") === "1";
    c.header("Cache-Control", "private, no-store");
    if (
      alt &&
      alt.signatur === signatur &&
      alter < (frisch ? MIN_ABSTAND_MS : GUELTIG_MS)
    ) {
      return c.json(alt.koerper);
    }
    const koerper = await bauen(person, rechte);
    speicher.delete(schluessel);
    speicher.set(schluessel, { signatur, am: jetzt(), koerper });
    // Der älteste Eintrag zuerst: Map behält die Einfügereihenfolge
    while (speicher.size > MAX_EINTRAEGE) {
      speicher.delete(speicher.keys().next().value as string);
    }
    return c.json(koerper);
  });
}
