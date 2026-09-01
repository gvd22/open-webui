# KOBY Unified Workspace - Gesamtspezifikation

**Status:** Verbindliche Produkt- und Verhaltensspezifikation  
**Version:** 1.3
**Datum:** 1. September 2026

### Upgrade-Vertrag fuer Open WebUI 0.11.3

Die Grundlage ist der exakte Upstream-Tag `v0.11.3`, nicht ein beweglicher `main`-Stand.
Der zugehoerige Konfigurations- und Abnahmebericht ist
[Workspace 0.11.3 Upgrade Acceptance](2026-09-01-workspace-v0113-upgrade-acceptance.md).
Dieser Bericht unterscheidet nachgewiesenes Verhalten von noch offenen Abnahmen.

- Native Tool-Freigaben und `ask_user` werden verwendet. Wenn Tool Permissions aktiv sind,
  verwenden neue Chats ohne explizite Wahl `ask`; bestehende explizite Entscheidungen und
  native nicht-interaktive Ausnahmen bleiben bestehen.
- Warten auf Freigabe oder Antwort ist kein abgeschlossener oder abgestuerzter Turn.
  Ein Reload erhaelt ausstehende Interaktionen. Gleichzeitige Freigaben duerfen denselben
  Aufruf nicht zweimal ausfuehren.
- Freigegebene Aufrufe behalten Chat, Objekt-ID, Runtime-Bindung und urspruenglichen Fokus.
  Ein Tabwechsel darf sie nicht umleiten. Version und Eigentum werden vor der Mutation erneut
  geprueft; bei einem Konflikt muss das Modell den aktuellen Stand lesen.
- Ein Teil-Read liefert einen Datei-Hash fuer Teilersetzungen und bei Web Preview zusaetzlich
  einen Preview-Hash fuer paketweite Updates und Imports. Mehrere Teilersetzungen verwenden
  jeweils den neuen Versionsstand; mehrere Dateien koennen alternativ zusammen aktualisiert werden.
- Neue gespeicherte Chats erhalten genau eine serverseitig gebundene Terminal-Umgebung.
  Bestehende Bindungen und gemeinsam genutzte Altdateien werden nicht still verschoben.
  Noch ungespeicherte Chats duerfen keinen gemeinsamen Terminal-Speicher verwenden.
- Shell, Files, Ports, Dokumente, Exports und Imports verwenden dieselbe vertrauenswuerdige
  Chat-Zuordnung. Ein ausgefallenes oder gesperrtes Terminal fuehrt nicht zu einem Pyodide-Fallback.
- Native Script- und Download-Einstellungen gelten auch fuer Web Preview. Dessen iframe
  bleibt ohne `allow-same-origin`; die Vorschau erhaelt keinen Zugriff auf die Host-Anwendung.
- Relative `fetch()`-Zugriffe auf virtuelle Text-/JSON-/CSV-Dateien werden aus dem Preview-Paket
  beantwortet. Sie lesen weder Host-Dateien noch Runtime-Dateien. Unbekannte virtuelle Pfade
  liefern 404; Schreibmethoden sind nicht erlaubt. Paketinstallation, Module-Bundling und
  signierte API-Sitzungen gehoeren nicht zu dieser browsernativen Vorschau.
- Exportordner fuer neue Preview-Exporte enthalten die stabile Preview-ID, damit gleichnamige
  Objekte einander nicht ueberschreiben. Bestehende gueltige Exportpfade bleiben erhalten.
- Native Dateiausgaben werden im vorhandenen passenden Viewer geoeffnet. Eine angegebene
  PDF-Seite oder PPTX-Folie wird beruecksichtigt; Downloads bleiben verfuegbar.


## 1. Zweck und Geltungsbereich

Diese Spezifikation fasst die Entscheidungen fuer Canvas, Web Preview, Files, Terminal,
Browser, Dokumentanzeige und kuenftige Connector-Oberflaechen in einer gemeinsamen
KOBY-Arbeitsflaeche zusammen.

Sie ist bei Widerspruechen die massgebliche Quelle und ersetzt die ueberschneidenden
Produktentscheidungen aus diesen frueheren Dokumenten:

- `2026-08-03-koby-canvas-product-spec.md`
- `2026-08-04-koby-unified-work-surface.md`
- `2026-08-16-koby-document-viewer-support.md`
- `2026-08-16-koby-document-viewer-production-readiness.md`
- aeltere Canvas-Integrations-, Akzeptanz- und Arbeitsflaechenentwuerfe

Die alten Dokumente bleiben als Entscheidungsverlauf erhalten. Neue Implementierungen,
Reviews und Abnahmen muessen sich jedoch an diesem Dokument orientieren.

## 2. Produktmodell

KOBY hat fuer Endbenutzer keine unterschiedlichen Arbeitsmodi. Es gibt:

1. einen primaeren Chat,
2. eine optionale seitliche Arbeitsflaeche daneben,
3. darin stabile, typisierte Arbeitsobjekte als Tabs.

Der Chat bleibt Ausgangspunkt fuer Anweisungen und Rueckfragen. Die Arbeitsflaeche zeigt
das konkrete Ergebnis, das betrachtet oder bearbeitet wird. Ein Benutzer muss Begriffe wie
MCP, Tool Call, Pyodide, Renderer, Artifact oder Workspace-Modus nicht verstehen.

### 2.1 Leitprinzipien

- **Chat bleibt primaer:** Die Arbeitsflaeche ergaenzt den Chat und ersetzt ihn nicht.
- **Ein Objekt, ein Ort:** Dasselbe Objekt wird aktualisiert, nicht bei jeder Aenderung dupliziert.
- **Keine sichtbaren Modi:** KOBY entscheidet anhand der Aktion und der verfuegbaren Funktion.
- **Direkte Bearbeitung:** Text und Code werden in der Arbeitsflaeche normal bearbeitet.
- **Explizite Dauerhaftigkeit:** Chatgebundene Inhalte werden nur durch eine bewusste Aktion
  in Notes oder Files uebertragen.
- **Stabile Identitaet:** Tabs, Tool-Ergebnisse und Folgeanweisungen verwenden dauerhafte IDs.
- **Ruhige Oberflaeche:** Wenige, kontextuelle Aktionen; keine technischen Statusanzeigen.
- **Sichere externe Aktionen:** Schreibende Connector-Aktionen benoetigen eine klare Freigabe.

### 2.2 Begriffe in der Benutzeroberflaeche

Erlaubte Begriffe sind beispielsweise `Dokument`, `Vorschau`, `Dateien`, `Terminal`,
`Browser`, `Bearbeiten`, `Rueckgaengig`, `Zu Notizen hinzufuegen` und konkrete Objekttitel.

Nicht als Rahmen oder Modus anzuzeigen sind `Workspace`, `Artifact`, `Draft`, `Renderer`,
`MCP`, `Pyodide` und interne Tool-Namen.

## 3. Grundlayout

### 3.1 Desktop

- Ohne offenes Arbeitsobjekt nutzt der Chat die verfuegbare Breite.
- Beim ersten Oeffnen eines Objekts erscheint rechts eine persistente, in der Breite anpassbare
  Arbeitsflaeche. Der Benutzer kann sie mit einer kompakten Kopfaktion nach links oder wieder
  nach rechts verschieben; die Wahl gilt chatuebergreifend und bleibt nach einem Reload erhalten.
- Der Chat wird schmaler, bleibt aber lesbar und voll bedienbar.
- Das Oeffnen, Wechseln oder Schliessen eines Objekts darf die Chatposition nicht sichtbar
  springen lassen.
- Es gibt keinen Vollbild-Canvas und kein zusaetzliches unteres Terminal-Dock.
- Terminal, Browser, Files und Dokumente sind gleichwertige Seiten der seitlichen Flaeche.

### 3.2 Mobile und schmale Ansichten

- Die Arbeitsflaeche darf den Chat temporaer ueberlagern.
- Zurueck zum Chat und Schliessen muessen jederzeit klar erreichbar sein.
- Objektidentitaet, ungespeicherte Aenderungen und laufende Aktionen bleiben erhalten.
- Inhalte und Aktionsleisten duerfen sich nicht ueberdecken.

