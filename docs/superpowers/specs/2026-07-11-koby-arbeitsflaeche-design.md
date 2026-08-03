# KOBY Arbeitsfläche Design Spec

Datum: 2026-07-11
Status: Entwurf
Zielprodukt: KOBY Web auf Basis von Open WebUI

## Kurzfassung

KOBY soll sich für Endnutzer ähnlich vertraut anfühlen wie moderne Chat-Produkte mit Canvas/Artifacts, aber stärker auf behördliche Arbeit, Nachvollziehbarkeit und Freigabe ausgerichtet sein.

Die zentrale Produktidee heißt nach außen:

**KOBY Arbeitsfläche**

Die Arbeitsfläche ist der rechte Arbeitsbereich neben dem Chat. Dort legt KOBY konkrete Arbeitsergebnisse ab: Notizen, Entwürfe, Dateien, Analysen, Jira-Aufgaben, Confluence-Seiten, Pull-Request-Entwürfe, Diagramme, Tabellen, HTML-Vorschauen oder Berichte.

Endnutzer sollen keine technischen Modi sehen. Begriffe wie Artifact Canvas, Pyodide, MCP Apps, Connector Renderer oder Render Layer sind interne Architektur. In der Oberfläche geht es nur um:

- Gespräch
- Arbeitsfläche
- Arbeitsergebnisse
- vorgeschlagene Änderungen
- Freigabe

## Produktziel

KOBY soll nicht nur Antworten im Chat erzeugen, sondern sichtbare Arbeitsergebnisse erstellen, bearbeiten und zur Freigabe vorbereiten.

Der Nutzer soll jederzeit verstehen:

1. Woran arbeitet KOBY gerade?
2. Was hat KOBY erstellt oder geändert?
3. Was ist nur ein Vorschlag?
4. Was würde extern geschrieben oder veröffentlicht?
5. Was muss ich freigeben?

## Leitprinzipien

### Ein Arbeitsbereich statt mehrere Modi

Die Benutzeroberfläche darf nicht zwischen "Canvas", "Artifact", "Pyodide", "MCP App" oder "Connector" unterscheiden. All das wird intern gebraucht, soll aber für Nutzer unsichtbar sein.

Der Nutzer sieht nur eine **Arbeitsfläche** mit **Arbeitsergebnissen**.

### Chat steuert, Arbeitsfläche bearbeitet

Der Chat bleibt der Verlauf, die Erklärung und die Steuerung. Die Arbeitsfläche ist der Ort, an dem konkrete Ergebnisse geprüft, geändert und freigegeben werden.

Beispiel:

- Nutzer: "Bereite eine Projektaktualisierung vor."
- KOBY im Chat: "Ich habe eine Notiz, einen Jira-Vorschlag und einen Confluence-Entwurf vorbereitet."
- Arbeitsfläche: zeigt diese Arbeitsergebnisse als auswählbare Objekte.

### KOBY schlägt vor, der Mensch entscheidet

KOBY darf Änderungen vorbereiten und sichtbar machen. Externe Aktionen wie Jira aktualisieren, Confluence veröffentlichen oder Pull Requests ändern dürfen erst nach expliziter Freigabe ausgeführt werden.

### KI-Edits sind begrenzt und sichtbar

Wenn die KI an einem Dokument, einer Notiz oder einem Canvas arbeitet, darf sie nicht unbemerkt alles überschreiben. Der Nutzer kann festlegen:

- KOBY darf nur markierte Zeilen ändern.
- KOBY darf nur ausgewählte Abschnitte ändern.
- KOBY darf nur bestimmte Felder ändern.
- KOBY darf nur Vorschläge machen, aber nichts direkt übernehmen.

Änderungen werden als Diff oder hervorgehobener Vorschlag angezeigt.

### Technische Fähigkeiten verschwinden hinter einer einfachen Metapher

Intern kann ein Arbeitsergebnis aus verschiedenen Quellen kommen:

