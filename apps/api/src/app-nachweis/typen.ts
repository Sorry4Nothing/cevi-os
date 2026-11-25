// App-Nachweis (#785): Der Server erkennt die echte App nicht am Header Origin (den setzt jeder), sondern am Beleg des Betriebssystems: Google Play Integrity (Android) und Apple App Attest (iOS). Jeder Prüfer bekommt die Bindung der Anfrage und den Nachweis der App und sagt, ob beides stimmt.

export type Plattform = "android" | "ios";

export type NachweisErgebnis =
  | {
      ok: true;
      plattform: Plattform;
      // Das Gerät hat das geforderte Siegel (Android: MEETS_DEVICE_INTEGRITY oder mehr; iOS: Schlüssel im Secure Enclave bestätigt)
      geraetOk: boolean;
      // Nur iOS: die Kennung des Schlüssels, dem der Nachweis gehört
      schluesselId?: string;
    }
  // grund steht nur im Betriebs-Log, nie in einer Antwort; voruebergehend: der Dienst von Google war nicht erreichbar, ein neuer Versuch kann gelingen
  | { ok: false; grund: string; voruebergehend?: boolean };

// nonce ist die Bindung der Anfrage (bindung.ts), als base64url: Der Prüfer vergleicht sie mit dem, was das Betriebssystem im Nachweis beglaubigt hat
export interface NachweisPruefer<E extends { nonce: string }> {
  pruefe(eingabe: E): Promise<NachweisErgebnis>;
}

export type AndroidEingabe = { nonce: string; integrityToken: string };
export type IosEingabe = {
  nonce: string;
  schluesselId: string;
  // Genau eines von beiden: die erste Bestätigung eines neuen Schlüssels oder die Assertion eines bekannten
  attestation?: string;
  assertion?: string;
};

// Die Parameter, die die App für ihren Aufruf beim Betriebssystem braucht; sie stehen in der Antwort der Herausforderung
export type PlattformParameter =
  | { plattform: "android"; paketname: string }
  | { plattform: "ios"; appId: string; umgebung: "production" | "development" };
