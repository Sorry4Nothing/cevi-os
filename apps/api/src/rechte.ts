import {
  type AnyColumn,
  and,
  asc,
  eq,
  exists,
  gte,
  inArray,
  isNull,
  ne,
  notExists,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { unionAll } from "drizzle-orm/pg-core";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import type { erstelleAuth } from "./auth.js";
import type { Db } from "./db/client.js";
import {
  abteilungsleitungPerson,
  chat,
  kind,
  kindKontoEinstellung,
  kindZugang,
  nachricht,
  plattformEntwickler,
  rolle,
  stufe,
  user,
} from "./db/schema.js";

// Eltern haben keine Stufenrolle: Ihre Rechte hängen am Kind, die Routen joinen kind_zugang (Eltern und eigenes Konto des Kindes) direkt in SQL
export type Person = {
  id: string;
  abteilungId: string;
  // Das Konto steht in abteilungsleitung_person (#720)
  abteilungsleitung: boolean;
  // Das Konto steht in plattform_entwickler: hat jedes Recht (#722) und, über siehtAlles, jede Sicht
  entwickler: boolean;
  // Gilt für diese Anfrage: Das Konto hat den zweiten Faktor UND diese Sitzung hat den Code geprüft (#721). Alle Prüfungen «braucht den zweiten Faktor» lesen dieses Feld. Eine App-Sitzung ohne Code ist hier falsch, auch bei einem Konto mit Faktor. Bei ladePerson (ohne Sitzung) gilt das Konto
  zweiterFaktor: boolean;
  // Das Konto hat den zweiten Faktor eingerichtet, unabhängig von der Sitzung: für die Anzeige (/api/v1/ich) und den Code der Antwort (ZWEITER_FAKTOR_SITZUNG statt ZWEITER_FAKTOR_FEHLT). Fehlt das Feld, gilt zweiterFaktor
  zweiterFaktorKonto?: boolean;
  // Woher die Sitzung kommt (#785): web, app_nachgewiesen oder app_ungeprueft. Nur zur Anzeige und fürs Protokoll; kein Recht hängt daran. Fehlt das Feld, gilt «web»
  clientArt?: "web" | "app_nachgewiesen" | "app_ungeprueft";
  rollen: { stufeId: string; typ: "leitung" | "stufenleitung" }[];
  // Gesetzt, wenn das Konto das eigene Konto eines Kindes ist (#644): die ID dieses Kindes. Solche Konten haben nie eine Rolle und nie die Abteilungsleitung
  kindId?: string;
};

// Sicht, kein Recht: Wer die Abteilungsleitung oder der Entwickler ist, sieht jedes Objekt der eigenen Abteilung (alle Programme, Seiten, Termine, jedes Lager als Lagerleitung, alle Kacheln der Übersicht). Der Katalog der Rechte kennt das nicht; wer nur ein Recht hat, sieht damit nichts Fremdes
export const siehtAlles = (
  person: Pick<Person, "abteilungsleitung" | "entwickler">,
) => person.abteilungsleitung || person.entwickler;

// Jede Route unter /api/v1 lädt ihr Objekt in SQL auf person.abteilungId gefiltert, sonst HTTPException(404); erst dann prüft sie das Recht, sonst HTTPException(403)
export function personAusSitzung(
  auth: ReturnType<typeof erstelleAuth>,
  db: Db,
) {
  return createMiddleware<{
    Variables: { person: Person; sitzungId: string; nutzerId: string };
  }>(async (c, next) => {
    // disableRefresh: Die Verlängerung gehört zu get-session; hier schriebe sie die Zeile und verlöre ihr Set-Cookie
    const sitzung = await auth.api.getSession({
      headers: c.req.raw.headers,
      query: { disableRefresh: true },
    });
    // Für das Anfrage-Log bei 401 und 403 (#224); vor den Prüfungen, damit auch ein gesperrtes Konto und der Pflichtwechsel die ID zeigen
    if (sitzung) c.set("nutzerId", sitzung.user.id);
    // banned prüft better-auth nur beim Anlegen einer Sitzung, nicht beim Lesen
    if (!sitzung || sitzung.user.banned) throw new HTTPException(401);
    // Bis zum Pflichtwechsel (#15) nur das eigene Profil; den Zustand kennt die App aus get-session
    if (
      sitzung.user.mussPasswortAendern &&
      !(c.req.method === "GET" && c.req.path === "/api/v1/ich")
    ) {
      throw new HTTPException(403);
    }
    // Kein Fremdschlüssel sichert zu, dass die Stufe zur Abteilung der Person gehört, darum die Bedingung im Join
    // Eine Abfrage für alles (Rollen, eigenes Kind, Abteilungsleitung): jede Anfrage zahlt sie, und die Tests der Datenbanklast zählen sie. Die Zeile mit kindId ist das eigene Konto eines Kindes (user_id ist eindeutig, höchstens eine)
    const zeilen = await unionAll(
      db
        .select({
          stufeId: sql<string | null>`${rolle.stufeId}`.as("stufe_id"),
          typ: sql<string | null>`${rolle.typ}`.as("typ"),
          kindId: sql<string | null>`null::uuid`.as("kind_id"),
          abteilungsleitung: sql<boolean>`false`.as("abteilungsleitung"),
          entwickler: sql<boolean>`false`.as("entwickler"),
        })
        .from(rolle)
        .innerJoin(
          stufe,
          and(
            eq(rolle.stufeId, stufe.id),
            eq(stufe.abteilungId, sitzung.user.abteilungId),
          ),
        )
        .where(eq(rolle.userId, sitzung.user.id)),
      db
        .select({
          stufeId: sql<string | null>`null::uuid`.as("stufe_id"),
          typ: sql<string | null>`null::text`.as("typ"),
          kindId: sql<string | null>`${kind.id}`.as("kind_id"),
          abteilungsleitung: sql<boolean>`false`.as("abteilungsleitung"),
          entwickler: sql<boolean>`false`.as("entwickler"),
        })
        .from(kind)
        .where(
          and(
            eq(kind.userId, sitzung.user.id),
            eq(kind.abteilungId, sitzung.user.abteilungId),
          ),
        ),
      // Die Abteilungsleitung steht in einer eigenen Tabelle (#720)
      db
        .select({
          stufeId: sql<string | null>`null::uuid`.as("stufe_id"),
          typ: sql<string | null>`null::text`.as("typ"),
          kindId: sql<string | null>`null::uuid`.as("kind_id"),
          abteilungsleitung: sql<boolean>`true`.as("abteilungsleitung"),
          entwickler: sql<boolean>`false`.as("entwickler"),
        })
        .from(abteilungsleitungPerson)
        .where(eq(abteilungsleitungPerson.userId, sitzung.user.id)),
      // Der Entwickler steht ebenfalls in einer eigenen Tabelle (nur per CLI vergeben); derselbe Zweig der Union, keine zusätzliche Abfrage
      db
        .select({
          stufeId: sql<string | null>`null::uuid`.as("stufe_id"),
          typ: sql<string | null>`null::text`.as("typ"),
          kindId: sql<string | null>`null::uuid`.as("kind_id"),
          abteilungsleitung: sql<boolean>`false`.as("abteilungsleitung"),
          entwickler: sql<boolean>`true`.as("entwickler"),
        })
        .from(plattformEntwickler)
        .where(eq(plattformEntwickler.userId, sitzung.user.id)),
    );
    const rollen = zeilen.flatMap((z) =>
      z.stufeId && z.typ
        ? [{ stufeId: z.stufeId, typ: z.typ as "leitung" | "stufenleitung" }]
        : [],
    );
    const eigenesKind = zeilen.find((z) => z.kindId)?.kindId;
    c.set("person", {
      id: sitzung.user.id,
      abteilungId: sitzung.user.abteilungId,
      abteilungsleitung: zeilen.some((z) => z.abteilungsleitung),
      entwickler: zeilen.some((z) => z.entwickler),
      zweiterFaktor:
        sitzung.user.twoFactorEnabled === true &&
        (sitzung.session as { zweiterFaktorGeprueft?: boolean })
          .zweiterFaktorGeprueft === true,
      zweiterFaktorKonto: sitzung.user.twoFactorEnabled === true,
      clientArt: clientArtVon(sitzung.session),
      rollen,
      ...(eigenesKind && { kindId: eigenesKind }),
    });
    // Nie aus der Anfrage: Das Push-Token hängt an der Sitzung, die better-auth aus dem Cookie liest
    c.set("sitzungId", sitzung.session.id);
    await next();
  });
}

// Die Art der Sitzung (#785); ein unbekannter Wert gilt als «web». Der Wert steuert kein Recht
function clientArtVon(sitzung: object): NonNullable<Person["clientArt"]> {
  const art = (sitzung as { clientArt?: unknown }).clientArt;
  return art === "app_nachgewiesen" || art === "app_ungeprueft" ? art : "web";
}

// Verwaltungsrouten erst mit zweitem Faktor für die Abteilungsleitung und den Entwickler (Entscheid vom 24.11.2026), geprüft in der Sitzung (person.zweiterFaktor, #721): Eine App-Sitzung ohne Code kommt nicht hinein, auch bei einem Konto mit Faktor (403 ZWEITER_FAKTOR_SITZUNG). Eigener Code, damit die App zur Einrichtung führt. Alle anderen passen vorbei und behalten das 403/404 der Route
export const zweiterFaktorPflicht = createMiddleware<{
  Variables: { person: Person };
}>(async (c, next) => {
  const person = c.get("person");
  if (siehtAlles(person) && !person.zweiterFaktor) {
    return c.json(
      zweiterFaktorFehlt(
        "Für die Verwaltung braucht es zuerst einen zweiten Faktor.",
        person,
      ),
      403,
    );
  }
  await next();
});

// Der Body der Antwort 403, wenn ein erweitertes Recht ohne zweiten Faktor genutzt wird (#423): Code für die App, Text zur Anzeige. Hat das Konto den Faktor und nur die Sitzung hat den Code nicht geprüft (die Anmeldung der App, #721), lautet der Code ZWEITER_FAKTOR_SITZUNG: Die Verwaltung zeigt dann die neue Anmeldung mit Code, nicht die Einrichtung
export const zweiterFaktorFehlt = (
  message: string,
  person?: Pick<Person, "zweiterFaktor" | "zweiterFaktorKonto">,
) =>
  person?.zweiterFaktorKonto === true && !person.zweiterFaktor
    ? ({
        code: "ZWEITER_FAKTOR_SITZUNG",
        message:
          "Diese Sitzung hat den zweiten Faktor nicht geprüft. Melde dich in der Verwaltung im Browser mit dem Code an.",
      } as const)
    : ({ code: "ZWEITER_FAKTOR_FEHLT", message } as const);

// Chat: Mitgliedschaft wird nie gespeichert, sondern pro Anfrage aus Rollen und Kindern abgeleitet

// banned ist null-sicher geprüft; Deaktivieren setzt beide Felder, jedes allein beendet die Mitgliedschaft
export function aktivesKonto(abteilungId: string) {
  return and(
    eq(user.abteilungId, abteilungId),
    isNull(user.deaktiviertAm),
    sql`${user.banned} is not true`,
  );
}

// Alle Chat-Mitglieder der Abteilung als Unterabfrage { chatId, userId, sichtAb }; sichtAb null heisst ganzer Verlauf
export function chatMitglieder(db: Db, abteilungId: string) {
  // Die Union nimmt Spaltennamen und Decoder aus dem ersten Zweig, darum in jedem Zweig derselbe Alias und der Decoder einer timestamptz-Spalte
  const sichtAb = (ausdruck: SQL) =>
    (ausdruck.mapWith(kind.stufeSeit) as SQL<Date | null>).as("sicht_ab");
  const kontoAktiv = aktivesKonto(abteilungId);
  const istSlDerStufe = (userId: AnyColumn) =>
    db
      .select({ eins: sql`1` })
      .from(rolle)
      .where(
        and(
          eq(rolle.userId, userId),
          eq(rolle.stufeId, chat.stufeId),
          eq(rolle.typ, "stufenleitung"),
        ),
      );

  // SL lesen jeden Chat ihrer Stufe, auch den Einzelchat eines Elternteils, der den Zugang verloren hat
  const sl = db
    .select({
      chatId: chat.id,
      userId: rolle.userId,
      sichtAb: sichtAb(sql`null::timestamptz`),
    })
    .from(chat)
    .innerJoin(
      rolle,
      and(eq(rolle.stufeId, chat.stufeId), eq(rolle.typ, "stufenleitung")),
    )
    .innerJoin(user, and(eq(user.id, rolle.userId), kontoAktiv))
    .where(eq(chat.abteilungId, abteilungId));

  // Die Eltern und das eigene Konto eines Kindes (kind_zugang). Das Kind-Konto ist nur Mitglied, wenn die Abteilung den Chat für Kinder zulässt (lesen oder schreiben; Schreiben prüft die Route)
  const kindChatErlaubt = exists(
    db
      .select({ eins: sql`1` })
      .from(kindKontoEinstellung)
      .where(
        and(
          eq(kindKontoEinstellung.abteilungId, chat.abteilungId),
          eq(kindKontoEinstellung.erlaubt, true),
          ne(kindKontoEinstellung.chat, "aus"),
        ),
      ),
  );

  // Wer in der Stufe SL ist, nimmt nur als SL teil, darum lassen beide Eltern-Zweige diese Konten aus
  const eltern = db
    .select({
      chatId: chat.id,
      userId: kindZugang.userId,
      sichtAb: sichtAb(
        // min(): Beim frühesten aktiven Kind beginnt die Sicht; Drizzles min() nähme den String-Decoder
        sql`min(greatest(${kindZugang.erstelltAm}, ${kind.stufeSeit}))`,
      ),
    })
    .from(chat)
    .innerJoin(
      kind,
      and(
        eq(kind.stufeId, chat.stufeId),
        eq(kind.abteilungId, abteilungId),
        isNull(kind.inaktivSeit),
      ),
    )
    .innerJoin(kindZugang, eq(kindZugang.kindId, kind.id))
    .innerJoin(user, and(eq(user.id, kindZugang.userId), kontoAktiv))
    .where(
      and(
        eq(chat.abteilungId, abteilungId),
        eq(chat.typ, "stufe"),
        notExists(istSlDerStufe(kindZugang.userId)),
        or(eq(kindZugang.eigen, false), kindChatErlaubt),
      ),
    )
    .groupBy(chat.id, kindZugang.userId);

  // exists statt Join: Zwei aktive Kinder in der Stufe gäben sonst zwei Zeilen pro Einzelchat
  const einzel = db
    .select({
      chatId: chat.id,
      userId: sql<string>`${chat.elternUserId}`.as("user_id"),
      // Das Beitrittsdatum gilt nur im Gruppenchat; den eigenen Einzelchat sieht das Elternteil ganz
      sichtAb: sichtAb(sql`null::timestamptz`),
    })
    .from(chat)
    .innerJoin(user, and(eq(user.id, chat.elternUserId), kontoAktiv))
    .where(
      and(
        eq(chat.abteilungId, abteilungId),
        eq(chat.typ, "direkt"),
        exists(
          db
            .select({ eins: sql`1` })
            .from(kind)
            .innerJoin(kindZugang, eq(kindZugang.kindId, kind.id))
            .where(
              and(
                eq(kindZugang.userId, chat.elternUserId),
                // Nur Eltern: Das Konto eines Kindes hat nie einen Einzelchat mit der Leitung
                eq(kindZugang.eigen, false),
                eq(kind.stufeId, chat.stufeId),
                eq(kind.abteilungId, abteilungId),
                isNull(kind.inaktivSeit),
              ),
            ),
        ),
        notExists(istSlDerStufe(chat.elternUserId)),
      ),
    );

  return unionAll(sl, eltern, einzel).as("chat_mitglieder");
}

// undefined heisst: Für diese Person existiert der Chat nicht, die Route antwortet 404; Nichtmitglieder sehen nie einen Chat, darum gibt es kein 403
export async function chatFuerPerson(
  db: Db,
  person: Pick<Person, "id" | "abteilungId">,
  chatId: string,
) {
  const mitglieder = chatMitglieder(db, person.abteilungId);
  const [eigener] = await db
    .select({
      id: chat.id,
      typ: chat.typ,
      stufeId: chat.stufeId,
      elternUserId: chat.elternUserId,
      sichtAb: mitglieder.sichtAb,
    })
    .from(chat)
    .innerJoin(mitglieder, eq(mitglieder.chatId, chat.id))
    .where(and(eq(chat.id, chatId), eq(mitglieder.userId, person.id)));
  return eigener;
}

// Die SL der Stufen, wie sie die Mitgliedschaft zählt: nur aktive Konten. Sie lesen jeden Einzelchat ihrer Stufe mit. Reihenfolge: Priorität der Stufe (ohne zuletzt), dann Name
export function stufenleitungDerStufen(
  db: Db,
  abteilungId: string,
  stufeIds: string[],
) {
  return db
    .select({
      stufeId: rolle.stufeId,
      id: user.id,
      name: user.name,
      ceviName: user.ceviName,
    })
    .from(rolle)
    .innerJoin(user, and(eq(user.id, rolle.userId), aktivesKonto(abteilungId)))
    .where(
      and(inArray(rolle.stufeId, stufeIds), eq(rolle.typ, "stufenleitung")),
    )
    .orderBy(asc(rolle.prioritaet), user.name, user.id);
}

// Nachrichten in den Chats der Person, Eltern ab Beitritt (einschliesslich)
export function sichtbareNachrichten(
  db: Db,
  person: Pick<Person, "id" | "abteilungId">,
) {
  const mitglieder = chatMitglieder(db, person.abteilungId);
  return db
    .select({
      id: nachricht.id,
      chatId: nachricht.chatId,
      autorId: nachricht.autorId,
      text: nachricht.text,
      programmId: nachricht.programmId,
      erstelltAm: nachricht.erstelltAm,
    })
    .from(nachricht)
    .innerJoin(
      mitglieder,
      and(
        eq(mitglieder.chatId, nachricht.chatId),
        eq(mitglieder.userId, person.id),
      ),
    )
    .where(
      or(
        isNull(mitglieder.sichtAb),
        gte(nachricht.erstelltAm, mitglieder.sichtAb),
      ),
    )
    .as("sichtbare_nachrichten");
}

// «stufenleitung» erfüllt nur die SL, «leitung» auch die SL derselben Stufe; die die Abteilungsleitung ist keine Stufenrolle
export function hatRolle(
  person: Person,
  stufeId: string,
  typ: "leitung" | "stufenleitung",
) {
  return person.rollen.some(
    (r) =>
      r.stufeId === stufeId && (r.typ === "stufenleitung" || typ === "leitung"),
  );
}

// Beginn des Programms; ganztägige beginnen um 00:00 Schweizer Zeit, nie über die Sitzungszone (tag_von::timestamptz)
export const programmBeginn: SQL = sql`coalesce(programm.beginn, programm.tag_von::timestamp at time zone 'Europe/Zurich')`;

// Leitende und SL melden sich nur für Programme einer eigenen Stufe an; die Abteilungsleitung ohne Stufenrolle und Eltern nie
export function darfLeitungAnmelden(
  person: Person,
  stufeIds: readonly string[],
) {
  return stufeIds.some((stufeId) => hatRolle(person, stufeId, "leitung"));
}