### 3.3 Einstieg

- Der Arbeitsflaechen-Knopf bleibt im Chatkopf erreichbar.
- Gibt es keine offenen Objekte, zeigt die rechte Flaeche eine ruhige Auswahl der tatsaechlich
  verfuegbaren Inhalte, zum Beispiel Files, Terminal oder Browser.
- Im leeren Zustand gibt es keine leere Tab-Leiste und kein zweites Plus-System.
- Oben bleibt nur die Aktion zum Schliessen der Arbeitsflaeche.
- Ein Plus erscheint nur, wenn mindestens eine weitere gueltige Aktion hinzugefuegt werden kann.

## 4. Gemeinsames Objekt- und Tabmodell

Jedes Arbeitsobjekt besitzt mindestens:

```ts
type WorkspaceItem = {
  id: string;
  kind:
    | "canvas"
    | "web-preview"
    | "files"
    | "file"
    | "terminal"
    | "browser"
    | "connector";
  title: string;
  renderer: string;
  closable: boolean;
  source?: unknown;
  persistence?: "chat" | "note" | "runtime" | "external";
  dirty?: boolean;
};
```

### 4.1 Tabregeln

- Die Tab-Leiste ist sichtbar, sobald mindestens ein Objekt offen ist, auch bei nur einem Tab.
- Jeder Tab zeigt ein passendes Symbol, einen menschlichen Titel und eine Schliessen-Aktion.
- Tabs sind horizontal scrollbar und umbrechen nicht.
- Tabs koennen per Drag-and-drop umsortiert werden.
- Ein neu geoeffnetes Objekt wird am Ende angehaengt.
- Erneutes Oeffnen derselben stabilen ID fokussiert den vorhandenen Tab.
- Das Schliessen eines Tabs loescht das Objekt nicht.
- Das Schliessen des letzten Tabs schliesst die rechte Flaeche.
- Die globale Schliessen-Aktion schliesst die Flaeche, nicht alle zugrunde liegenden Objekte.
- Fokuswechsel muessen beim ersten Klick funktionieren.

### 4.2 Fokusregeln

- Ein neu erstelltes Canvas oder eine neue Web Preview darf sich einmal automatisch oeffnen.
- Ein Update eines vorhandenen Objekts aktualisiert es live, stiehlt aber keinen Fokus.
- Ein bewusst geschlossenes Objekt wird durch ein Update nicht erneut geoeffnet.
- Ein Klick auf eine kompakte Chatkarte oeffnet oder fokussiert das zugehoerige Objekt.
- Der sichtbare Tab ist der primaere Arbeitsfokus fuer die naechste Modellanfrage.
- Ein Fehler in einem Tab darf andere Tabs oder den Chat nicht blockieren.

## 5. Verfuegbarkeitsmatrix

| Funktion | Voraussetzung | Ohne Voraussetzung |
|---|---|---|
| Canvas | Gespeicherter normaler Chat, Canvas-Modellfaehigkeit | Kein Canvas-Tool |
| Canvas zu Notes | Notes global aktiv und Benutzer berechtigt | Aktion verborgen, API lehnt ab |
| Web Preview | Gespeicherter normaler Chat, eigene Web-Preview-Modellfaehigkeit | Kein Preview-Tool |
| Web Preview anzeigen | Moderne Browserfunktionen | Keine Runtime notwendig |
| Files | Konfiguriertes Terminal oder aktives Pyodide-Filesystem | Nicht angeboten |
| Terminal | Zentral konfigurierter Terminal-Service | Nicht angeboten |
| Browser | Terminal-Service mit lokaler App-/Port-Funktion | Nicht angeboten |
| Dokumentanzeige | Viewer-Flag aktiv und unterstuetztes Format | Datei bleibt in Files |
| Jira/Confluence/Bitbucket | Typisiertes Connector-/MCP-Tool-Ergebnis | Kein Tab |

Canvas und Web Preview sind unabhaengige Modellfaehigkeiten. Das Deaktivieren von Canvas
darf Web Preview nicht deaktivieren.

## 6. Canvas

### 6.1 Zweck

Canvas ist der direkt editierbare Textbereich fuer Entwuerfe, Notizen, Berichte und andere
Markdown-Dokumente. Er verwendet die bestehende Notes-Editorlogik und ist kein zweiter,
separater Editor.

### 6.2 Erstellung und Chatdarstellung

- Canvas wird ausschliesslich durch ein typisiertes Tool-Ergebnis erstellt oder ausgewaehlt.
- Markdown-Fences oder spezielle Textmarker sind kein Erstellungsmechanismus.
- Pro Canvas erscheint bei der ersten Erstellung genau eine kompakte Dokumentkarte im Chat.
- Die Karte zeigt Dokument-Symbol, Titel und `Bearbeiten` beziehungsweise `Oeffnen`.
- Weitere KI-Aenderungen desselben Canvas erzeugen keine weiteren Karten.
- Bei offenem Canvas bleibt die Karte kompakt.
- Bei geschlossenem Canvas darf der erste Verweis eine formatierte, lesbare Vorschau zeigen.
- Modellprosa vor und nach einem Tool-Aufruf bleibt in der urspruenglichen Reihenfolge sichtbar.

### 6.3 Aktivitaetsanzeige

- Ein Update erscheint als leichte Standard-Toolzeile: `Canvas updated: <Titel>`.
- Die Zeile verwendet dieselben Farben, Abstaende und Statussymbole wie andere Tool Calls.
- Keine eigene gruene Badge, keine zusaetzliche Erfolgsanimation und kein Toast-Duplikat.
- Die Zeile ist klickbar und fokussiert das betroffene Dokument, ohne die Chatposition zu verschieben.

### 6.4 Editor

- Der Editor zeigt nur Dokumenttitel, dezenten Speicherstatus, Markdown-Werkzeuge und Inhalt.
- Titel und Text sind direkt editierbar und werden automatisch gespeichert.
- Es gibt keinen allgemeinen `Speichern`-Knopf.
- Der Titel wird beim Erstellen aus dem Inhalt generiert und bleibt editierbar.
- Eine manuelle Titelanpassung wird von spaeteren Inhaltsupdates nicht ueberschrieben, ausser der
  Benutzer verlangt ausdruecklich eine Umbenennung.
- KI-Aenderungen werden ueber normale Nachrichten im Chat angefordert; es gibt keinen separaten
  Funken-, Generieren- oder Access-Knopf im Editor.
- Nach genau einem KI-Update ist ein einzelnes `Rueckgaengig` verfuegbar. Es stellt den Stand vor
  diesem Update wieder her.
- Eine anschliessende manuelle Titel- oder Textaenderung deaktiviert dieses Rueckgaengig, damit
  keine eigene Arbeit ueberschrieben wird.

### 6.5 Folgeanweisungen

- Der Assistent kennt die vorhandenen Canvas-Titel und den aktuell sichtbaren Canvas.
- `Schreibe weiter`, `kuerze`, `korrigiere` oder vergleichbare Anweisungen aktualisieren den
  fokussierten Canvas mit derselben ID.
- Ein neuer Canvas wird nur bei einer ausdruecklichen Anforderung nach einem neuen oder separaten
  Dokument erstellt.
- Bei einem explizit genannten anderen Dokument wird dieses gezielt gelesen beziehungsweise
  ausgewaehlt und aktualisiert.
- Ohne eindeutigen Fokus oder Ziel muss der Assistent nachfragen und darf nicht raten.

### 6.6 Lebenszyklus und Notes

- Ein neuer Canvas ist zuerst chatgebunden und transient.
- Er bleibt nach dem Neuladen des Chats vorhanden.
- Das Loeschen des Chats loescht nicht uebertragene Canvas-Dokumente.
- `Zu Notizen hinzufuegen` ist eine explizite, idempotente Aktion fuer den ausgewaehlten Canvas.
- Nur dieser Canvas wird uebertragen; andere transiente Canvas-Dokumente bleiben chatgebunden.
- Wiederholtes Hinzufuegen verwendet dieselbe Note und erzeugt kein Duplikat.
- Nach der Verknuepfung ist die Note die dauerhafte Dokumentquelle. Bearbeitungen und KI-Updates
  werden konsistent mit der verknuepften Note gespeichert.
