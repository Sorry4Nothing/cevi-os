import ICAL from "ical.js";
import { describe, expect, test } from "vitest";
import {
  erzeugeHoeckIcs,
  faltIcsZeile,
  maskiereIcsText,
  type HoeckFuerIcs,
} from "../../src/lager/hoeck-ics.js";

// Die Kalenderdatei eines Höcks (#378): Format nach RFC 5545 (der Parser von ical.js liest sie zurück), Maskierung, Faltung. Ohne Datenbank.
const hoeck: HoeckFuerIcs = {
  id: "0194b3a2-7c1d-7a4e-8f00-1234567890ab",
  version: 3,
  datum: "2027-06-15",
  zeit: "19:30",
  titel: "Lagerleitungs-Höck",
  ort: "Pfarrhaus, Stäfa",
  geaendertAm: new Date("2027-05-01T08:15:30.123Z"),
};

const lies = (text: string) => {
  const kalender = new ICAL.Component(ICAL.parse(text));
  const vevent = kalender.getFirstSubcomponent("vevent")!;
  return { kalender, vevent, termin: new ICAL.Event(vevent) };
};

describe("Höck als Kalenderdatei", () => {
  test("hat den Aufbau von RFC 5545: CRLF, ein Kalender, ein Termin", () => {
    const text = erzeugeHoeckIcs(hoeck);
    expect(text.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(text.endsWith("END:VEVENT\r\nEND:VCALENDAR\r\n")).toBe(true);
    // Jede Zeile endet mit CRLF, nie ein einzelnes LF
    expect(text.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    const { kalender } = lies(text);
    expect(kalender.name).toBe("vcalendar");
    expect(kalender.getFirstPropertyValue("version")).toBe("2.0");
    expect(kalender.getFirstPropertyValue("prodid")).toBe(
      "-//Cevi OS//Lager//DE",
    );
    expect(kalender.getAllSubcomponents("vevent")).toHaveLength(1);
  });

  test("ical.js liest Titel, Ort, Zeit, UID und Folgenummer zurück", () => {
    const { termin, vevent } = lies(erzeugeHoeckIcs(hoeck));
    expect(termin.summary).toBe("Lagerleitungs-Höck");
    expect(termin.location).toBe("Pfarrhaus, Stäfa");
    expect(termin.uid).toBe(`${hoeck.id}@cevi-os`);
    expect(termin.sequence).toBe(2);
    expect(termin.startDate.isDate).toBe(false);
    expect(termin.startDate.toString()).toBe("2027-06-15T19:30:00");
    expect(termin.startDate.zone.tzid).toBe("floating");
    // Der Zeitstempel kommt aus dem Änderungszeitpunkt, nicht aus der Uhr
    expect(vevent.getFirstPropertyValue("dtstamp")!.toString()).toBe(
      "2027-05-01T08:15:30Z",
    );
  });

  test("dieselbe Zeile ergibt dieselbe Datei", () => {
    expect(erzeugeHoeckIcs(hoeck)).toBe(erzeugeHoeckIcs({ ...hoeck }));
  });

  test("ohne Zeit ein Tag, ohne Ort keine LOCATION-Zeile", () => {
    const text = erzeugeHoeckIcs({ ...hoeck, zeit: null, ort: null });
    expect(text).toContain("DTSTART;VALUE=DATE:20270615\r\n");
    expect(text).not.toContain("LOCATION");
    const { termin } = lies(text);
    expect(termin.startDate.isDate).toBe(true);
    expect(termin.startDate.toString()).toBe("2027-06-15");
    expect(termin.location).toBeFalsy();
  });

  test("enthält nur Titel, Ort, Datum und Zeit, keine Personendaten", () => {
    const text = erzeugeHoeckIcs(hoeck);
    const eigenschaften = text
      .split("\r\n")
      .filter(Boolean)
      .map((z) => z.split(/[:;]/)[0]);
    expect(eigenschaften).toEqual([
      "BEGIN",
      "VERSION",
      "PRODID",
      "CALSCALE",
      "METHOD",
      "BEGIN",
      "UID",
      "DTSTAMP",
      "SEQUENCE",
      "DTSTART",
      "SUMMARY",
      "LOCATION",
      "END",
      "END",
    ]);
    for (const verboten of ["ATTENDEE", "ORGANIZER", "DESCRIPTION", "URL"]) {
      expect(text).not.toContain(verboten);
    }
  });

  test("maskiert Sonderzeichen, und ein Titel kann keine Zeile einschleusen", () => {
    const boese =
      "A\\B; C, D\r\nEND:VEVENT\r\nBEGIN:VEVENT\nATTENDEE:mailto:x@example.org \u0007";
    const text = erzeugeHoeckIcs({ ...hoeck, titel: boese, ort: boese });
    // Genau ein Termin, kein eingeschleuster Block, keine Teilnehmenden
    const { kalender, termin } = lies(text);
    expect(kalender.getAllSubcomponents("vevent")).toHaveLength(1);
    expect(termin.attendees).toHaveLength(0);
    // Die Maskierung ist umkehrbar: ical.js liest den Wert (mit Zeilenumbruch statt Steuerzeichen) zurück
    expect(termin.summary).toBe(
      "A\\B; C, D\nEND:VEVENT\nBEGIN:VEVENT\nATTENDEE:mailto:x@example.org\n ",
    );
    expect(termin.location).toBe(termin.summary);
    // Keine Zeile der Datei beginnt mit einem eingeschleusten Schlüsselwort
    const zeilen = text.split("\r\n");
    expect(zeilen.filter((z) => z === "END:VEVENT")).toHaveLength(1);
    expect(zeilen.filter((z) => z.startsWith("ATTENDEE"))).toHaveLength(0);
  });

  test("maskiereIcsText: Backslash zuerst, ein Backslash vor n bleibt ein Backslash", () => {
    expect(maskiereIcsText("a\\nb")).toBe("a\\\\nb");
    expect(maskiereIcsText("a;b,c")).toBe("a\\;b\\,c");
    expect(maskiereIcsText("a\nb\r\nc\rd")).toBe("a\\nb\\nc\\nd");
    expect(maskiereIcsText("a\u0000b\u007fc")).toBe("a b c");
  });

  test("faltet lange Zeilen auf höchstens 75 Oktette, ohne ein Zeichen zu zerschneiden", () => {
    const titel =
      "Höck mit sehr langem Titel für den Ausflug über die Berge ".repeat(3);
    const text = erzeugeHoeckIcs({ ...hoeck, titel: titel.trim() });
    for (const zeile of text.split("\r\n")) {
      expect(Buffer.byteLength(zeile, "utf8")).toBeLessThanOrEqual(75);
    }
    expect(lies(text).termin.summary).toBe(titel.trim());
    // Zeichen aus mehreren Oktetten bleiben ganz
    const umlaute = faltIcsZeile(`SUMMARY:${"ä".repeat(80)}`);
    expect(umlaute.split("\r\n").length).toBeGreaterThan(1);
    expect(umlaute.replace(/\r\n /g, "")).toBe(`SUMMARY:${"ä".repeat(80)}`);
    expect(umlaute).not.toContain("�");
  });
});
