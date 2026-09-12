# KOBY Artifact Workspace - Abnahmekriterien

Status: verbindliche Produkt- und UX-Abnahme fuer Canvas, Web Preview und die seitliche
Arbeitsflaeche auf Open WebUI 0.11.3.

Dieses Dokument ist die kompakte, testbare Fassung der relevanten Regeln aus der
[KOBY Unified Workspace Gesamtspezifikation](2026-08-18-koby-unified-workspace-specification.md).
Bei technischen Details oder Sicherheitsgrenzen bleibt die Gesamtspezifikation massgeblich.

**Aktuelles Implementierungsprofil:** Der Branch `codex/koby-canvas-workspace` liefert den
Pyodide-only-Start mit Canvas, Web Preview, Files und Dokumentausgaben. Terminal- und
Browser-Workspace-Kriterien in diesem Dokument beschreiben die spaetere Erweiterung und sind fuer
diesen Branch nicht abnahmeverbindlich. Der letzte vollstaendige Terminal-Stand ist separat auf
`codex/koby-terminal-workspace` gesichert.

## 1. Produktvertrag

1. Der Chat ist immer die primaere Interaktion.
2. Canvas und Web Preview ersetzen die alte eingebettete Artifact-Darstellung.
3. Im Chat erscheint nur ein kompakter Verweis. Der eigentliche Inhalt wird in einer optionalen
   seitlichen Arbeitsflaeche angezeigt und bearbeitet.
4. Die Oberflaeche nennt diese Inhalte `Dokument`, `Vorschau`, `Dateien`, `Terminal` oder
   `Browser`. Technische Begriffe wie `Artifact`, `Renderer`, `MCP` oder `Pyodide` werden dem
   Endbenutzer nicht als Modus angezeigt.
5. Canvas und Web Preview sind chatgebundene Objekte mit stabiler ID. Eine Aktualisierung erzeugt
   kein neues Objekt und keine neue Chatkarte.
6. Canvas und Web Preview funktionieren ohne Terminal und ohne Code Interpreter.

## 2. Seitliche Arbeitsflaeche

### AW-01: Geschlossener Ausgangszustand

**Gegeben** kein Arbeitsobjekt ist offen.  
**Wenn** der Chat geladen wird.  
**Dann** nutzt der Chat die verfuegbare Breite und es ist keine leere Tab-Leiste sichtbar.

### AW-02: Leerer Einstieg

**Gegeben** der Benutzer oeffnet die Arbeitsflaeche ohne vorhandenes Objekt.  
**Dann** werden nur tatsaechlich verfuegbare Einstiege gezeigt, beispielsweise `Dateien`,
`Terminal` oder `Browser`. Oben ist nur `Schliessen` sichtbar. Ein zweites Plus oder eine leere
Tab-Leiste wird nicht angezeigt.

### AW-03: Position und Groesse

**Wenn** ein Objekt geoeffnet wird.  
**Dann** erscheint die Arbeitsflaeche rechts und der Chat wird schmaler, bleibt aber voll
bedienbar. Die Trennkante ist in der Breite verschiebbar. Es gibt keine Aktion zum Wechseln auf
die linke Seite. Die Flaeche ist nicht frei schwebend und ueberdeckt auf Desktop nicht
willkuerlich den Chat.

### AW-04: Tabs

- Ab dem ersten offenen Objekt ist die Tab-Leiste sichtbar.
- Jeder Tab besitzt Icon, menschlichen Titel und eigene Schliessen-Aktion.
- Ein neues Objekt wird am Ende angehaengt.
- Tabs sind per Drag-and-drop umsortierbar, horizontal scrollbar und umbrechen nicht.
- Dieselbe stabile Objekt-ID wird fokussiert statt dupliziert.
- Der erste Klick wechselt den Tab. Ein Doppelklick oder zweiter Versuch ist nie erforderlich.
- Ein einzelner Tab kann geschlossen werden, ohne andere Tabs oder das Objekt zu loeschen.
- Das Schliessen des letzten Tabs schliesst die Arbeitsflaeche.
- Die globale Schliessen-Aktion schliesst nur die Flaeche.

### AW-05: Fokus

- Der sichtbare Canvas oder die sichtbare Web Preview ist der primaere Modellfokus.
- Ein neu erstelltes Objekt darf sich genau einmal automatisch oeffnen.
- Ein Update eines vorhandenen Objekts aktualisiert es live, stiehlt aber keinen Fokus.
- Ein bewusst geschlossenes Objekt wird durch ein Update nicht erneut geoeffnet.
- Oeffnen, Wechseln und Schliessen verursachen keinen Seiten-Reload, Chat-Sprung oder Verlust
  aktivierter Chatfunktionen.

### AW-06: Output-Verzeichnis

- In einem gespeicherten Chat ist oben rechts eine kompakte Output-Aktion sichtbar. Im
  geschlossenen Zustand bleibt nur das Aufgabenlisten-Icon stehen.
- Das Menue listet jeden Canvas und jede Web Preview genau einmal sowie PDF-, Word-,
  PowerPoint-, Excel- und CSV-Dateien, die das Modell in der aktiven Runtime erzeugt, bearbeitet
  oder explizit angezeigt hat.
- Ein Eintrag oeffnet beziehungsweise fokussiert das vorhandene Objekt. Er erzeugt weder eine
  Kopie noch einen zweiten Tab fuer dieselbe stabile ID oder denselben Pfad.
- Canvas und Preview bleiben im Chat autoritativ. Bei relevanten Runtime-Dateien bleibt der
  Pyodide-Pfad die Arbeitskopie; nach jeder erkannten Modell-Aenderung wird zusaetzlich ein
  serverseitiger Datei-Snapshot wie bei einem Chat-Upload gespeichert. Das Output-Verzeichnis
  verweist auf den neuesten Snapshot und kann ihn auch ohne laufende Runtime wieder oeffnen.
- Jeder Snapshot traegt serverseitig validierte Herkunftsmetadaten fuer Chat, optional
  Ursprungsnachricht und Runtime-Pfad. Eine neue Version ersetzt den aktiven Katalogeintrag fuer
  denselben Pfad, ohne einen zweiten Eintrag zu erzeugen.
