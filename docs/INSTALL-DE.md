# Klarraum 2.1 — Installation und Übergabe

Eine Installation für eine Firma. Node.js 24.13+ ist erforderlich; ein reiner PHP-/WordPress-Tarif genügt nicht. Öffentliches Hosting benötigt HTTPS, dauerhaften Speicher und einen verantwortlichen Betreiber. Die kostenlose Render-Demo ist nicht für echte Daten gedacht.

## Neu installieren

1. Quellcodearchiv in ein privates Anwendungsverzeichnis entpacken.
2. `npm ci --ignore-scripts --omit=dev` ausführen.
3. `npm run setup` starten: öffentliche HTTPS-Origin ohne abschließenden Schrägstrich eingeben, eigenes Inhaberpasswort zweimal verdeckt eingeben. Es gibt kein Standardpasswort. Ein eigenes Geheimnis und ein Passworthash werden in `.env.local` gespeichert; vorhandene Einstellungen werden nicht überschrieben.
4. Für die Bewertung Demo wählen. Echte Anfragen bleiben ausgeschaltet, bis Geschäftsdaten, Datenschutz, Speicher und E-Mail eingerichtet sind.
5. `npm run start:local` starten. Dieser Befehl lädt `.env.local`. Für öffentlichen Betrieb zusätzlich HTTPS-Reverse-Proxy und einen überwachten Dienst einrichten. Port standardmäßig 3000.
6. `/admin.html` öffnen, eigenes Passwort verwenden, `/system.html` prüfen und zuerst mit erfundenen Daten testen.

Lokal ist `http://localhost:3000` möglich. Auf Render werden Zugangsdaten bereits durch die Hosting-Umgebung erzeugt; bestehende Installationen nicht durch den Assistenten ersetzen. Für das direkte GitHub-Deployment ist kein Render-API-Schlüssel nötig.

## Docker-Alternative

Nach Erstellung von `.env.local`: `docker compose up -d --build`. Der HTTP-Port ist nur an Loopback gebunden; davor HTTPS-Reverse-Proxy einrichten. Das benannte Volume `company_data` bleibt bei Container-Neuerstellung erhalten. **Nicht `docker compose down -v` verwenden**, außer die Daten sollen bewusst gelöscht werden. Sicherung im Container: `docker compose exec -T web npm run backup`; vollständige Datenbank-/Bildsätze zusätzlich geschützt außerhalb des Servers speichern. Ein automatischer Neustart ist keine Hochverfügbarkeitsgarantie.

## Vor echten Daten

- `DATA_DIR` dauerhaft und geschützt bereitstellen. Nach Neustart und Deployment alte Datensätze und Bilder prüfen. `PERSISTENT_STORAGE_CONFIRMED=true` erst nach dieser Prüfung setzen; der Schalter ist nur eine Betreiberbestätigung.
- Anbieterangaben, Preis-/Steuerhinweise, Einsatz-Postleitzahlen, Datenschutztexte und rechtliche Prüfung nach DEPLOYMENT.md eintragen.
- Resend-Absender bestätigen; `RESEND_API_KEY`, `MAIL_FROM`, `MAIL_TO` privat konfigurieren. Ein echtes Testschreiben einschließlich Empfang und Fehlerfall prüfen.
- Optional `EMPLOYEE_EMAIL_NOTIFICATIONS=true`: betriebliche Hinweise an Mitarbeiter, ohne Kundenadressen im Mailtext. Versand wird ungefähr minütlich bei laufendem Server geprüft, mit maximal fünf Versuchen. Das Mitarbeiterpostfach funktioniert auch ohne Mailanbieter.
- `DEMO_ONLY=true` verhindert echte Anfragen und Mitarbeiter-E-Mails. Den Echtbetrieb erst nach Prüfung freischalten.
- Aufbewahrung und Löschung von Mitarbeiter-, Kunden- und Finanzdaten gesondert festlegen. Die Frist für Anfragen erledigt dies nicht automatisch.
- Niemals Schlüssel/Passwörter in Git, Chat, Screenshots oder öffentliche Texte eintragen.

## Sprache

Mit English/Deutsch im Kopfbereich die Bedienelemente umschalten. Die Wahl wird nur im Browser gespeichert; ungespeicherte Eingaben werden vor dem Neuladen bestätigt. Firmeninhalte, Namen, Adressen, Anweisungen und Rechtstexte werden nicht automatisch übersetzt oder in der Datenbank verändert. Deutsche EUR-/Berichtsformate und Europe/Berlin bleiben bestehen. Nicht zugeordnete Validierungsmeldungen bleiben im deutschen Original.

## Tägliche Bedienung