- Das Loeschen des Chats loescht die bereits erstellte Note nicht.
- Ist Notes deaktiviert oder nicht erlaubt, wird die Aktion nicht angezeigt und der Backend-Aufruf
  abgelehnt. Eine bestehende Verknuepfung darf dadurch nicht inkonsistent werden.
- Canvas-Tools werden im Notes-internen Chat nicht angeboten.

### 6.7 Kapazitaet

- Ab 10 transienten Canvas-Dokumenten zeigt KOBY eine unaufdringliche Warnung.
- Maximal 15 transiente Canvas-Dokumente pro Chat sind erlaubt.
- Der Versuch, ein 16. Dokument zu erstellen, wird erklaerbar abgelehnt.

## 7. Web Preview

### 7.1 Zweck und Datenmodell

Web Preview ist ein chatgebundenes, browsernatives HTML/CSS/JavaScript-Objekt. Es ersetzt
die fruehere eingebettete HTML-Artifact-Vorschau.

```ts
type WebPreviewDocument = {
  previewId: string;
  title: string;
  entrypoint: "index.html" | string;
  files: Record<string, { content: string; mime: string }>;
  updatedAt: number;
};
```

- Mehrere voneinander isolierte Previews pro Chat sind erlaubt.
- Kleine eingebettete Assets duerfen Teil der virtuellen Dateien sein.
- Die Preview ist die Quelle der Wahrheit, bis der Benutzer sie ausdruecklich in Files uebertraegt.

### 7.2 Chatverhalten

- Pro Preview erscheint genau einmal eine kompakte Webkarte mit Titel und `Oeffnen`.
- Im Chat wird weder ein iframe noch der vollstaendige Quelltext eingebettet.
- Die erste Erstellung oeffnet die Preview einmal automatisch.
- Updates derselben `previewId` aktualisieren eine offene Vorschau live.
- Updates erzeugen keine neue Karte, oeffnen eine geschlossene Preview nicht und stehlen keinen Fokus.
- Bestehende HTML-, CSS- und JavaScript-Codeblock-Erkennung darf als klar begrenzter
  Kompatibilitaetsadapter ein Web-Preview-Objekt erzeugen. Der dauerhafte Modellpfad bleibt toolbasiert.

### 7.3 Renderer

- Der Renderer bietet `Vorschau` und `Code` als kompakten segmentierten Wechsel.
- `Vorschau` zeigt die zusammengesetzte Webseite in einem isolierten iframe.
- `Code` zeigt die virtuellen Dateien und erlaubt direkte Bearbeitung.
- Mehrere Dateien sind auswaehlbar; unbekannte oder nicht textuelle Dateien zeigen einen
  verstaendlichen Zustand statt eines Absturzes.
- Aenderungen werden automatisch gespeichert und aktualisieren die Vorschau unmittelbar.
- Es gibt keinen `Speichern`-Knopf.
- Reload und ein kleines Aktionsmenue sind erlaubt; ein wirkungsloses Plus ist verborgen.

### 7.4 Ausfuehrung und Sicherheit

- HTML, lokale CSS-/JS-Verweise und kleine Assets werden im Browser sicher zu `srcdoc` zusammengesetzt.
- Bestehende CSP- und iframe-Sandbox-Regeln bleiben verbindlich.
- Externe Navigation darf die KOBY-Seite nicht ungefragt ersetzen.
- Fehlerhaftes HTML oder JavaScript darf den Chat und andere Tabs nicht beeintraechtigen.
- Eine Preview funktioniert vollstaendig ohne Terminal und ohne Pyodide.
- Version 1 installiert keine Pakete und fuehrt keinen Buildschritt aus.

### 7.5 Uebertragung in Files

- Es werden standardmaessig keine Dateien in eine Runtime geschrieben.
- `In Files speichern` erscheint nur, wenn die aktive Runtime ein beschreibbares Filesystem bietet.
- Die Aktion kopiert den aktuellen Stand einmalig in die aktive Runtime.
- Spaetere Preview-Aenderungen synchronisieren nicht automatisch.
- Eine erneute Uebertragung erfolgt bewusst ueber `Aenderungen in Files uebernehmen`.
- Ohne Files-Runtime wird ein HTML- beziehungsweise ZIP-Download angeboten.
- Das Loeschen des Chats darf bereits exportierte Runtime-Dateien nicht loeschen.

### 7.6 Runtime-Ergebnisse in eine Preview uebernehmen

- Wenn Pyodide-Code oder ein Terminal-Befehl eine CSV-, JSON-, HTML- oder andere Textdatei
  erzeugt, kann das Modell diese Datei gezielt in eine bestehende Web Preview uebernehmen.
- Die Uebernahme ist ein einmaliger Snapshot in die virtuellen Preview-Dateien, kein direkter
  oder dauerhafter Zugriff der Webseite auf das Runtime-Dateisystem.
- Das Modell gibt einen absoluten Quellpfad innerhalb der aktiven Runtime sowie einen relativen
  Zielpfad in der Preview an, zum Beispiel `/workspace/results.json` und `data/results.json`.
- Nur UTF-8-Textdateien bis 512.000 Bytes werden uebernommen. Binaere oder groessere Dateien
  bleiben in Files und erzeugen eine verstaendliche Fehlermeldung.
- Die Runtime-Grenzen bleiben verbindlich: Terminal-Dateien werden ueber den authentifizierten,
  chatgebundenen Terminal-Proxy gelesen; Pyodide-Dateien nur ueber dessen isoliertes Dateisystem.
- Die Preview-Version und ihr Inhalts-Hash werden vor und nach dem Runtime-Lesevorgang geprueft.
  Eine zwischenzeitliche Benutzer- oder KI-Aenderung fuehrt zu einem Konflikt statt zu
  stillschweigendem Ueberschreiben.
- Nach der Uebernahme ist die Preview unabhaengig von der Runtime. Spaetere Aenderungen der
  Quelldatei werden nur durch einen weiteren ausdruecklichen Tool-Aufruf uebernommen.

#### 7.6.1 Benutzerziel

Ein Benutzer kann KOBY Daten mit dem Code Interpreter oder im Terminal erzeugen beziehungsweise
transformieren lassen und das Ergebnis anschliessend in einer bestehenden Web Preview darstellen,
ohne Dateien manuell herunterzuladen, hochzuladen oder Quelltext zwischen Chat und Preview zu
kopieren.

Beispiel:

1. Der Benutzer stellt eine CSV-Datei im Chat oder in Files bereit.
2. KOBY bereinigt oder aggregiert die Daten mit Python beziehungsweise einem Terminal-Befehl.
3. Die Runtime erzeugt beispielsweise `results.json`.
4. KOBY uebernimmt `results.json` als `data/results.json` in die ausgewaehlte Web Preview.
5. Die geoeffnete Preview aktualisiert sich unter derselben `previewId`.

Der Benutzer sieht dabei keine Runtime-Pfade, Tool-Namen oder technischen Uebertragungsmodi, sofern
kein Fehler eine konkrete Handlung erfordert.

#### 7.6.2 Voraussetzungen und Verfuegbarkeit

Der Import ist nur verfuegbar, wenn alle Bedingungen erfuellt sind:

- Der Chat ist gespeichert und gehoert dem aktuellen Benutzer.
- Das ausgewaehlte Modell unterstuetzt Web Preview.
- Eine zulaessige Runtime kann fuer die Modellanfrage aufgeloest werden:
  - ein zentral verwaltetes Terminal ist ausgewaehlt, oder
  - kein Terminal ist ausgewaehlt und der aktive Code Interpreter verwendet Pyodide.
- Der Benutzer besitzt die erforderliche Berechtigung fuer die aktive Runtime.

