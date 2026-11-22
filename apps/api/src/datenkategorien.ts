// Welche Daten Cevi OS bearbeitet: jede Spalte der Datenbank mit ihrer Kategorie, dazu Zweck und Frist je Kategorie.
// Ein Test hält diese Datei, das Drizzle-Schema und public/datenschutz.html zusammen (test/datenkategorien.test.ts).
// Die Angaben für Apple «App Privacy» und Google «Data safety» stammen aus derselben Datei; sie sind ein Vorschlag und werden vor dem Store-Eintrag gegen die aktuellen Formulare geprüft.

export type Kategorie = {
  titel: string;
  zweck: string;
  frist: string;
  // Datentypen der Formulare der Stores; leer heisst: keine Personendaten im Sinne des Formulars
  apple: string[];
  google: string[];
};

const AUF_ANFRAGE = "Auf Anfrage löscht die Leitung Daten.";

export const KATEGORIEN = {
  konto: {
    titel: "Konto und Anmeldung",
    zweck:
      "Anmelden, Rechte prüfen und das Konto vor Missbrauch schützen. Dazu gehört das Passwort, das nur als Prüfwert gespeichert ist.",
    frist: `Bis das Konto gelöscht wird. ${AUF_ANFRAGE}`,
    apple: ["Contact Info: Name", "Identifiers: User ID"],
    google: ["Personal info: Name", "Personal info: User IDs"],
  },
  telefon: {
    titel: "Telefonnummer der Stufenleitung",
    zweck:
      "Eltern erreichen die Stufenleitung ihrer Stufe. Die Nummer ist freiwillig.",
    frist: "Bis die Person die Nummer entfernt oder das Konto gelöscht wird.",
    apple: ["Contact Info: Phone Number"],
    google: ["Personal info: Phone number"],
  },
  kalenderlink: {
    titel: "Persönlicher Kalenderlink",
    zweck:
      "Du abonnierst die Termine, die du in der App siehst, in einer Kalender-App. Der Link ist geheim und gehört nur dir; du kannst ihn jederzeit erneuern oder widerrufen.",
    frist:
      "Bis du den Link widerrufst oder erneuerst oder das Konto gelöscht wird; ein widerrufener Link verschwindet nach 30 Tagen ganz.",
    apple: ["Other Data"],
    google: ["Personal info: Other info"],
  },
  profilbild: {
    titel: "Profilbild",
    zweck:
      "Andere Personen erkennen, wer schreibt oder wen sie erreichen. Das Bild ist freiwillig, und jede Person lädt nur ihr eigenes hoch.",
    frist:
      "Bis die Person das Bild löscht oder das Konto deaktiviert oder gelöscht wird. Von Kindern gibt es nie ein Bild.",
    apple: ["User Content: Photos or Videos"],
    google: ["Photos and videos: Photos"],
  },
  kinder: {
    titel: "Kinder",
    zweck:
      "Die Eltern melden ihr Kind zu Programmen an oder ab, und die Leitung sieht, wer kommt.",
    frist: `Bis die Leitung den Eintrag löscht. ${AUF_ANFRAGE}`,
    apple: ["Contact Info: Name"],
    google: ["Personal info: Name"],
  },
  rollen: {
    titel: "Rollen, Stufen und Tags",
    zweck:
      "Festlegen, wer welche Programme, Anmeldungen und Chats sehen darf. Tags (Stufe, Funktion, Team, Lager) ordnen Personen Gruppen zu. Bearbeitungsrechte und Plattformrollen legen fest, wer Inhalte ändern darf.",
    frist: "Bis die Leitung die Rolle entfernt oder das Konto gelöscht wird.",
    apple: ["Other Data"],
    google: ["Personal info: Other info"],
  },
  programme: {
    titel: "Programme",
    zweck:
      "Information über Zeit und Ort der Programme. Sie stammen aus dem Kalender der Abteilung und von den Angaben, die die Stufenleitung pflegt.",
    frist:
      "Bis die Leitung das Programm löscht. Der Kalender der Abteilung bleibt unverändert.",
    apple: [],
    google: [],
  },
  anmeldungen: {
    titel: "Anmeldungen und Abmeldungen",
    zweck:
      "Zeigen, ob ein Kind zu einem Programm kommt (Ja oder Nein) und ob eine Leitungsperson dabei ist.",
    frist: `Bis die Leitung die Anmeldung, das Kind oder das Programm löscht. ${AUF_ANFRAGE}`,
    apple: ["Other Data"],
    google: ["App activity: Other actions"],
  },
  anwesenheit: {
    titel: "Anwesenheit",
    zweck:
      "Die Leitung hält fest, wer bei einem Programm da war, und sieht pro Stufe, wie oft jemand kam.",
    frist: `Bis die Leitung den Eintrag, das Kind oder das Programm löscht. ${AUF_ANFRAGE}`,
    apple: ["Other Data"],
    google: ["App activity: Other actions"],
  },
  terminvorschlaege: {
    titel: "Terminvorschläge",
    zweck:
      "Berechtigte Personen schlagen der Abteilungsleitung einen Termin vor, mit Titel, Zeit, Ort, Beschreibung, gewünschten Kategorien und einer Bemerkung. Die Abteilungsleitung entscheidet; in Outlook trägt sie den Termin von Hand ein. Die vorschlagende Person sieht ihre Vorschläge mit dem Stand und kann einen offenen zurückziehen. Der Push an die Abteilungsleitung nennt weder Titel noch Namen.",
    frist: `Bis die Leitung den Vorschlag löscht oder die vorschlagende Person ihn zurückzieht. Mit dem Konto verschwindet nur die Angabe, wer vorgeschlagen oder entschieden hat. ${AUF_ANFRAGE}`,
    apple: ["User Content: Other User Content"],
    google: ["App activity: Other user-generated content"],
  },
  chat: {
    titel: "Chats",
    zweck:
      "Austausch zwischen Eltern und Stufenleitung im Gruppenchat der Stufe und im Einzelchat mit der Stufenleitung.",
    frist: `Bis die Nachricht oder das Konto gelöscht wird. ${AUF_ANFRAGE}`,
    apple: ["User Content: Emails or Text Messages"],
    google: ["Messages: Other in-app messages"],
  },
  benachrichtigungen: {
    titel: "Benachrichtigungen",
    zweck:
      "Pushes zu neuen Nachrichten, zu An- und Abmeldungen und zu Erinnerungen zustellen. Das Token gehört zum Gerät und zur Sitzung.",
    frist:
      "Bis die Sitzung endet, also beim Abmelden, beim Deaktivieren und beim Löschen des Kontos.",
    apple: ["Identifiers: Device ID"],
    google: ["Device or other IDs"],
  },
  technik: {
    titel: "Technische Daten",
    zweck:
      "Sitzungen führen, Anfragen begrenzen und Fehler finden. Dazu gehören IP-Adressen in den Logs und für die Begrenzung.",
    frist:
      "Logs 14 Tage. Die Begrenzung der Anfragen löscht ihre Einträge frühestens 15 Minuten nach der letzten Anfrage. Sitzungen enden nach 90 Tagen ohne Nutzung oder früher mit dem Abmelden.",
    apple: ["Diagnostics: Other Diagnostic Data"],
    google: ["App info and performance: Diagnostics"],
  },
  protokoll: {
    titel: "Protokoll der Verwaltung",
    zweck:
      "Nachvollziehen, welche Verwaltungsaktion wann auf wen oder was zielte. Das Protokoll enthält Kennungen, keine Namen.",
    frist: "Das Protokoll bleibt; es enthält keine Personendaten.",
    apple: [],
    google: [],
  },
  abteilung: {
    titel: "Angaben der Abteilung",
    zweck:
      "Die Abteilung, ihre Stufen (mit freiwilligem Logo) und die Anbindung an den Kalender.",
    frist: "Bis die Leitung die Angaben ändert oder löscht.",
    apple: [],
    google: [],
  },
  medien: {
    titel: "Medien",
    zweck:
      "Bilder und PDFs der Abteilung bereitstellen, zum Beispiel für die Webseite. Nur die Leitung lädt sie hoch. Wer ein Medium sehen darf, legt die Leitung beim Hochladen fest.",
    frist:
      "Bis die Leitung das Medium löscht. Mit dem Konto verschwindet nur die Angabe, wer es hochgeladen hat.",
    apple: ["User Content: Photos or Videos"],
    google: ["Photos and videos: Photos"],
  },
  lager: {
    titel: "Lager und Lagermitglieder",
    zweck:
      "Die Abteilungsleitung legt Lager an und legt fest, wer im Lager mitarbeitet und mit welcher Rolle (Lagerleitung, Leitung, Team oder Lesen). Die Rolle bestimmt, was eine Person im Lager sehen und ändern darf. Die Lagerleitung und die Abteilungsleitung stellen ein, welche Rechte Leitung, Team und Lesen im Lager haben. Die Ressorts gliedern die Arbeit im Lager: Jedes hat eine Leitung und eine Stellvertretung, dazu Links und Notizen. Die Aufgaben halten fest, was im Lager zu tun ist, mit Status, Frist, Ressort, einer verantwortlichen Person und deren Unterstützung. Checkliste, Links und Stichworte halten Teilschritte, Unterlagen und Schlagwörter der Aufgabe fest; eine wiederkehrende Aufgabe legt beim Erledigen die nächste an. Die Einkaufsliste hält fest, was fürs Lager eingekauft wird und wer es einkauft.",
    frist: `Bis die Leitung die Mitgliedschaft entfernt oder das Konto gelöscht wird. ${AUF_ANFRAGE}`,
    apple: ["Other Data"],
    google: ["Personal info: Other info"],
  },
  lagerTeilnehmende: {
    titel: "Teilnehmende im Lager",
    zweck:
      "Die Lagerleitung erfasst, wer am Lager teilnimmt, und das Team zählt im Lager ab, wer da ist. Gespeichert sind nur Vorname, Nachname, Stufe und ein freiwilliger Cevi-Name, keine Angaben zur Gesundheit, keine Telefonnummer und keine Adresse. Das Team sieht Vorname, Nachname und Stufe.",
    frist:
      "Sechs Monate nach dem Ende des Lagers löscht ein automatischer Lauf die Teilnehmenden, das Abzählen und die Einteilung in Gruppen endgültig; im Protokoll der Verwaltung bleibt nur die Anzahl. Die Lagerleitung kann Einträge früher entfernen. Auf Anfrage löscht die Leitung Daten.",
    apple: ["Contact Info: Name"],
    google: ["Personal info: Name"],
  },
  lagerEinteilung: {
    titel: "Zimmer und Zelte im Lager",
    zweck:
      "Die Lagerleitung legt Zimmer und Zelte mit Namen, Art, Plätzen und einer Notiz an und teilt Teilnehmende und Mitglieder des Lagers ein. Das Team sieht nur das eigene Zimmer und die Namen der Mitbewohner. Gespeichert ist nur, wer in welchem Zimmer liegt, keine weiteren Angaben zur Person. Dazu legt sie Dienste an (zum Beispiel Küche oder Nachtwache, mit Abschnitt des Tages und nötiger Personenzahl) und teilt Mitglieder und Teilnehmende für jeden Lagertag ein, von Hand oder mit einem Vorschlag, der nach der eingetragenen Anwesenheit gleichmässig verteilt. Der Schichtplan ist für alle Mitglieder des Lagers lesbar; gespeichert ist nur, wer an welchem Tag in welchem Dienst steht. Wer im Team eine eigene Schicht tauschen oder abgeben möchte, stellt eine Anfrage an die Lagerleitung (mit freiwilliger Bemerkung und, wenn gewünscht, einer Wunschperson); die Lagerleitung klärt die Zustimmung selbst und nimmt die Anfrage an oder lehnt sie ab. Erst dann ändert sich die Einteilung. Ein Push über eine Anfrage oder ihren Entscheid nennt nur den Lagertitel. Aus diesen Angaben erzeugt Cevi OS auf Abruf Aushänge als PDF (Zimmerliste, Türschilder, Gruppenlisten, Fahrtenliste, Schichtplan, Organigramm); die Datei geht nur an die abrufende Person und wird nicht gespeichert.",
    frist:
      "Die Einteilung der Teilnehmenden (Zimmer und Dienste) geht mit den Teilnehmenden sechs Monate nach dem Ende des Lagers, die übrigen mit dem Lager. Die Lagerleitung kann Zimmer, Dienste und Einteilungen früher entfernen. Auf Anfrage löscht die Leitung Daten.",
    apple: ["Contact Info: Name"],
    google: ["Personal info: Name"],
  },
  lagerFahrten: {
    titel: "Fahrten im Lager",
    zweck:
      "Die Lagerleitung teilt die Hin- und Rückfahrt ein: Auto oder ÖV-Gruppe, mit Fahrer, Plätzen, Datum, Zeit, Treffpunkt und den Mitfahrenden (Leitende und Teilnehmende). Dazu kann sie einen Link auf den Fahrplan und einen Kartenpunkt als Ziel der Fahrt hinterlegen (Bezeichnung mit Adresse, Koordinaten oder Link), den die App in der Karten-App öffnet. Der Server speichert beides nur und ruft weder den Fahrplan noch einen Kartendienst ab. Das Team sieht nur die eigene Fahrt.",
    frist: `Bis die Lagerleitung die Fahrt oder die Mitfahrt löscht oder das Lager gelöscht wird; die Mitfahrt eines Teilnehmenden entfällt mit dem Teilnehmenden, sechs Monate nach dem Ende des Lagers. ${AUF_ANFRAGE}`,
    apple: ["Contact Info: Name"],
    google: ["Personal info: Name"],
  },
  lagerDatei: {
    titel: "Dateien im Lager (Verknüpfungen)",
    zweck:
      "Dateien, die im SharePoint der Abteilung liegen, im Lager auffindbar machen, zum Beispiel an einem Pinnwand-Beitrag oder einem Dokument. Cevi OS speichert nur den Link, den Anzeigenamen und, falls bekannt, Typ und Grösse, nie den Inhalt, und ruft den Link nie ab. Wer die Datei öffnen darf, regelt der Ablageort. Beim Eintrag steht, welches Konto ihn hinzugefügt hat. Die Abteilungsleitung kann festlegen, auf welchen Hosts die Links liegen dürfen. Eine Offline-Kopie legt nur die App an und nur, wenn die Person die Option in den Einstellungen der App einschaltet.",
    frist: `Bis die Leitung die Verknüpfung löscht oder das Lager gelöscht wird; ein Eintrag, den kein Datensatz einbindet, entfällt nach 24 Stunden. Die Datei am Ablageort bleibt immer. Mit dem Konto verschwindet nur die Angabe, wer den Eintrag hinzugefügt hat. ${AUF_ANFRAGE}`,
    apple: [],
    google: [],
  },
  lagerPinnwand: {
    titel: "Pinnwand im Lager",
    zweck:
      "Mitteilungen an die Mitglieder eines Lagers: Titel, Text, ob eine Mitteilung wichtig oder angeheftet ist, von wann bis wann sie sichtbar ist, und an wen sie sich richtet (alle, eine Rolle oder einzelne Personen), dazu Verknüpfungen auf Dateien im SharePoint. Bei einem Beitrag steht, welches Konto ihn geschrieben hat. Der Server zeigt jeder Person nur die Beiträge, die zu ihr passen und im Zeitfenster liegen. Eine wichtige Mitteilung löst einen Push aus, der nur den Lagertitel nennt, nie den Inhalt. An einem Beitrag kann eine Umfrage hängen: Die Antworten, welche Person welche Antwort gewählt hat und optional bis wann sie offen ist. Die Namen der Stimmen sieht nur die Leitung, ausser die Umfrage zeigt sie dem Team; sonst gibt es nur Zahlen. Jede Person kann auf einen Beitrag mit einem von fünf festen Zeichen reagieren; es zählen nur die Anzahl und die eigene Reaktion.",
    frist: `Bis die Leitung den Beitrag löscht oder das Lager gelöscht wird. ${AUF_ANFRAGE}`,
    apple: [],
    google: [],
  },
  lagerEingang: {
    titel: "Eingang im Lager",
    zweck:
      "Mitglieder des Lagers schicken der Lagerleitung eine Idee, einen Wunsch, eine Frage oder Feedback, auf Wunsch anonym. Gespeichert sind die Art, der Text, der Tag der Meldung, der Status, die Antwort der Lagerleitung mit ihrem Tag und, wenn die Lagerleitung sie zuordnet, das Ressort und das Traktandum. Bei einer nicht anonymen Meldung steht auch das Konto der Person dabei: Die Lagerleitung sieht den Namen, und die Person bekommt die Antwort als Push, der nur den Lagertitel nennt. Bei einer anonymen Meldung speichert Cevi OS keine Person, keine IP-Adresse und keine Uhrzeit, nur den Tag, und schreibt weder ein Audit-Log noch einen Eintrag im Änderungsfeed. Die Person bekommt beim Senden einen Rückfragecode, mit dem sie Status und Antwort abruft; gespeichert ist nur ein Prüfwert dieses Codes. Die Antwort steht ausserdem an der Meldung, die die Lagerleitung liest. Die Meldungen sieht nur die Lagerleitung und wer von ihr das Recht dazu bekommt.",
    frist:
      "Bis die Lagerleitung die Meldung löscht oder das Lager gelöscht wird; eine nicht anonyme Meldung entfällt auch mit dem Konto. Auf Anfrage löscht die Leitung Daten. Eine anonyme Meldung kennt keine Person und lässt sich darum nur über den Rückfragecode oder durch die Lagerleitung finden.",
    apple: ["User Content: Other User Content"],
    google: ["App activity: Other user-generated content"],
  },
  lagerDokumente: {
    titel: "Dokumente im Lager",
    zweck:
      "Unterlagen des Lagers auffindbar machen: Ein Dokument hat einen Titel, Stichworte und verweist auf eine Datei im SharePoint der Abteilung (siehe «Dateien im Lager»). Wer Dokumente bearbeiten darf (im Standard Lagerleitung und Leitung), gibt ein Dokument für das Team frei; ohne Freigabe sieht das Team es nicht. Cevi OS speichert nur den Verweis, nie den Inhalt. Die Suche läuft nur über Titel und Stichworte.",
    frist: `Bis die Leitung das Dokument löscht oder das Lager gelöscht wird; die Datei am Ablageort bleibt. Mit dem Konto verschwindet nur die Angabe, wer das Dokument angelegt hat. ${AUF_ANFRAGE}`,
    apple: [],
    google: [],
  },
  lagerProtokolle: {
    titel: "Protokolle und Beschlüsse im Lager",
    zweck:
      "Protokolle und Beschlüsse eines Lagers festhalten und auffindbar machen: Ein Protokoll hat eine Art (Sitzung, Notiz, Kontakt oder Idee), einen Titel, ein Datum, optional einen Höck und verweist auf eine Datei im SharePoint der Abteilung (siehe «Dateien im Lager»). Cevi OS speichert nur den Verweis, nie den Inhalt des Protokolls, und ruft den Link nie ab; wer die Datei öffnen darf, regelt der Ablageort. Ein Beschluss ist ein kurzer Text mit optionalem Verweis auf Protokoll und Höck. Protokolle und Beschlüsse sieht nur, wer das Recht dazu hat, und das Team nie, wenn sie zu einem Höck der Lagerleitung gehören.",
    frist: `Bis die Leitung das Protokoll oder den Beschluss löscht oder das Lager gelöscht wird; die Datei am Ablageort bleibt. Mit dem Konto verschwindet nur die Angabe, wer den Eintrag angelegt hat. ${AUF_ANFRAGE}`,
    apple: [],
    google: [],
  },
  lagerAdressbuch: {
    titel: "Adressbuch im Lager",
    zweck:
      "Externe Kontakte des Lagers an einem Ort haben, zum Beispiel Bäckerei, Platzwart oder Behörde. Die Lagerleitung erfasst Name, Funktion, Gruppe, Telefonnummer, E-Mail-Adresse und eine Notiz. Es sind Daten Dritter, die selbst kein Konto haben: Nur die Lagerleitung liest und ändert sie (die Rechte lassen sich je Lager einstellen), und jedes Lesen steht im Protokoll, ohne die Inhalte. Wer einen Kontakt für das nächste Lager behalten will, markiert ihn.",
    frist: `180 Tage nach dem Ende des Lagers löscht Cevi OS jeden Kontakt endgültig, ausser er ist mit «Fürs nächste Lager behalten» markiert; 14 Tage vorher erinnert Cevi OS die Lagerleitung. Markierte Kontakte bleiben, bis die Lagerleitung sie löscht oder das Lager gelöscht wird. Ein gelöschter Kontakt verschwindet nach 30 Tagen endgültig. Mit dem Konto verschwindet nur die Angabe, wer den Kontakt erfasst hat. ${AUF_ANFRAGE}`,
    apple: [
      "Contact Info: Name",
      "Contact Info: Phone Number",
      "Contact Info: Email Address",
    ],
    google: [
      "Personal info: Name",
      "Personal info: Phone number",
      "Personal info: Email address",
    ],
  },
  lagerBenachrichtigung: {
    titel: "Benachrichtigungen im Lager",
    zweck:
      "Die Mitglieder eines Lagers über Neues im Lager informieren, zum Beispiel über eine zugeteilte Aufgabe oder eine wichtige Mitteilung. Die Benachrichtigung zeigt in der App eine Liste mit Art und Ziel, der Push nennt nur den Lagertitel. Jede Person schaltet jede Art selbst ab.",
    frist: `Gelesene Benachrichtigungen 90 Tage, ungelesene bis die Person das Lager verlässt oder das Konto gelöscht wird. ${AUF_ANFRAGE}`,
    apple: [],
    google: [],
  },
  lagerErwaehnungen: {
    titel: "Erwähnungen im Lager",
    zweck:
      "Wer in einem Inhalt des Lagers (Aufgabe, Traktandum, Pinnwand-Beitrag, Beschluss) erwähnt wird, soll es merken: Cevi OS benachrichtigt die Person, und sie kann die Erwähnung als erledigt markieren oder daraus eine Aufgabe machen. Die Erwähnung speichert nur, wer in welchem Inhalt erwähnt wurde, nie den Text; sie sieht nur die erwähnte Person.",
    frist: `Bis die Marke aus dem Inhalt entfällt (ausser es ist daraus eine Aufgabe entstanden), die Person das Lager verlässt oder das Lager gelöscht wird. ${AUF_ANFRAGE}`,
    apple: [],
    google: [],
  },
  lagerAnwesenheit: {
    titel: "Anwesenheit im Lager",
    zweck:
      "Planen, wer an welchem Tag und zu welcher Tageszeit im Lager ist, zum Beispiel für den Schichtplan und die Einkaufsmenge. Die Lagerleitung trägt für alle ein, das Team seine eigene Anwesenheit; eine Änderung eines eingetragenen Feldes stellt das Team als Anfrage an die Lagerleitung, die sie annimmt oder ablehnt. Ein Push über eine Anfrage oder ihren Entscheid nennt nur den Lagertitel.",
    frist: `Bis die Leitung die Anwesenheit löscht, das Lager gelöscht wird oder das Konto gelöscht wird. Die Einträge der Teilnehmenden (nur Kennung und Wert, kein Name) bleiben auch nach dem Löschen der Teilnehmenden, sechs Monate nach dem Ende des Lagers, bis das Lager gelöscht wird. ${AUF_ANFRAGE}`,
    apple: ["Other Data"],
    google: ["Personal info: Other info"],
  },
  lagerNotfall: {
    titel: "Notfall-Kontakte im Lager",
    zweck:
      "Im Notfall die richtigen Personen sofort erreichen. Die Lagerleitung erfasst die Sicherheitsverantwortlichen und weitere Anlaufstellen mit Funktion und Telefonnummer, entweder als Konto des Lagers (die Nummer kommt aus dem Konto, solange keine eigene steht) oder als Name mit Nummer. Dazu kommen Leitung und Stellvertretung des Ressorts «si» und seiner Teilbereiche mit der Nummer aus ihrem Konto. Das Team sieht diese Kontakte mit Nummer, sonst nirgends im Lager eine Telefonnummer. Dazu speichert das Lager einen Link zur Lageradresse in einer Karten-App; der Server ruft keinen Kartendienst ab.",
    frist: `Bis die Lagerleitung den Kontakt löscht, das Lager gelöscht wird oder das Konto gelöscht wird. ${AUF_ANFRAGE}`,
    apple: ["Contact Info: Name", "Contact Info: Phone Number"],
    google: ["Personal info: Name", "Personal info: Phone number"],
  },
  lagerInfos: {
    titel: "Packliste und Infos im Lager",
    zweck:
      "Die Packliste und die Infos des Lagers bereitstellen. Die Lagerleitung pflegt die Vorlage der Packliste und die Info-Abschnitte (Text, Links und Verknüpfungen auf Dateien im SharePoint der Abteilung); einzelne Punkte und Abschnitte können der Lagerleitung vorbehalten sein. Jede Person hat ihre eigene Kopie der Packliste: Gespeichert sind nur ihre Abweichungen von der Vorlage (abgehakt, entfernt) und ihre eigenen Punkte, die nur sie sieht.",
    frist: `Die Vorlage und die Infos, bis die Lagerleitung sie löscht oder das Lager gelöscht wird. Die Abweichungen und eigenen Punkte einer Person, bis sie sie löscht, das Lager gelöscht wird oder das Konto gelöscht wird. ${AUF_ANFRAGE}`,
    apple: ["Other Data"],
    google: ["Personal info: Other info"],
  },
  lagerVorlagen: {
    titel: "Private To-dos und Vorlagen im Lager",
    zweck:
      "Jede Person im Lager führt eigene To-dos, die nur sie sieht; auch die Lagerleitung und die Abteilungsleitung lesen sie nie. Die Abteilungsleitung pflegt Vorlagen für Aufgaben und Packlisten; die Lagerleitung wendet eine Vorlage in einem Lager an, und es entstehen daraus gewöhnliche Aufgaben und Punkte des Lagers.",
    frist: `Die To-dos, bis die Person sie löscht, das Lager gelöscht wird oder das Konto gelöscht wird. Die Vorlagen, bis die Abteilungsleitung sie löscht. ${AUF_ANFRAGE}`,
    apple: ["Other Data"],
    google: ["Personal info: Other info"],
  },
  lagerTagesseiten: {
    titel: "Tagesseiten im Lager",
    zweck:
      "Pro Lagertag eine Seite führen: wer Tageschef ist, eine Notiz, Hinweise und Ideen des Tages und Verknüpfungen auf Programmbilder im SharePoint der Abteilung. Die Leitung des Lagers pflegt die Seite; die Aufgaben mit Frist an diesem Tag zeigt die Seite aus den Aufgaben des Lagers, und das Wetter des Tages kommt aus dem Wetter des Lagers.",
    frist: `Bis die Leitung den Block löscht oder das Lager gelöscht wird. Wird ein Tageschef aus dem Lager entfernt oder sein Konto gelöscht, verschwindet die Angabe auf der Seite. ${AUF_ANFRAGE}`,
    apple: ["Other Data"],
    google: ["Personal info: Other info"],
  },
  lagerWetter: {
    titel: "Wetter im Lager",
    zweck:
      "Das Wetter am Lagerort anzeigen und vor Gewitter, starkem Wind, Hitze und viel Regen warnen. Die Lagerleitung legt den Ort des Lagers als Breite und Länge fest. Der Server holt die Vorhersage dafür beim Wetterdienst Open-Meteo und speichert sie je Lager zwischen, damit nicht jeder Aufruf einen Abruf auslöst. An den Wetterdienst gehen nur die beiden Zahlen des Ortes, auf zwei Stellen gerundet, keine Namen und keine Angaben zu Personen.",
    frist: `Der Ort, bis die Lagerleitung ihn löscht oder das Lager gelöscht wird. Die Vorhersage im Zwischenspeicher wird bei jedem Abruf ersetzt und geht mit dem Lager. ${AUF_ANFRAGE}`,
    apple: [],
    google: [],
  },
  lagerHoeck: {
    titel: "Höcks und Traktanden im Lager",
    zweck:
      "Die Sitzungen des Lagers planen und festhalten: Datum, Zeit, Ort und Titel eines Höcks, wer beim Höck war, Gäste als Freitext, die Traktanden mit Notizen, Links, Verantwortlichen und einem kurzen Entscheid. Das Team sieht nur Höcks der Art Team, und von diesen nur Datum, Zeit, Titel und Ort. Ein Höck lässt sich als Kalenderdatei laden; sie enthält nur Titel, Ort, Datum und Zeit. Das Protokoll liegt als Verknüpfung auf eine Datei im SharePoint der Abteilung.",
    frist: `Bis die Leitung den Höck oder das Traktandum löscht, das Lager gelöscht wird oder das Konto gelöscht wird. ${AUF_ANFRAGE}`,
    apple: ["Other Data"],
    google: ["Personal info: Other info"],
  },
  website: {
    titel: "Seiten der Website",
    zweck:
      "Die Seiten der Website der Abteilung aufbauen und verwalten: Adresse, Titel, Reihenfolge, wer sie sieht, und der Inhalt als Entwurf und als veröffentlichte Stände. Bei einem Stand steht, welches Konto ihn erstellt hat. Alte Adressen der Website leiten auf die neuen Seiten weiter; bei einer Weiterleitung steht, welches Konto sie angelegt hat.",
    frist:
      "Bis ein Webmaster die Seite oder die Weiterleitung löscht. Mit dem Konto verschwindet nur die Angabe, wer einen Stand oder eine Weiterleitung erstellt hat.",
    apple: [],
    google: [],
  },
  anlass: {
    titel: "Anlässe und Anmeldungen",
    zweck:
      "Die Abteilungsleitung macht aus einem Termin einen Anlass, zu dem sich Kinder oder Personen anmelden können, und legt fest, bis wann die Anmeldung offen ist, wer den Anlass sieht und welche Zusatzfragen die Anmeldung stellt (Text, Ja oder Nein, Auswahl). Die Fragen dürfen keine Gesundheitsdaten verlangen. Zum Anlass entsteht eine Seite der Website als Entwurf. Wer den Anlass sieht, meldet sich über das Konto an: Eltern melden ihr Kind an, andere Personen sich selbst, und beides geht bis zum Anmeldeschluss. Name, Cevi-Name und die Stufe des Kindes liest die Anmeldung aus dem Konto und füllt sie vor; gespeichert werden nur die Antworten auf die Zusatzfragen, wer angemeldet hat und ob die Anmeldung gilt. Die Abteilungsleitung sieht die Anmeldungen mit Name und Telefon aus dem Konto und kann sie als CSV-Datei laden; der Server speichert die Datei nicht und hält im Protokoll nur fest, wann der Export lief und wie viele Anmeldungen er enthielt.",
    frist:
      "Den Anlass bis die Abteilungsleitung ihn löscht; das geht nur, solange es keine Anmeldungen gibt. Die Anmeldungen löscht der Server 180 Tage nach dem Ende des Anlasses; die Antworten einer Abmeldung löscht er sofort. Anlässe der Art Lager sind von diesem Lauf ausgenommen, ihre Anmeldungen behandelt das Lager. Mit dem Konto verschwinden die Anmeldungen, die es angelegt hat, und die Angabe, wer den Anlass angelegt hat. Die Seite der Website bleibt, bis ein Webmaster sie löscht.",
    apple: ["Contact Info: Name", "User Content: Other User Content"],
    google: [
      "Personal info: Name",
      "App activity: Other user-generated content",
    ],
  },
  // Die Tabelle blockierung stammt aus dem Datenmodell des Chats; die API hat keine Funktion dazu, und Blockieren gibt es nicht
  ungenutzt: {
    titel: "Ungenutzt",
    zweck: "Keine Funktion.",
    frist: "Keine Daten.",
    apple: [],
    google: [],
  },
} satisfies Record<string, Kategorie>;

