import {
  createHash,
  createVerify,
  timingSafeEqual,
  X509Certificate,
} from "node:crypto";
import { dekodiereCbor, type Cbor } from "./cbor.js";
import { appleNonce } from "./der.js";
import { APPLE_APP_ATTEST_WURZEL } from "./apple-wurzel.js";
import type { IosEingabe, NachweisErgebnis, NachweisPruefer } from "./typen.js";

// Apple App Attest (#785), nach «Validating apps that connect to your server». Zwei Fälle: Die Attestation bestätigt einen neuen Schlüssel des Geräts einmal (Kette bis zur Wurzel von Apple, Nonce, Schlüsselkennung, App-Kennung, Zähler 0, Umgebung) und legt seinen öffentlichen Schlüssel ab; jede spätere Anmeldung belegt eine Assertion mit diesem Schlüssel (Signatur, App-Kennung, Zähler steigt streng). Die Quittung (receipt) und das Risikomass von Apple bleiben ungenutzt.
// Nur gegen selbst erzeugte Fixtures getestet; eine echte Antwort von Apple liegt erst mit der fertigen App vor (docs/app-nachweis.md)

// Der Speicher der Schlüssel (db: geraete.ts, Tests: im Arbeitsspeicher)
export type Geraeteablage = {
  holen(
    schluesselId: string,
  ): Promise<{ oeffentlicherSchluessel: string; zaehler: number } | undefined>;
  // false, wenn der Schlüssel schon bekannt ist
  anlegen(geraet: {
    schluesselId: string;
    oeffentlicherSchluessel: string;
  }): Promise<boolean>;
  // Setzt den Zähler nur, wenn er steigt; false sonst (auch bei gleichzeitigen Anfragen)
  zaehlerErhoehen(schluesselId: string, neu: number): Promise<boolean>;
};

const sha256 = (...teile: Uint8Array[]) => {
  const h = createHash("sha256");
  for (const t of teile) h.update(t);
  return h.digest();
};
const gleich = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && timingSafeEqual(a, b);

// 16 Byte: «appattestdevelop» bzw. «appattest» mit sieben Nullbyte
const AAGUID = {
  development: Buffer.from("appattestdevelop", "ascii"),
  production: Buffer.concat([
    Buffer.from("appattest", "ascii"),
    Buffer.alloc(7),
  ]),
} as const;

const fehler = (grund: string): NachweisErgebnis => ({ ok: false, grund });

// authenticatorData: rpIdHash (32), Flags (1), Zähler (4), danach nur bei der Attestation aaguid (16), Länge der Schlüsselkennung (2), Kennung, Schlüssel
function authDatenKopf(authData: Uint8Array) {
  if (authData.length < 37) return undefined;
  const b = Buffer.from(authData.buffer, authData.byteOffset, authData.length);
  return { rpIdHash: b.subarray(0, 32), zaehler: b.readUInt32BE(33), b };
}