Ohne aktive Runtime bleiben Web Previews voll funktionsfaehig; lediglich die Uebernahme einer
Runtime-Datei wird dem Modell nicht als Werkzeug angeboten.

Das Werkzeug darf bereits registriert sein, bevor eine Preview erstellt wurde. Ein konkreter
Import ist jedoch nur mit einer im aktuellen Chat vorhandenen `preview_id` gueltig.

#### 7.6.3 Runtime-Auswahl

- Eine explizit ausgewaehlte zentrale Terminal-Verbindung ist fuer diese Anfrage autoritativ.
- Wenn ein Terminal ausgewaehlt ist, darf der Import nicht still auf Pyodide ausweichen.
- Pyodide wird nur verwendet, wenn der Code Interpreter aktiv ist, dessen Engine `pyodide` ist und
  kein Terminal fuer die Anfrage ausgewaehlt wurde.
- Direkte, benutzerspezifische Terminal-Verbindungen sind kein Bestandteil dieses Produktpfads.
- Terminal und Pyodide werden niemals fuer denselben Import kombiniert.

Konfigurationsmatrix:

| Terminal ausgewaehlt | Code Interpreter aktiv | Engine | Importquelle |
|---|---|---|---|
| Ja | beliebig | beliebig | Terminal |
| Nein | Ja | `pyodide` | Pyodide |
| Nein | Ja | nicht `pyodide` | Nicht verfuegbar |
| Nein | Nein | beliebig | Nicht verfuegbar |

#### 7.6.4 Modellverhalten

Das Modell soll diesen Flow verwenden, wenn eine Runtime bereits eine geeignete Textdatei erzeugt
hat und eine bestehende Preview diese Daten benoetigt. Es soll insbesondere nicht:

- grosse CSV-/JSON-Inhalte in `web_preview_update` oder eine Chatnachricht kopieren,
- fuer ein Update derselben Darstellung eine neue Preview erstellen,
- einen Import ausfuehren, bevor die Runtime-Datei erfolgreich erzeugt wurde,
- eine Runtime-Datei importieren, wenn der Benutzer nur eine Analyse im Chat verlangt,
- aus einem Import automatisch eine dauerhafte Files-Synchronisierung ableiten.

Fehlt eine Preview, erstellt das Modell zuerst eine passende Web Preview. Existieren mehrere
Previews, verwendet es die aktive Preview oder waehlt die vom Benutzer eindeutig benannte Preview.
Bei Mehrdeutigkeit fragt es nach, statt eine beliebige Preview zu veraendern.

#### 7.6.5 Werkzeugvertrag

Der aktuelle Modellvertrag lautet:

```ts
web_preview_import_runtime_file({
  preview_id: string;
  source_path: string;
  expected_updated_at: number;
  expected_content_hash: string;
  target_path?: string;
})
```

Parameter:

| Parameter | Bedeutung | Regel |
|---|---|---|
| `preview_id` | Ziel-Preview im aktuellen Chat | Muss existieren und dem Chat gehoeren |
| `source_path` | Quelldatei in der aktiven Runtime | Absoluter, normalisierter Runtime-Pfad |
| `expected_updated_at` | Vom Modell gelesene Preview-Version | Muss der aktuellen Version entsprechen |
| `expected_content_hash` | Hash des vom Modell gelesenen Preview-Inhalts | Muss dem aktuellen Inhalt entsprechen |
| `target_path` | Virtueller Zielpfad in der Preview | Relativ, normalisiert; Standard `data/<dateiname>` |

Erfolgreiche Antworten verwenden denselben strukturierten Ergebnistyp wie andere Preview-Updates:

```json
{
  "type": "web_preview.document",
  "previewId": "preview-123",
  "title": "Auswertung",
  "entrypoint": "index.html",
  "files": {
    "index.html": { "content": "...", "mime": "text/html" },
    "data/results.json": { "content": "...", "mime": "application/json" }
  },
  "updatedAt": 1787692800000,
  "contentHash": "..."
}
```

Die Antwort referenziert immer dieselbe `previewId`; sie erzeugt weder eine zweite Chatkarte noch
einen neuen Workspace-Tab.

#### 7.6.6 Sicherheits- und Integritaetsregeln

- Es werden ausschliesslich UTF-8-dekodierbare Textdateien importiert.
- Das harte Limit betraegt 512.000 Bytes pro Import, gemessen auf den tatsaechlichen UTF-8-Bytes.
- Eine ungueltige `Content-Length` darf das Streaming-Limit nicht umgehen.
- Pyodide-Quellen muessen innerhalb von `/mnt/uploads` liegen. Normalisierte Pfade ausserhalb
  dieses Verzeichnisses werden abgelehnt.
- Terminal-Quellen werden ausschliesslich ueber den bestehenden authentifizierten Files-Proxy der
  ausgewaehlten zentralen Terminal-Verbindung gelesen.
- Die Terminal-Anfrage bleibt an den aktuellen Chat beziehungsweise die aktuelle Terminal-Sitzung
  gebunden.
- `source_path` wird niemals als Host-Dateisystempfad direkt vom Open-WebUI-Backend geoeffnet.
- `target_path` darf keine absolute Adresse, Traversierung, Nullbytes oder unbekannte externe URL
  enthalten.
- Die Preview-Version und der Inhalts-Hash werden vor dem Runtime-Lesen und unmittelbar vor der
  Mutation erneut geprueft.
- Schlaegt die zweite Pruefung fehl, werden zwischenzeitliche manuelle oder KI-Aenderungen nicht
  ueberschrieben.
- Der importierte Inhalt wird als Dateninhalt behandelt und darf keine Modell- oder
  Systemanweisungen ausloesen.

#### 7.6.7 Zustandsuebergang und Persistenz

Vor dem Import:

```text
Runtime-Datei vorhanden
Preview P in Version V vorhanden
```

Nach erfolgreichem Import:

```text
Preview P bleibt dasselbe Objekt
target_path enthaelt eine Kopie des Runtime-Inhalts
updatedAt und contentHash sind neu
Runtime-Datei bleibt unveraendert
```

Weitere Regeln:

- Die Preview speichert den importierten Inhalt im Chatdatensatz als Teil ihrer virtuellen Dateien.
- Das Schliessen des Tabs oder der Runtime entfernt den Snapshot nicht.
- Ein Chat-Reload erhaelt den Snapshot, oeffnet die Preview aber nicht ungefragt erneut.
- Das Loeschen des Chats entfernt nicht exportierte Preview-Snapshots.
- Das Aendern oder Loeschen der Quelldatei nach dem Import veraendert die Preview nicht.
- Eine erneute Uebernahme ersetzt nur den angegebenen `target_path` und erzeugt eine neue
  Preview-Version.
- Es gibt keine automatische Zwei-Wege-Synchronisierung zwischen Preview und Runtime-Files.

#### 7.6.8 Sichtbares UI-Verhalten

Waehren der Ausfuehrung erscheint im Chat dieselbe ruhige Aktivitaetszeile wie bei anderen
Web-Preview-Werkzeugen:

- laufend: `Importing preview data`
- erfolgreich: `Preview data imported`

Produktiv muessen diese Texte ueber die bestehende Lokalisierung in die Benutzersprache uebertragen
werden. Die Aktivitaet verwendet keine Sonderfarbe und keinen eigenen Kartentyp.

Bei Erfolg:

- aktualisiert sich eine bereits offene Preview live,
- bleibt der aktuelle Workspace-Fokus erhalten,
- entsteht keine weitere Chatkarte,
- wird eine bewusst geschlossene Preview nicht automatisch geoeffnet.

#### 7.6.9 Fehlerverhalten