- Ein Persistenzfehler ist sichtbar; bis zur erfolgreichen Speicherung bleibt der Runtime-Pfad als
  temporaerer Eintrag nutzbar. Ein fremder Datei-Identifier darf nie an den Chat gebunden werden.
- Das Output-Menue unterscheidet browserlokale Dateien, laufende Speicherung, fehlgeschlagene
  Speicherung, ungespeicherte Aenderungen und bestaetigte Chat-Snapshots. Ein aelterer Snapshot
  bedeutet nicht, dass die aktuelle Arbeitskopie gespeichert ist.
- `workspace_display_file(path)` darf fertige PDF-, DOCX-, PPTX-, XLS-, XLSX- und CSV-Outputs des
  aktiven Chats im Viewer oeffnen. Registrierung erfordert Code-Interpreter-Freigabe, Pyodide,
  `ENABLE_DOCUMENT_VIEWER=true` und eine interaktive Session. Backend und Frontend pruefen
  Berechtigung und Chat-Kontext erneut. Fehlende Dateien und Chatwechsel erzeugen einen Fehler;
  `opening` bestaetigt den Oeffnungsauftrag, nicht den abgeschlossenen Dokument-Render.
- Canvas und Web Preview werden nach Reload und Nachrichten-Zweigwechsel nicht als neu erstellt
  behandelt. Gespeicherte Objekte bleiben unabhaengig von offenen Tabs ueber Outputs erreichbar.
- Chat-Loeschung und Datei-Aufbewahrung folgen den Regeln normaler Chat-Uploads. Das Loeschen des
  Chats loescht weiterhin keine unabhaengige browserlokale Pyodide-Arbeitskopie.

## 3. Darstellung im Chat

### CH-01: Canvas-Karte

Beim ersten Erstellen eines Canvas erscheint genau eine kompakte Dokumentkarte mit Dokument-Icon,
Titel und `Oeffnen` beziehungsweise `Bearbeiten`. Sie enthaelt nicht den vollstaendigen
Markdown-Inhalt. Weitere KI-Aenderungen desselben `canvasId` erzeugen keine zweite Karte.

### CH-02: Web-Preview-Karte

Beim ersten Erstellen einer Web Preview erscheint genau eine kompakte Webkarte mit Web-Icon, Titel
und `Oeffnen`. Im Chat erscheinen weder iframe noch kompletter HTML-, CSS- oder JavaScript-Code.
Weitere Aenderungen derselben `previewId` erzeugen keine zweite Karte.

### CH-03: Aktivitaet

- Canvas-Aenderungen erscheinen als Standard-Toolzeile `Canvas updated: <Titel>`.
- Web-Preview-Aenderungen verwenden dieselbe bestehende Tool-Call-Sprache und Gestaltung.
- Farben, Abstaende, Statussymbol und Typografie entsprechen anderen Open-WebUI-Tool Calls.
- Es gibt keine zusaetzliche gruene Badge, keine doppelte Erfolgsanimation und keinen Toast fuer
  dasselbe Ereignis.
- Laufende, fehlgeschlagene und abgeschlossene Aktionen sind sichtbar. Der letzte gueltige Inhalt
  bleibt waehrend einer Aenderung sichtbar.
- Modellprosa vor und nach Tool Calls bleibt in der urspruenglichen Reihenfolge.

### CH-04: Karteninteraktion

Ein Klick auf eine Karte oder Update-Zeile oeffnet beziehungsweise fokussiert genau das referenzierte
Objekt. Der Chat scrollt dadurch nicht sichtbar nach oben oder unten.

## 4. Canvas

### CA-01: Mehrere Dokumente

In einem gespeicherten normalen Chat koennen mehrere Canvas-Dokumente existieren. Jedes besitzt
eine stabile `canvasId`, einen eigenen Titel und eigenen Inhalt. Ab 10 transienten Dokumenten wird
unaufdringlich gewarnt. Bis 15 ist die Erstellung erlaubt; das 16. Dokument wird klar abgelehnt.

### CA-02: Erstellen und Aktualisieren

- Ein neuer Canvas entsteht nur bei einer ausdruecklichen Anforderung nach einem neuen oder
  separaten Dokument.
- `Schreibe weiter`, `kuerze`, `korrigiere` oder vergleichbare Folgeanweisungen aktualisieren den
  fokussierten Canvas unter derselben ID.
- Ein explizit genannter anderer Canvas wird gezielt ausgewaehlt und aktualisiert.
- Ohne eindeutiges Ziel fragt das Modell nach und mutiert kein Dokument.

### CA-03: Editor

- Titel und Markdown-Inhalt sind direkt editierbar.
- Jede Aenderung wird automatisch gespeichert; es gibt keinen allgemeinen Speichern-Knopf.
- Manuelle Titel werden von spaeteren Inhaltsupdates nicht ueberschrieben, ausser der Benutzer
  verlangt eine Umbenennung.
- Es gibt im Editor keinen separaten KI-, Funken-, Access- oder Generieren-Knopf. KI-Aenderungen
  werden im normalen Chat angefordert.
- Nach einem KI-Update ist genau ein `Rueckgaengig` verfuegbar und stellt den Stand unmittelbar vor
  diesem Update wieder her.
- Eine anschliessende manuelle Titel- oder Textaenderung deaktiviert Rueckgaengig, damit eigene
  Arbeit nicht ueberschrieben wird.

### CA-04: Persistenz und Notes

- Tab-Schliessen und Chat-Reload erhalten Inhalt und Identitaet, oeffnen den Canvas aber nicht
  ungefragt erneut.
- Ein transienter Canvas wird beim Loeschen seines Chats geloescht.
- `Zu Notizen hinzufuegen` uebertraegt nur den ausgewaehlten Canvas und ist idempotent.
- Wiederholtes Hinzufuegen erzeugt keine zweite Note.
- Eine uebertragene Note bleibt nach Chat-Loeschung erhalten.
- Bei deaktivierten Notes oder fehlender Berechtigung ist die Aktion verborgen und die API lehnt
  den direkten Aufruf ab.
- Notes-interne Chats erhalten keine Canvas-Werkzeuge.
- Nach der Uebertragung bilden Canvas und Note zwei Ansichten desselben logischen Dokuments. Die
  zuletzt erfolgreich versionierte Aenderung wird in beide Richtungen uebernommen.
