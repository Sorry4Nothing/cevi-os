import { createHash, randomBytes } from "node:crypto";

// Die Nonce der Herausforderung: 32 Byte Zufall, base64url
export const neueNonce = () => randomBytes(32).toString("base64url");
export const NONCE_FORMAT = /^[A-Za-z0-9_-]{43}$/;

// Hash für die Ablage: Nonce und Ticket stehen nie im Klartext in der Datenbank (256 Bit Zufall, ein Passwort-Hash wäre unnötig langsam)
export const hashVon = (wert: string) =>
  createHash("sha256").update(wert).digest("hex");

// Die Bindung des Nachweises an die Anmeldung: SHA-256 über «Nonce, Zeilenumbruch, Benutzername in Kleinbuchstaben». Die App berechnet sie gleich und gibt sie dem Betriebssystem mit: Android als nonce (base64url) des Integrity-Tokens, iOS als clientDataHash. So gilt ein Nachweis nur für diese Herausforderung und diesen Benutzernamen
export const bindung = (nonce: string, benutzername: string) =>
  createHash("sha256")
    .update(`${nonce}\n${benutzername.toLowerCase()}`)
    .digest();