| Fehlerfall | Verhalten |
|---|---|
| Keine aktive Runtime | Werkzeug wird nicht angeboten beziehungsweise klare Runtime-Meldung |
| Preview nicht vorhanden | Keine Mutation; Hinweis, die Preview auszuwaehlen oder neu zu erstellen |
| Veraltete Version oder Hash | Konflikt; Modell muss Preview erneut lesen und gezielt wiederholen |
| Quelldatei fehlt | Keine Mutation; Hinweis, den Runtime-Schritt erneut auszufuehren |
| Quelle ist ein Ordner | Keine Mutation; Datei erforderlich |
| Quelle ausserhalb des Runtime-Workspace | Zugriff abgelehnt |
| Binaere oder nicht UTF-8-kodierte Datei | Keine Mutation; nur Textdateien werden unterstuetzt |
| Datei groesser als 512.000 Bytes | Keine Mutation; Daten reduzieren oder auf mehrere Dateien aufteilen |
| Terminal nicht erreichbar | Keine Pyodide-Umschaltung; Terminal-Fehler mit Retry-Moeglichkeit |
| Zielpfad ungueltig | Keine Mutation; normalisierten relativen Pfad verwenden |
| Verbindung bricht waehrend des Lesens ab | Keine Teilmutation; erneuter Versuch ist sicher |

Fehler duerfen den Chat, andere Previews oder die Runtime-Datei nicht veraendern. Ein fehlgeschlagener
Import darf insbesondere keine leere oder teilweise geschriebene Zieldatei in der Preview anlegen.

#### 7.6.10 Interaktions- und Automationsgrenze

- Der Runtime-Import ist fuer normale interaktive, gespeicherte Chats vorgesehen.
- Das Lesen geschieht ueber einen aktiven Browser-/Chat-Ereigniskanal zur ausgewaehlten Runtime.
- Notes-interne Chats erhalten diesen Web-Preview-Pfad nicht.
- Ein Automation- oder Hintergrundslauf darf Web Previews erzeugen oder aktualisieren, aber keine
  browserlokale Pyodide-Datei importieren, wenn kein aktiver Ereigniskanal existiert.
- Ein Hintergrundslauf mit Terminal darf den Import nur verwenden, wenn seine Terminal-Sitzung und
  der sichere Files-Kanal explizit an diesen Lauf gebunden sind. Andernfalls muss der Import ohne
  Mutation fehlschlagen.
- Das Fehlen eines Ereigniskanals darf nie durch direkten Backend-Zugriff auf einen lokalen
  Dateipfad umgangen werden.

## 8. Modellwerkzeuge und Kontext

### 8.1 Canvas-Werkzeuge

- `canvas_create_document`
- `canvas_update_document`
- `canvas_select_document`
- `canvas_list_documents`
- `canvas_read_document`
- `canvas_replace_text`

### 8.2 Web-Preview-Werkzeuge

- `web_preview_create`
- `web_preview_update`
- `web_preview_select`
- `web_preview_list`
- `web_preview_read_file`
- `web_preview_replace_text`
- `web_preview_import_runtime_file`

### 8.3 Moegliche Weiterentwicklung: gemeinsamer Workspace-Toolvertrag

Die heute getrennten Canvas- und Web-Preview-Werkzeuge koennen spaeter durch einen gemeinsamen,
typisierten Modellvertrag ersetzt werden:

- `workspace_create`
- `workspace_update`
- `workspace_select`
- `workspace_list`
- `workspace_read`
- `workspace_replace`

Jeder Aufruf enthaelt einen diskriminierenden `kind`-Parameter, beispielsweise `canvas` oder
`web_preview`, sowie eine stabile `object_id`. Typabhaengige Nutzdaten bleiben explizit:

```json
{
  "kind": "canvas",
  "object_id": "canvas-123",
  "title": "Projektplan",
  "content": "# Projektplan"
}
```

```json
{
  "kind": "web_preview",
  "object_id": "preview-456",
  "title": "Dashboard",
  "entrypoint": "index.html",
  "files": {
    "index.html": {
      "content": "<main>...</main>",
      "mime": "text/html"
    }
  }
}
```

Ziel ist eine kleinere und leichter erweiterbare Tooloberflaeche fuer das Modell. Die
Vereinheitlichung gilt nur fuer den externen Modellvertrag:

- Canvas und Web Preview behalten getrennte interne Handler, Validierungen und Persistenzregeln.
- Canvas akzeptiert Markdown-Inhalt; Web Preview akzeptiert virtuelle Dateien und einen Einstiegspunkt.
- `workspace_read` und `workspace_replace` unterstuetzen bei Web Preview zusaetzlich einen Dateipfad.
- Content-Hash, Zeitstempel und Konfliktpruefung bleiben fuer Teilupdates verpflichtend.
- Notes-Promotion und Files-Export bleiben bewusste Benutzeraktionen und werden nicht zu
  allgemeinen Modellwerkzeugen.
- Externe Connector-Objekte wie Jira, Confluence und Bitbucket werden wegen eigener Rechte,
  Freigaben und Seiteneffekte nicht in diesen generischen Schreibvertrag aufgenommen.
- Eine Migration darf erst erfolgen, wenn die relevanten Modelle den typisierten Parametervertrag
  zuverlaessig einhalten und bestehende Chats beziehungsweise Tool-Historien kompatibel bleiben.

Bis zu dieser Migration gelten die unter 8.1 und 8.2 aufgefuehrten spezialisierten Werkzeuge als
verbindlicher implementierter Vertrag.

### 8.4 Registrierung

- Die Werkzeuge sind nur in normalen gespeicherten Chats verfuegbar.
- Sie sind pro Modellfaehigkeit opt-in und werden nicht allein durch die UI global erzwungen.
- Notes-interne Chats erhalten keine Canvas- oder Web-Preview-Werkzeuge.
- Automationen duerfen die Werkzeuge verwenden, wenn sie einen normalen gespeicherten Chat und
  ein passendes Modell verwenden. Es gibt keine automatische Notes-Promotion oder Files-Uebertragung.
- Fuer `web_preview_import_runtime_file` gelten zusaetzlich die Ereigniskanal- und
  Runtime-Bindungsregeln aus Abschnitt 7.6.10; ohne sicheren Runtime-Lesekanal erfolgt keine Mutation.
- Tool-Ergebnisse enthalten immer stabilen Typ, Objekt-ID und den aktuellen Zustand oder eine
  eindeutig bezeichnete Teilansicht.

### 8.5 Dynamischer Modellkontext

Der Assistent muss wissen, welche Objekte existieren und welches Objekt der Benutzer gerade sieht,
ohne den gesamten Modellkontext unkontrolliert zu fuellen.

- Der Client uebergibt nur einen validierten Fokus aus `canvas` oder `web_preview` mit einer
  maximal 256 Zeichen langen ID.
- Ein unbekannter oder ungueltiger Fokus darf keinen Objektinhalt offenlegen.
- Der Kontext enthaelt einen kompakten Objektkatalog und bevorzugt den sichtbaren Tab.
- Die Modellfenstergroesse wird aus gaengigen Modell-/Provider-Metadaten erkannt; ohne Angabe gilt
  ein konservativer Standard von 32.768 Tokens.
- Workspace-Kontext belegt hoechstens 20 Prozent des Modellfensters und hoechstens 25 Prozent des
  nach Nachrichten, Tools, Antwortreserve und Sicherheitsreserve verbleibenden Platzes.
- Die weichen Zielgroessen sind 16.000 Zeichen fuer Canvas und 32.000 fuer Web Preview.
- Ein fokussiertes grosses Objekt darf bis 64.000 Zeichen fuer Canvas beziehungsweise 128.000
  Zeichen fuer Web Preview erhalten, sofern das Modellfenster dies sicher zulaesst.
- Unter 1.200 sinnvoll verfuegbaren Zeichen wird kein Objektinhalt injiziert.
- Canvas und Web Preview teilen das Budget gewichtet; der fokussierte Typ erhaelt Vorrang.
- Titel, Pfade, MIME-Typen und Inhalte werden strukturiert und laengenbegrenzt serialisiert.
- Objektinhalt ist Dateninhalt, keine Systemanweisung. Delimiter im Benutzerdokument duerfen die
  Kontextstruktur nicht schliessen oder neue Anweisungen einschleusen.
- Bei gekuerztem Inhalt muss das Modell vor einer Aenderung gezielt `read` verwenden.
- Teilupdates verwenden einen vom Read-Ergebnis gelieferten Content-Hash und optional den
  Zeitstempel. `replace_text` darf nur einen eindeutig passenden, unveraenderten Bereich ersetzen.