Unter „Kalender & Objekte“ Kunden und Objekte erstellen. Unter „Team & Einsätze“ Mitarbeiter hinzufügen und den privaten Einladungslink weitergeben; er gilt einmalig für 24 Stunden. Mitarbeiter wählen ein eigenes Passwort und sehen nur zugewiesene Aufträge.

Objekt/Mitarbeiter wählen und Einzeltermin oder endliche Serie zuweisen: wöchentlich, alle zwei Wochen oder monatlich; maximal ein Jahr / 120 Termine. Monatliche Serien verwenden bei einem fehlenden Tag den letzten Monatstag. Der ursprüngliche Monatstag bleibt für spätere Monate erhalten.

Kalender auf Überschneidungen prüfen. Fahrtzeiten sind nicht automatisch eingeplant. Uhrzeiten gelten in Europe/Berlin; ungültige oder doppelte Zeiten bei der Zeitumstellung werden abgewiesen. Vor Arbeitsbeginn kann ein einzelner Termin geändert oder neu zugewiesen werden. Zukünftige Serientermine werden nur storniert, wenn noch keine Arbeit begonnen hat. Für einen anderen Rhythmus zukünftige Termine stornieren und neue Serie erstellen.

Mitarbeiter beginnen/pausieren/beenden einen Auftrag und reichen Checkliste, Bericht und optionale private Fotos ein. Der Inhaber prüft das Ergebnis. Auftragszeit ist keine vollständige gesetzliche Arbeitszeiterfassung und keine Lohnabrechnung.

Tatsächliche Zahlungen/Rückzahlungen gesondert erfassen. Monatsstände archivieren und CSV/JSON herunterladen oder als PDF drucken. Ein erledigter Auftrag ist kein Zahlungsnachweis. Diese Berichte sind keine Rechnungen, Steuererklärungen oder revisionssichere Buchführung.

## Sicherung und Wiederherstellung

`npm run backup` mit korrektem `DATA_DIR` ausführen. Standardziel `DATA_DIR/backups`, alternativ `BACKUP_DIR`. Betreiber richtet Zeitplan und geschützte externe Kopie ein. Alle drei Teile zusammenhalten: `.sqlite`, `.sqlite.media`, `.sqlite.jobs`.

Wiederherstellung ausschließlich in ein NEUES, LEERES Verzeichnis:

```sh
node scripts/restore.mjs --source /geschuetzte-kopien/klarraum-ZEITSTEMPEL.sqlite --target /srv/klarraum-wiederhergestellt
```

Die vorhandene Anwendung bleibt unverändert. Danach Dienst stoppen, `DATA_DIR` wechseln, `APP_SECRET` erneuern, neu starten und prüfen. Nicht zwei Instanzen gleichzeitig gegen denselben SQLite-Ordner betreiben. Eine Kopie auf demselben Server ersetzt keine externe Sicherung.

## Aktualisierung und Zugang

Vorher CHANGELOG.md lesen und neue Version an einer wiederhergestellten Kopie testen. Dienst stoppen, vollständige Kopie erstellen, private Einstellungen sichern. Neue Version in eigenes Verzeichnis entpacken, Abhängigkeiten über Lockfile installieren und denselben dauerhaften Datenordner verwenden. Alte Anfragen, Mitarbeiter, Aufträge, Monatsstände und Bilder prüfen. Bei Rückkehr zur alten Version passenden Code und passende Sicherung verwenden, keine automatische Rückmigration voraussetzen.

Bei verlorenem Inhaberpasswort erstellt der verantwortliche Betreiber mit `npm run admin:hash` einen neuen Hash, ersetzt `ADMIN_PASSWORD_HASH`, entfernt ein gegebenenfalls altes `ADMIN_PASSWORD`, erneuert `APP_SECRET` und startet neu. Kein öffentlicher Passwort-Reset. Mitarbeiterzugänge können in der Verwaltung neu eingeladen werden; der bisherige Zugang wird dadurch widerrufen.

## Kauf und Unterstützung

Quellcodelizenz, Installation und laufender Service getrennt vereinbaren. Vor einem Auftrag: Verkäufer, Preis/Umsatzsteuer, erlaubte Installationen, Update-/Supportumfang und Verantwortlichkeit für Sicherungen festlegen. LICENSE.txt ist ein Entwurf zur Prüfung, kein unterschriebener Vertrag.

Nicht enthalten: Online-Zahlung, native App, Offline-Synchronisation, GPS-Nachweis, Kundenunterschrift, Lohn-/Steuerberechnung und gemeinsame SaaS-Verwaltung mehrerer Firmen. Ausführliche technische Anleitung: INSTALL-EN.md, DEPLOYMENT.md und OPERATIONS.md.