export function erstelleIosPruefer({
  teamId,
  bundleId,
  umgebung,
  wurzel = APPLE_APP_ATTEST_WURZEL,
  geraete,
  jetzt = () => new Date(),
}: {
  teamId: string;
  bundleId: string;
  umgebung: "production" | "development";
  // Nur Tests setzen eine eigene Wurzel
  wurzel?: string;
  geraete: Geraeteablage;
  jetzt?: () => Date;
}): NachweisPruefer<IosEingabe> {
  const wurzelZertifikat = new X509Certificate(wurzel);
  const rpIdHash = sha256(Buffer.from(`${teamId}.${bundleId}`, "utf8"));

  async function attestation(
    daten: string,
    clientDataHash: Buffer,
    schluesselId: Buffer,
  ): Promise<NachweisErgebnis> {
    const objekt = dekodiereCbor(Buffer.from(daten, "base64"));
    if (
      typeof objekt !== "object" ||
      objekt === null ||
      Array.isArray(objekt)
    ) {
      return fehler("aufbau");
    }
    const { fmt, attStmt, authData } = objekt as Record<string, Cbor>;
    if (
      fmt !== "apple-appattest" ||
      !(authData instanceof Uint8Array) ||
      typeof attStmt !== "object" ||
      attStmt === null ||
      Array.isArray(attStmt) ||
      attStmt instanceof Uint8Array
    ) {
      return fehler("aufbau");
    }
    const x5c = (attStmt as Record<string, Cbor>).x5c;
    if (
      !Array.isArray(x5c) ||
      x5c.length < 2 ||
      x5c.length > 3 ||
      !x5c.every((z) => z instanceof Uint8Array)
    ) {
      return fehler("kette-aufbau");
    }
    // Die Kette bis zur Wurzel von Apple, die der Server selbst kennt (nie eine aus der Anfrage)
    const kette = (x5c as Uint8Array[]).map((z) => new X509Certificate(z));
    const jetztZeit = jetzt();
    const pfad = [...kette, wurzelZertifikat];
    for (const [i, z] of pfad.entries()) {
      if (jetztZeit < z.validFromDate || jetztZeit > z.validToDate) {
        return fehler("kette-zeit");
      }
      const eltern = pfad[i + 1];
      if (
        eltern &&
        (!eltern.ca || !z.checkIssued(eltern) || !z.verify(eltern.publicKey))
      ) {
        return fehler("kette-signatur");
      }
    }
    const blatt = kette[0]!;
    // Die Nonce im Zertifikat: SHA-256 über authData und die Bindung der Anfrage
    const erwartet = sha256(authData, clientDataHash);
    const imZertifikat = appleNonce(blatt);
    if (!imZertifikat || !gleich(imZertifikat, erwartet)) {
      return fehler("nonce");
    }
    // Die Kennung des Schlüssels ist der Hash seines öffentlichen Schlüssels (unkomprimiert, X9.62)
    const jwk = blatt.publicKey.export({ format: "jwk" });
    if (jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.x || !jwk.y) {
      return fehler("schluessel");
    }
    const punkt = Buffer.concat([
      Buffer.from([4]),
      Buffer.from(jwk.x, "base64url"),
      Buffer.from(jwk.y, "base64url"),
    ]);
    if (!gleich(sha256(punkt), schluesselId)) return fehler("schluessel-id");
    const kopf = authDatenKopf(authData);
    if (!kopf || authData.length < 55) return fehler("auth-daten");
    if (!gleich(kopf.rpIdHash, rpIdHash)) return fehler("rp-id");
    if (kopf.zaehler !== 0) return fehler("zaehler");
    if (!gleich(kopf.b.subarray(37, 53), AAGUID[umgebung])) {
      return fehler("umgebung");
    }
    const laenge = kopf.b.readUInt16BE(53);
    if (
      authData.length < 55 + laenge ||
      !gleich(kopf.b.subarray(55, 55 + laenge), schluesselId)
    ) {
      return fehler("schluessel-id");
    }
    const angelegt = await geraete.anlegen({
      schluesselId: schluesselId.toString("base64"),
      oeffentlicherSchluessel: blatt.publicKey
        .export({ format: "der", type: "spki" })
        .toString("base64"),
    });
    // Ein Schlüssel wird nur einmal bestätigt: Wer ihn schon kennt, kommt mit einer Assertion
    if (!angelegt) return fehler("schluessel-bekannt");
    return {
      ok: true,
      plattform: "ios",
      geraetOk: true,
      schluesselId: schluesselId.toString("base64"),
    };
  }

  async function assertion(
    daten: string,
    clientDataHash: Buffer,
    schluesselId: Buffer,
  ): Promise<NachweisErgebnis> {
    const id = schluesselId.toString("base64");
    const bekannt = await geraete.holen(id);
    if (!bekannt) return fehler("schluessel-unbekannt");
    const objekt = dekodiereCbor(Buffer.from(daten, "base64"));
    if (
      typeof objekt !== "object" ||
      objekt === null ||
      Array.isArray(objekt)
    ) {
      return fehler("aufbau");
    }
    const { signature, authenticatorData } = objekt as Record<string, Cbor>;
    if (
      !(signature instanceof Uint8Array) ||
      !(authenticatorData instanceof Uint8Array)
    ) {
      return fehler("aufbau");
    }
    const kopf = authDatenKopf(authenticatorData);
    if (!kopf) return fehler("auth-daten");
    if (!gleich(kopf.rpIdHash, rpIdHash)) return fehler("rp-id");
    const nonce = sha256(authenticatorData, clientDataHash);
    const gueltig = createVerify("sha256")
      .update(nonce)
      .verify(
        {
          key: Buffer.from(bekannt.oeffentlicherSchluessel, "base64"),
          format: "der",
          type: "spki",
        },
        signature,
      );
    if (!gueltig) return fehler("signatur");
    // Streng steigend, auch bei zwei gleichzeitigen Anfragen mit demselben Zähler: nur eine setzt ihn
    if (
      kopf.zaehler <= bekannt.zaehler ||
      !(await geraete.zaehlerErhoehen(id, kopf.zaehler))
    ) {
      return fehler("zaehler");
    }
    return { ok: true, plattform: "ios", geraetOk: true, schluesselId: id };
  }

  return {
    async pruefe(eingabe) {
      try {
        const clientDataHash = Buffer.from(eingabe.nonce, "base64url");
        const schluesselId = Buffer.from(eingabe.schluesselId, "base64");
        if (clientDataHash.length !== 32 || schluesselId.length !== 32) {
          return fehler("eingabe");
        }
        if (!eingabe.attestation === !eingabe.assertion) {
          return fehler("eingabe");
        }
        return eingabe.attestation
          ? await attestation(eingabe.attestation, clientDataHash, schluesselId)
          : await assertion(eingabe.assertion!, clientDataHash, schluesselId);
      } catch {
        // Kaputtes CBOR, kein Zertifikat, Fehler der Ablage: Die Gründe stehen nicht in der Antwort
        return fehler("unerwartet");
      }
    },
  };
}
