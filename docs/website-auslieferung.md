# Auslieferung der Website

Die öffentlichen Seiten der Website sind fertige HTML-Dateien (#351). Besucher belasten die Datenbank nicht: Ein Host liefert die Dateien aus, die API erzeugt sie nur. Dieses Dokument beschreibt den Ablauf, die Konfiguration und einen **Vorschlag** für den Edge-Caddy. Nichts davon ist im Repo umgesetzt: `deploy/edge/cevi-os.caddy` und `deploy/docker-compose.prod.yml` bleiben unverändert, und Domain (#68) und Ort der Dateien stehen noch nicht fest.

## Ablauf

1. Die Redaktion veröffentlicht eine Version einer Seite (#350). Die Routen melden danach ein Website-Ereignis (`src/website/ereignisse.ts`).
2. Der Abgleich (`src/website/abgleich.ts`) läuft beim Start, bei jedem Ereignis der Abteilung und alle 10 Minuten. Er liest die Seiten, die veröffentlichten Versionen und die Daten für Bausteine (Medien, Personen, Leitungsteams) und erzeugt daraus mit dem Renderer (`src/website/rendern.ts`) die Dateien.
3. Er schreibt nur, was sich geändert hat: Der SHA-256 der erzeugten Datei steht an der Seite (`seite.ausgabe_hash`, `seite.ausgabe_am`, Migration 0041). Fehlt eine Datei, schreibt er sie neu.
4. Er löscht Seitendateien (`…/index.html`), die zu keiner öffentlichen Seite mehr gehören: zurückgezogen, gelöscht, nicht mehr öffentlich oder mit neuer Adresse. Andere Dateien im Verzeichnis lässt er in Ruhe.
5. Ein Lauf hält eine Sperre in der Datenbank (`pg_try_advisory_lock`); läuft schon einer, endet der zweite sofort. Ereignisse während eines Laufs lösen genau einen weiteren Lauf aus. Ein Fehler beim Schreiben oder Löschen einer Datei erscheint nur im Log (Ereignis `website_ausgabe`, Seiten-ID und Fehlercode, nie Inhalt) und bricht den Lauf nicht ab; der nächste Lauf versucht es wieder.

Erzeugt werden:

| Datei                  | Inhalt                                                                                                                                 |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `<adresse>/index.html` | eine öffentliche, veröffentlichte Seite; die Seite mit der Adresse `start` auf der obersten Ebene ist `index.html` und die Adresse `/` |
| `sitemap.xml`          | nur öffentliche Seiten mit Datei                                                                                                       |
| `robots.txt`           | sperrt `/api/` und `/admin` und nennt die Sitemap; keine einzelne Seite, damit geschützte Adressen nicht verraten werden               |
| `404.html`             | Fehlerseite mit der Navigation                                                                                                         |
| `website/website.css`  | Platzhalter-Stil aus `apps/api/public/website/website.css`; das Design ersetzt diese Datei                                             |

## Was nie im HTML steht

- Seiten, die nicht `oeffentlich` sind, und Seiten ohne veröffentlichte Version: keine Datei, kein Eintrag in Navigation und Sitemap.
- Bausteine mit engerer Sichtbarkeit (angemeldet oder Tags): nur ein leerer Platzhalter `<div data-geschuetzt="<ID>"></div>`, ohne Typ und Inhalt. Das Nachladen nach der Anmeldung baut #354.
- Medien, die nicht `oeffentlich` sind oder zu einer anderen Abteilung gehören: Der Baustein entfällt.
- Telefon, E-Mail und Foto von Personen: Kontaktperson und Leitungsteam zeigen nur den Cevi-Namen und die Funktion (die Rolle an der Gruppe). Personen ohne Cevi-Namen, deaktivierte und gesperrte Konten erscheinen nicht. Das gilt, bis der Nutzer anders entscheidet.
- Der Renderer maskiert jede Zeichenkette, lässt nur Adressen mit `https:`, `mailto:`, `tel:` und Seitenpfaden zu und lädt nichts von aussen: keine Schriften, keine Einbettungen, kein Skript, kein Tracking. Ein Meta-CSP (`default-src 'none'; style-src 'self'; img-src 'self'; …`) ist eine zweite Schicht neben den Antwortköpfen des Hosts.

Bilder und Dateien sind Verweise auf `/api/v1/medien/<ID>` (öffentliche Medien, 5 Minuten Cache, Entscheid A7 des Plans). Die Website und die API müssen deshalb unter derselben Domain laufen.

## Konfiguration

Alle drei Variablen oder keine; mit einzelnen startet die API nicht. Ohne sie läuft die Erzeugung nicht (Log `website_ausgabe`, Art `aus`).

| Variable               | Bedeutung                                                                                                                                                               |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WEBSITE_AUSGABE_PFAD` | Verzeichnis für die Dateien. Ein eigenes Verzeichnis nur für die Website: Der Abgleich löscht dort `index.html`-Dateien, die er nicht mehr braucht.                     |
| `WEBSITE_ABTEILUNG_ID` | ID der Abteilung, deren Seiten erscheinen. Eine Datenbank kann mehrere Abteilungen haben (zum Beispiel die Demo-Abteilung); eine Website hat eine.                      |
| `WEBSITE_BASIS_URL`    | Adresse der Website, etwa `https://www.example.org`; in Produktion nur `https`. Daraus entstehen `canonical` und die Sitemap. Pfad und Schrägstrich am Ende fallen weg. |

`deploy/.env.example` und `deploy/docker-compose.prod.yml` führen die Variablen noch nicht: Sie hängen vom Ort der Dateien ab (siehe unten) und werden erst mit dieser Entscheidung ergänzt.

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
			Content-Security-Policy "default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
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
	}
}
```

Warum so:

- **Auslieferung:** `file_server` liefert nur Dateien unter `root` aus (Caddy bereinigt den Pfad). Vor dem Einsatz mit einer Anfrage wie `/../etc/passwd` und `/.tmp-x` prüfen. `try_files` macht aus `/stufen/woelfe` die Datei `stufen/woelfe/index.html`; die Startseite ist `index.html`.
- **Sicherheits-Header:** Wie bei der API (HSTS, `nosniff`, kein Referrer, kein `Server`). Die CSP gilt für die erzeugten Seiten und deckt sich mit dem Meta-CSP des Renderers; sie ist strenger als die Seiten brauchen. Mit #354 (Skript zum Nachladen geschützter Bausteine) kommt `script-src 'self'` und `connect-src 'self'` dazu.
- **Cache:** `no-cache` heisst nicht «nie speichern», sondern «vor jeder Verwendung nachfragen». Das ist günstig (Antwort 304) und zeigt eine neu veröffentlichte Seite sofort. Das Stylesheet darf eine Stunde liegen bleiben. Hinter einem CDN könnten die Seiten länger liegen, dann müsste der Abgleich es benachrichtigen; das ist hier nicht vorgesehen.
- **Pfad-Hygiene:** Die API-Pfade stehen vor den Dateien, damit eine Seite nie eine API-Adresse überdeckt. Die Liste in `@api` entspricht `RESERVIERTE_ADRESSEN` in `src/website/seiten.ts`; kommt dort eine Adresse dazu, muss sie hier mit.
- **Unbekannte Adressen:** `404.html` mit der Navigation und dem Status 404. Geschützte Seiten sind für Besucher nicht von unbekannten zu unterscheiden (bis #354 eine Hülle mit Weiterleitung auf die Anmeldung baut).

## Entwicklung und Testadresse

Ohne Caddy: `WEBSITE_AUSGABE_PFAD` auf ein lokales Verzeichnis setzen und es mit einem beliebigen statischen Server ausliefern, der `/api/*` an die API weitergibt (damit die Bilder laden). Die Variante «die API liefert die Dateien selbst aus» (`WEBSITE_API_AUSLIEFERN`) ist noch nicht gebaut.

## Offene Punkte

- Domain (#68), Ort der Dateien (Volume im Stack, Bucket oder anderer Host) und Änderung am Edge-Caddy: offen, blockieren nicht.
- Die Seite mit der Adresse `start` ist die Startseite: eine Annahme, bis der Nutzer die Startseite bestätigt oder anders benennt (`STARTSEITE` in `src/website/rendern.ts`).
- Ob Telefon, E-Mail und Foto von Leitenden erscheinen dürfen, entscheidet der Nutzer (Plan, Frage 2).
- Vorschau-Route für Entwürfe (`GET /api/v1/redaktion/seiten/{id}/vorschau`) und `WEBSITE_API_AUSLIEFERN` sind nicht Teil dieses Schnitts.