- Mehrdeutige Treffer, veraltete Hashes, unbekannte IDs oder Pfade werden ohne Teilmutation abgelehnt.
- Vollstaendige Tool-Inhalte werden in der historischen Tool-Ausgabe kompaktiert; der kanonische
  Zustand bleibt am Chat und wird bei Bedarf erneut gelesen.

## 9. Files und Runtime-Auswahl

### 9.1 Grundregeln

- Es gibt pro Arbeitsflaeche genau einen Files-Navigator.
- Ein erneuter Klick auf `Files` fokussiert den Navigator und oeffnet keine zufaellige Datei.
- Ein Dateiklick oeffnet oder fokussiert genau die angeklickte Datei.
- Der Files-Navigator bleibt als stabiler Tab erhalten, waehrend Dateien eigene Objekttabs erhalten.
- Eine zweite Files-Aktion erzeugt keinen zweiten Files-Tab.
- Leere Ordner bieten nur funktionierende Aktionen wie Upload oder Terminal; nicht verfuegbare
  Aktionen werden verborgen oder deaktiviert und erklaert.

### 9.2 Exklusive Runtime-Prioritaet

Terminal und Pyodide werden in dieser Produktumgebung nicht gleichzeitig als Files-Runtime genutzt.

1. Ist ein zentral verwalteter Terminal-Service konfiguriert, ist er autoritativ.
2. Ist dieser Service nicht erreichbar, zeigt KOBY einen klaren Fehler und Retry; es erfolgt kein
   stiller Fallback auf Pyodide.
3. Nur wenn kein Terminal-Service konfiguriert ist und der Code Interpreter mit Pyodide aktiv ist,
   verwendet Files das Pyodide-Dateisystem.
4. Direkt vom Benutzer konfigurierte Terminal-Verbindungen sind nicht Teil dieser Arbeitsflaeche.
5. Der alte parallele `TerminalDock`-Pfad ist nicht Teil des Produkts.

### 9.3 Pyodide-only-Verhalten

- Wird der Pyodide-Code-Interpreter aktiviert und es gibt keinen Terminal-Service, oeffnet sich
  Files automatisch.
- Wenn Files die einzige hinzufuegbare Seite ist, wird kein Plus angezeigt.
- Das Oeffnen von Files darf den Code Interpreter nicht deaktivieren und die Seite nicht neu laden.
- Das Pyodide-Dateisystem bleibt fuer den aktuellen Chat-/Browserkontext verfuegbar, entsprechend
  der konfigurierten Persistenz von Open WebUI.

## 10. Dateitabs und Dokumentanzeige

### 10.1 Dateitabs

- Unterstuetzte Dateien oeffnen als eigener stabiler Tab mit Pfad-basierter Identitaet.
- Ein neuer Dateitab wird am Ende angehaengt.
- Erneutes Oeffnen derselben Datei fokussiert denselben Tab.
- Dateitabs sind mit allen anderen Tabs umsortierbar und einzeln schliessbar.
- Maximal vier dedizierte Dokumenttabs bleiben gleichzeitig offen. Beim fuenften darf der am
  laengsten inaktive, nicht fokussierte Dokumenttab mit einer klaren Mitteilung geschlossen werden.
- Der aktive Tab wird nie automatisch verdraengt.

### 10.2 Unterstuetzte Formate

Der dedizierte Read-only-Viewer unterstuetzt in Version 1:

- PDF (`.pdf`)
- Word Open XML (`.docx`)
- PowerPoint Open XML (`.pptx`)

Nicht dediziert unterstuetzt sind insbesondere `.doc`, `.ppt`, `.xlsx`, `.xls`, `.csv`, `.odt`,
`.ods` und `.odp`. Sie bleiben im Files-Pfad und erhalten keinen falschen Viewer.

### 10.3 Gemeinsame Viewer-Bedienung

- PDF, DOCX und PPTX verwenden eine gemeinsame Open-WebUI-konforme Steuerleiste.
- Vorherige/naechste Seite beziehungsweise Folie, aktuelle Position und Gesamtzahl sind kompakt.
- Zoom-Schaltflaechen arbeiten ueberall in 10-Prozent-Schritten.
- Trackpad- und Mausrad-Zoom ist moderat, fluessig und deutlich schneller als Ein-Prozent-Schritte.
- Bei Zoom oberhalb der Einpassung kann der Benutzer mit Trackpad, Mausrad und Ziehen sowohl auf
  der X- als auch auf der Y-Achse navigieren.
- Zoomen orientiert sich sinnvoll am Zeiger beziehungsweise sichtbaren Bereich.
- Teure Neu-Renderings erfolgen nur bei einer relevanten Qualitaetsstufe, nicht bei jedem Pixel.
- Beim Oeffnen ist der Inhalt korrekt eingepasst und sichtbar, insbesondere die erste PPTX-Folie.
- Schliessen und erneutes Oeffnen setzt Zoom und Verschiebung auf den Ausgangszustand zurueck.
- Der Viewer ist read-only; Office-Bearbeitung, Suche und Annotationen sind nicht Teil von Version 1.

### 10.4 Grenzen und Sicherheit

- PDF: maximal 64 MiB, 1.000 Seiten, 24 Millionen Canvas-Pixel und 4-facher Zoom.
- DOCX: maximal 48 MiB Archivgroesse.
- PPTX: maximal 64 MiB Archivgroesse.
- Office-Archive: maximal 1.500 Eintraege, 16 MiB pro Eintrag, 96 MiB expandiert,
  64 MiB Medien und ein maximales Kompressionsverhaeltnis von 120:1.
- PPTX-Medien werden mit begrenzter Parallelitaet geladen.
- Unsichere externe Beziehungen werden nicht automatisch geladen.
- Erlaubte Links sind Fragmente sowie `http`, `https`, `mailto` und `tel`.
- Ein Refresh-Fehler behaelt die letzte gueltige Vorschau sichtbar und bietet Retry.
- Ressourcen werden beim Tab-Schliessen freigegeben.

### 10.5 Feature Flag und Rollback

- `ENABLE_DOCUMENT_VIEWER` steuert den dedizierten Viewer und ist standardmaessig `false`.
- Bei deaktiviertem Flag bleibt die bestehende Files-Funktion unveraendert.
- Aktivierung erfolgt zuerst in Entwicklung/Pilot, danach erst nach den automatisierten und
  manuellen Gates dieser Spezifikation.
- Rollback besteht aus dem Deaktivieren des Flags; gespeicherte Dateien bleiben unberuehrt.

## 11. Terminal

- Terminal ist eine vollwertige Seite in der rechten Arbeitsflaeche.
- Es ist im leeren Launcher und im Plus-Menue nur bei konfiguriertem zentralem Service sichtbar.
- Mehrere Terminal-Sitzungen und Tabs sind erlaubt.
- Jede Sitzung besitzt eine stabile ID und einen unterscheidbaren Titel.
- Der erste Klick auf einen Terminal-Tab muss ihn unmittelbar fokussieren.
- Nicht erreichbare Services zeigen einen eingebetteten Fehler mit Retry statt leerem Inhalt.
- Ein Terminal darf nicht dauerhaft als untere Leiste sichtbar sein.
- Der Benutzer sieht keine Auswahl fuer direkte, persoenliche Terminal-Server.

## 12. Browser fuer lokale Apps

- Der Browser zeigt ausschliesslich lokale Apps beziehungsweise freigegebene Ports des
  zentralen Terminal-Service.
- Mehrere Browser-Tabs sind erlaubt.
- Ohne Terminal- und Port-Funktion wird Browser nicht angeboten.
- Die leere Ansicht erklaert knapp, dass zuerst eine lokale Web-App im Terminal laufen muss.
- Die Adressleiste verwendet Open-WebUI-Abstaende, Farben und Icons und keine kopierte
  Desktop-App-Gestaltung.
- Navigation, Reload, externes Oeffnen und Schliessen muessen funktional sein.
- Ein Browserfehler blockiert weder Terminal noch andere Arbeitsobjekte.