- Eine direkte Note-Aenderung aktualisiert verknuepfte Canvas-Dokumente und verwirft deren
  einmaliges KI-Undo. Canvas- und KI-Aenderungen aktualisieren die verknuepfte Note.
- Versionskonflikte werden sichtbar abgelehnt; keine Seite ueberschreibt still eine neuere
  Aenderung.
- Wird die Note geloescht oder verliert der Benutzer den Zugriff, wird die Verknuepfung geloest.
  Der Canvas behaelt seinen letzten Inhalt im Chat. Eine spaetere Uebertragung erstellt eine neue
  Note.

### CA-05: Freigaben

Die registrierten chatlokalen Canvas-Built-ins fuer Erstellen, Aktualisieren, Auswaehlen, Auflisten,
Lesen und partielles Ersetzen laufen ohne separate Human-in-the-loop-Freigabe. Gleichnamige externe
oder benutzerdefinierte Tools erhalten diese Ausnahme nicht.

## 5. Web Preview

### WP-01: Objektmodell

Eine Web Preview besitzt stabile `previewId`, Titel, Einstiegspunkt und mehrere virtuelle Dateien.
Mindestens HTML, CSS und JavaScript koennen als getrennte Dateien Teil derselben Preview sein.
Mehrere voneinander isolierte Previews pro Chat sind erlaubt.

### WP-02: Renderer

- Der Kopf bietet einen kompakten Wechsel `Vorschau | Code`.
- `Vorschau` zeigt die zusammengesetzte Webseite in einem isolierten iframe.
- `Code` zeigt die virtuellen Dateien und erlaubt ihre direkte Bearbeitung.
- Codeaenderungen werden automatisch gespeichert und aktualisieren die Vorschau unmittelbar.
- Es gibt keinen Speichern-Knopf.
- Reload und ein kompaktes Aktionsmenue sind erlaubt.
- Ein Plus wird nur angezeigt, wenn es eine funktionierende Aktion ausloest.
- Unbekannte oder nicht textuelle Dateien zeigen einen verstaendlichen Zustand statt eines
  Absturzes.

### WP-03: Aktualisierung

- Die erste Erstellung oeffnet die Preview einmal automatisch.
- Ein Update derselben `previewId` aktualisiert einen offenen Renderer live.
- Das Update erzeugt keine neue Karte, keinen neuen Tab und keinen Fokuswechsel.
- Eine geschlossene Preview bleibt geschlossen.
- Manuelle ungespeicherte beziehungsweise neuere Aenderungen werden nicht still durch einen
  veralteten KI-Stand ueberschrieben; ein Versionskonflikt wird angezeigt.

### WP-04: Browsernative Ausfuehrung

- Relative lokale CSS-, JavaScript- und Asset-Verweise werden korrekt zusammengesetzt.
- Die Preview funktioniert ohne Terminal und ohne Code Interpreter.
- CSP, iframe-Sandbox und konfigurierte Script-/Download-Regeln bleiben aktiv.
- Fehlerhaftes HTML oder JavaScript blockiert weder Chat noch andere Tabs.
- Externe Navigation ersetzt nicht ungefragt die KOBY-Seite.
- Version 1 installiert keine Pakete und fuehrt keinen Buildschritt aus.
- Netzwerkzugriffe verwenden exakt dieselben konfigurierten `iframe_csp`- und Sandbox-Regeln wie
  die bisherige Open-WebUI-Artifact-Vorschau. Das gilt gemeinsam fuer `fetch`, Bilder, Fonts,
  WebSockets und externe Scripts; Web Preview fuehrt keine zweite Netzwerk-Whitelist ein.
- `allow-same-origin` bleibt standardmaessig aus. Abweichungen erfolgen nur ueber die vorhandenen
  globalen Open-WebUI-Einstellungen.

### WP-04a: Paketgrenzen

- Pro Chat sind hoechstens 15 Web Previews erlaubt; ab der zehnten wird die verbleibende
  Kapazitaet angezeigt.
- Eine Preview enthaelt hoechstens 40 virtuelle Textdateien.
- Ein relativer virtueller Pfad ist hoechstens 240 Zeichen lang und enthaelt weder Traversal noch
  Steuerzeichen.
- Eine einzelne Datei ist hoechstens 512.000 UTF-8-Bytes gross. Das gesamte Paket ist hoechstens
  2.000.000 UTF-8-Bytes und 750.000 Zeichen gross.
- Dieselben Grenzen gelten fuer Erstellen, komplettes Aktualisieren, Teilersetzung, direkte
  Editor-Aenderungen und Runtime-Snapshot-Importe. Eine Ablehnung veraendert die Preview nicht.

### WP-05: Files und Runtime-Snapshots

- Standardmaessig schreibt eine Preview keine Dateien in Terminal oder Code Interpreter.
- `In Files speichern` erscheint nur bei einer beschreibbaren aktiven Files-Runtime.
- Die Aktion kopiert einen Snapshot; danach gibt es keine automatische Zwei-Wege-Synchronisierung.
- Eine erneute Uebertragung erfolgt bewusst ueber `Aenderungen in Files uebernehmen`.
- Ohne Files-Runtime steht HTML- beziehungsweise ZIP-Download zur Verfuegung.
- Ein Modell kann eine erzeugte UTF-8-Textdatei bis 512.000 Bytes als Snapshot in eine bestehende
  Preview uebernehmen. Binaere, zu grosse, fehlende oder ausserhalb des erlaubten Runtime-Pfads
  liegende Quellen mutieren die Preview nicht.
- Nach erfolgreichem Import bleibt die Preview auch nach Beenden der Runtime funktionsfaehig.
- `web_preview_import_runtime_file` bleibt wegen des Runtime-Dateizugriffs freigabepflichtig.

### WP-06: Freigaben

Die registrierten chatlokalen Web-Preview-Built-ins fuer Erstellen, Aktualisieren, Auswaehlen,
Auflisten, Lesen und partielles Ersetzen laufen ohne separate Human-in-the-loop-Freigabe. Terminal-,
Files-, Runtime-Import- und externe Werkzeuge behalten ihre konfigurierte Freigabe.

## 6. Files und Pyodide-only-Darstellung

