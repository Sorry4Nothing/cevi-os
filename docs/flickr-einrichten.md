# Fotos aus Flickr einrichten

Die Fotos der Abteilung liegen bei Flickr. Cevi OS zeigt sie direkt auf der Website, **nur für angemeldete Personen**. Es gibt kein gemeinsames Passwort mehr: Wer ein Konto hat, sieht die Fotos, alle anderen sehen «Nur angemeldet sichtbar» mit einem Link zur Anmeldung. Das Konto eines Kindes sieht die Fotos nicht (es sieht nur sein eigenes Kind).

Diese Anleitung enthält **keine Zugangsdaten**. Schlüssel, Secret und Token gehören nur in `deploy/.env` auf dem Server, nie in das Repository, in Issues, in Chats oder in Screenshots.

## So funktioniert es

- Der **Server** holt Alben und Bilder bei Flickr (über die Flickr-API) und reicht die Bilder an die Website weiter. Der Browser verbindet sich nie mit Flickr. Darum bleibt die strenge Inhaltsrichtlinie der Website bei `img-src 'self'`.
- Der Server speichert keine Bilder. Albumlisten und Bildlisten merkt er sich 10 Minuten im Speicher, damit Flickr nicht bei jedem Besuch gefragt wird (Flickr erlaubt rund 3600 Abrufe je Stunde und Schlüssel).
- Welche Alben erscheinen, entscheidet die Abteilung in der Verwaltung unter **Website, Fotos**. Ein neues Album bei Flickr erscheint **nie von selbst**.

## Schritt 1: App bei Flickr erstellen

1. Melde dich bei Flickr mit dem Konto an, dem die Fotos gehören (oder das Zugriff darauf hat).
2. Öffne <https://www.flickr.com/services/apps/create/> und wähle «Request an API Key», dann «Non-Commercial».
3. Gib einen Namen und eine kurze Beschreibung ein (zum Beispiel «Fotos der Abteilung auf der Website»).
4. Flickr zeigt **Key** und **Secret**. Notiere beide an einem sicheren Ort (Passwort-Manager). Das sind `FLICKR_API_KEY` und `FLICKR_API_SECRET`.

## Schritt 2: Lese-Token holen

Ohne Token sieht der Server nur **öffentliche** Fotos. Sollen auch nicht öffentliche Alben erscheinen (zum Beispiel «Mit Link»- oder private Alben), braucht er ein Token, das nur lesen darf. Das Skript holt es auf deinem Rechner, in drei Schritten (OAuth 1.0a):

```sh
FLICKR_API_KEY=<dein Key> FLICKR_API_SECRET=<dein Secret> node apps/api/scripts/flickr-token.mjs
```

1. Das Skript gibt eine Adresse bei Flickr aus. Öffne sie in einem Browser, in dem du bei Flickr angemeldet bist, und gib die Freigabe («Nur lesen»).
2. Flickr zeigt einen Code aus 9 Ziffern. Gib ihn im Skript ein.
3. Das Skript gibt `FLICKR_OAUTH_TOKEN`, `FLICKR_OAUTH_TOKEN_SECRET` und die **Kennung des Kontos** (zum Beispiel `12345678@N00`) aus.

Das Skript speichert nichts und schreibt keine Datei: Es zeigt die Werte nur auf dem Bildschirm. Das Token darf nur lesen; ändern oder löschen kann es nichts. Du kannst es jederzeit bei Flickr widerrufen (Konto, «Apps and Connected Accounts»).

## Schritt 3: Werte auf dem Server eintragen

In `deploy/.env` (nie im Repository) und danach den Server neu starten:

```
FLICKR_API_KEY=
FLICKR_API_SECRET=
FLICKR_OAUTH_TOKEN=
FLICKR_OAUTH_TOKEN_SECRET=
FLICKR_KONTO=
```

- Schlüssel und Secret gehören zusammen, ebenso Token, Token-Secret und `FLICKR_KONTO` (die Kennung des Kontos, dem das Token gehört, aus Schritt 2, zum Beispiel `12345678@N00`); sonst startet der Server nicht und nennt die fehlenden **Namen** (nie die Werte).
- Ohne diese Werte läuft alles weiter, nur ohne Fotos: Die Seite zeigt «Hier gibt es noch keine Fotos.», die Verwaltung eine Anleitung.
- `FLICKR_API_BASIS` und `FLICKR_BILD_BASIS` gibt es nur für Tests und lokale Läufe mit einer Attrappe von Flickr. In Produktion sind sie verboten: Dort sind die Adressen von Flickr fest im Code.

## Schritt 4: Konto und Alben in der Verwaltung wählen