## 13. Connector-Oberflaechen

- Jira, Confluence, Bitbucket und spaetere Connectoren erscheinen nicht dauerhaft im Launcher.
- Ein Connector-Tab entsteht nur aus einem typisierten Ergebnis einer tatsaechlichen Modell-/MCP-Aktion.
- Die Objekt-ID des externen Systems ist Teil der stabilen Tabidentitaet.
- Ein spaeteres Ergebnis fuer dasselbe Objekt aktualisiert den vorhandenen Tab.
- Jeder Objekttyp erhaelt einen spezialisierten Renderer, zum Beispiel Issue, Seite oder Pull Request.
- Das blosse Oeffnen eines Tabs fuehrt keine externe Schreibaktion aus.
- Konsequente externe Aenderungen zeigen vor Ausfuehrung System, Objekt, betroffene Felder,
  neuen Inhalt und konkrete Aktion zur menschlichen Freigabe.
- Berechtigungen, Audit und Fehlerbehandlung bleiben unter Kontrolle von KOBY/Open WebUI; die
  technische MCP-UI-Quelle ist fuer Endbenutzer nicht sichtbar.

## 14. Persistenz und Loeschverhalten

| Objekt | Primaere Quelle | Nach Chat-Reload | Nach Tab-Schliessen | Nach Chat-Loeschung |
|---|---|---|---|---|
| Transienter Canvas | Chat | vorhanden, nicht ungefragt offen | vorhanden | geloescht |
| Canvas in Notes | Note plus Verknuepfung | vorhanden | vorhanden | Note bleibt |
| Web Preview | Chat | vorhanden, nicht ungefragt offen | vorhanden | geloescht |
| Exportierte Preview-Dateien | Runtime | runtimeabhaengig | vorhanden | bleiben |
| Files | Aktive Runtime | runtimeabhaengig | Runtime bleibt | runtimeabhaengig |
| Terminal | Terminal-Service | serviceabhaengig | Sitzung nach Servicevertrag | serviceabhaengig |
| Browser | Terminal-Port/App | serviceabhaengig | App bleibt | serviceabhaengig |
| Connector-Objekt | Externes System | erneut referenzierbar | extern bleibt | extern bleibt |

Tabs sind Ansichten, keine Eigentumsgrenzen. `Schliessen` bedeutet niemals automatisch `Loeschen`.

## 15. Berechtigungen und Konfiguration

- Canvas, Web Preview, Notes, Code Interpreter, Terminal und Dokumentanzeige werden jeweils
  durch ihre eigene Konfiguration und Berechtigung gesteuert.
- Eine sichtbare UI-Aktion muss dieselbe Berechtigungspruefung wie ihr Backend-Endpunkt verwenden.
- Ausgeblendete Funktionen duerfen nicht allein durch einen direkten API-Aufruf umgangen werden.
- Ein Modell erhaelt nur Werkzeuge fuer aktivierte Faehigkeiten.
- Ein normaler Benutzer sieht keine erweiterten Valves, System-Prompt- oder Providerparameter
  als Teil der Arbeitsflaeche.
- Produktive Authentifizierung, Datenverzeichnisse und Terminal-Secrets sind unabhaengig von der
  lokalen Entwicklungsinstanz zu betreiben.

## 16. Lade-, Fehler- und Aenderungszustaende

- Laufende Modellaktionen sind im Chat mit der bestehenden Tool-Call-Darstellung sichtbar.
- Ein offenes Objekt darf waehrend eines Updates eine dezente, nicht farbdominante Ladeanzeige zeigen.
- Der letzte gueltige Inhalt bleibt waehrend Update oder Fehler sichtbar.
- Erfolg wird einmal gezeigt; keine doppelte Badge-, Toast- und Chatmeldung.
- Konflikte durch parallele manuelle und KI-Aenderungen werden erkannt und nicht still ueberschrieben.
- Fehlende IDs, veraltete Hashes, nicht vorhandene Dateien und ungesunde Services liefern
  handlungsorientierte Meldungen.
- Keine Aktion darf die gesamte Seite neu laden, den Chat leeren oder aktivierte Funktionen
  unbeabsichtigt deaktivieren.

## 17. Visuelles System und Barrierefreiheit

- Farben, Typografie, Fokusrahmen, Hoverzustand und Dark Mode verwenden Open-WebUI-Tokens.
- Karten haben hoechstens 8 Pixel Radius und werden nur fuer echte Objekte verwendet.
- Symbolaktionen verwenden die bestehende Icon-Bibliothek und besitzen Tooltips sowie Aria-Labels.
- Kein einfarbig gruener Erfolgsbereich und keine technischen Statuschips.
- Titel werden gekuerzt, ohne Aktionen aus dem sichtbaren Bereich zu druecken.
- Tastaturfokus ist sichtbar; Tabwechsel, Schliessen und primaere Viewer-Aktionen sind per Tastatur erreichbar.
- Pointer-Ziele sind ausreichend gross und verschieben das Layout nicht beim Hover oder Klick.
- Die Oberflaeche darf in Hell- und Dunkelmodus keine ueberlappenden oder unlesbaren Elemente enthalten.

## 18. Nicht-Ziele von Version 1

- Kein Dashboard und keine Mehrfach-Pane-IDE.
- Kein Vollbild-Canvas.
- Kein dauerhaftes Terminal-Dock.
- Kein allgemeiner Internetbrowser.
- Keine parallele Nutzung von Terminal- und Pyodide-Files.
- Keine direkten Benutzer-Terminal-Verbindungen.
- Keine automatische Synchronisierung zwischen Web Preview und Files.
- Keine automatische Notes-Promotion.
- Keine Office-Bearbeitung oder Tabellenansicht im Dokumentviewer.
- Keine Paketinstallation oder Build-Pipeline innerhalb einer browsernativen Web Preview.
- Keine Connector-Tabs ohne vorheriges typisiertes Tool-Ergebnis.

## 19. Verbindliche Ende-zu-Ende-Abnahme

### 19.1 Gemeinsame Arbeitsflaeche

- Leere Arbeitsflaeche zeigt nur verfuegbare Einstiege und oben nur Schliessen.
- Tabs erscheinen ab dem ersten Objekt, lassen sich umsortieren, fokussieren und einzeln schliessen.
- Neue Objekte werden angehaengt; gleiche IDs werden fokussiert statt dupliziert.
- Der erste Klick wechselt zwischen Files, Terminal, Browser, Canvas und Dokumenten.
- Oeffnen und Wechseln verursachen keinen Chat-Sprung und keinen Seiten-Reload.

### 19.2 Canvas

- Zwei Canvas-Dokumente in einem realen Chat erstellen, unterschiedlich benennen und isoliert bearbeiten.
- Normale Folgeanweisungen aktualisieren jeweils die richtige stabile ID.
- Pro Dokument erscheint nur die erste kompakte Karte.
- Prosa vor und nach Tool Calls bleibt geordnet.
- Manuelle Titel-/Textaenderungen bleiben erhalten.
- Ein KI-Update kann einmal rueckgaengig gemacht werden; manuelle Folgeaenderung deaktiviert Undo.
- Schliessen, erneutes Oeffnen und Chat-Reload erhalten den Inhalt ohne ungefragtes Oeffnen.
- Nur der ausgewaehlte Canvas wird explizit und idempotent zu Notes uebertragen.
- Notes deaktiviert: keine Aktion und Backend-Ablehnung.
- Warnung bei 10, Erfolg bis 15, klare Ablehnung bei 16 Dokumenten.

### 19.3 Web Preview

- Mindestens zwei Previews mit mehreren HTML/CSS/JS-Dateien in einem Chat erstellen.
- Codeaenderungen speichern automatisch und aktualisieren die Vorschau unmittelbar.
- Updates derselben ID erzeugen keine Karten und keinen Fokuswechsel.
- Relative lokale Dateien und Assets funktionieren; fehlerhafte Inhalte bleiben isoliert.
- Reload, Tab-Schliessen und Chat-Reload erhalten den kanonischen Zustand.
- Runtimefrei, nur mit Pyodide und nur mit Terminal testen.
- Mit Pyodide eine JSON-/CSV-Datei erzeugen und per Modell-Tool als Snapshot in eine bestehende
  Preview uebernehmen; danach Runtime beenden und die Preview erneut laden.