### PY-01: Sichtbares Konzept

`Pyodide` ist eine technische Implementierung und kein sichtbarer Arbeitsmodus. Der Benutzer
aktiviert im Composer den `Code Interpreter`. Wenn kein verwaltetes Terminal konfiguriert ist,
erscheint in der seitlichen Arbeitsflaeche automatisch `Dateien` als normaler Files-Tab.

### PY-02: Aussehen der Files-Flaeche

- Die Flaeche verwendet dieselbe Tab-Leiste, Typografie, Icons, Farben und Abstaende wie Canvas,
  Web Preview und Terminal.
- Der Files-Tab zeigt eine ruhige Toolbar mit Zurueck, Vorwaerts, Breadcrumbs, Aktualisieren,
  neuer Datei, neuem Ordner und Upload, soweit die jeweilige Aktion funktioniert.
- Ordner und Dateien erscheinen als schlichte Liste. Ein leerer Ordner zeigt einen ruhigen
  Leerzustand mit funktionierendem Upload statt wirkungsloser Aktionen.
- Dateien koennen per Drag-and-drop hochgeladen werden.
- Ein Klick auf eine unterstuetzte Datei oeffnet einen eigenen Tab am Ende. Derselbe Pfad wird
  fokussiert statt dupliziert.
- PDF, DOCX und PPTX verwenden den gemeinsamen Dokumentviewer. Andere Textdateien verwenden den
  passenden vorhandenen Dateipfad.

### PY-03: Verhalten waehrend Codeausfuehrung

- Die Ausfuehrung selbst erscheint einmal in der bestehenden Code-Interpreter-/Tool-Aktivitaet im
  Chat. Die Files-Flaeche zeigt keine zweite dominante Lade- oder Erfolgsanzeige.
- Neu erzeugte oder geaenderte Dateien werden nach der Ausfuehrung im Files-Tab aktualisiert.
- Ein bereits geoeffnetes aktives Dokument aktualisiert sich kontrolliert; ein inaktiver Tab darf
  die Aktualisierung bis zum Fokuswechsel zurueckstellen.
- Das Oeffnen oder Schliessen von Dateien deaktiviert den Code Interpreter nicht und laedt die
  Seite nicht neu.
- Das Schliessen und erneute Oeffnen eines Dokumenttabs setzt Viewer-Zoom und Verschiebung zurueck.

### PY-04: Exklusivitaet

- Ist ein verwaltetes Terminal konfiguriert, ist es fuer Files autoritativ. Ein Fehler fuehrt zu
  einem sichtbaren Retry-Zustand und nicht zu einem stillen Pyodide-Fallback.
- Nur ohne verwaltetes Terminal und mit aktivem Code Interpreter wird das Pyodide-Filesystem
  verwendet.
- In diesem Files-only-Zustand gibt es kein Plus, weil weder Terminal noch Browser hinzugefuegt
  werden koennen.
- Schliessen der Arbeitsflaeche schaltet den Code Interpreter nicht aus. Dateipersistenz folgt der
  konfigurierten Open-WebUI-Persistenz und darf nicht durch einen UI-Tabwechsel veraendert werden.

### PY-05: Persistenzvertrag

- Das Pyodide-Dateisystem gehoert zum Benutzer im aktuellen Browserprofil, nicht zu einem
  einzelnen Chat und nicht zum Open-WebUI-Server.
- Ist Pyodide-Dateipersistenz aktiv, werden Dateien in IndexedDB gespeichert und nach Seiten-Reload
  und Browser-Neustart im selben Browserprofil wiederhergestellt. Ist sie aus, gelten nur die
  Lebensdauer des aktuellen Workers beziehungsweise der Seite.
- Chatwechsel, Tab-Schliessen und Workspace-Schliessen loeschen keine Pyodide-Dateien.
- Ein gespeicherter Chat behaelt fuer relevante Modell-Outputs den Runtime-Pfad und den neuesten
  serverseitigen Datei-Snapshot. Ein ungespeicherter Chat erhaelt weder Snapshot noch dauerhaften
  Output-Katalog.
- Nur Snapshots des aktuellen Chats werden als priorisierte Output-Dateien in den Modellkontext
  aufgenommen. Andere Dateien im gemeinsam genutzten Pyodide-Dateisystem werden nicht aufgelistet
  und gelten ohne explizite Auswahl nicht als Kontext dieses Chats.
- Chat-Loeschung entfernt die chatbezogenen Verweise, nicht die browserlokalen Dateien. Das
  Zuruecksetzen persistierter Dateien bleibt eine ausdrueckliche Benutzeraktion.

## 7. Terminal, Browser und Files-Tabs

- Pro Arbeitsflaeche existiert genau ein Files-Navigator.
- Ein erneuter Klick auf `Dateien` fokussiert ihn und oeffnet keine zufaellige Datei.
- Mehrere Terminal-Tabs und mehrere Browser-Tabs sind erlaubt.
- Terminal und Browser erscheinen nur bei einem zentral konfigurierten Dienst mit den benoetigten
  Faehigkeiten.
- Terminal ist ein vollwertiger seitlicher Tab und niemals eine dauerhaft sichtbare untere Leiste.
- Browser zeigt nur lokale Apps beziehungsweise freigegebene Ports. Sein Leerzustand erklaert,
  dass zuerst eine lokale Web-App laufen muss.
- Nicht erreichbare Dienste zeigen Fehler und Retry im betroffenen Tab, ohne andere Inhalte zu
  blockieren.

## 8. Persistenz und Loeschen

| Inhalt                      | Nach Tab-Schliessen                   | Nach Chat-Reload                     | Nach Chat-Loeschung  |
| --------------------------- | ------------------------------------- | ------------------------------------ | -------------------- |
| Transienter Canvas          | bleibt im Chat                        | vorhanden, nicht automatisch offen   | geloescht            |
| Canvas in Notes             | bleibt                                | vorhanden                            | Note bleibt          |
| Web Preview                 | bleibt im Chat                        | vorhanden, nicht automatisch offen   | geloescht            |
| Exportierte Preview-Dateien | bleiben in Runtime                    | nach Runtime-Vertrag                 | bleiben              |
| Pyodide-Dateien             | bleiben im Browserprofil              | bei aktivierter Persistenz vorhanden | bleiben              |
| Terminal-Dateien            | bleiben im Chat-Workspace der Runtime | nach Servicevertrag                  | nach Servicevertrag  |
| Terminal-Sitzung            | nach Servicevertrag                   | serviceabhaengig                     | nach Servicevertrag  |
| Browser-App                 | Prozess bleibt                        | serviceabhaengig                     | nach Runtime-Vertrag |