export type KategorieId = keyof typeof KATEGORIEN;

// Die Spalten, die lagerSpalten() (db/schema-lager.ts) jeder Lager-Tabelle mitgibt (#366); ein Modul schreibt { lager: [...LAGER_BASIS_SPALTEN, "eigene", ...] }
export const LAGER_BASIS_SPALTEN = [
  "id",
  "lager_id",
  "version",
  "erstellt_am",
  "erstellt_von",
  "geaendert_am",
  "geaendert_von",
  "lager_seq",
];

// Tabelle -> Kategorie -> Spalten. Jede Spalte steht genau einmal da; ein Test scheitert bei einer neuen oder entfernten Spalte
export const SPALTEN: Record<string, Partial<Record<KategorieId, string[]>>> = {
  abteilung: {
    abteilung: [
      "id",
      "name",
      "google_kalender_id",
      "sync_ok_am",
      "sync_fehler",
      "datei_hosts",
    ],
  },
  account: {
    konto: [
      "id",
      "account_id",
      "provider_id",
      "user_id",
      "access_token",
      "refresh_token",
      "id_token",
      "access_token_expires_at",
      "refresh_token_expires_at",
      "scope",
      "password",
      "created_at",
      "updated_at",
    ],
  },
  audit_log: {
    protokoll: [
      "id",
      "abteilung_id",
      "akteur_id",
      "aktion",
      "ziel_typ",
      "ziel_id",
      "details",
      "erstellt_am",
    ],
  },
  // Wartungsmodus und Sperre (#424, #425): kein Personenbezug ausser der Kennung der auslösenden Person
  bereichsschalter: {
    protokoll: [
      "id",
      "abteilung_id",
      "bereich",
      "art",
      "hinweis",
      "ende",
      "website_offline",
      "ausgeloest_von",
      "ausgeloest_am",
    ],
  },
  // Anlässe (#442): Einstellungen und Fragen der Anmeldung, keine Antworten (die stehen in anlass_anmeldung); wer ihn angelegt hat, steht in erstellt_von
  anlass: {
    anlass: [
      "id",
      "abteilung_id",
      "programm_id",
      "art",
      "anmeldung_offen",
      "frist",
      "anmeldung_fuer",
      "sichtbarkeit",
      "sichtbarkeit_tags",
      "seite_id",
      "erstellt_von",
      "erstellt_am",
    ],
  },
  // Anmeldungen (#443): wer angemeldet hat (user_id), für welches Kind (kind_id) und die Antworten auf die Zusatzfelder; Name, Cevi-Name und Stufe liest die Ansicht live aus dem Konto
  anlass_anmeldung: {
    anlass: [
      "id",
      "anlass_id",
      "user_id",
      "kind_id",
      "antworten",
      "status",
      "erstellt_am",
      "geaendert_am",
    ],
  },
  anlass_feld: {
    anlass: [
      "id",
      "anlass_id",
      "schluessel",
      "beschriftung",
      "typ",
      "optionen",
      "pflicht",
      "reihenfolge",
    ],
  },
  blockierung: { ungenutzt: ["user_id", "blockiert_id"] },
  chat: {
    chat: ["id", "abteilung_id", "typ", "stufe_id", "eltern_user_id"],
  },
  chat_status: { chat: ["chat_id", "user_id", "gelesen_bis"] },
  kind: {
    kinder: [
      "id",
      "abteilung_id",
      "vorname",
      "nachname",
      "cevi_name",
      "stufe_id",
      "stufe_seit",
      "inaktiv_seit",
    ],
  },
  kind_eltern: { kinder: ["kind_id", "user_id", "erstellt_am"] },
  leitung_anmeldung: {
    anmeldungen: ["programm_id", "user_id", "status"],
  },
  medium: {
    medien: [
      "id",
      "abteilung_id",
      "mime_typ",
      "groesse",
      "breite",
      "hoehe",
      "alt_text",
      "dekorativ",
      "sichtbarkeit",
      "speicher_schluessel",
      "hochgeladen_von",
      "erstellt_am",
    ],
  },
  nachricht: {
    chat: ["id", "chat_id", "autor_id", "text", "programm_id", "erstellt_am"],
  },
  programm: {
    programme: [
      "id",
      "abteilung_id",
      "google_event_id",
      "google_serie",
      "titel",
      "ganztaegig",
      "beginn",
      "ende",
      "tag_von",
      "tag_bis",
      "status",
      "sichtbarkeit",
      "kategorien",
      "ort",
    ],
  },
  programm_tag: { programme: ["programm_id", "tag_id"] },
  kategorie_zuordnung: {
    programme: ["id", "abteilung_id", "kategorie", "tag_id"],
  },
  termin_vorschlag: {
    terminvorschlaege: [
      "id",
      "abteilung_id",
      "vorgeschlagen_von",
      "titel",
      "ganztaegig",
      "beginn",
      "ende",
      "tag_von",
      "tag_bis",
      "ort",
      "beschreibung",
      "bemerkung",
      "tag_ids",
      "status",
      "entschieden_von",
      "entschieden_am",
      "begruendung",
      "erstellt_am",
    ],
  },
  programm_eckdaten: {
    programme: [
      "stufe_id",
      "tag",
      "treff_zeit",
      "treffpunkt",
      "schluss_ort",
      "schluss_zeit",
      "mitnehmen",
      "abgerufen_am",
      "quelle",
    ],
  },
  kalender_token: {
    kalenderlink: [
      "id",
      "user_id",
      "token_hash",
      "endung",
      "erstellt_am",
      "zuletzt_abgerufen_am",
      "widerrufen_am",
    ],
  },
  programm_stufe: { programme: ["programm_id", "stufe_id"] },
  profilbild: { profilbild: ["user_id", "inhalt", "geaendert_am"] },
  push_token: {
    benachrichtigungen: [
      "session_id",
      "token",
      "user_id",
      "plattform",
      "zuletzt_gesehen",
    ],
  },
  rate_limit: { technik: ["id", "key", "count", "last_request"] },
  // Seit Migration 0035 (#332) sind «rolle» und «stufe» Sichten auf person_tag und tag; die Daten stehen dort, die Einträge bleiben für die Spalten, die die Sichten den Routen zeigen
  rolle: {
    rollen: ["user_id", "stufe_id", "typ", "prioritaet", "erstellt_am"],
  },
  session: {
    technik: [
      "id",
      "expires_at",
      "token",
      "created_at",
      "updated_at",
      "ip_address",
      "user_agent",
      "user_id",
      "impersonated_by",
    ],
  },
  stufe: {
    abteilung: ["id", "abteilung_id", "name", "kuerzel"],
  },
  stufenlogo: { abteilung: ["stufe_id", "inhalt", "geaendert_am"] },
  // Tags vom Typ «stufe» sind die Stufen der Abteilung (Kategorie «abteilung», kein Personenbezug); alle anderen Tags gehören zu «rollen»
  tag: { rollen: ["id", "abteilung_id", "typ", "name", "kuerzel"] },
  person_tag: {
    rollen: ["user_id", "tag_id", "rolle", "prioritaet", "erstellt_am"],
  },
  // Das Lager hat keinen Personenbezug ausser seiner Adresse und den Mitgliedern
  lager: {
    lager: [
      "id",
      "abteilung_id",
      "anlass_id",
      "titel",
      "von",
      "bis",
      "vorbereitung_ab",
      "ort",
      "adresse",
      "status",
      "uebung",
      "farbe",
      "anwesenheit_frist",
      "logo_medium_id",
      "seq",
      "seq_min",
      "erstellt_am",
    ],
    lagerNotfall: ["karten_link"],
    lagerWetter: ["breite", "laenge"],
  },
  // Der Änderungsfeed (#366) hält nur Art, Tabelle, Zeilen-ID, Version und Zeitpunkt einer Änderung, keine Inhalte und keine Person
  lager_aenderung: {
    lager: [
      "lager_id",
      "seq",
      "tabelle",
      "zeile_id",
      "art",
      "version",
      "zeitpunkt",
    ],
  },
  // Die Warteschlange für Offline-Änderungen (#367) hält je Operation das Ergebnis: IDs und Versionen, bei einem Konflikt nicht gespeichert
  lager_client_op: {
    lager: ["lager_id", "person_id", "client_op_id", "ergebnis", "erstellt_am"],
  },
  lager_mitglied: {
    lager: ["lager_id", "person_id", "rolle", "ressort_id", "erstellt_am"],
  },
  lager_rolle_recht: { lager: ["lager_id", "rolle", "recht", "erlaubt"] },
  lager_datei: {
    lagerDatei: [
      ...LAGER_BASIS_SPALTEN,
      "anzeigename",
      "link",
      "typ",
      "groesse",
    ],
  },
  // Dokumente (#396): Titel, Verweis auf die Datei, Stichworte, Freigabe für das Team
  dokument: {
    lagerDokumente: [
      ...LAGER_BASIS_SPALTEN,
      "titel",
      "datei_id",
      "stichworte",
      "team_sichtbar",
    ],
  },
  // Adressbuch (#397): Personendaten Dritter, nur Lagerleitung; Aufräumfrist 180 Tage nach dem Lagerende, ausser «behalten»
  adressbuch_kontakt: {
    lagerAdressbuch: [
      ...LAGER_BASIS_SPALTEN,
      "name",
      "funktion",
      "gruppe",
      "telefon",
      "email",
      "notiz",
      "behalten",
    ],
  },
  // Ressorts (#371): Leitung und Stellvertretung als Personen-IDs, die Notiz nennt über erstellt_von, wer sie schrieb
  ressort: {
    lager: [
      ...LAGER_BASIS_SPALTEN,
      "kuerzel",
      "name",
      "leitung_person_id",
      "stv_person_id",
      "notiz",
      "parent_id",
      "reihenfolge",
    ],
  },
  ressort_link: {
    lager: [...LAGER_BASIS_SPALTEN, "ressort_id", "titel", "url"],
  },
  ressort_notiz: {
    lager: [...LAGER_BASIS_SPALTEN, "ressort_id", "text"],
  },
  // Einkaufsliste (#392): wer einkauft, steht als Personen-ID (Mitglied des Lagers). Stamm und Vorschläge sind Daten je Artikelname, ohne Person
  einkauf_artikel: {
    lager: [
      ...LAGER_BASIS_SPALTEN,
      "name",
      "name_norm",
      "menge",
      "einheit",
      "warengruppe",
      "einkaeufer_person_id",
      "erledigt",
    ],
  },
  einkauf_artikelstamm: { lager: ["lager_id", "name_norm", "warengruppe"] },
  einkauf_vorschlag: {
    lager: ["lager_id", "name_norm", "name", "haeufigkeit"],
  },
  // Aufgaben (#372): Verantwortliche und Unterstützung als Personen-IDs; erledigt_am setzt der Server mit dem Status
  aufgabe: {
    lager: [
      ...LAGER_BASIS_SPALTEN,
      "titel",
      "ressort_id",
      "teil",
      "verantwortlich_person_id",
      "status",
      "notiz",
      "frist",
      "frist_meilenstein_id",
      "frist_versatz_tage",
      "stern",
      "laufend",
      "spaeter_ab",
      "wiederholung",
      "reihenfolge",
      "quelle",
      "erledigt_am",
      "frist_erinnert_am",
    ],
  },
  aufgabe_unterstuetzung: {
    lager: ["lager_id", "aufgabe_id", "person_id"],
  },
  // Zeitplan (#374): Termine und Bezeichnungen des Lagers, keine Personendaten ausser den Spalten der Basis
  meilenstein: {
    lager: [...LAGER_BASIS_SPALTEN, "titel", "datum", "art"],
  },
  lagertag: {
    lager: [...LAGER_BASIS_SPALTEN, "datum", "label"],
  },
  // Tagesseiten (#391): Tageschef als Personen-ID, Notiz und Blöcke; das Programmbild ist ein Verweis auf lager_datei
  tagesseite: {
    lagerTagesseiten: [
      ...LAGER_BASIS_SPALTEN,
      "lagertag_id",
      "tageschef_person_id",
      "notiz",
    ],
  },
  tagesseite_block: {
    lagerTagesseiten: [
      ...LAGER_BASIS_SPALTEN,
      "seite_id",
      "art",
      "text",
      "datei_id",
      "reihenfolge",
    ],
  },
  // Zwischenspeicher des Wetters (#391): Ort und Tageswerte der Vorhersage, keine Personendaten
  wetter_cache: {
    lagerWetter: [
      "lager_id",
      "breite",
      "laenge",
      "abgerufen_am",
      "versuch_am",
      "tage",
    ],
  },
  tagesabschnitt: {
    lager: [...LAGER_BASIS_SPALTEN, "name", "zeit", "reihenfolge"],
  },
  // Details einer Aufgabe (#373): Checkpunkte mit der Person, die abgehakt hat, Links und Stichworte
  aufgabe_checkpunkt: {
    lager: [
      ...LAGER_BASIS_SPALTEN,
      "aufgabe_id",
      "text",
      "erledigt",
      "person_id",
      "reihenfolge",
    ],
  },
  aufgabe_link: {
    lager: [...LAGER_BASIS_SPALTEN, "aufgabe_id", "titel", "url"],
  },
  aufgabe_stichwort: {
    lager: ["lager_id", "aufgabe_id", "stichwort"],
  },
  // Höcks (#378): Anwesende und Verantwortliche als Konto-IDs, Gäste als Freitext; protokoll_id verknüpft das Protokoll (#379)
  hoeck: {
    lagerHoeck: [
      ...LAGER_BASIS_SPALTEN,
      "art",
      "datum",
      "zeit",
      "titel",
      "ort",
      "gaeste",
      "protokoll_id",
    ],
  },
  // Protokolle (#379): Art, Titel, Datum, Höck und Verweis auf die Datei; Beschlüsse: Text mit Verweis auf Protokoll und Höck
  protokoll: {
    lagerProtokolle: [
      ...LAGER_BASIS_SPALTEN,
      "art",
      "titel",
      "datum",
      "hoeck_id",
      "datei_id",
    ],
  },
  beschluss: {
    lagerProtokolle: [
      ...LAGER_BASIS_SPALTEN,
      "text",
      "protokoll_id",
      "hoeck_id",
    ],
  },
  hoeck_anwesenheit: {
    lagerHoeck: ["lager_id", "hoeck_id", "person_id"],
  },
  traktandum: {
    lagerHoeck: [
      ...LAGER_BASIS_SPALTEN,
      "hoeck_id",
      "titel",
      "text",
      "entscheid",
      "links",
      "reihenfolge",
      "aufgabe_id",
      "status",
    ],
  },
  traktandum_verantwortlich: {
    lagerHoeck: ["lager_id", "traktandum_id", "person_id"],
  },
  // Anwesenheit (#390): Leitende als Konto, Teilnehmende als ID; die Anfrage nennt, wer sie stellte und wer entschied
  anwesenheit: {
    lagerAnwesenheit: [
      ...LAGER_BASIS_SPALTEN,
      "person_id",
      "teilnehmer_id",
      "lagertag_id",
      "tagesabschnitt_id",
      "wert",
    ],
  },
  anwesenheit_anfrage: {
    lagerAnwesenheit: [
      ...LAGER_BASIS_SPALTEN,
      "person_id",
      "lagertag_id",
      "tagesabschnitt_id",
      "wert",
      "notiz",
      "status",
      "entschieden_von",
      "entschieden_am",
    ],
  },
  // Pinnwand (#381): Empfänger als Rolle oder Personen-ID; die Dateien sind Verweise auf lager_datei
  pinnwand_beitrag: {
    lagerPinnwand: [
      ...LAGER_BASIS_SPALTEN,
      "titel",
      "text",
      "wichtig",
      "angeheftet",
      "sichtbar_ab",
      "sichtbar_bis",
    ],
  },
  pinnwand_empfaenger: {
    lagerPinnwand: ["id", "lager_id", "beitrag_id", "rolle", "person_id"],
  },
  pinnwand_datei: {
    lagerPinnwand: [
      ...LAGER_BASIS_SPALTEN,
      "beitrag_id",
      "datei_id",
      "reihenfolge",
    ],
  },
  // Umfragen und Reaktionen (#382): Stimmen und Reaktionen gehören einer Person (person_id); die Reaktion ist ein fester Schlüssel, kein Emoji-Zeichen
  umfrage: {
    lagerPinnwand: [
      ...LAGER_BASIS_SPALTEN,
      "beitrag_id",
      "mehrfach",
      "schliesst_am",
      "geschlossen",
      "namen_fuer_team",
    ],
  },
  umfrage_option: {
    lagerPinnwand: [
      ...LAGER_BASIS_SPALTEN,
      "umfrage_id",
      "text",
      "reihenfolge",
    ],
  },
  umfrage_stimme: {
    lagerPinnwand: [
      ...LAGER_BASIS_SPALTEN,
      "umfrage_id",
      "option_id",
      "person_id",
    ],
  },
  reaktion: {
    lagerPinnwand: [
      ...LAGER_BASIS_SPALTEN,
      "ziel_typ",
      "ziel_id",
      "person_id",
      "emoji",
    ],
  },
  // Eingang (#383): bei einer anonymen Meldung (anonym) ist person_id leer, dafür steht ein Prüfwert des Rückfragecodes; nur der Tag, keine Uhrzeit, keine zeitgeordnete ID. Die Tabelle hat keine LAGER_BASIS_SPALTEN (kein Feed, keine Revision)
  eingang: {
    lagerEingang: [
      "id",
      "lager_id",
      "version",
      "art",
      "text",
      "anonym",
      "person_id",
      "rueckfragecode_hash",
      "erstellt_tag",
      "status",
      "antwort",
      "beantwortet_tag",
      "ressort_id",
      "traktandum_id",
    ],
  },
  // Teilnehmende und Abzählen (#384): nur Name und Stufe; kind_id und anmeldung_id sind die spätere Verknüpfung zum Kind und zur Anmeldung, über die API noch nicht gesetzt
  teilnehmer: {
    lagerTeilnehmende: [
      ...LAGER_BASIS_SPALTEN,
      "kind_id",
      "anmeldung_id",
      "vorname",
      "nachname",
      "cevi_name",
      "stufe",
      "abgewaehlt",
    ],
  },
  // Programmgruppen (#387): Name und Reihenfolge; die Zuordnung nennt Teilnehmende und Mitglieder nur als ID, mit der Rolle «leitung» oder «mitglied»
  gruppe: {
    lagerTeilnehmende: [...LAGER_BASIS_SPALTEN, "name", "reihenfolge"],
  },
  gruppe_zuordnung: {
    lagerTeilnehmende: [
      ...LAGER_BASIS_SPALTEN,
      "gruppe_id",
      "teilnehmer_id",
      "person_id",
      "rolle",
    ],
  },
  // Ein Haken je Teilnehmende oder Mitglied des Lagers (Team)
  abzaehlen: {
    lagerTeilnehmende: [
      ...LAGER_BASIS_SPALTEN,
      "teilnehmer_id",
      "person_id",
      "geprueft",
      "geprueft_am",
    ],
  },
  // Zimmer und Zelte (#385): Name, Art, Plätze und Notiz; die Zuordnung hält nur, wer in welchem Zimmer liegt
  zimmer: {
    lagerEinteilung: [
      ...LAGER_BASIS_SPALTEN,
      "name",
      "art",
      "plaetze",
      "notiz",
      "reihenfolge",
    ],
  },
  zimmer_zuordnung: {
    lagerEinteilung: [
      ...LAGER_BASIS_SPALTEN,
      "zimmer_id",
      "teilnehmer_id",
      "person_id",
    ],
  },
  // Dienste und Schichtplan (#388): Name, Beschreibung, nötige Personenzahl und Nachtwache je Dienst; die Schicht nennt Person oder Teilnehmende nur als ID, mit Tag, Abschnitt und Dienst
  dienst: {
    lagerEinteilung: [
      ...LAGER_BASIS_SPALTEN,
      "name",
      "beschreibung",
      "mindestbesetzung",
      "nacht",
      "tagesabschnitt_id",
      "reihenfolge",
    ],
  },
  schicht: {
    lagerEinteilung: [
      ...LAGER_BASIS_SPALTEN,
      "lagertag_id",
      "tagesabschnitt_id",
      "dienst_id",
      "person_id",
      "teilnehmer_id",
    ],
  },
  // Diensttausch (#389): wer welche eigene Schicht mit wem tauschen oder abgeben will, mit freiwilliger Notiz, Stand und wer wann entschied; die Schichten nur als ID
  diensttausch: {
    lagerEinteilung: [
      ...LAGER_BASIS_SPALTEN,
      "von_person_id",
      "schicht_id",
      "mit_person_id",
      "mit_schicht_id",
      "notiz",
      "status",
      "entschieden_von",
      "entschieden_am",
    ],
  },
  // Fahrten (#386): Hin- und Rückfahrt mit Fahrer, Plätzen, Treffpunkt, Fahrplan-Link und Kartenpunkt (ziel_*); die Mitfahrt ist eine Person des Lagers oder ein Teilnehmender
  fahrt: {
    lagerFahrten: [
      ...LAGER_BASIS_SPALTEN,
      "richtung",
      "art",
      "name",
      "fahrer_person_id",
      "plaetze",
      "datum",
      "zeit",
      "von",
      "nach",
      "treffpunkt",
      "link",
      "ziel_bezeichnung",
      "ziel_adresse",
      "ziel_lat",
      "ziel_lon",
      "ziel_link",
    ],
  },
  fahrt_mitfahrer: {
    lagerFahrten: [
      ...LAGER_BASIS_SPALTEN,
      "fahrt_id",
      "richtung",
      "person_id",
      "teilnehmer_id",
    ],
  },
  // Packliste, Notfall und Infos (#393): Telefonnummern stehen nur bei den Notfall-Kontakten (oder im Konto, aus dem sie kommen); die Abweichungen und eigenen Punkte der Packliste gehören einer Person und sehen nur sie
  packliste_punkt: {
    lagerInfos: [
      ...LAGER_BASIS_SPALTEN,
      "abschnitt",
      "text",
      "nur_lagerleitung",
      "reihenfolge",
    ],
  },
  packliste_abhaken: {
    lagerInfos: [
      "lager_id",
      "person_id",
      "punkt_id",
      "zustand",
      "geaendert_am",
    ],
  },
  packliste_eigen: {
    lagerInfos: [
      "id",
      "lager_id",
      "person_id",
      "abschnitt",
      "text",
      "abgehakt",
      "reihenfolge",
      "erstellt_am",
    ],
  },
  notfall_kontakt: {
    lagerNotfall: [
      ...LAGER_BASIS_SPALTEN,
      "funktion",
      "person_id",
      "name",
      "telefon",
      "reihenfolge",
    ],
  },
  info_abschnitt: {
    lagerInfos: [
      ...LAGER_BASIS_SPALTEN,
      "titel",
      "text",
      "links",
      "nur_lagerleitung",
      "notfall",
      "reihenfolge",
    ],
  },
  info_abschnitt_datei: {
    lagerInfos: [...LAGER_BASIS_SPALTEN, "abschnitt_id", "datei_id"],
  },
  todo_privat: {
    lagerVorlagen: [
      "id",
      "lager_id",
      "person_id",
      "text",
      "erledigt",
      "reihenfolge",
      "erstellt_am",
    ],
  },
  vorlage: {
    lagerVorlagen: [
      "id",
      "abteilung_id",
      "art",
      "name",
      "inhalt",
      "erstellt_am",
      "erstellt_von",
      "geaendert_am",
      "geaendert_von",
    ],
  },
  lager_benachrichtigung: {
    lagerBenachrichtigung: [
      "id",
      "lager_id",
      "person_id",
      "art",
      "objekt_typ",
      "objekt_id",
      "gelesen_am",
      "erstellt_am",
    ],
  },
  erwaehnung: {
    lagerErwaehnungen: [
      "id",
      "lager_id",
      "quelle_typ",
      "quelle_id",
      "person_id",
      "erledigt_am",
      "aufgabe_id",
      "erstellt_am",
    ],
  },
  lager_benachrichtigung_einstellung: {
    lagerBenachrichtigung: ["person_id", "art", "aktiv"],
  },
  bearbeiter: {
    rollen: [
      "id",
      "abteilung_id",
      "objekt_typ",
      "objekt_id",
      "user_id",
      "tag_id",
      "erstellt_am",
    ],
  },
  plattform_rolle: {
    rollen: ["id", "abteilung_id", "name", "schluessel", "erstellt_am"],
  },
  plattform_rolle_recht: {
    rollen: ["rolle_id", "recht"],
  },
  person_plattform_rolle: {
    rollen: ["user_id", "rolle_id", "erstellt_am"],
  },
  plattform_entwickler: {
    rollen: ["user_id", "erstellt_am"],
  },
  seite: {
    website: [
      "id",
      "abteilung_id",
      "eltern_id",
      "adresse",
      "titel",
      "reihenfolge",
      "sichtbarkeit",
      "sichtbarkeit_tags",
      "tag_id",
      "herkunft",
      "veroeffentlichte_version_id",
      "entwurf",
      "entwurf_zaehler",
      "erstellt_am",
      "geaendert_am",
      "ausgabe_hash",
      "ausgabe_am",
    ],
  },
  seite_version: {
    website: ["id", "seite_id", "nr", "inhalt", "autor_id", "erstellt_am"],
  },
  weiterleitung: {
    website: [
      "id",
      "abteilung_id",
      "alter_pfad",
      "ziel_pfad",
      "status",
      "erstellt_von",
      "erstellt_am",
    ],
  },
  anwesenheit_kind: {
    anwesenheit: ["programm_id", "kind_id", "da", "erfasst_von", "erfasst_am"],
  },
  anwesenheit_leitung: {
    anwesenheit: ["programm_id", "user_id", "da", "erfasst_von", "erfasst_am"],
  },
  teilnahme: {
    anmeldungen: [
      "programm_id",
      "kind_id",
      "status",
      "geaendert_von",
      "geaendert_am",
    ],
  },
  two_factor: {
    konto: [
      "id",
      "secret",
      "backup_codes",
      "user_id",
      "verified",
      "failed_verification_count",
      "locked_until",
    ],
  },
  user: {
    konto: [
      "id",
      "name",
      "email",
      "email_verified",
      "image",
      "created_at",
      "updated_at",
      "username",
      "display_username",
      "cevi_name",
      "role",
      "banned",
      "ban_reason",
      "ban_expires",
      "two_factor_enabled",
      "abteilung_id",
      "muss_passwort_aendern",
      "startpasswort_gueltig_bis",
      "startpasswort_verschluesselt",
      "fehlversuche",
      "naechster_versuch_ab",
      "deaktiviert_am",
      "datenschutz_gelesen_am",
    ],
    telefon: ["telefon"],
    benachrichtigungen: ["push_chat", "push_programme", "push_anmeldungen"],
  },
  verification: {
    technik: [
      "id",
      "identifier",
      "value",
      "expires_at",
      "created_at",
      "updated_at",
    ],
  },
  zeitregel: {
    benachrichtigungen: [
      "id",
      "abteilung_id",
      "stufe_id",
      "wochentag",
      "uhrzeit",
      "text",
      "beschreibung",
      "aktiv",
      "erstellt_am",
    ],
  },
  zeitregel_gesendet: {
    benachrichtigungen: ["regel_id", "programm_id", "gesendet_am"],
  },
};

// Was die Apps auf dem Gerät ablegen (Schlüssel im geschützten Speicher des Systems) -> Kategorie. Die Apps liegen in eigenen Repos; wer dort einen Schlüssel ergänzt, ergänzt ihn auch hier
export const GERAET: Record<string, KategorieId> = {
  sitzung: "konto",
};

// Gilt für beide Stores, unabhängig von der Kategorie
export const STORE_ALLGEMEIN = {
  tracking: false,
  werbung: false,
  analyse: false,
  // Pushes tragen weder Chat-Inhalt noch Kindernamen, nur den Namen eines Chats oder Programms und den Text der Admins
  weitergabeAn: ["Apple (Push)", "Google (Push)"],
  verschluesselteUebertragung: true,
  loeschungMoeglich: true,
};
