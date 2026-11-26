import type { LagerMatrix, LagerPersona } from "../matrix.js";

// Matrix-Zeilen von L0a (#364): Lager und Mitglieder. Literale Werte, beobachtet und von Hand gegengelesen, nie aus der Policy berechnet
const status = (
  werte: Partial<Record<LagerPersona, number>>,
  grundlage: number,
): Record<LagerPersona, number> => ({
  abteilungsleitung: grundlage,
  lagerleitung: grundlage,
  leitung: grundlage,
  team: grundlage,
  lesen: grundlage,
  ohneMitgliedschaft: grundlage,
  fremdeAbteilung: grundlage,
  ohneLogin: 401,
  ...werte,
});
const gleich = (e: Record<LagerPersona, number>) => ({
  aktiv: e,
  abgeschlossen: e,
});

// Verwaltung: nur die Abteilungsleitung. Die Lager-Rollen und ein Konto ohne Mitgliedschaft bekommen 403, die fremde Abteilung 404 (bei Objekten) oder 403 (Sammelroute: ein Konto ohne Recht der Abteilungsleitung)
const verwaltungSammel = (admin: number) =>
  status({ abteilungsleitung: admin }, 403);
const verwaltungObjekt = (admin: number) =>
  status({ abteilungsleitung: admin, fremdeAbteilung: 404 }, 403);

export const ZEILEN: LagerMatrix = {
  "GET /api/v1/lager": {
    // Jedes Konto sieht seine eigenen Lager; die fremde Abteilung ihre eigenen, nie die der Testabteilung
    erwartet: gleich(status({}, 200)),
  },
  "GET /api/v1/lager/neuigkeiten": {
    // Wie die Liste: jedes Konto sieht den Stand seiner eigenen Lager
    erwartet: gleich(status({}, 200)),
  },
  "GET /api/v1/lager/:id": {
    url: (w, z) => `/api/v1/lager/${w.lagerId(z)}`,
    erwartet: gleich(
      status({ ohneMitgliedschaft: 404, fremdeAbteilung: 404 }, 200),
    ),
  },
  "GET /api/v1/admin/lager": { erwartet: gleich(verwaltungSammel(200)) },
  "POST /api/v1/admin/lager": {
    body: () => ({
      titel: "Matrix-Lager neu",
      von: "2027-07-10",
      bis: "2027-07-24",
    }),
    erwartet: gleich(verwaltungSammel(201)),
  },
  "GET /api/v1/admin/lager/:id": {
    url: (w, z) => `/api/v1/admin/lager/${w.lagerId(z)}`,
    erwartet: gleich(verwaltungObjekt(200)),
  },
  "PATCH /api/v1/admin/lager/:id": {
    url: (w, z) => `/api/v1/admin/lager/${w.lagerId(z)}`,
    body: () => ({ titel: "Matrix-Lager geändert" }),
    // Stammdaten eines abgeschlossenen Lagers sind gesperrt, aber nur für den, der sie ändern dürfte
    erwartet: {
      aktiv: verwaltungObjekt(204),
      abgeschlossen: verwaltungObjekt(409),
    },
  },
  "POST /api/v1/admin/lager/:id/seite": {
    url: (w, z) => `/api/v1/admin/lager/${w.lagerId(z)}/seite`,
    // Die Abteilungsleitung legt die Seite an (jedes Matrix-Lager einmal, darum 201); auch ein geschlossenes Lager darf eine Seite bekommen (Rückblick). Den zweiten Klick (200) prüft test/rechte-website-lager-plattform.test.ts
    erwartet: gleich(verwaltungObjekt(201)),
  },
  "GET /api/v1/admin/lager/:id/mitglieder": {
    url: (w, z) => `/api/v1/admin/lager/${w.lagerId(z)}/mitglieder`,
    erwartet: gleich(verwaltungObjekt(200)),
  },
  "PUT /api/v1/admin/lager/:id/mitglieder/:personId": {
    url: async (w, z) =>
      `/api/v1/admin/lager/${w.lagerId(z)}/mitglieder/${await w.wegwerfPersonId()}`,
    body: () => ({ rolle: "team" }),
    erwartet: {
      aktiv: verwaltungObjekt(204),
      abgeschlossen: verwaltungObjekt(409),
    },
  },
  "DELETE /api/v1/admin/lager/:id/mitglieder/:personId": {
    // Jede Anfrage entfernt ihr Ziel, darum eines pro Anfrage
    url: async (w, z) =>
      `/api/v1/admin/lager/${w.lagerId(z)}/mitglieder/${await w.wegwerfMitgliedId(w.lagerId(z))}`,
    erwartet: {
      aktiv: verwaltungObjekt(204),
      abgeschlossen: verwaltungObjekt(409),
    },
  },
  "DELETE /api/v1/admin/lager/:id": {
    url: (w, z) => `/api/v1/admin/lager/${w.lagerId(z)}`,
    // Die Matrix-Lager sind aktiv oder abgeschlossen und lassen sich nie löschen: Die Abteilungsleitung bekommt 409 (nichts verschwindet), alle anderen wie bei den übrigen Verwaltungsrouten. Das Löschen selbst prüft test/lager/loeschen.test.ts
    body: () => ({ titel: "Matrix-Lager" }),
    erwartet: gleich(verwaltungObjekt(409)),
  },
};