`Schliessen` bedeutet fuer einen Tab oder die Arbeitsflaeche niemals automatisch `Loeschen`.

## 9. Verbindliche E2E-Abnahme

Die Abnahme gilt nur mit sichtbarer Browserpruefung in einem normalen gespeicherten Chat. Reine
Unit- oder API-Simulation ist zusaetzliche Diagnose, aber kein Ersatz.

### E2E-01: Canvas

1. Zwei unterschiedlich benannte Canvas-Dokumente mit einem realen Modell erstellen.
2. Beide Karten einmalig im Chat nachweisen.
3. Per Karte und Tab zwischen beiden wechseln.
4. Je ein gezieltes KI-Update ausfuehren und gleiche IDs nachweisen.
5. Titel und Inhalt manuell bearbeiten; Autosave und Reload pruefen.
6. Ein KI-Update rueckgaengig machen; danach Undo durch manuelle Aenderung deaktivieren.
7. Tab schliessen, erneut ueber Karte oeffnen und Chat neu laden.
8. Einen Canvas zu Notes uebertragen, wieder oeffnen und bearbeiten.
9. Notes deaktivieren und verborgene Aktion plus API-Ablehnung pruefen.
10. Tool Permissions auf `Ask` stellen und nachweisen, dass chatlokale Canvas-Built-ins ohne
    Freigabedialog laufen.

### E2E-02: Web Preview

1. Zwei isolierte, jeweils mehrdateilige Previews mit einem realen Modell erstellen.
2. Einmalige Karten, getrennte IDs und angehaengte Tabs nachweisen.
3. HTML, CSS und JavaScript im Code-Modus editieren und sofortiges Preview-Update pruefen.
4. Preview-Tab schliessen; Modellupdate darf ihn nicht erneut oeffnen.
5. Chat neu laden und beide Previews ueber ihre Karten wieder oeffnen.
6. Relative Assets, JavaScript-Fehler, CSP und externe Navigation pruefen.
7. Tool Permissions auf `Ask` stellen und nachweisen, dass chatlokale Preview-Built-ins ohne
   Freigabedialog laufen.
8. Runtime-Import anfordern und den weiterhin sichtbaren Freigabeschritt pruefen.

### E2E-03: Pyodide-only

1. Kein Terminal konfigurieren, Code Interpreter aktivieren.
2. Nachweisen, dass `Dateien` automatisch oeffnet und kein Plus sichtbar ist.
3. CSV oder JSON hochladen, per Python veraendern und neue Datei im Files-Tab sehen.
4. PDF, DOCX oder PPTX oeffnen, Tab wechseln und wieder schliessen.
5. Nachweisen, dass kein Seiten-Reload erfolgt und Code Interpreter aktiv bleibt.
6. Aus einer erzeugten Textdatei einen freigegebenen Snapshot in eine Web Preview importieren.
7. Runtime beenden und die weiterhin funktionsfaehige Preview nach Reload oeffnen.

### E2E-04: Terminal-only und gemeinsame Tabs

1. Verwaltetes Terminal aktivieren und Pyodide nicht verwenden.
2. Genau einen Files-Navigator, zwei Terminals und zwei Browser-Tabs erstellen.
3. Tabs umsortieren und jeweils beim ersten Klick fokussieren.
4. Eine lokale Web-App starten, Port im Browser oeffnen und Reload pruefen.
5. Terminal voruebergehend stoppen: Fehler und Retry muessen sichtbar sein; kein Pyodide-Fallback.

### E2E-05: Layout und Robustheit

1. Arbeitsflaeche rechts oeffnen, Breite veraendern und Reload ausfuehren.
2. Hell- und Dunkelmodus sowie breite und schmale Ansichten pruefen.
3. Tabs per Maus und Tastatur bedienen; sichtbaren Fokus und Tooltips pruefen.
4. Sicherstellen, dass keine Aktion Chatposition, aktivierte Funktionen oder andere Tabs verliert.
5. Fehlende IDs, veraltete Versionen, ungesunde Dienste und unbekannte Dateien ohne Absturz pruefen.

## 10. Definition of Done

Die Funktion ist nur abgenommen, wenn:

- alle sichtbaren Kriterien in einem echten Browserlauf geprueft wurden,
- Canvas und Web Preview mit einem realen konfigurierten Modell erstellt und aktualisiert wurden,
- automatisierte Regressionen fuer die entdeckten Fehler bestehen,
- Runtime-free, Pyodide-only und Terminal-only getrennt getestet wurden,
- Screenshots oder Traces die sichtbaren Ergebnisse belegen,
- bekannte Luecken ausdruecklich als Luecken dokumentiert sind,
- die Produktionsumgebung und produktive Daten unberuehrt bleiben.

## 11. Verifikation vom 10. September 2026

Dieser Abgleich betrifft den aktuellen Pyodide-only-Branch auf 0.11.3. Die oben
beschriebenen Terminal-Journeys gelten nicht als in diesem Branch implementiert
oder bestanden.

- Frontend: 174 Tests in 20 Dateien bestanden (`npm run test:frontend -- --run`).
- Backend: 159 Tests fuer Canvas, Web Preview, Mutationen, Kontext, Output-Katalog,
  Persistenz und Builtin-Berechtigungen bestanden; isolierte Testdatenbank.
- Produktionsbuild mit Node 22 sowie Viewer-Abhaengigkeits- und Bundle-Pruefung bestanden.
- Vollanwendung: Neun Chromium-Journeys bestanden. Sie pruefen explizites Oeffnen
  ueber Outputs, Autosave, Chatwechsel, Reload ohne Auto-Open, Notes-Promotion,
  CSV-Upload, Sichtbarkeit des aktiven Tabs bei horizontalem Ueberlauf und
  Wiedereroeffnen eines gespeicherten Outputs in einem neuen Browserkontext ohne
  Runtime-Katalog. Der Berechtigungstest wird im No-Auth-Lauf bewusst uebersprungen
  und separat mit echter Anmeldung ausgefuehrt.
