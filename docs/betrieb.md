# Betrieb

Abläufe für den Betrieb von Cevi OS; vorerst steht hier nur der Ablauf bei einer Datenpanne.

## Datenpanne

Der Ablauf gilt, sobald Daten in falsche Hände geraten sein könnten, etwa durch ein gekapertes Konto, ein geleaktes Geheimnis oder eine kopierte Datenbank. Es handeln Rollen, keine bestimmten Personen: Wer den Server betreibt, führt die Befehle aus; der Vorstand entscheidet und meldet.

1. **Alle Sitzungen beenden:** `npm run sitzungen:beenden -w apps/api`. Der Befehl liest `DATABASE_URL` aus der Umgebung oder aus `apps/api/.env` und meldet «Beendete Sitzungen: n». Alle müssen sich neu anmelden; Konten, Passwörter und zweite Faktoren bleiben.
2. **Den Vorstand informieren.** Bedeutet die Panne wahrscheinlich ein hohes Risiko für die betroffenen Personen, geht so rasch als möglich eine Meldung an den EDÖB über <https://databreach.edoeb.admin.ch/report> (Art. 24 Abs. 1 DSG), ohne auf die Schritte 3 und 4 zu warten; noch fehlende Angaben folgen so rasch als möglich (Art. 15 Abs. 2 DSV).
3. **Geheimnisse wechseln,** jedes einzeln:
   - Auth-Geheimnis: in `BETTER_AUTH_SECRET` einen neuen Zufallswert setzen und die API neu starten. Alte Cookies gelten dann nicht mehr, und die gespeicherten TOTP-Geheimnisse und Ersatzcodes lassen sich nicht mehr entschlüsseln: Kein Admin besteht den zweiten Faktor, bis er neu eingerichtet ist (Schritt 4). Den alten Wert vollständig entfernen, auch nicht als ältere Version in `BETTER_AUTH_SECRETS` behalten: Wer ihn kennt, könnte damit weiterhin Codes berechnen.
   - Passwörter der Datenbankrollen (#69).
   - Google-Service-Account: einen neuen Schlüssel erzeugen, ihn überall einsetzen, wo der alte lag, die API neu starten und erst dann den alten Schlüssel löschen (#26, #27, #69).
   - Expo-Zugriffstoken (#43).
   - restic- und S3-Schlüssel (#71).
4. **Gekapertes Konto sperren, dann zweite Faktoren neu einrichten.** Nach Schritt 3 besteht kein Admin den zweiten Faktor. Die CLI (#23) setzt den Faktor genau eines vertrauenswürdigen Admins zurück; diese Person meldet sich an und richtet ihren Faktor neu ein. Dann deaktiviert sie das gekaperte Konto oder gibt ihm ein neues Startpasswort (#18); nie den Faktor eines Kontos zurücksetzen, solange sein altes Passwort noch gilt, sonst richtet die fremde Person den neuen Faktor selbst ein. Danach setzt sie die Faktoren der übrigen Admins zurück (#23), und diese richten ihre neu ein. Bleibt kein vertrauenswürdiger Admin übrig, legt die CLI (#20) einen neuen an.
5. **Dokumentieren:** die Tatsachen rund um die Panne, ihre Auswirkungen und die getroffenen Massnahmen (Art. 15 Abs. 4 DSV), dazu ob gemeldet wurde und warum. Die Dokumentation bleibt mindestens zwei Jahre erhalten, nie im Repo, in Issues oder in PRs.