- Modellantwort
- Pyodide-Ausführung
- Datei-Upload
- MCP/App-Connector
- Tool-Aufruf
- bestehendes Open-WebUI Artifact

Nach außen ist es immer ein Arbeitsergebnis in der KOBY Arbeitsfläche.

## Zielbild der Oberfläche

### Grundlayout

KOBY Web zeigt im Arbeitsmodus zwei Bereiche:

1. Links: Chat mit KOBY
2. Rechts: KOBY Arbeitsfläche

Die Arbeitsfläche kann ein- und ausgeblendet werden. Wenn KOBY ein Arbeitsergebnis erstellt, öffnet sich die Arbeitsfläche automatisch oder zeigt einen Hinweis im Chat.

### Arbeitsfläche

Die Arbeitsfläche enthält:

- Liste der Arbeitsergebnisse dieser Sitzung
- aktuelles Arbeitsergebnis
- Vorschläge und Diffs
- Quellen und Kontext
- Freigabeaktionen
- Versionen oder Verlauf

Beispielhafte Arbeitsergebnisse:

- "Projektupdate"
- "Jira KOBY-142"
- "Confluence-Entwurf"
- "Auswertung Budgetdaten"
- "Diagramm"
- "HTML-Vorschau"
- "Pull-Request-Beschreibung"

### Verhalten im Chat

KOBY soll Arbeitsergebnisse sprachlich einfach ankündigen:

> Ich habe drei Arbeitsergebnisse vorbereitet: eine Notiz, einen Jira-Vorschlag und einen Confluence-Entwurf. Ich habe noch nichts extern geändert.

Der Chat soll nicht sagen:

> Ich habe ein Pyodide Artifact, ein MCP App iframe und einen Connector Renderer erzeugt.

## Arbeitsergebnis-Typen

### Notiz

Eine lokale Arbeitsnotiz für Zusammenfassungen, Meeting Notes, Projektstände, Übergaben oder Brainstorming.

Fähigkeiten:

- frei editierbar
- KI kann markierte Abschnitte überarbeiten
- Diffs sichtbar
- kann später in andere Arbeitsergebnisse überführt werden

Beispiel:

Nutzer markiert den Abschnitt "Risiken" und sagt:

> Formuliere nur diesen Abschnitt klarer.

KOBY darf nur diesen Abschnitt ändern.

### Canvas

Ein kontrollierter Editor für längere Texte, Code, strukturierte Inhalte oder Review-Dokumente.

Fähigkeiten:

- Zeilen- oder Abschnittsfreigabe
- KI-Patches statt Vollüberschreibung
- Versionen
- Annahme oder Ablehnung einzelner Änderungen

### Datei

Ein Arbeitsergebnis kann eine Datei sein: Markdown, CSV, HTML, PNG, SVG, Notebook, PDF-Vorbereitung, Bericht oder Tabelle.

Fähigkeiten:

- Vorschau in der Arbeitsfläche
- Quellen und Erzeugungsweg sichtbar
- Download oder Weiterverwendung
- "als Arbeitsergebnis übernehmen"

### Analyse

Ein Ergebnis aus Daten- oder Codeausführung.

Fähigkeiten:

- erzeugte Dateien anzeigen
- Charts und HTML rendern
- Logs anzeigen
- Ergebnis in Notiz, Bericht oder Präsentation überführen

### Jira-Aufgabe

Ein Jira-Arbeitsergebnis zeigt eine Aufgabe oder einen vorgeschlagenen Patch.

Fähigkeiten:

- aktueller Jira-Snapshot
- vorgeschlagene Feldänderungen
- Statusübergang als Vorschlag
- Kommentarentwurf
- explizite Freigabe für externes Schreiben

Keine externe Jira-Änderung ohne Freigabe.

### Confluence-Seite

Ein Confluence-Arbeitsergebnis zeigt eine Seite oder einen Seitenentwurf.