- Viewer-Harness: 39 Tests in Chromium, Firefox und WebKit bestanden; PDF, DOCX,
  PPTX, CSV, Zoom/Pan/Reset, defekte Dateien, Runtime-Ausfall, schmale Ansichten
  sowie helle und dunkle Darstellung.
- Echter Modelllauf im lokalen Browser: GPT-5.5 erstellte einen Canvas, eine
  Web Preview mit `index.html` und `styles.css` sowie per `execute_code` eine CSV.
  `workspace_display_file` zeigte die Tabelle mit Alpha/10 und Beta/20 rechts an.
  Nach Schliessen des Test-Tabs waren beide Objekte und der serverseitige
  Datei-Verweis im gespeicherten Chat weiterhin vorhanden.
- Separater Browser-Test mit echter eingeschraenkter Benutzeridentitaet bestanden: Canvas und Web Preview ohne Runtime
  oeffenbar; Files nicht verfuegbar; Upload-API und Notes-Promotion liefern 403;
  fremde Chats, Dateimetadaten und Dateiinhalte bleiben unzugaenglich. Upload,
  Capture und Attach Files sind deaktiviert; Attach Notes ist nicht sichtbar.
- Alte gespeicherte Outputs ohne Versionszeitstempel bleiben oeffenbar und zeigen
  `Saved version available`. Bei bekannten neueren Browser-Aenderungen weist
  manuelles Oeffnen auf die letzte gespeicherte Version hin; Modellanzeige nutzt
  in diesem Fall die aktuelle Browser-Datei.
- Keine neue Datenbankmigration im Fork, keine Aenderung an produktiven Diensten
  oder Daten. Die isolierte Berechtigungs-Testdatenbank wird mit den bestehenden
  Upstream-Migrationen initialisiert.

### 11.1 Regressionen und Wiederholung

- Viewer-Harness und Hauptanwendung haben getrennte Vite-Caches. Zuvor konnte der
  Harness veraltete Editor-Abhaengigkeiten und `504 Outdated Optimize Dep`
  verursachen. Pyodide wird im Dev-Server vorab optimiert, damit sein erster
  Worker-Start keinen Seiten-Reload ausloest.
- Der Outputs-Katalog erhaelt gespeicherte Canvas-/Preview-Objekte explizit vom
  Chat; er funktioniert auch ohne sichtbare Erstellungskarte im aktuellen Verlauf.
- Neue Tests decken unterbrochene Uploads, erneutes Speichern, ueberholte
  Bestaetigungen, gleichnamige Dateien in verschiedenen Chats und unklare
  Serverantworten ab. Bei Netzwerkfehlern, HTTP 408 oder 5xx werden moeglicherweise
  bereits zugeordnete Uploads nicht geloescht.
- Der aktive Tab wird bei Auswahl in den sichtbaren Bereich der Tab-Leiste
  verschoben, ohne Chat oder Dokument zu scrollen.

Den eigenstaendigen Rechte-Test nach `npm run build` mit Node 22 starten:
`node scripts/test-workspace-permissions.mjs`. Voraussetzung ist die eingerichtete
Backend-Umgebung in `.venv`. Der Runner waehlt einen freien Loopback-Port, erstellt
eine frische Datenbank unter `.tmp/permissions-*`, deaktiviert Modellprovider und
beendet seinen Backend-Prozess nach dem Test. Die regulaere Dev-Instanz und ihre
Benutzer werden nicht veraendert.

**Speichergrenze:** Erst `Saved to chat` bestaetigt die serverseitige Speicherung.
Ein abrupt geschlossenes Browserfenster waehrend `Saving...` garantiert keine
Fertigstellung. Es gibt keinen Service-Worker-Hintergrundupload. Nicht gespeicherte
Browserdaten sind kein Ersatz fuer einen bestaetigten Datei-Upload. Der Abbruch
des Uploads ist als Unit-Regression getestet; das Beenden des gesamten Browsers
waehrend eines laufenden Uploads ist nicht als eigener E2E-Test nachgewiesen.

Lokale, nicht versionierte Pruefprotokolle liegen unter
`.tmp/workspace-sep10-*.log` und `.tmp/permissions-sep10-*.log`. Fehlgeschlagene
Browserlaeufe behalten Traces und Screenshots in `.tmp/workspace-e2e-results`
beziehungsweise im isolierten Berechtigungs-Testverzeichnis. Der reale Modellchat
hat die ID `84e0be17-0104-4def-9505-79cd48b08436` in der lokalen Dev-Instanz.

**Offene Freigabegrenze:** Die globale Svelte-Typpruefung ist nicht gruen:
7.660 Fehler und 200 Warnungen in 339 Dateien. Gegen den bisherigen lokalen
Pruefstand kamen keine neuen Diagnosegruppen hinzu; das ersetzt keine fehlerfreie
Gesamtpruefung. Der reale Modellnachweis oben belegt die genannten Erstellungs-
und Anzeigepfade, nicht pauschal saemtliche Modell-/Konfigurationskombinationen.

### 11.2 Sichere Bearbeitung und Preview-Diagnose

- Bei HTTP 409 behalten Canvas und Web Preview den lokalen Entwurf. Autosave
  pausiert; `Compare`, `Recover draft` und `Discard draft` sind explizite Aktionen.
  Wiederherstellen liest zuerst die aktuelle Serverversion und speichert weiterhin
  mit Versionspruefung. Eine weitere konkurrierende Aenderung erzeugt erneut einen
  Konflikt, keine erzwungene Ueberschreibung.
- Konfliktentwuerfe sind nach Benutzer, Chat und Objekt getrennt im
  `sessionStorage` desselben Browser-Tabs gesichert. Workspace-Tab schliessen und
  Seiten-Reload behalten sie. Browserfenster schliessen ist keine zugesicherte
  Wiederherstellung. Bei Speicherkontingent-/Browserfehlern bleibt die aktuelle
  Kopie im Arbeitsspeicher und eine Warnung fordert zum Offenhalten des Tabs auf.
  Noch laufende, nicht als Konflikt erkannte Saves bleiben von dieser Sicherung
  ausgeschlossen. Es gibt keine neue Datenbankmigration.