1. Öffne die Verwaltung, **Website, Fotos** (das Recht «Fotoalben verwalten» haben die Abteilungsleitung und die Vorgabe «Webmaster»).
2. Trage die **Kennung des Flickr-Kontos** ein (aus Schritt 2) und speichere.
3. **Verbindung testen** zeigt, ob der Zugang funktioniert (ohne Geheimnisse im Ergebnis).
4. Schalte bei jedem Album **Auf der Website zeigen** ein, das erscheinen soll. Bei vielen Alben hilft die Werkzeugleiste: Suche (Taste «/»), Sicht, Jahr und Sortierung; mit dem Kästchen vor einem Album wählst du mehrere und zeigst sie zusammen (bei mehr als 5 fragt die Seite zuerst nach, weil die Fotos oft Kinder zeigen). Die Alben, die auf der Website erscheinen, stehen im Bereich «Auf der Website» und lassen sich dort per Ziehen oder mit den Pfeilen ordnen; neu gezeigte Alben stehen am Ende. Du kannst jedem Album einen eigenen Titel geben («Mehr», «Titel ändern»).
5. «Album auf Flickr öffnen» ist standardmässig **aus**: Der Link führt aus der Website hinaus zu Flickr, wo andere Regeln gelten. Schalte ihn nur ein, wenn du das willst.

## Schritt 5: Seite auf der Website anlegen

Im Editor eine Seite anlegen (zum Beispiel «Fotos», Adresse `/fotos`), den Baustein **Fotoalben** einfügen und veröffentlichen. Die Seite ist für alle sichtbar, der Inhalt erscheint nur angemeldeten Personen. Ein Album hat eine teilbare Adresse: `/fotos?album=<Kennung>`. Wer nicht angemeldet ist, kommt nach der Anmeldung zum selben Album zurück. Ab 9 sichtbaren Alben zeigt die Seite sie nach Jahr gruppiert (das Datum kommt von Flickr) mit einer Suche; im Album erscheinen 48 Fotos, mehr mit «Weitere Fotos anzeigen».

## Was bei Flickr gelten muss

- **Sichtbarkeit bei Flickr:** Die Fotos können öffentlich, «Mit Link» oder privat sein. Welche davon der Server abrufen kann, hängt vom Token ab (mit Token auch nicht öffentliche des eigenen Kontos). Ob Flickr die **Bilddateien** nicht öffentlicher Fotos ohne Anmeldung ausliefert, hängt von Flickr ab und lässt sich nur mit echten Zugangsdaten prüfen: Zeigt ein Album keine Bilder, setze es bei Flickr auf «Mit Link» (der Link selbst bleibt beim Server und steht nie auf der Website).
- **Alben, die nicht erscheinen sollen:** In der Verwaltung ausgeschaltet lassen. Neue Alben sind immer ausgeschaltet.
- **Kinderfotos:** Schalte nur Alben ein, für die die Einwilligung der Eltern vorliegt (Datenschutzerklärung, Abschnitt 10). Ein «Nein» einer jugendlichen Person zählt auch bei einem «Ja» der Eltern. Entfernst du ein Foto bei Flickr, verschwindet es nach spätestens 10 Minuten von der Website (Zwischenspeicher).
- **Datenschutz:** Flickr erfährt nur die IP-Adresse des Servers und welche Alben und Bilder abgerufen werden, nie Konto, Name oder IP-Adresse der Person, die die Website besucht.

## Wenn etwas nicht klappt

| Meldung in der Verwaltung                       | Bedeutung und Abhilfe                                                                                     |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| «Der Server hat noch keine Zugangsdaten»        | Die vier Werte fehlen in der Umgebung des Servers (Schritt 3), oder der Server wurde nicht neu gestartet. |
| «Flickr lehnt den Zugang ab»                    | Schlüssel, Secret oder Token sind falsch oder widerrufen. Hole das Token neu (Schritt 2).                 |
| «Dieses Konto gibt es bei Flickr nicht»         | Die Kennung stimmt nicht. Sie hat die Form `12345678@N00`.                                                |
| «Flickr antwortet gerade nicht»                 | Flickr ist langsam oder bremst. Warte einige Minuten; der Server fragt nicht öfter als nötig.             |
| Die Seite zeigt «Hier gibt es noch keine Fotos» | Kein Album ist eingeschaltet, oder Zugangsdaten und Konto fehlen.                                         |

## Rückweg

Die Fotos selbst bleiben immer bei Flickr. Willst du Cevi OS wieder von Flickr lösen: Werte aus `deploy/.env` entfernen, Server neu starten, Token bei Flickr widerrufen. Die Auswahl der Alben liegt in den Tabellen `foto_einstellung` und `foto_album` (Rückweg der Migration: `apps/api/drizzle/rueckweg/0156_fotos.sql`).
