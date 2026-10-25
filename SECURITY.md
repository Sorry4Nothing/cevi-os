# Sicherheit

Cevi OS verwaltet Daten von Kindern, Eltern und Leitenden einer Cevi-Abteilung. Schützenswert sind vor allem die Namen und Stufen der Kinder mit ihren Teilnahmen, Treffpunkte und Zeiten der Programme, die Chats, die Telefonnummern der Stufenleitung und die Konten mit Admin-Rechten. Wir nehmen Sicherheitslücken deshalb ernst.

## Unterstützte Versionen

Sicherheitskorrekturen gibt es nur für den aktuellen Stand. Ältere Versionen werden nicht nachgebessert.

## Eine Lücke melden

Bitte melde Sicherheitslücken **nicht** als öffentliches Issue. Nutze die private Meldung über GitHub:

**[Sicherheitslücke privat melden](https://github.com/Sorry4Nothing/cevi-os/security/advisories/new)**

Hilfreich sind:

- die betroffene Stelle (Bildschirm der App, API-Pfad oder Datei)
- die Schritte, um das Problem nachzustellen
- was ein Angreifer damit erreichen kann, z. B. fremde Daten lesen oder Rechte erweitern

Schick keine echten Personendaten mit, auch nicht als Beleg. Nenne nur ihre Art, z. B. «Namen von Kindern einer anderen Stufe».

Wir bestätigen den Eingang, prüfen die Meldung und halten dich über den Stand der Korrektur auf dem Laufenden. Bitte veröffentliche Details erst, wenn eine Korrektur verfügbar ist.

## Was dazugehört

- Anmeldung und Sitzungen, auch Startpasswort und zweiter Faktor
- Zugriff auf Daten oder Rechte über die eigene Rolle, Stufe oder Abteilung hinaus
- Chat und Moderation, z. B. Nachrichten in fremden Chats lesen oder die Moderation umgehen
- Inhalte von Pushes, z. B. Nachrichtentext oder Namen von Kindern
- Daten, die auf dem Gerät liegen bleiben
- offengelegte Zugangsdaten oder Geheimnisse

Bekannte Restrisiken und bewusste Verzichte, etwa kein Zertifikat-Pinning, keine Root- oder Jailbreak-Erkennung und kein FLAG_SECURE auf Android, stehen mit Begründung im [Bedrohungsmodell](docs/sicherheit/bedrohungsmodell.md#bewusst-nicht-umgesetzt).

Lücken in Expo, better-auth, Hono oder anderen Bibliotheken meldest du bitte direkt dem jeweiligen Projekt.