Fähigkeiten:

- Seitenvorschau
- Abschnitts-Diff
- Quellen und verlinkte Jira-Aufgaben
- Publizieren erst nach Freigabe

### Bitbucket Pull Request

Ein Bitbucket-Arbeitsergebnis zeigt PR-bezogene Vorschläge.

Fähigkeiten:

- PR-Beschreibung überarbeiten
- Review-Kommentare entwerfen
- Jira-Verlinkungen ergänzen
- Changelog oder Release Notes ableiten
- externe Aktualisierung erst nach Freigabe

## Pyodide als interne Fähigkeit

Pyodide soll nicht als eigener Endnutzer-Modus erscheinen. Es ist eine interne lokale Ausführungsumgebung innerhalb von KOBY Web.

Aus Nutzersicht:

> KOBY hat eine Auswertung erstellt.

Intern kann KOBY dafür Pyodide verwenden, um Python im Browser auszuführen und Dateien im virtuellen Dateisystem zu erzeugen.

Pyodide ermöglicht insbesondere:

- HTML-Dateien erzeugen und rendern
- SVGs und PNGs erzeugen
- CSV/JSON/Markdown schreiben
- Charts oder kleine Reports generieren
- Notebook-ähnliche Outputs anzeigen
- lokale Dateien temporär oder persistent in der Sitzung halten

Produktregel:

Pyodide-Ergebnisse sollen als normale Arbeitsergebnisse in der Arbeitsfläche erscheinen. Nutzer sollen nicht zwischen "Pyodide-Datei" und "normalem Arbeitsergebnis" unterscheiden müssen.

Beispiel:

1. Nutzer: "Analysiere diese CSV und erstelle ein Diagramm."
2. KOBY führt lokal Code aus.
3. Arbeitsfläche zeigt "Budgetanalyse" mit Diagramm, erzeugten Dateien und kurzer Zusammenfassung.
4. Nutzer kann das Diagramm übernehmen, herunterladen oder in eine Notiz einfügen.

## MCP Apps und Connector-UIs als interne Fähigkeit

MCP Apps sind ein relevanter Standard für eingebettete UIs von MCP-Servern. OpenAI dokumentiert, dass ChatGPT MCP Apps als iframe-basierte UIs mit einer standardisierten `ui/*` JSON-RPC Bridge über `postMessage` unterstützt. Neue Apps sollen nach Möglichkeit den MCP-Apps-Standard verwenden und ChatGPT-spezifische Erweiterungen nur optional ergänzen.

Für KOBY bedeutet das:

- Connectoren wie Jira, Confluence oder Bitbucket können eigene UI-Ressourcen liefern.
- KOBY kann diese UIs in der Arbeitsfläche einbetten, sofern der Host MCP Apps unterstützt.
- Die UI darf aber nicht als fremder Modus wirken.
- KOBY muss weiterhin Freigabe, Audit, Rechte und Arbeitsflächen-Integration kontrollieren.

Produktregel:

MCP Apps sind ein technischer Einbettungsmechanismus, nicht die Produktmetapher. Nutzer sehen "Jira-Aufgabe" oder "Confluence-Entwurf", nicht "MCP App".

## Freigabe- und Sicherheitsmodell

### Lokale Änderungen

Lokale Notizen, lokale Canvas-Inhalte und lokale Pyodide-Ergebnisse dürfen in der Sitzung entstehen, solange sie klar als Entwurf erkennbar sind.

### Externe Änderungen

Alles, was ein externes System ändert, braucht explizite Freigabe:

- Jira-Feld ändern
- Jira-Status verschieben
- Jira-Kommentar posten
- Confluence-Seite veröffentlichen
- Bitbucket PR-Beschreibung aktualisieren
- Review-Kommentar posten
- Datei in ein externes System hochladen

### Freigabe muss konkret sein

Eine Freigabe muss zeigen:

