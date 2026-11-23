import { anfrage, fehlertext } from "./api.js";
import { dialogFormular, el, feld } from "./dom.js";
import { nachVerlauf } from "./fluss.js";
import { BASIS, legeRolleAn } from "./rechte-api.js";
import { adresse } from "./rechte-gemeinsam.js";
import { vorschlaegeKarten } from "./rechte-gruppen.js";
import { rechteFehlerText, vorschlaegeFuer } from "./rechte-modell.js";

// «OK anlegen» direkt am Anlass (#651): eine Gruppe vom Typ «anlass» mit den Rollen, die ein OK meistens braucht (Leitung, Kasse, Kommunikation, Helfende). Alles ist vorbelegt und frei änderbar: Namen, Auswahl, eigene Rollen. Die Rechte der Rollen stellst du danach in der Matrix der Gruppe ein.
// Der Server legt die Gruppe samt ihren eingebauten Rollen an (POST /admin/tags) und danach jede gewählte Rolle (POST /admin/rechte/gruppen/:id/rollen); die Rechte der Vorschläge sind «eigene»: Sie gelten nur für diesen Anlass.

const text = (f) => rechteFehlerText(f, fehlertext(f));

export async function okAnlegen({ ctx, anlass }) {
  let katalog;
  try {
    katalog = await anfrage("GET", `${BASIS}/katalog`);
  } catch (f) {
    ctx.melde(text(f), "fehler");
    return null;
  }
  const klartextVon = new Map(katalog.rechte.map((r) => [r.id, r.klartext]));
  const z = { klartext: (recht) => klartextVon.get(recht) ?? recht };
  const name = feld({
    label: "Name der Gruppe",
    wert: `OK ${anlass.titel}`.slice(0, 100),
    maxlength: 100,
    required: true,
    "aria-required": "true",
    hilfe:
      "Der Name gilt in der ganzen Abteilung nur einmal. Nimm den Anlass in den Namen auf.",
  });
  const zeilen = vorschlaegeKarten(z, vorschlaegeFuer(katalog));
  return dialogFormular({
    titel: "OK anlegen",
    beschreibung: `Eine Gruppe für das Organisationskomitee von «${anlass.titel}». Sie gilt, bis du sie löschst. Die Rollen sind ein Vorschlag: Ändere ihn frei.`,
    felder: [
      name.wurzel,
      el("h3", { class: "rr-vorschlag-titel" }, "Rollen im OK"),
      zeilen.wurzel,
    ],
    ok: "OK anlegen",
    fehlertext: (f) => f.teilweise ?? text(f),
    pruefe: () => zeilen.pruefe(),
    senden: async () => {
      const gruppe = await anfrage("POST", "/api/v1/admin/tags", {
        typ: "anlass",
        name: name.eingabe.value.trim(),
        anlassId: anlass.id,
      });
      const fehler = [];
      let ok = 0;
      for (const r of zeilen.wert()) {
        try {
          await legeRolleAn(gruppe.id, r);
          ok++;
        } catch (f) {
          fehler.push(`«${r.name}»: ${text(f)}`);
        }
      }
      return { id: gruppe.id, ok, fehler };
    },
    danach: ({ id, ok, fehler }) => {
      ctx.melde(
        fehler.length > 0
          ? `Das OK ist angelegt. Nicht angelegt: ${fehler.join(" ")}`
          : `Das OK ist angelegt, mit ${ok === 1 ? "1 Rolle" : `${ok} Rollen`}. Stelle jetzt die Rechte ein und nimm die Personen auf.`,
        fehler.length > 0 ? "warn" : "ok",
      );
      // Erst wenn das Zurück der geschlossenen Seite angekommen ist: sonst landete es auf dem neuen Eintrag
      nachVerlauf(() => {
        location.hash = adresse("gruppen", id);
      });
    },
  });
}
