import { z } from "zod";
import { FEHLER, OutlookFehler } from "./fehler.js";
import { erstelleHttp, formular, SCOPES, type GraphOptionen } from "./graph.js";

// Einmalige Autorisierung per Geraetecode (device code flow, #835): Der Server zeigt einen Code, die Person gibt ihn im Browser unter der angezeigten Adresse ein und meldet sich mit dem Konto des Kalenders an. Ohne Umleitungsadresse, ohne Client-Secret (öffentlicher Client). Das Ergebnis ist ein Refresh-Token, das der Aufrufer verschlüsselt speichert.
const geraeteAntwort = z.object({
  device_code: z.string().min(1),
  user_code: z.string().min(1).max(50),
  verification_uri: z.url({ protocol: /^https?$/ }),
  expires_in: z.coerce.number().int().min(1),
  interval: z.coerce.number().int().min(1).max(60).default(5),
});
const tokenAntwort = z.object({
  refresh_token: z.string().min(1),
  scope: z.string().default(""),
});
const fehlerAntwort = z.object({ error: z.string() });

export type Geraetecode = {
  // Was die Person sieht: Adresse und Code (kein Geheimnis, nur eine Sitzung lang gültig)
  adresse: string;
  code: string;
  gueltigSek: number;
  warteAufFreigabe(): Promise<string>;
};

export async function starteGeraetecode(
  o: GraphOptionen,
): Promise<Geraetecode> {
  const http = erstelleHttp(o);
  const basis = `${http.login}/${encodeURIComponent(http.tenant)}/oauth2/v2.0`;
  const { body } = await http.sende(
    `${basis}/devicecode`,
    formular({ client_id: http.clientId, scope: SCOPES }),
  );
  const g = geraeteAntwort.safeParse(body);
  if (!g.success) throw new OutlookFehler(FEHLER.ANTWORT_UNGUELTIG);
  const schlaf =
    o.schlaf ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  return {
    adresse: g.data.verification_uri,
    code: g.data.user_code,
    gueltigSek: g.data.expires_in,
    async warteAufFreigabe() {
      let abstand = g.data.interval;
      const ende = http.jetzt() + g.data.expires_in * 1000;
      while (http.jetzt() < ende) {
        await schlaf(abstand * 1000);
        const antwort = await http.sende(
          `${basis}/token`,
          formular({
            client_id: http.clientId,
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
            device_code: g.data.device_code,
          }),
          { durchlassen: [400] },
        );
        if (antwort.status === 200) {
          const t = tokenAntwort.safeParse(antwort.body);
          if (!t.success) throw new OutlookFehler(FEHLER.ANTWORT_UNGUELTIG);
          // Ohne diese Rechte könnte Cevi OS später nichts schreiben: lieber jetzt scheitern
          const gewaehrt = new Set(t.data.scope.toLowerCase().split(" "));
          for (const s of [
            "calendars.readwrite",
            "mailboxsettings.readwrite",
          ]) {
            if (!gewaehrt.has(s)) throw new OutlookFehler(FEHLER.ABGELEHNT);
          }
          return t.data.refresh_token;
        }
        const f = fehlerAntwort.safeParse(antwort.body);
        const code = f.success ? f.data.error : "";
        if (code === "authorization_pending") continue;
        if (code === "slow_down") {
          abstand += 5;
          continue;
        }
        // abgelehnt, abgelaufen oder ein anderer Fehler: Es gibt nichts abzuwarten
        throw new OutlookFehler(FEHLER.ABGELEHNT);
      }
      throw new OutlookFehler(FEHLER.ABGELEHNT);
    },
  };
}