- welches System betroffen ist
- welches Objekt betroffen ist
- welche Felder oder Abschnitte geändert werden
- welcher Inhalt geschrieben wird
- welche Aktion ausgeführt wird

Beispiel:

> Jira KOBY-142 aktualisieren: Status auf "Ready for refinement" setzen, zwei Labels ergänzen und Kommentar posten.

### Audit

Jede Freigabe soll nachvollziehbar bleiben:

- Nutzer
- Zeitpunkt
- ursprünglicher Vorschlag
- angenommener Patch
- externer Tool-/Connector-Aufruf
- Ergebnis oder Fehler

## Interne Architektur

### Einheitliches Arbeitsergebnis-Modell

KOBY braucht intern ein persistierbares Objekt, z. B. `work_artifact` oder `workspace_item`.

Kernfelder:

- `id`
- `chat_id`
- `message_id`
- `type`
- `title`
- `status`
- `origin`
- `content`
- `patches`
- `versions`
- `sources`
- `permissions`
- `approval_state`
- `external_ref`
- `created_at`
- `updated_at`

### Typen

Beispielhafte interne Typen:

- `note`
- `canvas.text`
- `canvas.code`
- `file.markdown`
- `file.html`
- `file.image`
- `analysis.report`
- `jira.issue`
- `confluence.page`
- `bitbucket.pull_request`
- `mcp.app`

Diese Typen dürfen in der UI nicht als technische Modi dominieren. Sie dienen der Auswahl des passenden Renderers und der passenden Aktionen.

### Renderer Registry

Die Arbeitsfläche braucht eine Renderer Registry:

- `note` -> Note Editor
- `canvas.text` -> kontrollierter Texteditor
- `file.html` -> HTML Preview
- `file.image` -> Bildvorschau
- `analysis.report` -> Report/Chart Viewer
- `jira.issue` -> Jira Review UI
- `confluence.page` -> Confluence Preview/Diff UI
- `bitbucket.pull_request` -> PR Review UI
- `mcp.app` -> sandboxed iframe host

### Patch-Protokoll

KOBY sollte Änderungen nicht nur als vollständigen neuen Inhalt liefern, sondern als Patch.

Patch-Arten:

- Zeilenbereich ersetzen
- Abschnitt ersetzen
- Feld ändern
- Kommentar hinzufügen
- Datei erzeugen
- Datei aktualisieren
- externen Write vorbereiten

Das erlaubt gezielte Freigabe und verhindert unkontrollierte Vollüberschreibungen.

### Approval Actions

Freigabeaktionen sind eigenständige Aktionen, nicht normale Chatantworten.

Beispiele:

- `accept_canvas_patch`
- `reject_canvas_patch`
- `apply_jira_patch`
- `publish_confluence_update`
- `update_bitbucket_pr`
- `promote_pyodide_output_to_artifact`

## UX-Flows

### Flow 1: Note mit kontrollierter KI-Bearbeitung

1. Nutzer bittet KOBY um eine Projektzusammenfassung.
2. KOBY erzeugt eine Notiz in der Arbeitsfläche.
3. Nutzer markiert den Abschnitt "Risiken".
4. Nutzer sagt: "Formuliere nur diesen Abschnitt klarer."
5. KOBY schlägt nur für diesen Abschnitt Änderungen vor.
6. Nutzer nimmt sie an oder lehnt sie ab.

### Flow 2: Pyodide-Auswertung als Arbeitsergebnis

1. Nutzer lädt eine CSV hoch.
2. Nutzer bittet KOBY um eine Analyse mit Diagramm.
3. KOBY führt lokal Pyodide-Code aus.
4. Pyodide erzeugt CSV-Zwischenresultate, HTML und PNG.
5. Arbeitsfläche zeigt "Analyse" mit Diagramm, Preview und Dateien.
6. Nutzer übernimmt das Diagramm in eine Notiz oder lädt es herunter.

