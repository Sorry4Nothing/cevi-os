// Holt das Lese-Token für das Flickr-Konto der Abteilung (#690), OAuth 1.0a in drei Schritten, lokal auf diesem Rechner.
// Aufruf:  FLICKR_API_KEY=… FLICKR_API_SECRET=… node apps/api/scripts/flickr-token.mjs
// Schlüssel und Secret kommen aus der Umgebung, nie als Argument (Argumente landen im Verlauf der Shell). Das Skript speichert nichts und schreibt keine Datei: Es gibt Token, Token-Secret und die Kennung des Kontos nur auf den Bildschirm aus. Trage die vier Werte danach selbst in deploy/.env ein (docs/flickr-einrichten.md).
// Das Token darf nur lesen («perms=read»). Der Ablauf braucht einen Browser, in dem du bei Flickr angemeldet bist; die Freigabe zeigt einen Code aus 9 Ziffern, den du hier eingibst.
import { createHmac, randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import process from "node:process";
import { URLSearchParams } from "node:url";

const BASIS = "https://www.flickr.com/services/oauth";

// RFC 3986: Ausser A-Z a-z 0-9 - . _ ~ wird alles prozentkodiert
const kodiere = (s) =>
  encodeURIComponent(s).replace(
    /[!*'()]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

// Dieselbe Signatur wie in src/fotos/flickr.ts (HMAC-SHA1 über Methode, Adresse und sortierte Parameter)
export function signiere(methode, adresse, parameter, secret, tokenSecret) {
  const paare = Object.entries(parameter)
    .map(([k, v]) => [kodiere(k), kodiere(v)])
    .sort((a, b) =>
      a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1,
    )
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const basis = `${methode.toUpperCase()}&${kodiere(adresse)}&${kodiere(paare)}`;
  return createHmac("sha1", `${kodiere(secret)}&${kodiere(tokenSecret)}`)
    .update(basis)
    .digest("base64");
}

// Ein signierter GET; die Antwort ist «a=b&c=d»
async function hole({
  url,
  extra,
  key,
  secret,
  token,
  tokenSecret,
  abruf,
  jetzt,
  nonce,
}) {
  const p = {
    oauth_consumer_key: key,
    oauth_nonce: nonce(),
    oauth_timestamp: String(Math.floor(jetzt() / 1000)),
    oauth_signature_method: "HMAC-SHA1",
    oauth_version: "1.0",
    ...(token && { oauth_token: token }),
    ...extra,
  };
  p.oauth_signature = signiere("GET", url, p, secret, tokenSecret ?? "");
  const u = new URL(url);
  u.search = new URLSearchParams(p).toString();
  const res = await abruf(u, {
    redirect: "error",
    signal: globalThis.AbortSignal.timeout(15000),
  });
  const text = await res.text();
  if (!res.ok) {
    // Nie die Antwort in den Fehler: Sie kann Teile der Anfrage wiederholen
    throw new Error(
      `Flickr antwortet mit Status ${res.status}. Prüfe Schlüssel und Secret.`,
    );
  }
  return Object.fromEntries(new URLSearchParams(text));
}

// Der ganze Ablauf mit austauschbaren Teilen (Test): abruf (fetch), frage (Eingabe des Codes), ausgabe, jetzt, nonce
export async function laufe({
  env,
  abruf = globalThis.fetch,
  frage,
  ausgabe = (z) => process.stdout.write(`${z}\n`),
  jetzt = Date.now,
  nonce = () => randomBytes(16).toString("hex"),
}) {
  const key = env.FLICKR_API_KEY;
  const secret = env.FLICKR_API_SECRET;
  if (!key || !secret) {
    throw new Error(
      "FLICKR_API_KEY und FLICKR_API_SECRET müssen in der Umgebung stehen.",
    );
  }
  const gemeinsam = { key, secret, abruf, jetzt, nonce };
  const anfrage = await hole({
    ...gemeinsam,
    url: `${BASIS}/request_token`,
    extra: { oauth_callback: "oob" },
  });
  if (!anfrage.oauth_token || !anfrage.oauth_token_secret) {
    throw new Error("Flickr hat kein Anfrage-Token geliefert.");
  }
  ausgabe("");
  ausgabe(
    "1. Öffne diese Adresse in einem Browser, in dem du bei Flickr angemeldet bist, und gib die Freigabe (nur Lesen):",
  );
  ausgabe(
    `   ${BASIS}/authorize?oauth_token=${encodeURIComponent(anfrage.oauth_token)}&perms=read`,
  );
  ausgabe("2. Flickr zeigt einen Code aus 9 Ziffern. Gib ihn hier ein.");
  const code = (await frage("Code: ")).trim().replace(/-/g, "");
  if (!/^[0-9]{6,12}$/.test(code))
    throw new Error("Der Code besteht aus Ziffern.");
  const zugang = await hole({
    ...gemeinsam,
    url: `${BASIS}/access_token`,
    token: anfrage.oauth_token,
    tokenSecret: anfrage.oauth_token_secret,
    extra: { oauth_verifier: code },
  });
  if (!zugang.oauth_token || !zugang.oauth_token_secret) {
    throw new Error("Flickr hat kein Zugangs-Token geliefert. Prüfe den Code.");
  }
  ausgabe("");
  ausgabe(
    "Fertig. Trage diese Werte in deploy/.env ein und gib sie nie weiter:",
  );
  ausgabe(`FLICKR_OAUTH_TOKEN=${zugang.oauth_token}`);
  ausgabe(`FLICKR_OAUTH_TOKEN_SECRET=${zugang.oauth_token_secret}`);
  if (zugang.user_nsid) {
    ausgabe("");
    ausgabe(
      `Kennung des Kontos für die Verwaltung (Website, Fotos): ${zugang.user_nsid}`,
    );
  }
  return { nsid: zugang.user_nsid ?? null };
}

if (process.argv[1]?.endsWith("flickr-token.mjs")) {
  const leser = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    await laufe({ env: process.env, frage: (t) => leser.question(t) });
  } catch (f) {
    process.stderr.write(`${f.message}\n`);
    process.exitCode = 1;
  } finally {
    leser.close();
  }
}
