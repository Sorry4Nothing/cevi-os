# Auslieferung der Website

Die öffentlichen Seiten der Website sind fertige HTML-Dateien (#351). Besucher belasten die Datenbank nicht: Ein Host liefert die Dateien aus, die API erzeugt sie nur. Dieses Dokument beschreibt den Ablauf, die Konfiguration und einen **Vorschlag** für den Edge-Caddy. Der Code der Erzeugung ist umgesetzt und läuft, sobald die drei `WEBSITE_*`-Variablen gesetzt sind. Der Betrieb ist es nicht: `deploy/edge/cevi-os.caddy` und `deploy/docker-compose.prod.yml` bleiben unverändert, und Domain (#68) und Ort der Dateien stehen noch nicht fest. In Produktion läuft die Erzeugung darum heute nicht (Log `website_ausgabe`, Art `aus`).

## Ablauf

1. Eine Person mit dem Recht «Seiten veröffentlichen» (Webmaster) oder die Stufenleitung veröffentlicht eine Version einer Seite (#350). Die Routen melden danach ein Website-Ereignis (`src/website/ereignisse.ts`).
2. Der Abgleich (`src/website/abgleich.ts`) läuft beim Start, bei jedem Ereignis der Abteilung und alle 10 Minuten. Er liest die Seiten, die veröffentlichten Versionen und die Daten für Bausteine (Medien, Personen, Leitungsteams) und erzeugt daraus mit dem Renderer (`src/website/rendern.ts`) die Dateien.
3. Er schreibt nur, was sich geändert hat: Der SHA-256 der erzeugten Datei steht an der Seite (`seite.ausgabe_hash`, `seite.ausgabe_am`, Migration 0041). Fehlt eine Datei, schreibt er sie neu.
4. Er löscht Seitendateien (`…/index.html`), die zu keiner öffentlichen Seite mehr gehören: zurückgezogen, gelöscht, nicht mehr öffentlich oder mit neuer Adresse. Andere Dateien im Verzeichnis lässt er in Ruhe.
5. Unter einer Informationssperre mit «Öffentliche Website vom Netz nehmen» läuft der Abgleich nicht (siehe «Wartungsmodus und Informationssperre»).
6. Ein Lauf hält eine Sperre in der Datenbank (`pg_try_advisory_lock`); läuft schon einer, endet der zweite sofort. Ereignisse während eines Laufs lösen genau einen weiteren Lauf aus. Ein Fehler beim Schreiben oder Löschen einer Datei erscheint nur im Log (Ereignis `website_ausgabe`, Seiten-ID und Fehlercode, nie Inhalt) und bricht den Lauf nicht ab; der nächste Lauf versucht es wieder.

Erzeugt werden:

| Datei                       | Inhalt                                                                                                                                 |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `<adresse>/index.html`      | eine öffentliche, veröffentlichte Seite; die Seite mit der Adresse `start` auf der obersten Ebene ist `index.html` und die Adresse `/` |
| `sitemap.xml`               | nur öffentliche Seiten mit Datei                                                                                                       |
| `robots.txt`                | sperrt `/api/` und `/admin` und nennt die Sitemap; keine einzelne Seite, damit geschützte Adressen nicht verraten werden               |
| `404.html`                  | Fehlerseite mit den Hauptpunkten (Design W4)                                                                                           |
| `500.html`, `wartung.html`  | Seiten für Serverfehler und Wartung (Design W4); der Host liefert sie bei 5xx und 503 (Vorschlag unten)                                |
| `website/website.css`       | Stil nach dem Design «Cevi Web» aus `apps/api/public/website/website.css` (Aufbau: [website-design.md](website-design.md))             |
| `website/*.js`              | die Skripte aus `apps/api/public/website/` (#354, #529): `geschuetzt.js`, `knoten.js`, `weiter.js`, `anmelden.js`, `ui.js`             |
| `anmelden/index.html`       | die Anmeldeseite (#354), Adresse `/anmelden`                                                                                           |
| `weiterleitungen.caddy`     | Weiterleitungen alter Adressen als `redir`-Zeilen (#356); nur wenn es Weiterleitungen gibt, ein Vorschlag, nicht eingebunden           |
| `<alte-adresse>/index.html` | Rückfallseite je alter Adresse (#356): `meta refresh` und Link, kein Skript, für einen Host ohne die Caddy-Zeilen                      |
| `<adresse>/index.html`      | auch für ganz geschützte Seiten mit veröffentlichter Version: nur eine Hülle ohne Titel und Inhalt (siehe unten)                       |

## Was nie im HTML steht

- Seiten ohne veröffentlichte Version: keine Datei, kein Eintrag in Navigation und Sitemap.
- Seiten, die nicht `oeffentlich` sind: keine Seitendatei mit Inhalt. Mit veröffentlichter Version gibt es nur eine Hülle (Titel «Geschützte Seite», Hinweis, Link zur Anmeldung, `noindex`); kein Titel, kein Inhalt, nie in Navigation oder Sitemap. Die Adresse einer solchen Seite ist damit für Besucher erkennbar (Annahme A6 des Plans).
- Bausteine mit engerer Sichtbarkeit (angemeldet oder Tags): nur ein Platzhalter `<div data-geschuetzt="<ID>">` mit dem Hinweis «Nur angemeldet sichtbar» und dem Link «Anmelden», ohne Typ und Inhalt (Design W10). Das Skript lädt sie nach der Anmeldung nach (siehe «Geschützte Bausteine und Anmeldung»).
- Medien, die nicht `oeffentlich` sind oder zu einer anderen Abteilung gehören: Der Baustein entfällt.
- Telefon, E-Mail und Foto von Personen: Kontaktperson und Leitungsteam zeigen nur den Cevi-Namen und die Funktion (die Rolle an der Gruppe). Personen ohne Cevi-Namen, deaktivierte und gesperrte Konten erscheinen nicht. Das gilt, bis der Nutzer anders entscheidet.
- Der Renderer maskiert jede Zeichenkette, lässt nur Adressen mit `https:`, `mailto:`, `tel:` und Seitenpfaden zu und lädt nichts von aussen: keine Schriften, keine Einbettungen, kein Skript, kein Tracking. Ein Meta-CSP (`default-src 'none'; style-src 'self'; img-src 'self'; …`) ist eine zweite Schicht neben den Antwortköpfen des Hosts. Nur Seiten mit Platzhalter, die Hülle und die Anmeldeseite laden ein Skript und erlauben deshalb zusätzlich `script-src 'self'; connect-src 'self'`; es gibt nie ein Inline-Skript.

Bilder und Dateien sind Verweise auf `/api/v1/medien/<ID>` (öffentliche Medien, 5 Minuten Cache, Entscheid A7 des Plans). Die Website und die API müssen deshalb unter derselben Domain laufen.

## Geschützte Bausteine und Anmeldung

- **Nachladen:** `GET /api/v1/website/inhalt?pfad=/a/b` (hinter der Sitzung) liefert für die Seite die Bausteine, die die Person laut Sichtbarkeit sehen darf, als JSON-Knoten (`{ tag, attr?, kinder? }` und Texte), nie als HTML. Ohne Sitzung 401; unbekannte Seite, andere Abteilung und fehlendes Recht antworten gleich mit 404. `Cache-Control: private, no-store`.
- **Skript:** `website/geschuetzt.js` (ES-Modul, eigene Datei) ersetzt die Platzhalter durch DOM-Knoten (`website/knoten.js`: feste Liste von Elementen und Attributen, Text nur als Textknoten, nie `innerHTML`). Zustände nach dem Design W10: Laden (Skeleton nach 200 ms, `aria-busy`, Live-Region, nach 4 Sekunden «Das dauert länger als sonst.», nach 15 Sekunden Abbruch mit Fehler), nicht angemeldet (der Hinweis des Platzhalters kommt zurück), Fehler mit «Nochmals versuchen», kein Zugriff. Bei einer Hülle ersetzt es nach der Anmeldung den ganzen Inhalt der Seite.
- **Anmeldung:** `/anmelden` ist eine erzeugte Datei (kein Datenbankzugriff beim Abruf) mit dem Skript `website/anmelden.js`. Es ruft dieselben Aufrufe wie die Verwaltung unter `/api/auth` (Rate-Limit und Sperre nach Fehlversuchen gelten dort) und führt danach auf `weiter`. `weiter` ist eine Allowlist (`website/weiter.js`): nur `/` oder Adressstücke aus `a-z`, `0-9` und `-`, nie eine reservierte Adresse; alles andere führt auf `/`.
- **Gleiche Herkunft:** Die API prüft bei `POST` den `Origin` (`BETTER_AUTH_URL` und `BETTER_AUTH_TRUSTED_ORIGINS`). Die Website muss unter derselben Domain wie die API laufen; eine Testadresse mit anderer Domain braucht einen Eintrag in `BETTER_AUTH_TRUSTED_ORIGINS` (und dann ein Cookie für diese Domain, also einen Proxy auf dieselbe Herkunft).

## Konfiguration

Alle drei Variablen oder keine; mit einzelnen startet die API nicht. Ohne sie läuft die Erzeugung nicht (Log `website_ausgabe`, Art `aus`).

| Variable               | Bedeutung                                                                                                                                                               |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WEBSITE_AUSGABE_PFAD` | Verzeichnis für die Dateien. Ein eigenes Verzeichnis nur für die Website: Der Abgleich löscht dort `index.html`-Dateien, die er nicht mehr braucht.                     |
| `WEBSITE_ABTEILUNG_ID` | ID der Abteilung, deren Seiten erscheinen. Eine Datenbank kann mehrere Abteilungen haben (zum Beispiel die Demo-Abteilung); eine Website hat eine.                      |
| `WEBSITE_BASIS_URL`    | Adresse der Website, etwa `https://www.example.org`; in Produktion nur `https`. Daraus entstehen `canonical` und die Sitemap. Pfad und Schrägstrich am Ende fallen weg. |

Die Vorlage für die lokale Entwicklung mit Kommentar steht in `apps/api/.env.example`. `deploy/.env.example` und `deploy/docker-compose.prod.yml` führen die Variablen noch nicht: Der Compose-Stack reicht nur die Variablen durch, die er aufzählt, und der Ort der Dateien (siehe «Offene Punkte») steht nicht fest. Mit dieser Entscheidung kommen dazu: die drei Variablen in beiden Dateien, ein beschreibbares Volume für den Dienst `api` (er läuft mit `read_only: true`) und der lesende Einbau im Edge-Caddy.

## Vorschau im Editor

Entwürfe erscheinen nie in den erzeugten Dateien. Der Editor zeigt sie über `GET /api/v1/redaktion/seiten/{id}/vorschau` (optional `?version=n` für eine frühere Version), in einem Rahmen der Verwaltung (#358):

- Es ist derselbe Renderer wie bei der Auslieferung, aber mit allen Bausteinen offen, auch denen mit engerer Sichtbarkeit: Die Vorschau sieht nur, wer den Entwurf der Seite lesen darf (dieselben Rechte wie der Entwurf; Fremdabteilung 404, ohne Recht 403).
- Die Antwort ist `private, no-store`, ohne Skript, und nur die eigene Verwaltung darf sie einrahmen (`frame-ancestors self`). Den Stil liefert die Verwaltung als `/admin/website-vorschau.css`; die API liefert die Website sonst nie aus.
- Abfragen: Seite und Recht (2), bei `?version=` eine weitere, die Daten der Bausteine gebündelt (höchstens 3) und die Stufenfelder aus dem Zwischenspeicher. Es gibt keinen Abruf im Takt, nur auf Klick.

## Stufenfelder und der Baustein «Termin-Liste»

- **Stufenfelder** (`stufenfakten`, #355): Treffzeit, Treffpunkt, Schluss und «mitnehmen» der nächsten Daten kommen aus `programm_eckdaten`. Der Abgleich holt sie mit einer Abfrage für alle Seiten (`ladeStufenfakten`); das Nachladen geschützter Bausteine nutzt einen Zwischenspeicher je Seite im Prozess (5 Minuten). Speichert die Stufenleitung Eckdaten, meldet die Route `seite_geaendert` für die Stufenseite, und der Abgleich erzeugt sie neu; sonst genügt der Lauf alle 10 Minuten (Datumswechsel).
- **Termin-Liste** (`terminliste`): Das Schema des Bausteins gibt es (3 bis 10 Termine, optional ein Tag), der Renderer zeigt ihn aber **noch nicht**: Er liefert `null`, bis der Auftrag Termine die Daten einhängt. Wer den Baustein auf eine Seite legt, sieht ihn in der Vorschau und auf der Seite nicht. Das ist dokumentiert, nicht gebaut.

## Wartungsmodus und Informationssperre

- **Wartungsmodus** des Bereichs `website`: Alle schreibenden Anfragen der Website-Verwaltung antworten 503 `IN_WARTUNG` (kein Speichern, kein Veröffentlichen); die erzeugten Dateien bleiben stehen, und der Abgleich läuft weiter.
- **Informationssperre** des Bereichs `website` oder `alles`: Die Routen antworten 423 `GESPERRT`. Mit dem Wunsch «Öffentliche Website vom Netz nehmen» löscht der Server alle Dateien in `WEBSITE_AUSGABE_PFAD` ausser `weiterleitungen.caddy` und schreibt eine neutrale Hinweisseite (`index.html`, `404.html`); der Abgleich erzeugt in dieser Zeit nichts. Beim Aufheben löscht er die Hinweisseiten und löst den Abgleich aus. Ablauf und Rechte: `docs/betrieb.md`, «Wartungsmodus» und «Informationssperre».

## Neuaufbau und Backup

Der Ausgabeordner ist aus der Datenbank ableitbar und wird **nicht gesichert** (`deploy/backup.sh` sichert nur die Datenbank; die Seiten und Versionen stehen im Dump, die Dateien nicht).

- **Fehlende Datei oder leerer Ordner:** nichts von Hand tun. Der Abgleich schreibt jede fehlende Datei beim nächsten Lauf neu (beim Start der API, bei jedem Ereignis, spätestens nach 10 Minuten). Wer es beschleunigen will, startet die API neu.
- **Neuaufbau erzwingen** (etwa nach einem Fehler im Renderer): Den Inhalt von `WEBSITE_AUSGABE_PFAD` löschen (nicht das Verzeichnis selbst, wenn es ein Volume ist) und die API neu starten. Der erste Lauf schreibt alles neu. Nach einem Release mit geändertem Renderer oder Stil schreibt der erste Lauf die geänderten Dateien von selbst, denn der Hash der erzeugten Datei ändert sich.
- **Nach einer Wiederherstellung der Datenbank:** Der Abgleich gleicht die Dateien mit dem wiederhergestellten Stand ab, schreibt Geändertes und löscht Seitendateien, die dort nicht mehr öffentlich sind.
- **Prüfen:** Ein erfolgreicher Lauf schreibt nichts ins Log. Im Log (journald) stehen nur Fehler als Ereignis `website_ausgabe` (Art, Seiten-ID und Fehlercode, nie Pfad oder Inhalt) und beim Start `art: aus`, wenn die Erzeugung nicht läuft. Ob die Dateien aktuell sind, zeigt ein Blick in den Ordner oder die Seite im Browser.

## Datenbanklast

Besucher fragen die Datenbank nie ab. Ein Lauf des Abgleichs (beim Start, nach einem Ereignis, alle 10 Minuten) liest in gebündelten Abfragen die Seiten der Abteilung, die veröffentlichten Versionen aller öffentlichen Seiten, die Medien, Personen und Tags der Bausteine, die Stufenfelder und die Weiterleitungen, nie eine Abfrage je Seite oder Baustein; geschrieben wird nur, wenn sich eine Datei ändert (ein `UPDATE` des Hashs je geänderter Seite). Das Nachladen geschützter Bausteine ist eine Anfrage je Seitenaufruf einer angemeldeten Person (alle Seiten der Abteilung für die Adresse, die Version, die Daten der sichtbaren Bausteine) und nutzt für die Stufenfelder einen Zwischenspeicher von 5 Minuten.

## Sicherheit der Ausgabe

- Der Pfad jeder Datei entsteht aus geprüften Adressen (`a-z`, `0-9`, `-`, höchstens 60 Zeichen je Stück, höchstens 5 Ebenen) und läuft durch `istAusgabePfad`: nur Kleinbuchstaben, Ziffern, `-` und Endungen, nie ein Punkt am Anfang, nie `..`, nie ein Schrägstrich am Anfang oder ein Laufwerk. Zusätzlich muss das Ziel unter dem Ausgabeverzeichnis liegen.
- Reservierte Adressen auf der obersten Ebene (`api`, `admin`, `health`, `datenschutz`, `konto-loeschen`, `support`, `website`, `anmelden`, `medien`, `ical`) erzeugen nie eine Datei.
- Geschrieben wird in eine Datei mit Namen `.tmp-<Zufall>` im selben Ordner und dann umbenannt (atomar). Wer die Website liest, sieht nie eine halbe Datei. Eine nach einem Absturz liegen gebliebene `.tmp-…`-Datei ist harmlos und taucht in keiner Liste auf; der Host sollte Dateien mit Punkt am Anfang nie ausliefern (siehe Vorschlag).
- Der Dienst `api` läuft mit `read_only: true`. Er braucht für das Ausgabeverzeichnis ein beschreibbares Volume oder einen Bind-Mount; Ort und Hoster sind offen.

## Vorschlag für den Edge-Caddy

Nicht umgesetzt und nicht getestet: vor der Übernahme mit `caddy validate` prüfen (`docs/betrieb.md`, «Edge-Caddy»). Annahmen: Der Edge-Caddy kann die Dateien lesen (der Ordner ist zum Beispiel ein Volume, das die API beschreibt und der Caddy nur lesend einbindet), und die Website läuft unter derselben Domain wie die API.

```caddy
www.example.org {
	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Content-Type-Options nosniff
		Referrer-Policy no-referrer
		-Server
	}

	# Was die API besitzt: Schnittstelle, Verwaltung, Gesundheitsprüfung, Store-Seiten. Gleiche Liste wie die reservierten Adressen
	@api path /api/* /admin /admin/* /health /datenschutz /konto-loeschen /support /ical /ical/*
	handle @api {
		reverse_proxy cevi-os-api:3000
	}

	# Alles andere sind erzeugte Dateien
	handle {
		root * /srv/website
		# Nie Dateien mit Punkt am Anfang (zum Beispiel liegen gebliebene .tmp-…), nie Verzeichnislisten
		@versteckt path_regexp \/\.
		respond @versteckt 404
		header {
			Content-Security-Policy "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
			# Kurz prüfen lassen: Die Dateien ändern sich beim Veröffentlichen, ETag und Last-Modified liefert file_server
			Cache-Control "no-cache"
		}
		header /website/* Cache-Control "public, max-age=3600"
		try_files {path} {path}/index.html
		file_server
	}

	handle_errors {
		@nichtGefunden expression {err.status_code} == 404
		handle @nichtGefunden {
			root * /srv/website
			rewrite * /404.html
			file_server
		}
		# Wartung der API (503) und andere Fehler der Website: eigene Seiten, die Stilvorlage lädt als gewöhnliche Datei
		@wartung expression {err.status_code} == 503
		handle @wartung {
			root * /srv/website
			rewrite * /wartung.html
			file_server
		}
		@fehler expression {err.status_code} >= 500
		handle @fehler {
			root * /srv/website
			rewrite * /500.html
			file_server
		}
	}
}
```

Warum so:

- **Auslieferung:** `file_server` liefert nur Dateien unter `root` aus (Caddy bereinigt den Pfad). Vor dem Einsatz mit einer Anfrage wie `/../etc/passwd` und `/.tmp-x` prüfen. `try_files` macht aus `/stufen/woelfe` die Datei `stufen/woelfe/index.html`; die Startseite ist `index.html`.
- **Sicherheits-Header:** Wie bei der API (HSTS, `nosniff`, kein Referrer, kein `Server`). Die CSP gilt für die erzeugten Seiten und deckt sich mit dem Meta-CSP des Renderers; sie ist strenger als die Seiten brauchen. Für #354 (Skript zum Nachladen geschützter Bausteine, Anmeldeseite) braucht sie `script-src 'self'` und `connect-src 'self'`: im Vorschlag unten enthalten.
- **Cache:** `no-cache` heisst nicht «nie speichern», sondern «vor jeder Verwendung nachfragen». Das ist günstig (Antwort 304) und zeigt eine neu veröffentlichte Seite sofort. Das Stylesheet darf eine Stunde liegen bleiben. Hinter einem CDN könnten die Seiten länger liegen, dann müsste der Abgleich es benachrichtigen; das ist hier nicht vorgesehen.
- **Pfad-Hygiene:** Die API-Pfade stehen vor den Dateien, damit eine Seite nie eine API-Adresse überdeckt. Die Liste in `@api` entspricht `RESERVIERTE_ADRESSEN` in `src/website/seiten.ts`; kommt dort eine Adresse dazu, muss sie hier mit.
- **Unbekannte Adressen:** `404.html` mit der Navigation und dem Status 404. Ganz geschützte Seiten mit veröffentlichter Version liefern die Hülle (Status 200); unbekannte Adressen die `404.html`.

## Entwicklung und Testadresse

Ohne Caddy: `WEBSITE_AUSGABE_PFAD` auf ein lokales Verzeichnis setzen und es mit einem beliebigen statischen Server ausliefern, der `/api/*` an die API weitergibt (damit die Bilder laden). Die API liefert die Website nie selbst aus (eine Variable `WEBSITE_API_AUSLIEFERN` gibt es nicht). Entwürfe zeigt die Vorschau im Editor; wer die erzeugten Seiten ansehen will, braucht den statischen Server.

## Offene Punkte

- Domain (#68), Ort der Dateien (Volume im Stack, Bucket oder anderer Host) und Änderung am Edge-Caddy: offen, entscheidet der Nutzer. Sie blockieren den Code nicht, aber den Betrieb: Erst mit der Entscheidung kommen die drei `WEBSITE_*`-Variablen, das beschreibbare Volume und der lesende Einbau in `deploy/`.
- Die Seite mit der Adresse `start` ist die Startseite: eine Annahme, bis der Nutzer die Startseite bestätigt oder anders benennt (`STARTSEITE` in `src/website/rendern.ts`).
- Ob Telefon, E-Mail und Foto von Leitenden erscheinen dürfen, entscheidet der Nutzer (Plan, Frage 2); bis dahin nur Cevi-Name und Funktion.
- Der Baustein `terminliste` rendert nichts, bis der Auftrag Termine ihn mit Daten füllt (siehe oben).
- Die Datei `weiterleitungen.caddy` und der Caddy-Vorschlag sind nicht gegen einen laufenden Caddy geprüft.