- Eine eindeutige Canvas-Textauswahl bis 8.000 Zeichen kann mit einer Anweisung
  direkt an der Auswahl in einem kleinen Dialog in den Chat uebernommen werden
  (`Add to chat`). Die Anweisung ist optional und wird an einen vorhandenen
  Composer-Entwurf angehaengt, nicht automatisch abgeschickt. Der Composer zeigt
  Titel und Textzitat mit Entfernen-Aktion. Ein anderes Auswahlziel muss zuvor
  entfernt werden. Auf schmalen Ansichten schliesst sich das Workspace-Overlay,
  damit der Chatentwurf sichtbar wird. Ein Tabwechsel veraendert den eingefrorenen
  Dokumentbezug nicht. Die API bindet `canvas_replace_text` an Original-ID,
  Originaltext und Originalhash; Erstellen/Vollersetzung sind fuer diesen Auftrag
  gesperrt. Sichtbare Textauswahlen werden auf den exakten Markdown-Quelltext
  abgebildet, einschliesslich Fett-/Kursivtext, Links, Listen, mehrerer Absaetze,
  Inline-Code und Sonderzeichen. Im Chat bleibt das Zitat ohne Markdown-Marker
  lesbar. Mehrdeutige und nicht sicher abbildbare Auswahlen werden abgelehnt.
- Reines Selektieren oder Ein-/Ausblenden von Aenderungsmarkierungen loest kein
  Autosave und keine Markdown-Normalisierung aus. Manuelle Aenderungen werden
  auch unmittelbar nach einem externen Update erfasst, ohne zeitbasierte Sperre.
  Vor dem Uebernehmen wird Autosave abgeschlossen und der gesamte erfasste
  Quelltext mit dem gespeicherten Dokument verglichen. Nur bei Gleichheit wird
  dessen kanonischer Hash verwendet; ein veralteter UI-Hash allein ist kein
  Konflikt. Chatwechsel, weitere lokale Bearbeitung oder echte externe Aenderungen
  waehrend dieses Ablaufs verhindern die Uebernahme.
- Das Auswahlzitat wird mit der User-Nachricht als `workspace_selection` im
  bestehenden Chat-JSON gespeichert. Es bleibt nach Reload lesbar und wird bei
  Regeneration als dasselbe versionierte Ziel verwendet. Kein neuer Tabellenentwurf.
- "Aenderungen anzeigen" erscheint ausschliesslich im Canvas-Editor, auch bei
  verknuepften Notes. Entfernte Texte werden direkt an ihrer Stelle im Dokument
  dezent rot und durchgestrichen, hinzugefuegte Texte dezent gruen markiert.
  Die vorhandene Dokumentformatierung bleibt erhalten. Keine Vergleichsbox im
  Chat und kein Aenderungsschalter bei Web Preview. Alte gespeicherte Chat-Diffs
  werden ebenfalls nicht angezeigt.
- Canvas hat keine eigene Kopfzeile, keinen zusaetzlichen Titel und keine
  Wort-/Zeichenzaehler, auch nicht bei verknuepften Notes. Der Dokumenttext beginnt
  direkt oben; Dokumentueberschrift und gespeicherter Objektname bleiben erhalten.
  Die Workspace-Tabs bleiben unveraendert. Aenderungsansicht, Undo und weitere
  Dokumentaktionen schweben rechts oben als kompakte, tastaturbedienbare Icons
  mit Tooltips. Der erste Textblock haelt ausreichend Abstand zu den Aktionen,
  auch in schmalen Ansichten. Es gibt keine zusaetzliche vollbreite Aktionsleiste.
  Eigenstaendige Notes behalten ihre vorhandenen Metadaten und Zaehler.
- Markierungen sind ausschliesslich Editor-Dekorationen: Sie veraendern weder
  Dokument-JSON noch Autosave oder Undo-Historie. Ausblenden, Weiterbearbeiten,
  Versionswechsel und Schliessen entfernen sie. Nach Reload wird der letzte
  gespeicherte KI-Snapshot erst auf ausdruecklichen Klick erneut verglichen.
  Der Vergleich markiert den geaenderten Bereich zwischen erstem und letztem
  Unterschied; zusammenhaengende Wortgrenzen bleiben lesbar.
- Canvas-Undo ist innerhalb der eingeschalteten Aenderungsansicht verfuegbar.
  Es verwendet den letzten KI-Snapshot des Objekts im Chat-JSON, nicht den
  Zustand eines gemounteten Editors. Es prueft atomar Objekt-ID, Inhalts-Hash und
  Zeitversion. Ein zweites Undo oder ein alter Chat-Diff darf keine neuere manuelle
  oder KI-Aenderung ueberschreiben. Konflikte werden sichtbar gemeldet. Mehrere
  Tool-Aufrufe bleiben einzelne Updates, keine atomare Turn-Version. Exportierte
  Dateien werden durch Undo nicht veraendert. Kein unbeschraenktes Versionsarchiv.
- Web Preview verwendet ausschliesslich die vorhandene Workspace-Breite; keine
  Desktop-/Mobile-Umschalter oder Geraeteemulation. Im schmalen Codebereich ersetzt
  weiterhin eine Dateiauswahl die seitliche Dateiliste.
- JS-Fehler, unbehandelte Promise-Ablehnungen, Ressourcen-/CSP-Fehler und fehlende
  virtuelle Fetch-Dateien werden innerhalb der bestehenden Sandbox gemeldet.
  Maximal 20 unterschiedliche Meldungen pro Render, je 600 Zeichen Text und 200
  Zeichen Dateibezeichnung; URL-Query und Fragment werden entfernt. Nur Nachrichten
  des aktuellen iframe-Fensters mit aktuellem Render-Kanal werden angenommen.
  Reload/Inhaltswechsel verwerfen alte Meldungen. Bei deaktivierten Scripts ist
  auch die Script-Diagnose deaktiviert; statische Kompositionsfehler bleiben sichtbar.
