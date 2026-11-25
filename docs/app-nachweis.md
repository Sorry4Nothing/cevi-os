# App-Nachweis: Anleitung für die App-Entwicklung

Entscheid vom 25.11.2026, Issue #785. Gilt für die Apps `cevi-os-android` und `cevi-os-ios`. Das Backend ist fertig; die Apps bauen den Ablauf ein, sobald sie so weit sind. Bis der Betreiber `APP_NACHWEIS` auf `pruefen` oder `pflicht` stellt, ändert sich für die Apps nichts ([betrieb.md](betrieb.md), Abschnitt «App-Nachweis»).

**Stand der Prüfung.** Der Server ist gegen selbst erzeugte Fixtures getestet. Eine echte Antwort von Google Play Integrity oder Apple App Attest gab es noch nie. Wer den Ablauf zum ersten Mal mit einer echten App fährt, tut das im Modus `pruefen` und liest das Log des Servers (`app_nachweis`, Feld `grund`).

## Warum

Der Server erkannte die App am Header `Origin: cevi-os://`. Den kann jeder setzen. Wer ein Passwort kennt, bekam so eine Sitzung ohne zweiten Faktor. Neu belegt die App mit dem Betriebssystem (Google Play Integrity, Apple App Attest), dass sie die echte App auf einem echten Gerät ist. An den Rechten ändert das nichts: Eine App-Sitzung bleibt eine Sitzung ohne zweiten Faktor, ohne Verwaltung und ohne Recht mit «erweitert».

## Ablauf in drei Schritten

```
App                                   Server
 |  1. POST /api/v1/app/nachweis/challenge  { plattform }
 |  <-- { nonce, laeuftAb, ...Parameter }
 |  2. Beleg beim Betriebssystem holen, gebunden an nonce und Benutzername
 |  3. POST /api/v1/app/nachweis  { plattform, nonce, benutzername, Beleg }
 |  <-- { ticket, laeuftAb }
 |  4. POST /api/auth/sign-in/username     Header X-Cevi-Nachweis: <ticket>
 |  <-- Sitzung (clientArt: app_nachgewiesen)
```

Alle drei Aufrufe laufen ohne Sitzung. Alle brauchen wie jeder Aufruf `X-App-Version`. Die Anmeldung trägt weiter `Origin: cevi-os://` (der Expo-Client meldet es in `expo-origin`), dazu das Ticket.

**Regeln:**

- Die Herausforderung (`nonce`) gilt **5 Minuten** und **für einen Versuch**. Ein gescheiterter Nachweis verbraucht sie; die App holt eine neue.
- Das Ticket gilt **2 Minuten**, **einmal** und nur für den **Benutzernamen**, mit dem es ausgestellt wurde. Auch eine Anmeldung mit falschem Passwort verbraucht es. Jeder Anmeldeversuch beginnt darum mit einer neuen Herausforderung.
- Holt die App den Nachweis, wenn die Person auf «Anmelden» tippt (Benutzername ist dann bekannt), dauert das für die Person nur einen Augenblick. Nicht vorab auf Vorrat holen: Das Ticket läuft ab.
- Ohne eingeschalteten Nachweis antwortet die Herausforderung mit **404 `NICHT_GEFUNDEN`**. Die App meldet sich dann wie bisher an, ohne Ticket. So läuft dieselbe App vor und nach dem Umschalten.

## Die Bindung

Der Beleg des Betriebssystems gilt nur für diese Herausforderung und diesen Benutzernamen. Die App rechnet:

```
bindung = SHA-256( nonce + "\n" + benutzername in Kleinbuchstaben )     // 32 Byte, UTF-8
```

- **Android** gibt `base64url(bindung)` (ohne `=`, 43 Zeichen) als `nonce` an Play Integrity.
- **iOS** gibt `bindung` (die 32 Byte) als `clientDataHash` an App Attest.

Der Benutzername ist der, den die Person eingibt und den die Anmeldung schickt; Gross- und Kleinschreibung zählt nicht, Leerzeichen am Rand gibt es nicht.

## Android (Google Play Integrity)

1. Herausforderung holen:

```http
POST /api/v1/app/nachweis/challenge
Content-Type: application/json
X-App-Version: 1.2.0

{ "plattform": "android" }
```

