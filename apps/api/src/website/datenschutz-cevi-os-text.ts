// Der Text der festen Seite «/datenschutz-cevi-os» (#712): Abschnitt 11 der früheren Datenschutzerklärung, «Zusätzlich für Cevi OS (App, Verwaltung und Website)».
// Er liegt im Code und nicht in der Datenbank: Er beschreibt, was Cevi OS bearbeitet, und ändert sich mit dem Code. Wer die Datenverarbeitung ändert, ändert ihn im selben Pull Request.
// Format: Markdown in dem kleinen Umfang, den datenschutz-cevi-os.ts kennt (Überschriften der Ebenen 2 bis 4, Absätze, flache Listen, **fett**, *kursiv*, Links).
export const DATENSCHUTZ_CEVI_OS_TEXT = `
## 11 Zusätzlich für Cevi OS (App, Verwaltung und Website)

Cevi OS ist die App der Abteilung. Mit ihr sehen Eltern und Leitende die Programme, melden Kinder an oder ab und schreiben miteinander. In der Verwaltung im Browser pflegt die Leitung die Daten, und die Website der Abteilung entsteht in Cevi OS. Dieser Abschnitt nennt, was Cevi OS dafür bearbeitet, wie lange die Daten bleiben, wer sie sieht und welche Dienste sie erhalten. Er ergänzt die Abschnitte 1 bis 10 und geht ihnen vor, wo es um Cevi OS geht.

### 11.1 Grundsätze

- Cevi OS bearbeitet nur, was die Abteilung für Programme, Anmeldungen, den Chat, Lager und die Website braucht.
- Ein Kind hat nur dann ein eigenes Konto, wenn die Abteilung es erlaubt und die Leitung es für dieses Kind erstellt, nachdem sie die Eltern informiert hat. Ohne Konto geben Kinder nichts ein.
- Die Konten haben keine E-Mail-Adresse. Nur im Adressbuch eines Lagers kann die Lagerleitung die E-Mail-Adresse einer Person eintragen, die selbst kein Konto hat.
- Cevi OS verschickt keine E-Mails. Es gibt kein Tracking, keine Analyse und keine Werbung.
- Bilder gibt es nur als freiwilliges Profilbild von Personen und als Bilder, die Personen mit Zugang zur Website als Medien hochladen.

Der Hinweis beim ersten Start der App ist eine Kenntnisnahme dieser Erklärung, keine Einwilligung. Die Daten brauchen wir, damit die App ihren Zweck erfüllt.

### 11.2 Welche Daten Cevi OS bearbeitet

Zu jeder Kategorie stehen die Daten, der Zweck und die Aufbewahrung.

#### Konto und Anmeldung

- **Daten:** Name, Benutzername, die Rolle als Abteilungsleitung, Einstellungen zur Anmeldung, der Prüfwert des Passworts (nie das Passwort selbst), bei der Abteilungsleitung der zweite Faktor und der Zeitpunkt, zu dem du diese Erklärung zur Kenntnis genommen hast.
- **Zweck:** Anmelden, Rechte prüfen und das Konto vor Missbrauch schützen. Dazu gehört das Passwort, das nur als Prüfwert gespeichert ist.
- **Aufbewahrung:** Bis das Konto gelöscht wird. Auf Anfrage löscht die Leitung Daten.

#### Telefonnummer der Stufenleitung

- **Daten:** Die Telefonnummer, die eine Stufenleitung freiwillig angibt.
- **Zweck:** Eltern erreichen die Stufenleitung ihrer Stufe. Die Nummer ist freiwillig.
- **Aufbewahrung:** Bis die Person die Nummer entfernt oder das Konto gelöscht wird.

#### Geschlecht der Person

- **Daten:** Die freiwillige Angabe «weiblich» oder «männlich» (oder keine Angabe) zu einer Person mit Konto und ob sie von Hand stammt.
- **Zweck:** Die Verwaltung nennt die Rolle einer Leitung so, wie die Person heisst: «Stufenleiterin», «Stufenleiter» oder, ohne Angabe, «Stufenleitung». Wer Personen bearbeiten darf, trägt die Angabe ein; die Person sieht sie in ihrem Konto. Ist die Cevi-Datenbank verbunden, übernimmt Cevi OS die Angabe («weiblich» oder «männlich») von dort, aber nur für Personen mit Konto, die einem Eintrag dort eindeutig zugeordnet sind, und nie über eine Angabe, die jemand in der Verwaltung gesetzt oder geändert hat. Sie erscheint nur in der Verwaltung, dort, wo Name und Rolle der Person stehen: nie auf der öffentlichen Website, im Kalender, in Mitteilungen, in der App der Eltern oder in Exporten. Von Kindern wird sie nicht erfasst.
- **Aufbewahrung:** Bis eine berechtigte Person die Angabe entfernt oder das Konto gelöscht wird. Eine Angabe aus der Cevi-Datenbank ändert sich oder verschwindet, wenn sie es dort tut.

#### Persönlicher Kalenderlink

- **Daten:** Der Prüfwert deines geheimen Kalenderlinks (nie der Link selbst), die letzten vier Zeichen zur Anzeige, wann du ihn erzeugt hast und wann er zuletzt abgerufen wurde.
- **Zweck:** Du abonnierst die Termine, die du in der App siehst, in einer Kalender-App. Der Kalender zeigt nur Titel, Ort, Zeit und Stand der Termine, nie Kinder, Beschreibung oder Anmeldungen. Der Link ist geheim und gehört nur dir: Wer ihn kennt, sieht diese Termine. Gib ihn nicht weiter; du kannst ihn jederzeit erneuern oder widerrufen.
- **Aufbewahrung:** Bis du den Link widerrufst oder erneuerst oder das Konto gelöscht wird; ein widerrufener Link verschwindet nach 30 Tagen ganz.

#### Profilbild

- **Daten:** Das Foto, das eine Person freiwillig für sich selbst hochlädt. Der Server verkleinert es auf 256 × 256 Pixel und kodiert es neu; Daten wie der Aufnahmeort gehen dabei verloren. Das Original bleibt nicht erhalten.
- **Zweck:** Andere Personen erkennen, wer schreibt oder wen sie erreichen. Das Bild ist freiwillig, und jede Person lädt nur ihr eigenes hoch; die Abteilungsleitung und der Entwickler können es entfernen. Wer Leitung oder Stufenleitung einer Stufe ist, erscheint auf der öffentlichen Website mit Anzeigenamen und Bild (Seite der Stufe). Das ist keine Wahl der Person, sondern folgt der Rolle.
- **Einwilligung:** Das Profilbild ist freiwillig. Wer es hochlädt, willigt damit ein, dass es die Personen sehen, die ihn oder sie ohnehin mit Namen sehen (siehe Wer was sieht). Die Person kann das Bild jederzeit selbst löschen. Es wird auch gelöscht, wenn das Konto gelöscht oder deaktiviert wird. Auf der öffentlichen Website erscheinen Anzeigename (Cevi-Name, sonst Vorname) und Bild jeder Person mit der Rolle Leitung oder Stufenleitung einer Stufe. Das hängt an der Rolle und nicht an einer Einwilligung; die Person kann es in der App nicht abstellen. Bei Minderjährigen braucht es das Einverständnis der Eltern; die Abteilung stellt das organisatorisch sicher, Cevi OS prüft es nicht. Die Rolle vergibt die Abteilungsleitung; jede Änderung steht im Protokoll der Verwaltung, ohne Namen.
- **Aufbewahrung:** Bis die Person das Bild löscht oder das Konto deaktiviert oder gelöscht wird. Von Kindern gibt es nie ein Bild. Auf der Website steht das Bild, solange die Person die Rolle trägt und das Bild besteht; die Website vergisst es beim nächsten Abgleich, kurz nachdem die Rolle oder das Bild wegfällt.

#### Kinder

- **Daten:** Vorname, Nachname und Stufe eines Kindes und die Zuordnung zu den Eltern.
- **Zweck:** Die Eltern melden ihr Kind zu Programmen an oder ab, und die Leitung sieht, wer kommt.
- **Aufbewahrung:** Bis die Leitung den Eintrag löscht. Auf Anfrage löscht die Leitung Daten.

#### Konto eines Kindes

- **Daten:** Die Verknüpfung eines Kindes mit seinem Konto (Benutzername und Passwort wie bei jedem Konto), das Datum, seit dem das Konto besteht, das Datum, an dem die Abteilung die Eltern informiert hat, und die Angabe, ob die verknüpften Eltern weiter sehen, was das Kind sieht. Der Text der Einwilligung der Eltern bleibt ausserhalb von Cevi OS.
- **Zweck:** Ein Kind meldet sich mit einem eigenen Konto an und sieht die Programme, die Leitung und, wenn die Abteilung es erlaubt, den Gruppenchat seiner Stufe. Die Abteilungsleitung erstellt das Konto und vermerkt, dass die Eltern informiert sind. Das Konto kennt nur das eigene Kind: nie andere Kinder, Eltern oder Telefonnummern.
- **Aufbewahrung:** Bis die Leitung das Konto entfernt oder sperrt oder das Kind gelöscht wird; mit dem Kind verschwindet auch das Konto.

#### Rollen, Stufen und Tags

- **Daten:** Die Rolle einer Person (Leitung oder Stufenleitung) in einer Stufe und die Tags, die ihr die Leitung zuweist (Stufe, Funktion, Team, Lager), jeweils mit einer freiwilligen Rolle. Die Stufen der Abteilung sind Tags vom Typ Stufe; die Rolle in einer Stufe (Leitung oder Stufenleitung) ist eine solche Zuordnung. Dazu die Bearbeitungsrechte, die die Leitung einer Person oder einem Tag gibt (zum Beispiel das Recht auf eine bestimmte Seite). Dazu die Plattformrollen, etwa die Rolle Webmaster, und die Rollen, die die Leitung in einer einzelnen Gruppe anlegt (zum Beispiel Kasse im OK eines Anlasses) mit den Rechten, die sie tragen, und die Rolle, die eine Person in der Gruppe hat.
- **Zweck:** Festlegen, wer welche Programme, Anmeldungen und Chats sehen darf. Tags (Stufe, Funktion, Team, Lager, Anlass) ordnen Personen Gruppen zu. Bearbeitungsrechte, Plattformrollen und Rollen in Gruppen legen fest, wer Inhalte ändern, Anmeldungen sehen oder Mitteilungen senden darf.
- **Aufbewahrung:** Bis die Leitung die Rolle entfernt oder das Konto gelöscht wird.

#### Programme

- **Daten:** Titel, Zeit und Ort. Dazu die Beschreibung aus dem Kalender, die Eltern nie sehen, die Kategorien des Termins im Kalender und die Stufen und Tags, für die ein Programm gilt. Dazu die Räume der Abteilung mit Name, Ort, Beschreibung, Plätzen und zuständigem Team und die Orte der Abteilung mit Name, Adresszeile und Standort.
- **Zweck:** Information über Zeit und Ort der Programme. Sie stammen aus dem Kalender der Abteilung und von den Angaben, die die Stufenleitung pflegt. Die Kategorien eines Termins im Kalender werden zu Tags und bestimmen, wer den Termin sieht. Dazu kommen die Räume der Abteilung (Name, Ort, Beschreibung, Plätze, zuständiges Team), die die Abteilungsleitung pflegt und die alle angemeldeten Personen der Abteilung lesen. Dazu kommen die Orte der Abteilung (Name, Adresszeile und ein Standort als Adresse, Koordinaten oder Link auf Google Maps), die die Stufenleitung pflegt: Treffpunkt und Schlussort der Angaben wählt sie aus diesen Orten. Die Website zeigt dazu den Link «Auf Google Maps ansehen»; der Server ruft Google nie ab, und die Seite verbindet sich nicht mit Google, erst der Klick auf den Link tut es.
- **Aufbewahrung:** Bis die Leitung das Programm löscht. Der Kalender der Abteilung bleibt unverändert. Einen Raum löscht die Abteilungsleitung; das geht nur, solange keine Anfrage offen und keine Buchung in der Zukunft ist. Einen Ort löscht die Stufenleitung oder die Abteilungsleitung; die Angaben behalten den Namen, nur der Link zur Karte entfällt.

#### Anmeldungen und Abmeldungen

- **Daten:** Ja oder Nein pro Kind und Programm, dasselbe für Leitende, und wer die Antwort zuletzt geändert hat. Ohne Antwort gilt «offen».
- **Zweck:** Zeigen, ob ein Kind zu einem Programm kommt (Ja oder Nein) und ob eine Leitungsperson dabei ist.
- **Aufbewahrung:** Bis die Leitung die Anmeldung, das Kind oder das Programm löscht. Auf Anfrage löscht die Leitung Daten.

#### Anwesenheit

- **Daten:** Da oder nicht da pro Kind und Programm, dasselbe für Leitende, und wer den Eintrag zuletzt geändert hat. Ohne Eintrag gilt «nicht erfasst». Die Anmeldung der Eltern bleibt davon getrennt.
- **Zweck:** Die Leitung hält fest, wer bei einem Programm da war, und sieht pro Stufe, wie oft jemand kam.
- **Aufbewahrung:** Bis die Leitung den Eintrag, das Kind oder das Programm löscht. Auf Anfrage löscht die Leitung Daten.

#### Terminvorschläge

- **Daten:** Titel, Zeit, Ort, Beschreibung, gewünschte Kategorien und Bemerkung des Vorschlags, wer ihn eingereicht hat, sein Stand und bei einem Entscheid wer, wann und mit welcher Begründung.
- **Zweck:** Berechtigte Personen schlagen der Abteilungsleitung einen Termin vor, mit Titel, Zeit, Ort, Beschreibung, gewünschten Kategorien und einer Bemerkung. Die Abteilungsleitung entscheidet; in Outlook trägt sie den Termin von Hand ein. Die vorschlagende Person sieht ihre Vorschläge mit dem Stand und kann einen offenen zurückziehen. Der Push an die Abteilungsleitung nennt weder Titel noch Namen.
- **Aufbewahrung:** Bis die Leitung den Vorschlag löscht oder die vorschlagende Person ihn zurückzieht. Mit dem Konto verschwindet nur die Angabe, wer vorgeschlagen oder entschieden hat. Auf Anfrage löscht die Leitung Daten.

#### Raumanfragen

- **Daten:** Raum, Zeit und Zweck der Anfrage, wer sie gestellt hat, ihr Stand und bei einem Entscheid wer, wann und mit welcher Begründung.
- **Zweck:** Eine Person fragt einen Raum der Abteilung für eine Zeit an, mit einem kurzen Zweck. Das Team des Raums entscheidet; bei Raum ohne Team entscheidet die Abteilungsleitung. Die anfragende Person sieht ihre Anfragen mit dem Stand. Alle Leitenden der Abteilung sehen im Belegungsplan, welche Räume wann belegt sind, mit Zweck und dem Cevi-Namen (sonst dem Vornamen) der Person; Eltern und Kinder sehen das nicht. Der Push nennt weder Namen, Raum noch Zweck. Bitte schreib im Zweck keine Angaben zur Gesundheit.
- **Aufbewahrung:** 180 Tage nach dem Ende der angefragten Zeit, mit dem Konto der anfragenden Person früher. Wird das Konto der entscheidenden Person gelöscht, verschwindet nur die Angabe, wer entschieden hat. Auf Anfrage löscht die Leitung Daten.

#### Bestellungen im Lädeli

- **Daten:** Wer bestellt hat, die bestellten Artikel mit Variante, Menge und Preis, die gewählte Übergabe, die Summe, der Stand und die Zeitpunkte der Bestellung.
- **Zweck:** Angemeldete Personen bestellen im Lädeli der Abteilung Artikel, zum Beispiel Kleider und Abzeichen. Gespeichert ist, wer bestellt hat, was (Artikel, Variante, Menge, Preis zum Zeitpunkt der Bestellung), die gewählte Übergabe, die Summe und der Stand. Die Abteilungsleitung sieht die Bestellungen mit dem Namen der Person und setzt den Stand; die bestellende Person sieht ihre eigenen und kann eine offene stornieren. Cevi OS wickelt keine Zahlung ab und speichert keine Zahlungsdaten und keine Lieferadresse: Bezahlt wird bei der Übergabe. Der Warenkorb entsteht erst nach der Anmeldung und liegt bis zum Absenden nur im Browser der Person.
- **Aufbewahrung:** 180 Tage nachdem die Bestellung übergeben oder storniert ist; eine Bestellung, die nie abgeschlossen wurde, ein Jahr nach der letzten Änderung. Mit dem Konto der bestellenden Person früher. Auf Anfrage löscht die Leitung Daten.

#### Chats

- **Daten:** Nachrichten (nur Text) im Gruppenchat einer Stufe und in den Einzelchats zwischen einem Elternteil und der Stufenleitung, mit Zeitpunkt, Autor und Lesestand. Im Chat können Angaben zur Gesundheit landen, wenn jemand sie schreibt. Bitte schreib nur das Nötigste und keine Diagnosen.
- **Zweck:** Austausch zwischen Eltern und Stufenleitung im Gruppenchat der Stufe und im Einzelchat mit der Stufenleitung.
- **Aufbewahrung:** Bis die Nachricht oder das Konto gelöscht wird. Auf Anfrage löscht die Leitung Daten.

#### Benachrichtigungen

- **Daten:** Das Push-Token deines Geräts mit der Plattform (iOS oder Android) und deine Schalter für Chat- und Programm-Pushes. Ein Push nennt nie den Text einer Nachricht und nie den Namen eines Kindes, sondern nur den Namen eines Chats oder eines Programms.
- **Zweck:** Pushes zu neuen Nachrichten, zu An- und Abmeldungen und zu Erinnerungen zustellen. Das Token gehört zum Gerät und zur Sitzung.
- **Aufbewahrung:** Bis die Sitzung endet, also beim Abmelden, beim Deaktivieren und beim Löschen des Kontos.

#### Technische Daten

- **Daten:** Die Sitzung (Token und Ablauf), einmalige Codes für die Anmeldung, IP-Adressen in den Logs des Webservers und in der Begrenzung der Anfragen (zusammen mit dem Pfad der Anfrage). Die Sitzung selbst speichert weder IP-Adresse noch Gerätetyp. Die Logs der API enthalten keine Namen, Nachrichten oder Tokens.
- **Zweck:** Sitzungen führen, Anfragen begrenzen und Fehler finden. Dazu gehören IP-Adressen in den Logs und für die Begrenzung.
- **Aufbewahrung:** Logs 14 Tage. Die Begrenzung der Anfragen löscht ihre Einträge frühestens 15 Minuten nach der letzten Anfrage. Sitzungen enden nach 90 Tagen ohne Nutzung oder früher mit dem Abmelden.

#### Protokoll der Verwaltung

- **Daten:** Aktion, Zeitpunkt und die Kennungen der handelnden Person und des Ziels, etwa «Rolle geändert» oder «Person gelöscht».
- **Zweck:** Nachvollziehen, welche Verwaltungsaktion wann auf wen oder was zielte. Das Protokoll enthält Kennungen, keine Namen.
- **Aufbewahrung:** Das Protokoll bleibt; es enthält keine Personendaten.

#### Änderungsprotokoll

- **Daten:** Zeitpunkt, Name und Funktionen der handelnden Person, ein Satz zur Änderung (zum Beispiel «Rolle «Kasse» der Gruppe «OK Kirmes» geändert»), die Kennung und, wenn es keine Person betrifft, der Name des Objekts, die Namen der geänderten Felder und der Rechte, die dazukamen oder wegfielen, einfache Statuswerte vorher und nachher, die Dauer, die Art des Browsers und ein Hash der IP-Adresse. Ebenso wenige Ereignisse des Systems mit Wirkung (Neustart, Versand von Erinnerungen) und Sicherheitsereignisse.
- **Zweck:** Nachvollziehbarkeit und Sicherheit: Der Entwickler der Plattform sieht, welche Person wann was geändert hat, zum Beispiel eine Rolle, einen Anlass oder eine Seite. Gespeichert sind Zeit, Name und Funktionen der Person zu diesem Zeitpunkt, ein Satz zur Änderung, das betroffene Objekt als Kennung und, wenn es keine Person betrifft, mit seinem Namen (Anlass, Gruppe, Rolle), die Namen (nie die Werte) der geänderten Felder und der Rechte, die dazukamen oder wegfielen, einfache Statuswerte vorher und nachher und ein Hash der IP-Adresse, der täglich wechselt und danach keiner Adresse mehr zuzuordnen ist. Nicht erfasst sind lesende Zugriffe, abgelehnte Anfragen, Anmeldungen und Eingaben im Alltag (Haken, Chat). Fehlgeschlagene Anmeldungen und Begrenzungen stehen getrennt als Sicherheitsereignisse, je Konto und Stunde zusammengezogen. Nie gespeichert sind Inhalte von Anfragen, Passwörter, Texte von Mitteilungen oder Namen von Kindern.
- **Aufbewahrung:** Neunzig Tage, danach löscht ein nächtlicher Lauf die Einträge; die Abteilung kann die Frist im Betrieb zwischen 7 und 365 Tagen einstellen. Über einer festen Obergrenze an Einträgen fallen die ältesten früher weg. Wird ein Konto gelöscht, verlieren die Einträge der Person sofort Kennung, Namen und Funktionen.

#### Angaben der Abteilung

- **Daten:** Name der Abteilung, ihre Stufen (mit freiwilligem Logo), die Anbindung an den Kalender, die Hosts, auf denen Datei-Links im Lager liegen dürfen, und die Auswahl der Fotoalben (Kennung des Flickr-Kontos und der Alben, Reihenfolge, eigener Titel, ob ein Album sichtbar ist).
- **Zweck:** Die Abteilung, ihre Stufen (mit freiwilligem Logo), die Anbindung an den Kalender und die Auswahl der Fotoalben, die auf der Website erscheinen.
- **Aufbewahrung:** Bis die Leitung die Angaben ändert oder löscht.

#### Lager und Lagermitglieder

- **Daten:** Titel, Zeitraum, Ort und Adresse eines Lagers, sein Status, eine freiwillige Farbe und ein freiwilliges Logo. Dazu, welche Person im Lager mit welcher Rolle (Lagerleitung, Leitung, Team oder Lesen) mitarbeitet. Dazu die Einstellung, welche Rechte die Rollen im Lager haben. Dazu ein Verzeichnis der Änderungen im Lager, das den Apps den Abgleich ermöglicht: Es nennt nur die Art der Änderung, die Kennung des geänderten Eintrags, seine Version und den Zeitpunkt, weder Inhalte noch Personen. Es entfällt nach 30 Tagen. Dazu die Ressorts des Lagers mit Kürzel, Name, Leitung und Stellvertretung (als Personen), ob das Ressort ruhig ist, ihren Links und Notizen; bei einer Notiz steht, wer sie geschrieben hat. Dazu für Änderungen, die die App ohne Netz gesammelt und später gesendet hat, eine Kennung der Änderung, wer sie gesendet hat und ihr Ergebnis (Kennungen und Versionen der geschriebenen Einträge, keine Inhalte); sie verhindert, dass eine wiederholte Sendung doppelt schreibt, und entfällt nach 30 Tagen. Offene Ansichten erfahren Änderungen über eine Verbindung, die nur meldet, dass es Neues gibt; sie speichert nichts. Dazu die Aufgaben des Lagers mit Titel, Status, Frist, Notiz und Ressort, der verantwortlichen Person und den Personen, die die Aufgabe unterstützen. Zu einer Aufgabe gehören ihre Checkliste (mit der Person, die einen Punkt abgehakt hat), ihre Links und ihre Stichworte. Dazu die Einkaufsliste mit Artikel, Menge, Einheit und Warengruppe und der Person, die einkauft, samt den Vorschlägen und den von der Leitung gesetzten Warengruppen je Artikelname. Dazu die eigenen Check-Punkte des Lagers (Titel, erledigt, Reihenfolge).
- **Zweck:** Die Abteilungsleitung legt Lager an und legt fest, wer im Lager mitarbeitet und mit welcher Rolle (Lagerleitung, Leitung, Team oder Lesen). Die Rolle bestimmt, was eine Person im Lager sehen und ändern darf. Die Lagerleitung und die Abteilungsleitung stellen ein, welche Rechte Leitung, Team und Lesen im Lager haben. Die Ressorts gliedern die Arbeit im Lager: Jedes hat eine Leitung und eine Stellvertretung, dazu Links und Notizen. Die Aufgaben halten fest, was im Lager zu tun ist, mit Status, Frist, Ressort, einer verantwortlichen Person und deren Unterstützung. Checkliste, Links und Stichworte halten Teilschritte, Unterlagen und Schlagwörter der Aufgabe fest; eine wiederkehrende Aufgabe legt beim Erledigen die nächste an. Die Einkaufsliste hält fest, was fürs Lager eingekauft wird und wer es einkauft. Der Zeitplan hält Meilensteine mit Datum, die Tage des Lagers und die Abschnitte des Tages fest; eine Aufgabe kann ihre Frist relativ zu einem Meilenstein führen. Vor einer Frist erinnert Cevi OS die Beteiligten der Aufgabe mit einer Benachrichtigung, die nur den Lagertitel nennt. Der Lager-Check zeigt den Mitgliedern mit dem Recht dazu, ob das Lager bereit ist: Er rechnet bei jeder Abfrage aus den Daten des Lagers (zum Beispiel überfällige Aufgaben) und speichert nichts; nur die eigenen Check-Punkte (Titel und Haken) sind gespeichert.
- **Aufbewahrung:** Bis die Leitung die Mitgliedschaft entfernt oder das Konto gelöscht wird. Auf Anfrage löscht die Leitung Daten.

#### Teilnehmende im Lager

- **Daten:** Für jede teilnehmende Person: Vorname, Nachname, Stufe und ein freiwilliger Cevi-Name; dazu, wer den Eintrag erfasst oder geändert hat. Beim Abzählen ein Haken je Teilnehmende und je Mitglied des Lagers mit dem Zeitpunkt. Für die Einteilung in Programmgruppen, welcher Gruppe eine teilnehmende Person oder ein Mitglied des Lagers angehört, und ob eine teilnehmende Person «nicht dabei» ist. Keine Angaben zur Gesundheit, keine Telefonnummer, keine Adresse. Das Team sieht Vorname, Nachname und Stufe.
- **Zweck:** Die Lagerleitung erfasst, wer am Lager teilnimmt, und das Team zählt im Lager ab, wer da ist. Gespeichert sind nur Vorname, Nachname, Stufe und ein freiwilliger Cevi-Name, keine Angaben zur Gesundheit, keine Telefonnummer und keine Adresse. Das Team sieht Vorname, Nachname und Stufe.
- **Aufbewahrung:** Sechs Monate nach dem Ende des Lagers löscht ein automatischer Lauf die Teilnehmenden, das Abzählen und die Einteilung in Gruppen endgültig; im Protokoll der Verwaltung bleibt nur die Anzahl. Die Lagerleitung kann Einträge früher entfernen. Löscht die Verwaltung ein Kind, gehen die Einträge dieses Kindes als Teilnehmende in allen Lagern sofort mit (die Zuordnung klappt bei gleichem Vor- und Nachnamen; ein Eintrag, der keinem Kind eindeutig gehört, bleibt und muss im Lager entfernt werden). Auf Anfrage löscht die Leitung Daten.

#### Zimmer und Zelte im Lager

- **Daten:** Für jedes Zimmer und Zelt: Name, Art, Plätze und eine Notiz. Für jede Einteilung: welche teilnehmende Person oder welches Mitglied des Lagers in welchem Zimmer liegt, wann und von welchem Konto die Einteilung gesetzt wurde. Für jeden Dienst (zum Beispiel Küche oder Nachtwache): Name, Beschreibung, Abschnitt des Tages, nötige Personenzahl und ob es eine Nachtwache ist. Für jede Schicht: welche teilnehmende Person oder welches Mitglied des Lagers an welchem Lagertag in welchem Dienst steht. Für jede Tauschanfrage: welche eigene Schicht, mit welcher Wunschperson oder Wunschschicht, eine freiwillige Bemerkung, wer sie stellte, ihr Stand und wer wann entschied. Keine weiteren Angaben zur Person.
- **Zweck:** Die Lagerleitung legt Zimmer und Zelte mit Namen, Art, Plätzen und einer Notiz an und teilt Teilnehmende und Mitglieder des Lagers ein. Das Team sieht nur das eigene Zimmer und die Namen der Mitbewohner. Gespeichert ist nur, wer in welchem Zimmer liegt, keine weiteren Angaben zur Person. Dazu legt sie Dienste an (zum Beispiel Küche oder Nachtwache, mit Abschnitt des Tages und nötiger Personenzahl) und teilt Mitglieder und Teilnehmende für jeden Lagertag ein, von Hand oder mit einem Vorschlag, der nach der eingetragenen Anwesenheit gleichmässig verteilt. Der Schichtplan ist für alle Mitglieder des Lagers lesbar; gespeichert ist nur, wer an welchem Tag in welchem Dienst steht. Wer im Team eine eigene Schicht tauschen oder abgeben möchte, stellt eine Anfrage an die Lagerleitung (mit freiwilliger Bemerkung und, wenn gewünscht, einer Wunschperson); die Lagerleitung klärt die Zustimmung selbst und nimmt die Anfrage an oder lehnt sie ab. Erst dann ändert sich die Einteilung. Ein Push über eine Anfrage oder ihren Entscheid nennt nur den Lagertitel. Aus diesen Angaben erzeugt Cevi OS auf Abruf Aushänge als PDF (Zimmerliste, Türschilder, Gruppenlisten, Fahrtenliste, Schichtplan, Organigramm); die Datei geht nur an die abrufende Person und wird nicht gespeichert.
- **Aufbewahrung:** Die Einteilung der Teilnehmenden (Zimmer und Dienste) geht mit den Teilnehmenden sechs Monate nach dem Ende des Lagers, die übrigen mit dem Lager. Die Lagerleitung kann Zimmer, Dienste und Einteilungen früher entfernen. Auf Anfrage löscht die Leitung Daten.

#### Fahrten im Lager

- **Daten:** Für jede Fahrt: Richtung (Hinfahrt oder Rückfahrt), Auto oder ÖV-Gruppe, ein Name, der Fahrer, die Zahl der Plätze, Datum, Zeit, Start, Ziel und Treffpunkt, bei einer ÖV-Gruppe ein Link auf den Fahrplan, dazu ein Kartenpunkt (Bezeichnung mit Adresse, Koordinaten oder Link). Für jede Mitfahrt die Person des Lagers oder der Teilnehmende. Dazu, wer die Einträge erfasst oder geändert hat.
- **Zweck:** Die Lagerleitung teilt die Hin- und Rückfahrt ein: Auto oder ÖV-Gruppe, mit Fahrer, Plätzen, Datum, Zeit, Treffpunkt und den Mitfahrenden (Leitende und Teilnehmende). Dazu kann sie einen Link auf den Fahrplan und einen Kartenpunkt als Ziel der Fahrt hinterlegen (Bezeichnung mit Adresse, Koordinaten oder Link), den die App in der Karten-App öffnet. Der Server speichert beides nur und ruft weder den Fahrplan noch einen Kartendienst ab. Das Team sieht nur die eigene Fahrt.
- **Aufbewahrung:** Bis die Lagerleitung die Fahrt oder die Mitfahrt löscht oder das Lager gelöscht wird; die Mitfahrt eines Teilnehmenden entfällt mit dem Teilnehmenden, sechs Monate nach dem Ende des Lagers. Auf Anfrage löscht die Leitung Daten.

#### Dateien im Lager (Verknüpfungen)

- **Daten:** Für jede Verknüpfung: der Link, der Anzeigename, falls bekannt Typ und Grösse, wann sie hinzugefügt wurde und von welchem Konto. Den Inhalt der Datei speichert Cevi OS nicht.
- **Zweck:** Dateien, die im SharePoint der Abteilung liegen, im Lager auffindbar machen, zum Beispiel an einem Pinnwand-Beitrag oder einem Dokument. Cevi OS speichert nur den Link, den Anzeigenamen und, falls bekannt, Typ und Grösse, nie den Inhalt, und ruft den Link nie ab. Wer die Datei öffnen darf, regelt der Ablageort. Beim Eintrag steht, welches Konto ihn hinzugefügt hat. Die Abteilungsleitung kann festlegen, auf welchen Hosts die Links liegen dürfen. Eine Offline-Kopie legt nur die App an und nur, wenn die Person die Option in den Einstellungen der App einschaltet.
- **Aufbewahrung:** Bis die Leitung die Verknüpfung löscht oder das Lager gelöscht wird; ein Eintrag, den kein Datensatz einbindet, entfällt nach 24 Stunden. Die Datei am Ablageort bleibt immer. Mit dem Konto verschwindet nur die Angabe, wer den Eintrag hinzugefügt hat. Auf Anfrage löscht die Leitung Daten.

#### Anwesenheit im Lager

- **Daten:** Für jede Person im Lager (Leitende als Konto, Teilnehmende) und jeden Abschnitt eines Lagertags, ob sie anwesend oder abwesend ist; wer nicht eingetragen ist, gilt als offen. Dazu die Anfragen des Teams, ein eingetragenes Feld zu ändern: das Feld, der gewünschte Wert, eine freiwillige Bemerkung, wer sie stellte, ihr Stand und wer wann entschied. Dazu die Frist, bis zu der das Team seine Anwesenheit direkt einträgt.
- **Zweck:** Planen, wer an welchem Tag und zu welcher Tageszeit im Lager ist, zum Beispiel für den Schichtplan und die Einkaufsmenge. Die Lagerleitung trägt für alle ein, das Team seine eigene Anwesenheit; eine Änderung eines eingetragenen Feldes stellt das Team als Anfrage an die Lagerleitung, die sie annimmt oder ablehnt. Ein Push über eine Anfrage oder ihren Entscheid nennt nur den Lagertitel.
- **Aufbewahrung:** Bis die Leitung die Anwesenheit löscht, das Lager gelöscht wird oder das Konto gelöscht wird. Die Einträge der Teilnehmenden (nur Kennung und Wert, kein Name) bleiben auch nach dem Löschen der Teilnehmenden, sechs Monate nach dem Ende des Lagers, bis das Lager gelöscht wird. Auf Anfrage löscht die Leitung Daten.

#### Pinnwand im Lager

- **Daten:** Für jeden Beitrag: Titel, Text, ob er wichtig oder angeheftet ist, von wann bis wann er sichtbar ist und an wen er sich richtet (alle, eine Rolle, ein Ressort, eine Gruppe oder einzelne Personen), dazu Verknüpfungen auf Dateien und das Konto, das ihn geschrieben hat. Bei einer Umfrage die Antworten und die Stimmen der Personen, dazu die Reaktionen der Personen auf Beiträge und wer einen Beitrag gesehen hat.
- **Zweck:** Mitteilungen an die Mitglieder eines Lagers: Titel, Text, ob eine Mitteilung wichtig oder angeheftet ist, von wann bis wann sie sichtbar ist, und an wen sie sich richtet (alle, eine Rolle, ein Ressort, eine Gruppe oder einzelne Personen), dazu Verknüpfungen auf Dateien im SharePoint. Bei einem Beitrag steht, welches Konto ihn geschrieben hat. Der Server zeigt jeder Person nur die Beiträge, die zu ihr passen und im Zeitfenster liegen. Eine wichtige Mitteilung löst einen Push aus, der nur den Lagertitel nennt, nie den Inhalt. An einem Beitrag kann eine Umfrage hängen: Die Antworten, welche Person welche Antwort gewählt hat und optional bis wann sie offen ist. Die Namen der Stimmen sieht nur die Leitung, ausser die Umfrage zeigt sie dem Team; sonst gibt es nur Zahlen. Jede Person kann auf einen Beitrag mit einem von fünf festen Zeichen reagieren; es zählen nur die Anzahl und die eigene Reaktion. Wer einen Beitrag geöffnet hat, wird einmal festgehalten (Person und Zeitpunkt); die Leitung sieht, wer ihn gesehen hat, alle anderen nur die Anzahl.
- **Aufbewahrung:** Bis die Leitung den Beitrag löscht oder das Lager gelöscht wird. Auf Anfrage löscht die Leitung Daten.

#### Notfall-Kontakte im Lager

- **Daten:** Je Notfall-Kontakt die Funktion, entweder das Konto einer Person im Lager oder ein Name, und die Telefonnummer (bei einem Konto optional eine eigene Nummer, sonst die Nummer aus dem Konto). Dazu der Link zur Lageradresse in einer Karten-App. Die Leitung und die Stellvertretung des Ressorts «si» und seiner Teilbereiche erscheinen mit der Nummer aus ihrem Konto.
- **Zweck:** Im Notfall die richtigen Personen sofort erreichen. Die Lagerleitung erfasst die Sicherheitsverantwortlichen und weitere Anlaufstellen mit Funktion und Telefonnummer, entweder als Konto des Lagers (die Nummer kommt aus dem Konto, solange keine eigene steht) oder als Name mit Nummer. Dazu kommen Leitung und Stellvertretung des Ressorts «si» und seiner Teilbereiche mit der Nummer aus ihrem Konto. Das Team sieht diese Kontakte mit Nummer, sonst nirgends im Lager eine Telefonnummer. Dazu speichert das Lager einen Link zur Lageradresse in einer Karten-App; der Server ruft keinen Kartendienst ab.
- **Aufbewahrung:** Bis die Lagerleitung den Kontakt löscht, das Lager gelöscht wird oder das Konto gelöscht wird. Auf Anfrage löscht die Leitung Daten.

#### Packliste und Infos im Lager

- **Daten:** Die Vorlage der Packliste (Abschnitt, Punkt, ob nur für die Lagerleitung) und je Person ihre Abweichungen davon (abgehakt oder entfernt) und ihre eigenen Punkte. Die Info-Abschnitte des Lagers mit Titel, Text, Links, Verknüpfungen auf Dateien, ob nur für die Lagerleitung, ob im Notfall-Fenster und der Reihenfolge. Bei einer Änderung steht, welches Konto sie vornahm.
- **Zweck:** Die Packliste und die Infos des Lagers bereitstellen. Die Lagerleitung pflegt die Vorlage der Packliste und die Info-Abschnitte (Text, Links und Verknüpfungen auf Dateien im SharePoint der Abteilung); einzelne Punkte und Abschnitte können der Lagerleitung vorbehalten sein. Jede Person hat ihre eigene Kopie der Packliste: Gespeichert sind nur ihre Abweichungen von der Vorlage (abgehakt, entfernt) und ihre eigenen Punkte, die nur sie sieht.
- **Aufbewahrung:** Die Vorlage und die Infos, bis die Lagerleitung sie löscht oder das Lager gelöscht wird. Die Abweichungen und eigenen Punkte einer Person, bis sie sie löscht, das Lager gelöscht wird oder das Konto gelöscht wird. Auf Anfrage löscht die Leitung Daten.

#### Private To-dos und Vorlagen im Lager

- **Daten:** Die privaten To-dos einer Person im Lager (Text, erledigt, Reihenfolge). Die Vorlagen der Abteilung für Aufgaben und Packlisten (Name, Art, die Einträge mit Fristen in Tagen ab Lagerbeginn). Bei einer Vorlage steht, welches Konto sie anlegte und änderte.
- **Zweck:** Jede Person im Lager führt eigene To-dos, die nur sie sieht; auch die Lagerleitung und die Abteilungsleitung lesen sie nie. Die Abteilungsleitung pflegt Vorlagen für Aufgaben und Packlisten; die Lagerleitung wendet eine Vorlage in einem Lager an, und es entstehen daraus gewöhnliche Aufgaben und Punkte des Lagers.
- **Aufbewahrung:** Die To-dos, bis die Person sie löscht, das Lager gelöscht wird oder das Konto gelöscht wird. Die Vorlagen, bis die Abteilungsleitung sie löscht. Auf Anfrage löscht die Leitung Daten.

#### Tagesseiten im Lager

- **Daten:** Je Lagertag: der Tageschef (ein Mitglied des Lagers), eine Notiz und die Blöcke mit Text, Art (Hinweis, Idee oder Programmbild), Reihenfolge und bei einem Programmbild die Verknüpfung auf die Datei. Bei einer Änderung steht, welches Konto sie vornahm.
- **Zweck:** Pro Lagertag eine Seite führen: wer Tageschef ist, eine Notiz, Hinweise und Ideen des Tages und Verknüpfungen auf Programmbilder im SharePoint der Abteilung. Die Leitung des Lagers pflegt die Seite; die Aufgaben mit Frist an diesem Tag zeigt die Seite aus den Aufgaben des Lagers, und das Wetter des Tages kommt aus dem Wetter des Lagers.
- **Aufbewahrung:** Bis die Leitung den Block löscht oder das Lager gelöscht wird. Wird ein Tageschef aus dem Lager entfernt oder sein Konto gelöscht, verschwindet die Angabe auf der Seite. Auf Anfrage löscht die Leitung Daten.

#### Wetter im Lager

- **Daten:** Der Wetterort des Lagers als Breite und Länge (der Server bestimmt ihn aus dem Ort des Lagers), der gefundene Ortsname, das Ergebnis der Suche und je Lager die zuletzt abgerufene Vorhersage (Tageswerte für Wettercode, Temperatur, Regen und Böen) mit dem Zeitpunkt des Abrufs.
- **Zweck:** Das Wetter am Lagerort anzeigen und vor Gewitter, starkem Wind, Hitze und viel Regen warnen. Niemand gibt Koordinaten ein: Der Server bestimmt den Wetterort aus dem Ort des Lagers. Dazu sucht er den Ortsnamen beim Ortsdienst von Open-Meteo (gesendet wird nur der Ortsname, nie die Adresse) und speichert Breite und Länge auf zwei Stellen gerundet, den gefundenen Namen und das Ergebnis der Suche am Lager. Die Vorhersage holt er dafür beim Wetterdienst Open-Meteo und speichert sie je Lager zwischen, damit nicht jeder Aufruf einen Abruf auslöst. An den Wetterdienst gehen nur die beiden Zahlen des Ortes, keine Namen und keine Angaben zu Personen.
- **Aufbewahrung:** Der Wetterort, bis sich der Ort des Lagers ändert oder das Lager gelöscht wird. Die Vorhersage im Zwischenspeicher wird bei jedem Abruf ersetzt und geht mit dem Lager. Auf Anfrage löscht die Leitung Daten.

#### Eingang im Lager

- **Daten:** Für jede Meldung: Art, Text, Tag der Meldung, Status, Antwort mit Tag, Ressort und Traktandum, dazu bei einer nicht anonymen Meldung das Konto der Person und bei einer anonymen Meldung nur einen Prüfwert des Rückfragecodes.
- **Zweck:** Mitglieder des Lagers schicken der Lagerleitung eine Idee, einen Wunsch, eine Frage oder Feedback, auf Wunsch anonym. Gespeichert sind die Art, der Text, der Tag der Meldung, der Status, die Antwort der Lagerleitung mit ihrem Tag und, wenn die Lagerleitung sie zuordnet, das Ressort und das Traktandum. Bei einer nicht anonymen Meldung steht auch das Konto der Person dabei: Die Lagerleitung sieht den Namen, und die Person bekommt die Antwort als Push, der nur den Lagertitel nennt. Bei einer anonymen Meldung speichert Cevi OS keine Person, keine IP-Adresse und keine Uhrzeit, nur den Tag, und schreibt weder ein Audit-Log noch einen Eintrag im Änderungsfeed. Die Person bekommt beim Senden einen Rückfragecode, mit dem sie Status und Antwort abruft; gespeichert ist nur ein Prüfwert dieses Codes. Die Antwort steht ausserdem an der Meldung, die die Lagerleitung liest. Die Meldungen sieht nur die Lagerleitung und wer von ihr das Recht dazu bekommt.
- **Aufbewahrung:** Bis die Lagerleitung die Meldung löscht oder das Lager gelöscht wird; eine nicht anonyme Meldung entfällt auch mit dem Konto. Auf Anfrage löscht die Leitung Daten. Eine anonyme Meldung kennt keine Person und lässt sich darum nur über den Rückfragecode oder durch die Lagerleitung finden.

#### Dokumente im Lager

- **Daten:** Für jedes Dokument: der Titel, die Stichworte, der Verweis auf die Datei, ob das Team es sehen darf, wann es angelegt wurde und von welchem Konto.
- **Zweck:** Unterlagen des Lagers auffindbar machen: Ein Dokument hat einen Titel, Stichworte und verweist auf eine Datei im SharePoint der Abteilung (siehe «Dateien im Lager»). Wer Dokumente bearbeiten darf (im Standard Lagerleitung und Leitung), gibt ein Dokument für das Team frei; ohne Freigabe sieht das Team es nicht. Cevi OS speichert nur den Verweis, nie den Inhalt. Die Suche läuft nur über Titel und Stichworte.
- **Aufbewahrung:** Bis die Leitung das Dokument löscht oder das Lager gelöscht wird; die Datei am Ablageort bleibt. Mit dem Konto verschwindet nur die Angabe, wer das Dokument angelegt hat. Auf Anfrage löscht die Leitung Daten.

#### Adressbuch im Lager

- **Daten:** Für jeden Kontakt: der Name, die Funktion, die Gruppe, die Telefonnummer, die E-Mail-Adresse, eine Notiz und ob er für das nächste Lager behalten wird. Dazu wann er erfasst wurde und von welchem Konto. Es sind Daten von Personen, die selbst kein Konto haben.
- **Zweck:** Externe Kontakte des Lagers an einem Ort haben, zum Beispiel Bäckerei, Platzwart oder Behörde. Die Lagerleitung erfasst Name, Funktion, Gruppe, Telefonnummer, E-Mail-Adresse und eine Notiz. Es sind Daten Dritter, die selbst kein Konto haben: Nur die Lagerleitung liest und ändert sie (die Rechte lassen sich je Lager einstellen), und jedes Lesen steht im Protokoll, ohne die Inhalte. Wer einen Kontakt für das nächste Lager behalten will, markiert ihn.
- **Aufbewahrung:** 180 Tage nach dem Ende des Lagers löscht Cevi OS jeden Kontakt endgültig, ausser er ist mit «Fürs nächste Lager behalten» markiert; 14 Tage vorher erinnert Cevi OS die Lagerleitung. Markierte Kontakte bleiben, bis die Lagerleitung sie löscht oder das Lager gelöscht wird. Ein gelöschter Kontakt verschwindet nach 30 Tagen endgültig. Mit dem Konto verschwindet nur die Angabe, wer den Kontakt erfasst hat. Auf Anfrage löscht die Leitung Daten.

#### Höcks und Traktanden im Lager

- **Daten:** Für jeden Höck: Art (Lagerleitung oder Team), Datum, Zeit, Ort, Titel, Gäste als Freitext und die Konten der Personen, die dabei waren. Für jedes Traktandum: Titel, Notizen, ein kurzer Entscheid, Links, die Konten der Verantwortlichen, die Reihenfolge, eine geplante Dauer in Minuten und ein Verweis auf eine Aufgabe.
- **Zweck:** Die Sitzungen des Lagers planen und festhalten: Datum, Zeit, Ort und Titel eines Höcks, wer beim Höck war, Gäste als Freitext, die Traktanden mit Notizen, Links, Verantwortlichen und einem kurzen Entscheid. Das Team sieht nur Höcks der Art Team, und von diesen nur Datum, Zeit, Titel und Ort. Ein Höck lässt sich als Kalenderdatei laden; sie enthält nur Titel, Ort, Datum und Zeit. Das Protokoll liegt als Verknüpfung auf eine Datei im SharePoint der Abteilung.
- **Aufbewahrung:** Bis die Leitung den Höck oder das Traktandum löscht, das Lager gelöscht wird oder das Konto gelöscht wird. Auf Anfrage löscht die Leitung Daten.

#### Protokolle und Beschlüsse im Lager

- **Daten:** Für jedes Protokoll: die Art, der Titel, das Datum, optional der Höck, der Verweis auf die Datei, wann es angelegt wurde und von welchem Konto. Für jeden Beschluss: der Text, optional der Verweis auf Protokoll und Höck, wann er angelegt wurde und von welchem Konto.
- **Zweck:** Protokolle und Beschlüsse eines Lagers festhalten und auffindbar machen: Ein Protokoll hat eine Art (Sitzung, Notiz, Kontakt oder Idee), einen Titel, ein Datum, optional einen Höck und verweist auf eine Datei im SharePoint der Abteilung (siehe «Dateien im Lager»). Cevi OS speichert nur den Verweis, nie den Inhalt des Protokolls, und ruft den Link nie ab; wer die Datei öffnen darf, regelt der Ablageort. Ein Beschluss ist ein kurzer Text mit optionalem Verweis auf Protokoll und Höck. Protokolle und Beschlüsse sieht nur, wer das Recht dazu hat, und das Team nie, wenn sie zu einem Höck der Lagerleitung gehören.
- **Aufbewahrung:** Bis die Leitung das Protokoll oder den Beschluss löscht oder das Lager gelöscht wird; die Datei am Ablageort bleibt. Mit dem Konto verschwindet nur die Angabe, wer den Eintrag angelegt hat. Auf Anfrage löscht die Leitung Daten.

#### Benachrichtigungen im Lager

- **Daten:** Für jede Benachrichtigung: an wen sie ging, in welchem Lager, ihre Art, das Ziel (zum Beispiel eine Aufgabe), ob und wann die Person sie gelesen hat und wann sie entstand. Dazu die Schalter, mit denen eine Person eine Art abschaltet. Einen Text speichert die Benachrichtigung nicht.
- **Zweck:** Die Mitglieder eines Lagers über Neues im Lager informieren, zum Beispiel über eine zugeteilte Aufgabe oder eine wichtige Mitteilung. Die Benachrichtigung zeigt in der App eine Liste mit Art und Ziel, der Push nennt nur den Lagertitel. Jede Person schaltet jede Art selbst ab.
- **Aufbewahrung:** Gelesene Benachrichtigungen 90 Tage, ungelesene bis die Person das Lager verlässt oder das Konto gelöscht wird. Auf Anfrage löscht die Leitung Daten.

#### Erwähnungen im Lager

- **Daten:** Für jede Erwähnung: wer erwähnt wurde, in welchem Lager und in welchem Inhalt (Art und Ziel), ob die Person sie erledigt hat, die Aufgabe, die sie daraus gemacht hat, und wann sie entstand. Den Text des Inhalts speichert die Erwähnung nicht.
- **Zweck:** Wer in einem Inhalt des Lagers (Aufgabe, Traktandum, Pinnwand-Beitrag, Beschluss) erwähnt wird, soll es merken: Cevi OS benachrichtigt die Person, und sie kann die Erwähnung als erledigt markieren oder daraus eine Aufgabe machen. Die Erwähnung speichert nur, wer in welchem Inhalt erwähnt wurde, nie den Text; sie sieht nur die erwähnte Person.
- **Aufbewahrung:** Bis die Marke aus dem Inhalt entfällt (ausser es ist daraus eine Aufgabe entstanden), die Person das Lager verlässt oder das Lager gelöscht wird. Auf Anfrage löscht die Leitung Daten.

#### Medien

- **Daten:** Bilder, die Personen mit Zugang zur Website hochladen, mit Grösse, Alt-Text, Sichtbarkeit und der Angabe, wer sie hochgeladen hat. Bilder verkleinert der Server und kodiert sie neu; Daten wie der Aufnahmeort gehen dabei verloren. Die Dateien liegen in einem eigenen Speicher, nicht in der Datenbank.
- **Zweck:** Bilder der Abteilung bereitstellen, zum Beispiel für die Website. Wer die Website bearbeiten darf, lädt sie hoch. Wer ein Medium sehen darf, legt die hochladende Person beim Hochladen fest.
- **Aufbewahrung:** Bis die Leitung oder ein Webmaster das Medium löscht. Mit dem Konto verschwindet nur die Angabe, wer es hochgeladen hat.

#### Seiten der Website

- **Daten:** Die Seiten der Website der Abteilung: Adresse, Titel, Stellung im Menü, wer sie sieht, der Inhalt als Entwurf und die veröffentlichten Stände mit der Angabe, welches Konto sie erstellt hat. Dazu kommen die Weiterleitungen alter Adressen auf neue Seiten, ebenfalls mit der Angabe, welches Konto sie angelegt hat. Auf einer öffentlichen Seite können der Cevi-Name und die Funktion von Leitenden stehen, nie Telefon, E-Mail oder Foto.
- **Zweck:** Die Seiten der Website der Abteilung aufbauen und verwalten: Adresse, Titel, Reihenfolge, wer sie sieht, und der Inhalt als Entwurf und als veröffentlichte Stände. Bei einem Stand steht, welches Konto ihn erstellt hat. Alte Adressen der Website leiten auf die neuen Seiten weiter; bei einer Weiterleitung steht, welches Konto sie angelegt hat.
- **Aufbewahrung:** Bis ein Webmaster die Seite oder die Weiterleitung löscht. Mit dem Konto verschwindet nur die Angabe, wer einen Stand oder eine Weiterleitung erstellt hat.

#### Anlässe und Anmeldungen

- **Daten:** Zu jedem Anlass: der Termin, ob die Anmeldung offen ist und bis wann, ob sich Kinder oder Personen anmelden, wer den Anlass sieht, die Seite der Website und welches Konto den Anlass angelegt hat. Dazu die Zusatzfragen der Anmeldung mit Beschriftung, Art (Text, Ja oder Nein, Auswahl), Auswahlmöglichkeiten und der Angabe, ob sie Pflicht sind. Zu jeder Anmeldung: welches Konto sie angelegt hat, bei einem Kind welches Kind, deine Antworten auf die Zusatzfragen, ob die Anmeldung gilt, und wann sie angelegt und zuletzt geändert wurde. Name, Cevi-Name und die Stufe des Kindes speichert die Anmeldung nicht: Sie werden aus dem Konto und den Angaben zum Kind gelesen. Gesundheitsdaten fragt die Anmeldung nicht ab.
- **Zweck:** Die Abteilungsleitung macht aus einem Termin einen Anlass, zu dem sich Kinder oder Personen anmelden können, und legt fest, bis wann die Anmeldung offen ist, wer den Anlass sieht und welche Zusatzfragen die Anmeldung stellt (Text, Ja oder Nein, Auswahl). Die Fragen dürfen keine Gesundheitsdaten verlangen. Zum Anlass entsteht eine Seite der Website als Entwurf. Wer den Anlass sieht, meldet sich über das Konto an: Eltern melden ihr Kind an, andere Personen sich selbst, und beides geht bis zum Anmeldeschluss. Name, Cevi-Name und die Stufe des Kindes liest die Anmeldung aus dem Konto und füllt sie vor; gespeichert werden nur die Antworten auf die Zusatzfragen, wer angemeldet hat und ob die Anmeldung gilt. Die Abteilungsleitung sieht die Anmeldungen mit Name und Telefon aus dem Konto und kann sie als CSV-Datei laden; der Server speichert die Datei nicht und hält im Protokoll nur fest, wann der Export lief und wie viele Anmeldungen er enthielt.
- **Aufbewahrung:** Den Anlass bis die Abteilungsleitung ihn löscht; das geht nur, solange es keine Anmeldungen gibt. Die Anmeldungen löscht der Server 180 Tage nach dem Ende des Anlasses; die Antworten einer Abmeldung löscht er sofort. Anlässe der Art Lager sind von diesem Lauf ausgenommen, ihre Anmeldungen behandelt das Lager. Mit dem Konto verschwinden die Anmeldungen, die es angelegt hat, und die Angabe, wer den Anlass angelegt hat. Die Seite der Website bleibt, bis ein Webmaster sie löscht.

#### Angaben aus der Cevi-Datenbank

- **Daten:** Die Nummer deines Eintrags in der Cevi-Datenbank (bei dir oder deinem Kind), bei einem Zusatzfeld der Anmeldung die Angabe, aus welcher Angabe der Cevi-Datenbank es sich füllt, und je Abteilung die Gruppe, der Zeitpunkt des letzten Abrufs, sein Ergebnis (ok oder Fehler) und die Zahl der Personen. Die Angaben selbst (Geburtsdatum, Telefon, Adresse, E-Mail) speichert Cevi OS nur, wenn du sie mit der Anmeldung absendest. Ausnahme ist das Geschlecht einer Person mit Konto, die eindeutig zugeordnet ist (siehe «Geschlecht der Person»). Zugangsdaten zur Cevi-Datenbank stehen nur in der Umgebung des Servers.
- **Zweck:** Die Anmeldung füllt Angaben vor, die du in der Cevi-Datenbank selbst gemacht hast, damit du sie nicht noch einmal eintippst: Geburtsdatum, Telefon, Adresse und E-Mail, aber nur die Angaben, die der Anlass in der Anmeldung fragt. Der Server liest sie beim Öffnen der Anmeldung mit dem Zugang der Abteilung, nur lesend, ordnet dich nur bei einem eindeutigen Treffer zu und zeigt sie als Vorschlag, den du ändern kannst. Gespeichert wird erst, was du mit der Anmeldung absendest, dann wie jede andere Antwort. Ausnahme ist das Geschlecht einer Person mit Konto, die eindeutig zugeordnet ist (siehe «Geschlecht der Person»). Gesundheitsangaben holt Cevi OS nie. Was in der Cevi-Datenbank fehlt, fragt die Anmeldung wie sonst. Zusätzlich merkt sich Cevi OS die Nummer deines Eintrags in der Cevi-Datenbank, damit die nächste Zuordnung eindeutig ist, und in den Einstellungen die Gruppe der Abteilung und den Stand des letzten Abrufs (Zeitpunkt, Ergebnis und Zahl der Personen).
- **Aufbewahrung:** Die Personen aus der Cevi-Datenbank liegen höchstens 15 Minuten im Arbeitsspeicher des Servers und nie in der Datenbank. Die Nummer bleibt, bis das Konto oder das Kind gelöscht wird. Die übernommenen Angaben löscht der Server mit der Anmeldung. Auf Anfrage löscht die Leitung Daten.

### 11.3 Woher die Daten stammen

- Die Daten der Kinder stammen von den Eltern und von der Abteilung. Die Leitung trägt sie ein. Die Kinder selbst geben nichts ein; ein Kind mit eigenem Konto kann nur die Programme seiner Stufe beantworten und, wenn die Abteilung es erlaubt, im Gruppenchat schreiben.
- Angaben wie Geburtsdatum, Telefon, Adresse und E-Mail können aus der Cevi-Datenbank stammen, wo du sie selbst angegeben hast. Die Anmeldung füllt sie nur vor, wenn der Anlass sie fragt, und du kannst sie vor dem Absenden ändern oder löschen.
- Das Geschlecht einer Person mit Konto kann aus der Cevi-Datenbank stammen, wenn die Person dort eindeutig zugeordnet ist. Eine Angabe in der Verwaltung hat immer Vorrang. Von Kindern übernimmt Cevi OS es nie.
- Die Konten legt die Leitung an. Name und Benutzername stammen von ihr, das Startpasswort ebenfalls, du wählst danach dein eigenes.
- Die Programme stammen aus dem Outlook-Kalender der Abteilung. Cevi OS liest ihn nur und schreibt nichts hinein. Treffpunkt, Schluss und Mitnehmen trägt die Stufenleitung in Cevi OS ein.
- Nachrichten, Anmeldungen und deine Einstellungen gibst du selbst ein.

### 11.4 Wer was sieht

- Ein Kind mit eigenem Konto sieht nur sich selbst: die Programme und die Leitung seiner Stufe, die eigene Anmeldung und, wenn die Abteilung es erlaubt, den Gruppenchat der Stufe (lesen oder auch schreiben). Es sieht nie andere Kinder, deren Eltern oder eine Telefonnummer, hat keinen Einzelchat mit der Leitung und keinen Zugang zur Verwaltung. Die verknüpften Eltern sehen weiter, was das Kind sieht, ausser die Abteilung hat das Konto dem Kind ganz übergeben.
- Eltern sehen ihre eigenen Kinder und die Programme, die für ihre Stufe freigegeben sind. Im Gruppenchat einer Stufe sehen sie die Nachrichten und die Namen der anderen Eltern dieser Stufe. Die Telefonnummer einer Stufenleitung sehen nur Eltern mit einem aktiven Kind in dieser Stufe.
- Leitende sehen die Programme ihrer Stufe und die Liste der An- und Abmeldungen ihrer Stufe.
- Wer einen Termin sieht, bestimmen seine Kategorien im Kalender: Sie werden zu Tags. Du siehst die Termine, die zu deinen Tags gehören; Eltern sehen sie über die Stufen ihrer Kinder. Ein Termin ohne Tag ist keiner Gruppe zugewiesen: Nur die Abteilungsleitung sieht ihn in der Liste aller Termine im Web; ältere App-Versionen zeigen ihn auch der Stufenleitung.
- Einen Terminvorschlag sehen nur die Person, die ihn gemacht hat, und die Abteilungsleitung. Eine Anmeldung zu einem Anlass sehen die Person, die sich angemeldet hat, und die Abteilungsleitung; nur sie sieht Name, Telefon und die Antworten aller Angemeldeten und kann sie als CSV-Datei laden. Eine Raumanfrage sehen die anfragende Person, das Team des Raums und, wenn der Raum kein Team hat, die Abteilungsleitung.
- Die Stufenleitung liest den Gruppenchat ihrer Stufe und alle Einzelchats ihrer Stufe. Einen Einzelchat liest das ganze Team der Stufenleitung, nicht nur eine Person. Sie sieht dabei die Namen der Eltern.
- Die Abteilungsleitung verwaltet Personen, Kinder, Stufen, Rollen, Tags, Bearbeitungsrechte und Medien und liest keine Chats. Welche Rechte sie dabei hat, stellt der Entwickler der Plattform ein; er sieht dabei keine Personendaten, nur die Rechte. Wer eine Rolle als Stufenleitung vergibt, gibt damit Zugriff auf die Chats der Stufe. Solche Änderungen stehen im Protokoll der Verwaltung.
- Ein Profilbild sehen nur angemeldete Personen, die die Person ohnehin mit Namen sehen, und die Person selbst: wer eine Nachricht der Person im Chat sieht; die Stufenleitung im Einzelchat mit einem Elternteil; bei den Kontakten einer Stufe die Abteilungsleitung, die Leitenden und die Stufenleitung dieser Stufe sowie Eltern mit einem aktiven Kind darin; bei den Kontakten eines Programms alle, die das Programm sehen. Es gibt keine öffentliche Adresse für Profilbilder auf der Plattform. Gibt eine Person ihr Bild für die öffentliche Website frei, legt der Server eine Kopie als Datei in die Website; sie trägt einen Zufallsnamen ohne Hinweis auf die Person und verschwindet beim nächsten Abgleich nach dem Widerruf, dem Deaktivieren oder dem Löschen des Kontos.
- Ein Medium sehen nach der Wahl der Leitung entweder alle, die seine Adresse kennen (öffentlich), oder nur angemeldete Personen derselben Abteilung (angemeldet). Öffentliche Medien liefert der Server ohne Anmeldung aus.
- Wer den Server betreibt, kann technisch alle Daten lesen.

### 11.5 An wen Daten gehen

- Cevi OS läuft auf einem virtuellen Server (VPS) mit der Datenbank. Die verschlüsselten Backups liegen auf einem S3-Speicher in der Schweiz.
- Die Dateien der Medien (Bilder) liegen in einem eigenen S3-kompatiblen Speicher, nicht in der Datenbank.
- Dateien wie Protokolle, Dokumente und Programmbilder liegen im SharePoint der Abteilung (Microsoft 365). Cevi OS speichert nur den Link, nie den Inhalt, und ruft den Link nie ab.
- Microsoft liefert den Kalender der Abteilung (Outlook). Cevi OS liest daraus die Programme und schickt nichts über Personen dorthin.
- Für die Vorbefüllung der Anmeldung und das Geschlecht im Konto liest der Server mit dem Zugang der Abteilung die Personen der eigenen Ebene aus der Cevi-Datenbank, nur lesend, und hält sie höchstens 15 Minuten im Arbeitsspeicher. Die Cevi-Datenbank erfährt nur die IP-Adresse des Servers und den Zugang der Abteilung, nie, wer sich anmeldet oder wofür.
- Beim Anlegen eines Ortes der Abteilung (zum Beispiel eines Treffpunkts) schlägt Cevi OS Adressen vor. Dafür schickt der Server den Text, den die Leitung ins Suchfeld tippt, an die Ortssuche des Bundes (geo.admin.ch). Der Dienst erfährt diesen Suchtext und die IP-Adresse des Servers, nie dein Konto, deinen Namen oder Angaben zu anderen Personen. Der Suchtext wird nicht gespeichert.
- Für das Wetter im Lager holt der Server die Vorhersage beim Dienst Open-Meteo. Der Dienst erfährt nur die Breite und Länge des Lagerorts auf zwei Stellen gerundet und die IP-Adresse des Servers, nie Namen, Konten oder Angaben zu Personen. Ein Abruf erfolgt höchstens einmal in sechs Stunden je Lager. Den Wetterort bestimmt der Server aus dem Ort des Lagers: Dazu fragt er den Ortsdienst von Open-Meteo einmal nach dem Ortsnamen (nur der Name, nie die Adresse, und nur wenn sich der Ort ändert).
- Pushes laufen über Firebase Cloud Messaging von Google und, auf dem iPhone, weiter über den Push-Dienst von Apple. Beide Dienste stehen in den USA. Sie erfahren das Push-Token deines Geräts, den Zeitpunkt und den Titel des Pushes, also den Namen eines Chats oder eines Programms. Nachrichtentext und Kindernamen sind nie dabei. Die Übermittlung stützt sich auf das Swiss-U.S. Data Privacy Framework oder, wo ein Empfänger dort nicht zertifiziert ist, auf Standardvertragsklauseln.
- Beim Festlegen eines neuen Passworts prüft der Server, ob es in bekannten Datenlecks vorkommt. Er schickt dazu nur die ersten fünf Zeichen des Prüfwerts (SHA-1) des Passworts an den Dienst Pwned Passwords von Have I Been Pwned. Der Dienst erfährt weder dein Passwort noch deinen Namen noch deine IP-Adresse, denn die Anfrage kommt vom Server.
- Abonnierst du die Termine mit deinem persönlichen Kalenderlink, ruft deine Kalender-App den Link ab. Je nach App tut das ihr Anbieter von seinen eigenen Servern aus und sieht dann Titel, Ort, Zeit und Stand deiner Termine. Das entscheidest du; du kannst den Link jederzeit widerrufen.
- Ist bei einem Treffpunkt oder Schlussort ein Standort hinterlegt, zeigt die Stufenseite den Link «Auf Google Maps ansehen». Es ist nur ein Link: Die Seite lädt keine Karte und kein Skript von Google, und der Server ruft Google nie ab. Erst wenn du den Link anklickst, verbindet sich dein Browser mit Google (Google Maps), ohne dass die Website mitgeschickt wird, woher du kommst; ab dann gelten die Bedingungen von Google. Cevi OS erfährt davon nichts.
- Die Fotos der Abteilung liegen bei Flickr (USA). Für die Website holt der Server Alben und Bilder dort mit dem Zugang der Abteilung und zeigt sie nur angemeldeten Personen. Dein Browser verbindet sich nie mit Flickr. Flickr erfährt nur die IP-Adresse des Servers und welche Alben und Bilder abgerufen werden, nie dein Konto, deinen Namen oder deine IP-Adresse. Die Leitung gibt nur Alben frei, für die die Einwilligung nach Abschnitt 10 vorliegt. Cevi OS speichert keine Bilder: Der Server reicht sie durch.
- Cevi OS selbst gibt sonst keine Daten an Dritte weiter und verkauft sie nicht. Was die Abteilung ausserhalb von Cevi OS weitergibt, steht in Abschnitt 4.

### 11.6 Wie lange Daten bleiben

Cevi OS löscht Nachrichten, Anmeldungen zu Programmen, Kinder und Konten nicht automatisch. Sie bleiben, bis eine Person sie löscht oder das Konto gelöscht wird. Auf Anfrage löscht die Leitung Daten. In der App kannst du dein Konto nicht selbst löschen (siehe Abschnitt 7). Wird ein Konto gelöscht, gehen die Nachrichten der Person mit; bei Eltern gehen auch der Einzelchat und die Zuordnung zu den Kindern mit. Die Kinder und ihre Anmeldungen bleiben, bis die Leitung sie löscht; löscht sie ein Kind mit eigenem Konto, geht das Konto mit seinen Nachrichten mit. Wie du eine Löschung verlangst, steht unter [Konto löschen](/konto-loeschen).

Im Lager ist Löschen endgültig. Was die Leitung im Lager löscht, ist sofort aus der Datenbank entfernt; es gibt keinen Papierkorb und keine Wiederherstellung. Teile, die an einer gelöschten Zeile hängen, gehen mit (zum Beispiel die Schichten eines Dienstes). Geräte mit einer Offline-Kopie erfahren die Löschung bei der nächsten Verbindung; dafür bleibt 30 Tage lang ein Vermerk ohne Inhalt auf dem Server (Art des Eintrags und Kennung).

Zeitliche Regeln gibt es für diese Daten:

- Logs des Servers und des Webservers: 14 Tage.
- Vermerke über gelöschte Einträge im Lager (nur Art und Kennung): 30 Tage.
- Einträge der Begrenzung von Anfragen mit IP-Adresse: frühestens 15 Minuten nach der letzten Anfrage.
- Backups: 30 tägliche und 3 monatliche Stände. Gelöscht wird also auch erst aus den Backups, wenn die Stände ablaufen; das dauert rund drei Monate. Der Schutz vor dem Löschen beim Speicheranbieter kann das um bis zu 30 Tage verlängern.
- Widerrufene persönliche Kalenderlinks: 30 Tage nach dem Widerruf.
- Anmeldungen zu Anlässen: 180 Tage nach dem Ende des Anlasses.
- Raumanfragen und Buchungen: 180 Tage nach dem Ende der angefragten Zeit.
- Bestellungen im Lädeli: 180 Tage nach der Übergabe oder dem Stornieren; nie abgeschlossene ein Jahr nach der letzten Änderung.
- Terminvorschläge: keine automatische Frist; sie bleiben, bis die Leitung sie löscht oder die vorschlagende Person einen offenen zurückzieht.
- Lager: Teilnehmende samt Einteilung und Abzählen sechs Monate nach dem Ende des Lagers; Kontakte im Adressbuch 180 Tage nach dem Ende des Lagers (ausser sie sind zum Behalten markiert); gelesene Benachrichtigungen 90 Tage; das Verzeichnis der Änderungen und die Ergebnisse gesammelter Änderungen 30 Tage.
- Wetter, Aushänge und Suche speichern nichts über Personen; ein Aushang als PDF wird bei jedem Abruf neu erzeugt.

### 11.7 Wie wir Daten schützen

- Die Verbindung zur App ist verschlüsselt (HTTPS).
- Das Passwort ist nur als Prüfwert gespeichert. Die Abteilungsleitung meldet sich zusätzlich mit einem zweiten Faktor an.
- Die Rechte prüft der Server bei jeder Anfrage, nicht die App. Was du nicht sehen darfst, liefert er nicht aus.
- Die App speichert Daten vom Server nur auf deinem Gerät, wenn du eine Offline-Kopie in den Einstellungen einschaltest (Vorgabe: aus). Die Sitzung liegt im geschützten Speicher des Geräts. Eine App-Sperre schützt sie zusätzlich.
- Die Backups sind verschlüsselt.
- Diese Seite setzt keine Cookies, lädt nichts von anderen Servern und nutzt kein Tracking.

### 11.8 Die öffentliche Website

Die öffentlichen Seiten der Abteilung sind fertige Dateien; ein Besuch fragt die Datenbank nicht ab. Die Website nutzt kein Tracking, keine Analyse und keine Werbung. Sie setzt keine Cookies und lädt keine Schriften, Skripte, Karten oder Videos von anderen Servern; ein Video erscheint nur als Link. Nur wer sich für geschützte Inhalte anmeldet, bekommt das Cookie der Sitzung (siehe Abschnitt 8.2.2), und nur dafür. Wie bei jeder Anfrage hält der Server die IP-Adresse in seinen Logs, 14 Tage lang. Auf den Seiten stehen von Leitenden höchstens der Cevi-Name und die Funktion, nie Telefon, E-Mail oder Foto.

Der Datenplan der Abteilung ist öffentlich: Die Seite «Termine» zeigt ohne Anmeldung Titel, Datum, Zeit, Treffpunkt und Stufe der Programme und der öffentlichen Anlässe. Namen von Kindern, Eltern oder Leitenden, Anmeldungen und Teilnahmen stehen dort nie. Termine, die nur für Leitende gedacht sind, erscheinen nicht.
`;