### Flow 3: Jira-Vorschlag mit Freigabe

1. Nutzer bittet KOBY, eine Jira-Aufgabe zu prüfen.
2. KOBY liest die Aufgabe.
3. Arbeitsfläche zeigt Snapshot, vorgeschlagene Feldänderungen und Kommentarentwurf.
4. Nutzer bearbeitet oder genehmigt den Vorschlag.
5. KOBY führt erst dann den externen Jira-Write aus.

### Flow 4: Confluence-Entwurf

1. Nutzer bittet KOBY um Release Notes aus Jira und Bitbucket.
2. KOBY erzeugt einen Confluence-Entwurf.
3. Arbeitsfläche zeigt Seite, Quellen, Abschnitts-Diff und Publish-Status.
4. Nutzer gibt die Veröffentlichung frei.
5. KOBY publiziert über den Connector.

## MVP-Schnitt

Der erste sinnvolle MVP sollte nicht alle Typen gleichzeitig vollständig bauen.

Empfohlener MVP:

1. Einheitliches Arbeitsergebnis-Modell
2. Arbeitsfläche rechts neben Chat
3. Note/Canvas Renderer
4. Patch- und Diff-Anzeige für Textabschnitte
5. Pyodide-Dateien als Arbeitsergebnisse übernehmen
6. Ein Connector-Beispiel, vorzugsweise Jira Issue Review
7. Freigabeaktion für externen Write

Nicht im MVP:

- vollständige MCP-App-Kompatibilität für alle Connectoren
- komplexe kollaborative Echtzeitbearbeitung
- vollständiger Office-Editor
- beliebige UI-Plugins ohne Review
- autonome externe Änderungen ohne explizite Freigabe

## Erfolgskriterien

Ein Nutzer versteht ohne technische Erklärung:

- KOBY hat ein Arbeitsergebnis erstellt.
- Das Arbeitsergebnis ist in der Arbeitsfläche sichtbar.
- KOBY hat Änderungen vorgeschlagen.
- Der Nutzer kann Änderungen annehmen, ablehnen oder bearbeiten.
- Externe Systeme werden erst nach Freigabe geändert.

Ein technischer Reviewer erkennt:

- Pyodide, MCP Apps, Open-WebUI Artifacts und Connectoren sind sauber integrierbar.
- Endnutzer sehen keine technischen Modi.
- Das System hat klare Grenzen für KI-Edits.
- Externe Writes sind auditierbar und freigabepflichtig.

## Offene Entscheidungen

1. Soll die Nutzerbezeichnung final "KOBY Arbeitsfläche", "Arbeitsbereich" oder "Arbeitsmappe" heißen?
2. Soll die Arbeitsfläche immer rechts erscheinen oder auch als Vollbildmodus?
3. Soll der erste Connector Jira oder Confluence sein?
4. Wie lange sollen lokale Pyodide-Arbeitsergebnisse gespeichert bleiben?
5. Welche Freigaben gehören in KOBY Web und welche in KOBY Manager?

## Quellen und aktuelle Standards

- OpenAI Apps SDK: https://developers.openai.com/apps-sdk/
- OpenAI MCP Apps compatibility in ChatGPT: https://developers.openai.com/apps-sdk/mcp-apps-in-chatgpt
- OpenAI Apps SDK Reference: https://developers.openai.com/apps-sdk/reference
- Model Context Protocol: https://modelcontextprotocol.io/docs/getting-started/intro

Stand zum Schreiben dieser Spec: OpenAI dokumentiert MCP Apps als eingebettete iframe-UIs mit `ui/*` JSON-RPC über `postMessage`, Tool Calls über die MCP-Tool-Oberfläche und optionalen ChatGPT-Erweiterungen über `window.openai`. Für KOBY ist diese Fähigkeit ein möglicher Connector-Mechanismus, aber nicht die sichtbare Produktmetapher.