- Mit Terminal eine Datei im chatgebundenen Workspace erzeugen und in dieselbe Preview-Klasse
  uebernehmen; falsche Pfade, binaere Dateien, mehr als 512.000 Bytes und einen parallelen
  Preview-Konflikt pruefen.
- Eine uebernommene Quelldatei nachtraeglich in der Runtime aendern: Die Preview bleibt unveraendert,
  bis das Modell die erneute Uebernahme ausfuehrt.
- Explizite Files-Uebertragung und erneutes Uebernehmen von Aenderungen testen.
- Chat-Loeschung entfernt die Preview, aber nicht exportierte Dateien.

#### 19.3.1 Abnahmematrix fuer Runtime-Import

| ID | Ausgangslage | Aktion | Erwartetes Ergebnis |
|---|---|---|---|
| WP-RI-01 | Gespeicherter Chat, Pyodide aktiv, Preview offen | Python erzeugt JSON; Modell importiert sie | Gleiche `previewId`, Datei unter Zielpfad, Live-Update, keine neue Karte |
| WP-RI-02 | Gespeicherter Chat, Terminal ausgewaehlt, Preview offen | Terminal erzeugt CSV; Modell importiert sie | Terminal wird verwendet; Preview aktualisiert sich ohne Fokuswechsel |
| WP-RI-03 | Terminal und Pyodide prinzipiell verfuegbar | Modell importiert eine Runtime-Datei | Ausschliesslich das ausgewaehlte Terminal wird verwendet |
| WP-RI-04 | Keine Runtime aktiv | Benutzer verlangt Runtime-Import | Kein Werkzeugaufruf beziehungsweise klare Meldung; Preview bleibt unveraendert |
| WP-RI-05 | Runtime aktiv, noch keine Preview vorhanden | Benutzer verlangt eine Darstellung | Modell erstellt zuerst eine Preview und importiert danach in deren stabile ID |
| WP-RI-06 | Zwei Previews vorhanden, eine sichtbar fokussiert | Benutzer sagt `verwende diese Vorschau` | Nur die fokussierte Preview wird aktualisiert |
| WP-RI-07 | Zwei Previews vorhanden, Ziel mehrdeutig | Benutzer verlangt ein unspezifisches Update | Rueckfrage; keine Preview wird veraendert |
| WP-RI-08 | Quelldatei fehlt oder ist ein Ordner | Modell versucht Import | Fehleraktivitaet, keine Zieldatei, keine neue Preview-Version |
| WP-RI-09 | Quelle liegt ausserhalb des Runtime-Workspace | Modell versucht Import | Zugriff abgelehnt; keine Dateiinhalte verlassen die Runtime-Grenze |
| WP-RI-10 | Quelle ist binaer oder ungueltiges UTF-8 | Modell versucht Import | Verstaendlicher Textdatei-Fehler; keine Mutation |
| WP-RI-11 | Quelle ist genau 512.000 Bytes | Modell importiert | Import erfolgreich, sofern UTF-8 und sonst gueltig |
| WP-RI-12 | Quelle ist 512.001 Bytes | Modell importiert | Groessenfehler vor Mutation |
| WP-RI-13 | Preview wurde nach Modell-Lesen manuell geaendert | Alter Hash/Stand wird importiert | Konflikt; manuelle Aenderung bleibt vollstaendig erhalten |
| WP-RI-14 | Preview aendert sich waehrend Runtime-Lesen | Zweite Vorbedingungspruefung schlaegt fehl | Konflikt; gelesene Datei wird nicht geschrieben |
| WP-RI-15 | Import erfolgreich, Runtime wird beendet | Chat wird neu geladen und Preview geoeffnet | Snapshot ist weiterhin vollstaendig vorhanden |
| WP-RI-16 | Import erfolgreich, Quelldatei wird danach geaendert | Preview wird erneut betrachtet | Preview bleibt unveraendert bis zu erneutem Import |
| WP-RI-17 | Preview-Tab wurde bewusst geschlossen | Modell aktualisiert dieselbe Preview per Import | Zustand wird aktualisiert, Tab oeffnet sich nicht automatisch |
| WP-RI-18 | Terminal ist ausgewaehlt, aber nicht erreichbar | Import wird angefordert | Terminal-Fehler; kein stiller Pyodide-Fallback |
| WP-RI-19 | Browser-Ereigniskanal bricht beim Lesen ab | Import laeuft | Keine Teilmutation; sicherer erneuter Versuch moeglich |
| WP-RI-20 | Import in Notes-internem Chat | Modellwerkzeuge werden aufgeloest | Runtime-Importwerkzeug ist nicht verfuegbar |

Die Abnahme gilt nur dann als bestanden, wenn neben dem gespeicherten Backendzustand auch die
sichtbare Chataktivitaet, die offene Workspace-Preview, der ausbleibende Fokuswechsel und das
Verhalten nach einem echten Chat-Reload geprueft wurden.

### 19.4 Runtimes, Files und lokale Apps

- Terminal konfiguriert: Files und Browser verwenden Terminal, auch bei nicht erreichbarem Service
  ohne Pyodide-Fallback.
- Kein Terminal plus aktives Pyodide: Files oeffnet automatisch, Plus ist verborgen und der Code
  Interpreter bleibt aktiv.
- Files wiederholt anklicken oeffnet keine zufaellige Datei.
- Mehrere Terminals und Browser, aber genau ein Files-Navigator erstellen.
- Eine lokale Web-App im Terminal starten, Port erkennen und im Browser oeffnen.
- Servicefehler, Retry und Wiederverbindung ohne Seiten-Reload testen.

### 19.5 Dokumentanzeige

- PDF, DOCX und PPTX aus Terminal-Files und Pyodide-Files oeffnen.
- Erste Seite/Folie ist sofort sichtbar und korrekt eingepasst.
- 10-Prozent-Buttons, moderates Trackpad-Zoom sowie X-/Y-Bewegung fuer alle Formate pruefen.
- Schliessen/erneutes Oeffnen setzt Zoom und Position zurueck.
- Navigation, letzte Seite, Einzelseite und grosse Dokumente testen.
- Unsichere Links, externe Beziehungen, Archivbomben, Groessen- und Seitenlimits pruefen.
- Viewer-Flag aus: Dateien bleiben im bisherigen Files-Pfad.
- Lazy Loading, Speicherfreigabe und letzte gueltige Vorschau bei Refresh-Fehler pruefen.

### 19.6 Modellkontext und Sicherheit

- Kleine und grosse Modellfenster mit Canvas und Web Preview gleichzeitig testen.
- Sichtbarer Fokus erhaelt Vorrang; geschlossener oder ungueltiger Fokus legt keinen Inhalt offen.
- Delimiter- und Prompt-Injektionsversuche in Titel, Markdown, Pfad, MIME und HTML bleiben Daten.
- Gekuerzte Inhalte erzwingen Read vor Replace.
- Eindeutiger Replace funktioniert; mehrdeutiger Text und veralteter Hash mutieren nichts.
- Gespeicherte Tool-Historie enthaelt keine unnoetigen Vollkopien grosser Dokumente.

## 20. Freigabekriterien

Eine Version ist erst freigabefaehig, wenn:

1. fokussierte Frontend- und Backend-Tests bestanden sind,
2. die realen Browser-Journeys dieser Spezifikation bestanden sind,
3. Hell-/Dunkelmodus und schmale/weite Ansichten visuell geprueft sind,
4. Berechtigungs- und Feature-Flag-Kombinationen getestet sind,
5. Viewer-Ressourcen- und Sicherheitsgrenzen bestanden sind,
6. keine uncommitteten produktrelevanten Aenderungen verbleiben,
7. Produktionsdaten, produktive Container und Secrets von der Testinstanz unberuehrt bleiben.
