/* global jest */
// Geteilte Attrappen für die Programm-Bildschirme: Netz wie in api.test.ts, Personas in den Formen der API

import type { InferResponseType } from "hono/client";

import type { api } from "../../src/api/client";
import type { Programm } from "../../src/api/programme";

type Ich = InferResponseType<typeof api.api.v1.ich.$get>;

export const netz = global.fetch as jest.Mock;

export function mockeNetz(antworten: Record<string, () => Response>) {
  netz.mockImplementation(async (eingabe: unknown) => {
    const url = String(eingabe instanceof Request ? eingabe.url : eingabe);
    for (const [endung, antwort] of Object.entries(antworten)) {
      if (new URL(url).pathname.endsWith(endung)) return antwort();
    }
    throw new Error(`Kein Netz im Test: ${url}`);
  });
}

export const json = (status: number, koerper: unknown) =>
  new Response(JSON.stringify(koerper), {
    status,
    headers: { "content-type": "application/json" },
  });

export const FALKEN = {
  id: "5b8f0a1e-0000-4000-8000-000000000001",
  name: "Falken",
};
export const PINGUINE = {
  id: "5b8f0a1e-0000-4000-8000-000000000002",
  name: "Pinguine",
};

const ICH_BASIS: Ich = {
  id: "u1",
  name: "Testperson",
  benutzername: "test.person",
  admin: false,
  zweiterFaktor: false,
  mussPasswortAendern: false,
  datenschutzGelesenAm: "2026-10-01T00:00:00.000Z",
  telefon: null,
  pushChat: true,
  pushProgramme: true,
  rollen: [],
  stufen: [],
  kinder: [],
};

// Eine Person pro Rolle; die Namen sind erfunden
export const PERSONAS: Record<"eltern" | "leitende" | "sl" | "admin", Ich> = {
  eltern: {
    ...ICH_BASIS,
    stufen: [{ ...FALKEN, kuerzel: "F" }],
    kinder: [{ id: "k1", vorname: "Kind", nachname: "A", stufeId: FALKEN.id }],
  },
  leitende: {
    ...ICH_BASIS,
    rollen: [{ stufeId: FALKEN.id, typ: "leitung" }],
    stufen: [{ ...FALKEN, kuerzel: "F" }],
  },
  sl: {
    ...ICH_BASIS,
    rollen: [{ stufeId: FALKEN.id, typ: "stufenleitung" }],
    stufen: [{ ...FALKEN, kuerzel: "F" }],
  },
  admin: { ...ICH_BASIS, admin: true, zweiterFaktor: true },
};

export function programm(
  aenderung: Partial<Programm> & { id: string; titel: string },
): Programm {
  return {
    status: "aktiv",
    sichtbarkeit: "eltern",
    ganztaegig: false,
    beginn: "2026-10-31T13:00:00.000Z",
    ende: "2026-10-31T16:00:00.000Z",
    tagVon: null,
    tagBis: null,
    googleOrt: null,
    treffpunkt: null,
    schlussOrt: null,
    schlussZeit: null,
    mitnehmen: null,
    infoEltern: null,
    stufen: [],
    googleBeschreibung: null,
    ...aenderung,
  };
}