```json
{
  "nonce": "mMn3wC0Rk9fVZ1Qp0eB8yq5H1b5d2xWw6tq3T8aJm0A",
  "laeuftAb": "2026-11-25T12:05:00.000Z",
  "plattform": "android",
  "paketname": "ch.example.cevios"
}
```

2. Integrity-Token anfordern (klassische Anfrage der Play Integrity API), mit der Bindung als `nonce`:

```kotlin
val bindung = MessageDigest.getInstance("SHA-256")
    .digest("$nonce\n${benutzername.lowercase()}".toByteArray(Charsets.UTF_8))
val nonceFuerGoogle = Base64.encodeToString(
    bindung, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING,
)
val anfrage = IntegrityTokenRequest.builder().setNonce(nonceFuerGoogle).build()
val token = IntegrityManagerFactory.create(context).requestIntegrityToken(anfrage).await().token()
```

3. Nachweis schicken:

```http
POST /api/v1/app/nachweis
Content-Type: application/json
X-App-Version: 1.2.0

{
  "plattform": "android",
  "nonce": "mMn3wC0Rk9fVZ1Qp0eB8yq5H1b5d2xWw6tq3T8aJm0A",
  "benutzername": "anna",
  "integrityToken": "<Token von Google>"
}
```

Der Server lässt das Token von Google dekodieren und prüft: gleiche Nonce, Paket, Zeitstempel (höchstens 5 Minuten alt), `PLAY_RECOGNIZED`, Zertifikat der App-Signatur aus der Liste des Betreibers, Gerätesiegel (mindestens `MEETS_DEVICE_INTEGRITY`).

## iOS (Apple App Attest)

Zwei Fälle: Das erste Mal (oder nach einem Fehler) bestätigt die App einen **neuen Schlüssel** (Attestation); danach belegt sie jede Anmeldung mit einer **Assertion** dieses Schlüssels.

1. Herausforderung holen: wie bei Android, mit `{ "plattform": "ios" }`. Antwort:

```json
{
  "nonce": "mMn3wC0Rk9fVZ1Qp0eB8yq5H1b5d2xWw6tq3T8aJm0A",
  "laeuftAb": "2026-11-25T12:05:00.000Z",
  "plattform": "ios",
  "appId": "ABCDE12345.ch.example.cevios",
  "umgebung": "production"
}
```

2. Beleg beim Betriebssystem holen:

```swift
let bindung = Data(SHA256.hash(data: Data("\(nonce)\n\(benutzername.lowercased())".utf8)))
let dienst = DCAppAttestService.shared

// Erstes Mal: Schlüssel anlegen und bestätigen lassen; schluesselId im Schlüsselbund merken
let schluesselId = try await dienst.generateKey()          // base64
let attestation = try await dienst.attestKey(schluesselId, clientDataHash: bindung)

// Jedes weitere Mal: mit dem gemerkten Schlüssel
let assertion = try await dienst.generateAssertion(schluesselId, clientDataHash: bindung)
```

3. Nachweis schicken, mit `attestation` **oder** `assertion` (genau eines):

```http
POST /api/v1/app/nachweis
Content-Type: application/json
X-App-Version: 1.2.0

{
  "plattform": "ios",
  "nonce": "mMn3wC0Rk9fVZ1Qp0eB8yq5H1b5d2xWw6tq3T8aJm0A",
  "benutzername": "anna",
  "schluesselId": "<base64 aus generateKey>",
  "attestation": "<base64 von attestKey>"
}
```

Merke die `schluesselId` erst, wenn der Server den Nachweis mit **200** angenommen hat. Der Server prüft bei der Attestation die Kette bis zur Wurzel von Apple, die Nonce, die App-Kennung (`appId` aus der Herausforderung), den Zähler 0 und die Umgebung, und legt den öffentlichen Schlüssel ab. Bei der Assertion prüft er die Signatur und dass der Zähler gegenüber dem letzten Nachweis steigt (der Zähler kommt vom Betriebssystem, die App zählt nichts selbst).

Ein Schlüssel wird nur **einmal** bestätigt. Antwortet der Server auf eine Attestation mit 401 (zum Beispiel, weil die Antwort der ersten Bestätigung verloren ging), legt die App einen **neuen** Schlüssel an. Antwortet er auf eine Assertion mit 401 (Schlüssel dem Server unbekannt, etwa nach dem Löschen des Kontos, oder Zähler zurück), verwirft die App den gemerkten Schlüssel und bestätigt einen neuen.

