import ICAL from "ical.js";
import { describe, expect, test } from "vitest";
import {
  baueIcs,
  falte,
  maskiere,
  ohneStempel,
  type IcsTermin,
} from "../../src/termine/ical-text.js";

// Format des Feeds (TC2 #438) an festen Beispielen, ohne Datenbank
const JETZT = new Date("2027-01-15T10:20:30Z");
const basis: IcsTermin = {
  id: "0194d3a0-0000-7000-8000-000000000001",
  titel: "Samstagsprogramm",
  status: "aktiv",
  ganztaegig: false,
  beginn: new Date("2027-03-06T13:00:00Z"),
  ende: new Date("2027-03-06T15:30:00Z"),
  tagVon: null,
  tagBis: null,
  ort: null,
};
const ganztag: IcsTermin = {
  ...basis,
  id: "0194d3a0-0000-7000-8000-000000000002",
  titel: "Pfingstlager",
  ganztaegig: true,
  beginn: null,
  ende: null,
  tagVon: "2027-05-30",
  tagBis: "2027-06-01",
};
const oktette = (z: string) => new TextEncoder().encode(z).length;

describe("ICS-Text", () => {
  test("fester Beispieltext: Kopf, ein Termin mit Zeit, ein ganztägiger über den Monatswechsel", () => {
    expect(baueIcs([basis, ganztag], JETZT)).toBe(
      [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Cevi OS//Termine//DE",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "X-WR-CALNAME:Mein Cevi-Kalender",
        "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
        "X-PUBLISHED-TTL:PT1H",
        "BEGIN:VEVENT",
        "UID:0194d3a0-0000-7000-8000-000000000001@cevi-os",
        "DTSTAMP:20270115T102030Z",
        "DTSTART:20270306T130000Z",
        "DTEND:20270306T153000Z",
        "SUMMARY:Samstagsprogramm",
        "STATUS:CONFIRMED",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:0194d3a0-0000-7000-8000-000000000002@cevi-os",
        "DTSTAMP:20270115T102030Z",
        "DTSTART;VALUE=DATE:20270530",
        // Das Ende ist exklusiv: der Tag nach dem letzten Tag
        "DTEND;VALUE=DATE:20270602",
        "SUMMARY:Pfingstlager",
        "STATUS:CONFIRMED",
        "END:VEVENT",
        "END:VCALENDAR",
        "",
      ].join("\r\n"),
    );
  });

  test("ganztägig über das Jahresende und eintägig", () => {
    const text = baueIcs(
      [
        { ...ganztag, tagVon: "2027-12-30", tagBis: "2027-12-31" },
        { ...ganztag, id: "x", tagVon: "2028-02-28", tagBis: null },
      ],
      JETZT,
    );
    expect(text).toContain("DTEND;VALUE=DATE:20280101\r\n");
    // 2028 ist ein Schaltjahr
    expect(text).toContain(
      "DTSTART;VALUE=DATE:20280228\r\nDTEND;VALUE=DATE:20280229\r\n",
    );
  });

  test("Ort, abgesagt und zu prüfen", () => {
    const text = baueIcs(
      [
        { ...basis, ort: "Pfadiheim", status: "abgesagt" },
        { ...basis, id: "y", status: "pruefen" },
      ],
      JETZT,
    );
    expect(text).toContain("LOCATION:Pfadiheim\r\nSTATUS:CANCELLED\r\n");
    expect(text).toContain("STATUS:TENTATIVE\r\n");
  });

  test("ohne gültige Zeit fällt ein Termin weg, ohne Ende gibt es kein DTEND", () => {
    const text = baueIcs(
      [
        { ...basis, id: "a", beginn: null },
        { ...ganztag, id: "b", tagVon: null },
        { ...basis, id: "c", ende: null },
        { ...basis, id: "d", ende: basis.beginn },
      ],
      JETZT,
    );
    expect(text).not.toContain("UID:a@");
    expect(text).not.toContain("UID:b@");
    expect(text).toContain("UID:c@");
    expect(text).not.toContain("DTEND");
  });

  test("Zeitumstellung: Der Beginn steht immer in UTC", () => {
    // 28.3.2027 ist der Tag der Umstellung auf Sommerzeit; 09:00 Schweizer Zeit ist 07:00 UTC
    const text = baueIcs(
      [{ ...basis, beginn: new Date("2027-03-28T07:00:00Z"), ende: null }],
      JETZT,
    );
    expect(text).toContain("DTSTART:20270328T070000Z\r\n");
  });

  test("Maskieren: Backslash, Semikolon, Komma, Zeilenumbruch; Steuerzeichen fallen weg", () => {
    expect(maskiere("a\\b;c,d\ne\r\nf\u0000g\u0007h")).toBe(
      "a\\\\b\\;c\\,d\\ne\\nfgh",
    );
    expect(maskiere("Zürich: Bäume")).toBe("Zürich: Bäume");
  });

  test("Falten: höchstens 75 Oktette, nie mitten im Zeichen, ungefaltet gleich", () => {
    // Zweibyte-Zeichen und ein Vier-Byte-Zeichen an der Faltstelle
    for (const text of [
      "SUMMARY:" + "ä".repeat(100),
      "SUMMARY:" + "x".repeat(66) + "ü",
      "SUMMARY:" + "x".repeat(66) + "\u{1F600}" + "y".repeat(80),
      "SUMMARY:kurz",
      "X:" + "a".repeat(75 - 2),
      "X:" + "a".repeat(75 - 1),
    ]) {
      const gefaltet = falte(text);
      for (const zeile of gefaltet.split("\r\n")) {
        expect(oktette(zeile)).toBeLessThanOrEqual(75);
      }
      expect(gefaltet.replace(/\r\n /g, "")).toBe(text);
      // Jede Fortsetzung beginnt mit genau einem Leerzeichen
      for (const zeile of gefaltet.split("\r\n").slice(1)) {
        expect(zeile.startsWith(" ")).toBe(true);
      }
    }
    expect(falte("X:" + "a".repeat(73))).not.toContain("\r\n");
    expect(falte("X:" + "a".repeat(74))).toContain("\r\n");
  });

  test("ical.js liest den Feed: Titel mit Sonderzeichen, langer Titel, Zeiten und Status", () => {
    const lang = "Elternabend, Übernachtung; Stäfa\\Hombi" + "lang ".repeat(30);
    const text = baueIcs(
      [
        { ...basis, titel: lang, ort: "Heim, Stäfa" },
        ganztag,
        { ...basis, id: "z", status: "abgesagt" },
      ],
      JETZT,
    );
    for (const zeile of text.split("\r\n")) {
      expect(oktette(zeile)).toBeLessThanOrEqual(75);
    }
    expect(text.endsWith("\r\n")).toBe(true);
    const kal = new ICAL.Component(ICAL.parse(text));
    expect(kal.getFirstPropertyValue("version")).toBe("2.0");
    expect(kal.getFirstPropertyValue("x-wr-calname")).toBe(
      "Mein Cevi-Kalender",
    );
    const events = kal
      .getAllSubcomponents("vevent")
      .map((c) => new ICAL.Event(c));
    expect(events).toHaveLength(3);
    expect(events[0].summary).toBe(lang);
    expect(events[0].location).toBe("Heim, Stäfa");
    expect(events[0].startDate.toJSDate().toISOString()).toBe(
      "2027-03-06T13:00:00.000Z",
    );
    expect(events[0].endDate.toJSDate().toISOString()).toBe(
      "2027-03-06T15:30:00.000Z",
    );
    expect(events[1].startDate.isDate).toBe(true);
    expect(events[1].startDate.toString()).toBe("2027-05-30");
    expect(events[1].endDate.toString()).toBe("2027-06-02");
    expect(events[2].component.getFirstPropertyValue("status")).toBe(
      "CANCELLED",
    );
    expect(events[0].uid).toBe("0194d3a0-0000-7000-8000-000000000001@cevi-os");
  });

  test("UID bleibt stabil und der ETag-Inhalt hängt nicht vom Stempel ab", () => {
    const a = baueIcs([basis, ganztag], new Date("2027-01-15T10:00:00Z"));
    const b = baueIcs([basis, ganztag], new Date("2027-02-01T11:11:11Z"));
    expect(a).not.toBe(b);
    expect(ohneStempel(a)).toBe(ohneStempel(b));
    expect(a.match(/^UID:.*$/gm)).toEqual(b.match(/^UID:.*$/gm));
    expect(ohneStempel(a)).not.toContain("DTSTAMP");
  });
});