- `Ask AI to fix` uebernimmt die begrenzten Meldungen ausdruecklich als untrusted
  JSON in einen noch abzusendenden Chatentwurf. Fehlertexte werden nie als HTML
  gerendert oder automatisch ausgefuehrt. Die bestehende CSP und der Ausschluss
  von `allow-same-origin` bleiben bestehen; keine zusaetzlichen Netzwerkrechte.

Abnahme dieses Bearbeitungspakets am 10.09.2026:

- 157 Frontend-Tests, 115 Backend-Tests und Node-22-Produktionsbuild bestanden.
  Die globale Svelte-Pruefung bleibt beim oben dokumentierten Bestand von 7.660
  Fehlern und 200 Warnungen; die neuen Editor-/Hilfsdateien melden keine Fehler.
- 14 Full-App-Browserregressionen bestanden; sie pruefen echte 409-Konflikte, Reload, Wiederherstellen und
  Verwerfen fuer beide Editoren, versionierte Auswahl nach Tabwechsel,
  Vorschauvergleich/Undo, Fehleranzeige und schmale Code-Dateiauswahl.
  Der isolierte Restricted-User-Test besteht weiterhin.
- Reales Modell `GPT-5.5` im lokalen Testchat
  `11f00669-f7a9-4c42-88c0-442d5cb9109e`: Canvas und Zwei-Dateien-Preview erstellt,
  dieselbe Preview aktualisiert, beide Dateiaenderungen verglichen und per Undo
  zurueckgenommen. Canvas-Satz ausgewaehlt, auf Preview gewechselt, Anfrage gesendet:
  Nur der ausgewaehlte Satz aenderte sich; der Preview-Fokus blieb erhalten.
  Canvas-Vergleich und Undo anschliessend ebenfalls erfolgreich.
- Dabei gefundene Regressionen behoben: Inhaltsupdates trotz vorab gestreamtem
  Hash erkennen; bei API-Hydrierung den gespeicherten Preview-Hash mitnehmen;
  Canvas-Auswahl gegen gespeicherten Originaltext pruefen und nur aeussere
  Auswahl-Leerzeichen entfernen. Konflikte bleiben explizit statt stiller Retries
  mit neuerem Hash. Pruefprotokolle: `.tmp/artifact-edit-*.log`.

Nachpruefung der Auswahl- und Inline-Aenderungsoberflaeche am 11.09.2026:

- 160 Frontend-Tests, 120 Backend-Tests und Node-22-Produktionsbuild bestanden.
  Die globale Svelte-Pruefung ist wegen vorhandener projektweiter Diagnosen
  weiterhin nicht gruen; sie ist keine bestandene Abnahmebedingung.
- Vollstaendiger Workspace-Browserlauf: 17 bestanden, ein Berechtigungstest
  absichtlich ausgenommen und in isolierter Konfiguration separat bestanden.
  Auswahl aus Canvas und verknuepfter Note, erhaltene Composer-Entwuerfe,
  Chat-/Tabwechsel, Reload, Inline-Undo, Konflikte, Uploads und Pyodide-Files
  wurden geprueft. Helle/dunkle und schmale Screenshots visuell kontrolliert.
- Reales Modell GPT-5.5 im Testchat `3f95b4aa-7ae8-4305-931d-47f6fe0f4fec`:
  ausgewaehlten Canvas-Satz geaendert, zweiten Absatz erhalten, Inline-Undo und
  gespeichertes Auswahlzitat nach Reload geprueft. Zwei-Dateien-Web-Preview
  erstellt, beide Dateien aktualisiert und ueber Inline-Undo zurueckgenommen;
  gerenderte Vorschau anschliessend kontrolliert.
- Im schmalen Layout beide Workspace-Sichtbarkeitszustaende beim Uebernehmen
  schliessen; andernfalls blieb der Chatentwurf hinter dem Overlay verborgen.
  Vergleichsausschnitte enthalten lesbaren Zeilenkontext statt Wortfragmente.
  Protokolle: `.tmp/selection-*.log`, Bilder: `.tmp/workspace-e2e-results/`.

UX-Korrektur am 11.09.2026: Die obige historische Inline-Chat-Abnahme ist durch
die Canvas-interne Darstellung ersetzt. Aktuell geprueft: 12 gezielte Unit-Tests,
Canvas-Vergleich und versionsgebundenes Undo nach Reload, keine Vergleichs-UI im
Chat oder bei Web Preview, Weiterbearbeiten ohne Mitspeichern von Dekorationen,
helle und schmale dunkle Ansicht sowie die beiden verknuepften Notes-Journeys.
Protokolle: `.tmp/canvas-document-*.log`.

Nachpruefung der haeufig abgelehnten Textauswahl am 11.09.2026:

- Reine Auswahltransaktionen speichern nicht mehr. Die zeitbasierte Sperre fuer
  schnelle manuelle Eingaben ist entfernt. Formatierter sichtbarer Text wird auf
  eindeutige Quellbereiche abgebildet; nicht teilbare Zeichenreferenzen werden
  nicht auf einen groesseren Bereich erweitert. Absatzabstaende bleiben erhalten.
- 187 Frontend-Tests, 36 gezielte Backend-Tests und Node-22-Produktionsbuild
  bestanden. Vollstaendiger Workspace-Browserlauf: 20 bestanden, ein
  Berechtigungstest in der No-Auth-Konfiguration ausgenommen. Nach der letzten
  Quellbereichsabsicherung beide neuen Browserregressionen erneut bestanden:
  Formatierungen ohne Autosave sowie sofortiges Bearbeiten/Auswaehlen mit echtem
  konkurrierendem Server-Update. Die globale Typpruefung bleibt bei 7.533 Fehlern
  und 200 Warnungen; keine Diagnosen in den neuen Auswahl-Hilfsdateien.
- Reales GPT-5.5 im Testchat `ac944771-156e-4409-8ba7-0cb4e72afe5d`: Canvas
  erstellt, Satz mit fetter Passage ausgewaehlt, Anweisung im Chat abgeschickt,
  nur diesen Satz ersetzt. Zweiter Absatz und Fettformatierung unveraendert.
  Canvas-interne Markierungen, Reload, Wiedereroeffnen ueber Outputs und erneute
  Uebernahme derselben formatierten Passage erfolgreich geprueft.
  Protokolle: `.tmp/selection-source-*.log`. Keine Datenbankmigration.