## Anmelden mit dem Ticket

```http
POST /api/auth/sign-in/username
Content-Type: application/json
Origin: cevi-os://
X-App-Version: 1.2.0
X-Cevi-Nachweis: Zm9vYmFyLWJhei1xdXV4LWVpbi10aWNrZXQtMTIzNDU

{ "username": "anna", "password": "…" }
```

Antwort wie bisher (Sitzung im `Set-Cookie`). `GET /api/v1/ich` zeigt in `clientArt`, woher die Sitzung kommt:

| `clientArt`        | Bedeutung                                                                                    |
| ------------------ | -------------------------------------------------------------------------------------------- |
| `web`              | Anmeldung im Browser oder ohne `Origin` der App                                              |
| `app_nachgewiesen` | Anmeldung der App mit gültigem Nachweis                                                      |
| `app_ungeprueft`   | `Origin` der App ohne gültigen Nachweis; nur mit `APP_NACHWEIS` `aus` oder `pruefen` möglich |

Die App zeigt `clientArt` nicht an und leitet keine Rechte daraus ab. Rechte, zweiter Faktor und alles andere bleiben, wie sie sind.

## Fehler

Der Server nennt keinen Grund über das hinaus, was hier steht (der Grund steht nur in seinem Log).

| Aufruf          | Status | `code`                          | Bedeutung und was die App tut                                                                                                                                                              |
| --------------- | ------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Herausforderung | 404    | `NICHT_GEFUNDEN`                | Der Nachweis ist nicht eingeschaltet. Ohne Ticket anmelden, wie bisher.                                                                                                                    |
| Herausforderung | 429    | `ZU_VIELE_ANFRAGEN`             | Zu viele Anfragen von dieser Adresse (30 je 15 Minuten). Später nochmals.                                                                                                                  |
| Herausforderung | 400    | `UNGUELTIGE_EINGABE`            | `plattform` fehlt oder ist unbekannt.                                                                                                                                                      |
| Nachweis        | 401    | `APP_NACHWEIS_UNGUELTIG`        | Der Beleg ist ungültig, oder die Herausforderung ist unbekannt, abgelaufen oder verbraucht. Neue Herausforderung holen. Bei iOS siehe oben (neuer Schlüssel).                              |
| Nachweis        | 503    | `APP_NACHWEIS_NICHT_ERREICHBAR` | Google war nicht erreichbar. Mit neuer Herausforderung später nochmals.                                                                                                                    |
| Nachweis        | 400    | `UNGUELTIGE_EINGABE`            | Falsch aufgebauter Body (Nonce nicht 43 Zeichen, fehlendes Feld, beide von `attestation` und `assertion`, Token über 16 KB).                                                               |
| Nachweis        | 429    | `ZU_VIELE_ANFRAGEN`             | Wie oben.                                                                                                                                                                                  |
| Anmeldung       | 401    | `APP_NACHWEIS_FEHLT`            | Nur im Modus `pflicht`: Kein Header `X-Cevi-Nachweis`. Herausforderung und Nachweis holen und nochmals anmelden.                                                                           |
| Anmeldung       | 401    | `APP_NACHWEIS_UNGUELTIG`        | Nur im Modus `pflicht`: Das Ticket ist unbekannt, abgelaufen, schon benutzt oder gehört zu einem anderen Benutzernamen. Wie oben.                                                          |
| Anmeldung       | 401    | `ANMELDUNG_FEHLGESCHLAGEN`      | Wie bisher: falsches Passwort, Wartezeit, deaktiviertes Konto und weitere. Nicht vom Nachweis zu unterscheiden. Für den nächsten Versuch ein neues Ticket holen (das alte ist verbraucht). |

Statuscodes und Felder im Detail: [api/openapi.yaml](api/openapi.yaml) (`appNachweisChallenge`, `appNachweisPruefen`, `anmeldenMitBenutzername`).

## Was die App nie tun darf

- Das Token, die Attestation, das Ticket oder die Nonce loggen oder in einem Absturzbericht mitschicken.
- Das Ticket zwischenspeichern oder für eine zweite Anmeldung aufbewahren.
- Aus `clientArt` Rechte oder Oberflächen ableiten.
