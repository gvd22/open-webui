# Fork-Wartbarkeit und Codebilanz - 2026-09-24

## Stand und Vergleich

- Branch: `codex/koby-canvas-workspace`.
- Gepruefter Produktstand: `87426730f2a936a9c5aba0c62798d32b020b25a7` (`fix(workspace): harden viewers and file recovery`). Die vorher offenen 21 Dateien sind damit committet; danach war der Arbeitsbaum sauber.
- Basis: offizielles Open WebUI `v0.11.3`, Commit `2a960a59fe1dbbd35282f0556b3666d81102e781`. Der lokale `upstream/main` und der gemeinsame Vorfahr stimmen mit dieser Basis ueberein.
- Kein Remote-Fetch: Dies ist der Vergleich mit dem integrierten Upstream, keine Aussage ueber die neueste inzwischen verfuegbare Version.
- Umfang: kompletter kumulierter Fork-Diff gegen diese Basis, nicht nur der letzte Commit. Dateiinventar und Aenderungsschwerpunkte wurden mit Ponytail-Audit und einer getrennten Engineering-Pruefung untersucht. Keine vollstaendige Zeile-fuer-Zeile-Sicherheitszertifizierung.
- In diesem Audit wurden keine Produktivcode-Refactorings vorgenommen. Bericht und Dateibilanz sind separate Dokumentation.

Begleitende [Dateibilanz als CSV](workspace-maintainability-2026-09-24.csv): alle 214 Dateien mit Kategorie, Herkunft und Zeilenzahlen.

## Kurzfazit

Die wesentlichen Workspace-Komponenten sind bereits ausgelagert. 68,3 % der hinzugefuegten Produktivquelltext-Zeilen liegen in neuen Dateien. Ein weiteres grosses Framework oder eine Kopie der Upstream-Komponenten wuerde die Wartung nicht vereinfachen.

Der groesste verbleibende Hebel ist die Konfliktflaeche in zentralen Upstream-Dateien: insbesondere `builtin.py`, danach die Workspace-Anteile in `middleware.py` und `+layout.svelte`. Eine gezielte Auslagerung koennte grob 1.000 Zeilen aus diesen Integrationsdateien verschieben. Sie spart nicht entsprechend viel Gesamtcode und beseitigt nicht alle Beruehrungen dieser Dateien.

Echte Loeschkandidaten sind deutlich kleiner: etwa 28 unmittelbar nachvollziehbare Quelltextzeilen sowie geschaetzt 40-50 weitere durch Ersatz eines eigenen XML-Scanners. Letzteres muss seine Sicherheitsfaelle unveraendert bestehen. Keine neue oder entfernbar belegte Produktionsabhaengigkeit ist dafuer erforderlich.

## Prioritaet: Kleinere Upstream-Patches

| Stelle | Befund | Kleinste sinnvolle Massnahme | Erwarteter Effekt |
| --- | --- | --- | --- |
| `backend/open_webui/tools/builtin.py:253` | +968 Zeilen gegen Upstream, ueberwiegend Canvas-/Web-Preview-Tools und Hilfsfunktionen. | Workspace-Handler in ein eigenes Tool-Modul verschieben und in `utils/tools.py` explizit importieren; kein neues Registry-/Plugin-Framework. | Etwa 900-950 Zeilen weniger in dieser Upstream-Datei, kaum weniger Gesamtcode. |
| `backend/open_webui/utils/middleware.py:156` und `:2408` | Workspace-Allowlist, Herkunftspruefung, Dateireferenzvalidierung und Runtime-Zugriffspolitik stehen in zentraler Middleware. | Zusammengehoerige Workspace-Funktionen in das vorhandene Workspace-Modul auslagern; wenige explizite Aufrufe im Ablauf behalten. | Etwa 60-90 Zeilen kleinere Integrationsflaeche; Sicherheitspruefungen bleiben bestehen. |
| `src/routes/+layout.svelte:302` und `:637` | Workspace-Runtime-Lesen und Display-/Read-RPC-Behandlung sind in die globale App-Lifecycle-Datei eingebettet. | Einen begrenzten Workspace-RPC-Helfer mit uebergebenem Worker-Zugriff verwenden. Python-Ausfuehrung und den globalen Eventhandler nicht komplett kopieren. | Etwa 30-50 Zeilen aus der globalen Datei verschiebbar, keine erhebliche Nettoersparnis. |

Bei der Tool-Auslagerung ist `_emit_note_updated` (`builtin.py:216`) eine konkrete Abhaengigkeit: Canvas und normale Notes benutzen denselben Emitter. Den kleinen gemeinsamen Emitter sauber teilen, statt aus dem neuen Tool-Modul zurueck nach `builtin.py` zu importieren und einen Importzyklus zu erzeugen. Die Note-zu-Canvas-Synchronisierung bei `builtin.py:2441` bleibt ein schmaler Hook.

Bei der Middleware muessen initiale Kontextanreicherung (`:3175`) und das erneute Lesen nach einer freigegebenen Tool-Ausfuehrung (`:3533`) beide erhalten bleiben. Die gemeinsame Lade-/Prompt-Erzeugung kann eine kleine Funktion werden; den zweiten Aufruf zu entfernen waere eine Verhaltensregression.

Bei `+layout.svelte` muss sessiongebundenes RPC weiterhin vor Sichtbarkeitspruefung, Electron-Fokusabfrage und Svelte-Flush verarbeitet werden (`:620`). Diese Reihenfolge ist funktional, nicht dekorative Komplexitaet.

## Ponytail: Konkrete Kuerzungen

1. `native:` Eigenen XML-Entity-/Attribut-/Tag-Scanner in `src/lib/components/common/documentSecurity.ts:44` durch `DOMParser` ersetzen, wie bereits in `src/lib/utils/pptxToHtml.ts:94` verwendet; geschaetzt 40-50 Zeilen weniger.
2. `delete:` Nicht erreichbaren Canvas-Titelcallback in `src/lib/components/chat/Artifacts/NoteCanvas.svelte:69` samt Prop/Export/Aufruf in `NoteEditor.svelte` entfernen; 23 Quelltextzeilen, ohne Ersatz.
3. `delete:` Nur noch von einem Test verwendetes `isKeyboardActivationClick` in `src/lib/components/chat/Artifacts/workspace.ts:57` samt veraltetem Kommentar entfernen; 3 Quelltextzeilen, dazu den nicht mehr verhaltensrelevanten Test entfernen.
4. `delete:` Unbenutzte Imports `decodeRuntimeText`, `workspaceOpenFilePaths` und `isWorkspaceDocumentPath` aus `src/routes/+layout.svelte` entfernen; 2 ganze Importzeilen plus ein Import-Symbol.

Der Titelcallback ist nicht nur selten verwendet: Sein einziger nichtleerer Empfaenger setzt `canvas={true}` (`NoteCanvas.svelte:286`), waehrend die einzige Ausloesestelle im `!canvas`-Zweig liegt (`NoteEditor.svelte:1037-1074`). `onDocumentChange` bleibt als bestehender Dokument-Aenderungspfad erhalten.

Der XML-Ersatz ist ein Refactoring mit Sicherheitsanforderungen, kein unbedingtes Loeschen: Parserfehler ablehnen, DTD/DOCTYPE nicht zulassen, Namespaces sowie die bestehenden defensiven Gross-/Kleinschreibungsfaelle erhalten, Attribute dekodiert pruefen, externe Medien weiterhin sperren und normale Hyperlinks weiter nachhaerten. Die bestehenden Entity-, Namespace-, Kommentar- und `>`-Faelle muessen in echten Browsern laufen; die aktuellen Unit-Tests haben keine Browser-DOM-Umgebung. ZIP-/Groessenlimits werden dabei nicht entfernt. Die Zeilenersparnis ist eine Schaetzung, noch kein gemessener Patch.

net: ~-75 lines, -0 deps possible.

## Was Nicht Weiter Zerlegt Werden Sollte

- `Artifacts.svelte` ist bereits ein kleiner Adapter zum eigenen `WorkspaceHost`. Das ist eine sinnvolle Grenze.
- Workspace-Union, Output-Persistenz, Nachladen, Session-Zustaende, gemeinsamer Auswahlpfad und Save-Queue sind bereits eigene Module. Die frueher vorgeschlagene Auslagerung aus `Chat.svelte` muss nicht erneut erfunden werden.
- `NoteEditor.svelte` weiterverwenden. Eine eigene Kopie wuerde Notes-Berechtigungen, kollaborative Aenderungen, Versionen und Upstream-Fixes auseinanderlaufen lassen. Sein Rohdiff (+362/-303) enthaelt auch Einrueckungsbewegungen, nicht nur neue Fachlogik.
- Kleine fachliche Komponenten wie Activity-Wrapper, Konfliktdialog und aktive Dokument-Panels sind keine belegten Loeschkandidaten allein aufgrund ihrer Groesse oder eines einzelnen Aufrufers.
- `mutate_chat_by_id` und `mutate_message_by_id` gehoeren zur bestehenden Persistenzgrenze. Locks, SQLite-Compare-and-Swap, atomare Message-Aktualisierung und Besitzpruefung nicht fuer eine kleinere Statistik entfernen.
- Frontend-/Backend-Pruefungen sind nicht automatisch doppelte Arbeit: Der Server muss unabhaengig vom UI autorisieren und Versionen pruefen.
- Keine neue generische Artifact-Engine, kein Adapter pro Dateityp allein aus Stilgruenden, keine vollstaendigen Upstream-Komponentenkopien ausserhalb des Originalpfads.
- Die entfernten Terminal-/Integrationsoptionen sind Produktentscheidungen, nicht pauschal toter Upstream-Code. Eine Ruecknahme braucht eine Produktentscheidung, nicht nur den Wunsch nach weniger beruehrten Dateien.

## Codebilanz

### Produktivquelltext

| Herkunft | Dateien | Hinzugefuegt | Entfernt | Aenderungsumfang (+ und -) | Netto |
| --- | ---: | ---: | ---: | ---: | ---: |
| Bereits im Upstream vorhanden | 68 | 4.500 | 2.471 | 6.971 | +2.029 |
| Neue fork-eigene Dateien | 54 | 9.711 | 0 | 9.711 | +9.711 |
| **Gesamt** | **122** | **14.211** | **2.471** | **16.682** | **+11.740** |

Damit lautet die Antwort je nach gemeinter Kennzahl:

- 14.211 hinzugefuegte Produktivquelltext-Zeilen, davon 4.500 in Originaldateien und 9.711 in neuen Dateien.
- 16.682 insgesamt hinzugefuegte oder entfernte Zeilen im Diff.
- 11.740 Zeilen Nettowachstum nach Abzug der entfernten Zeilen.
- 68 beruehrte Upstream-Quelldateien. Ueber alle Dateikategorien hinweg sind es 86 bestehende Upstream-Dateien.

Die 54 neuen Dateien liegen weiterhin **im selben Repository**. Sie sind neue, separat organisierte Fork-Module, aber keine ausserhalb des Projekts installierten Plugins. Neue Dateien an sich vermeiden keine Kopplung: Entscheidend bleiben wenige explizite, stabile Integrationspunkte.

### Aus Der Hauptzahl Ausgeschlossen

| Kategorie | Dateien | Hinzugefuegt | Entfernt | Bemerkung |
| --- | ---: | ---: | ---: | --- |
| Tests und Test-Fixtures | 65 | 11.590 | 0 | Drei Binaerdateien haben keine Textzeilenzahl. |
| Dokumentation, Specs, Lizenzhinweis | 6 | 2.019 | 0 | Stand vor diesem Auditbericht. |
| Uebersetzungs-JSON | 5 | 95 | 4 | Produktrelevante Texte, separat statt als Programmcode gezaehlt. |
| Build-/CI-/Deployment-Konfiguration und Hilfsskripte | 15 | 725 | 44 | Gemischte Kategorie, enthaelt auch Test- und Fixture-Werkzeuge. |
| Lockfile | 1 | 88 | 0 | Nicht als selbst geschriebener Quelltext gezaehlt. |

Kontrollsumme des gesamten geprueften Diffs: 214 Dateien, +28.728/-2.519. Diese grosse Rohzahl ist **nicht** die Custom-Produktivcodezahl. Auch die Konfigurationskategorie wird nicht pauschal als benoetigter Runtime-Code ausgegeben.

### Messmethode

Gezahlt sind physische Git-Diff-Zeilen, einschliesslich Leerzeilen und Codekommentaren, keine logischen Statements. Eine ersetzte Zeile erscheint als eine Entfernung und eine Hinzufuegung. Git kann nicht entscheiden, ob jede dieser Zeilen fachlich unverzichtbar ist; die Zahl ist daher kein behauptetes theoretisches Minimum.

Die Hauptkategorie umfasst `.svelte`, JS/TS einschliesslich Modul-/JSX-Varianten, `.py`, `.css`, `.scss` und `.html` unter `src/` oder `backend/open_webui/`. Ausgeschlossen sind Test-/Spec-Dateien, Testverzeichnisse, Dokumentationsverzeichnisse, Markdown und Uebersetzungsdateien. Die CSV-Dateibilanz enthaelt jede klassifizierte Datei und dient der Kontrolle.

Upstream-Zugehoerigkeit wird aus der Dateiliste am Basiscommit bestimmt, nicht aus Ordnernamen oder Commit-Autoren. Der Diff wird ohne Rename-Erkennung gerechnet; im geprueften Delta gab es keine umzudeutenden Renames. Es werden keine historischen Commit-Statistiken addiert: Zwischenzeitlich geloeschter Versuchscode wird nicht mitgezaehlt.

```sh
git merge-base 87426730f2a936a9c5aba0c62798d32b020b25a7 upstream/main
git ls-tree -r --name-only 2a960a59fe1dbbd35282f0556b3666d81102e781
git diff --numstat --no-renames 2a960a59fe1dbbd35282f0556b3666d81102e781 87426730f2a936a9c5aba0c62798d32b020b25a7
```

Zusaetzliche Kontrolle mit `--ignore-all-space`: 15.532 geaenderte Produktivquelltext-Zeilen statt 16.682; bei Originaldateien +3.925/-1.896. Das Nettowachstum bleibt +11.740. Die Differenz von 1.150 Diff-Zeilen zeigt Formatierungsbewegung, nicht 1.150 entfernbaren Programmcode.

### Groesste Originaldatei-Diffs

| Datei | Hinzugefuegt | Entfernt |
| --- | ---: | ---: |
| `backend/open_webui/tools/builtin.py` | 968 | 0 |
| `src/lib/components/notes/NoteEditor.svelte` | 362 | 303 |
| `src/lib/components/chat/Chat.svelte` | 413 | 213 |
| `src/lib/components/chat/PyodideFileNav.svelte` | 347 | 129 |
| `src/lib/components/chat/ChatControls.svelte` | 73 | 377 |
| `src/lib/workers/pyodide.worker.ts` | 267 | 133 |
| `src/lib/components/chat/Artifacts.svelte` | 4 | 275 |
| `src/lib/pyodide/pyodideSandboxHost.ts` | 210 | 47 |
| `src/lib/components/chat/Messages/CodeBlock.svelte` | 97 | 147 |
| `src/lib/components/common/PDFViewer.svelte` | 112 | 132 |
| `src/routes/+layout.svelte` | 165 | 70 |
| `backend/open_webui/utils/tool_approval.py` | 121 | 74 |
| `backend/open_webui/utils/middleware.py` | 169 | 8 |
| `backend/open_webui/models/chats.py` | 115 | 0 |

## Engineering- und Sicherheitsgrenzen

Der gepruefte Diff fuegt keine Datenbankmigrationen hinzu. Die Workspace-Daten nutzen vorhandene Chat-JSON-Strukturen; die neuen Chat-Methoden aendern keine Tabellenspalten. Das bedeutet nicht, dass kuenftige offizielle Upstream-Versionen ohne ihre eigenen Migrationen auskommen.

Die betrachteten Schutzmechanismen sind begruendet: verifizierte Benutzer an Artifact-Routen, Besitzerbindung bei Chat-Mutationen und Output-Dateien, Versions-/Hash-Preconditions, native Transaktionen, Archivlimits, Dokument-Link-Haertung und die Sandbox ohne `allow-same-origin`. Die Approval-Ausnahme prueft nicht nur den Toolnamen, sondern auch dessen Builtin-Herkunft. Diese Mechanismen muessen bei Auslagerungen unveraendert bleiben. Konfigurierbare CSP und alle Abhaengigkeiten sind damit nicht umfassend sicherheitszertifiziert.

Unabhaengig von Ponytail bleiben die im QA-Bericht dokumentierten Risiken offen:

1. **Tabellen-Ressourcenbudget:** `src/lib/utils/excelToTable.ts:42` materialisiert den Sheet-Bereich vor einer Zellanzahlbegrenzung. Ein explizites Zellbudget vor Konvertierung plus Download-Fallback ist die kleinere sinnvolle Loesung; nicht sofort einen virtualisierten Tabelleneditor bauen. Dateibyte-/ZIP-Limits reichen dafuer nicht.
2. **WebKit-Tab-Klick:** Die zuletzt ausgefuehrte komplette Browsermatrix endete mit 80 bestandenen Szenarien und einem intermittierenden Tab-Scroll-/Pointer-Fehler. Der Fehler ist im aktuellen QA-Bericht ausdruecklich wieder offen.
3. **Typecheck:** Der letzte Gesamtcheck war nicht gruen (7.553 Fehler, 200 Warnungen). Es gibt keinen belegten sauberen Upstream-Vergleich fuer alle Meldungen. Zuerst eine reproduzierbare Baseline oder einen belastbaren Gate fuer neu eingefuehrte Fehler herstellen.

Die `package.json`-Aenderung fuegt zwei Entwicklungsabhaengigkeiten fuer Playwright und Accessibility-Tests hinzu, aber keine neue Produktionsabhaengigkeit. Das ist kein Beleg dafuer, dass bereits vorhandene Abhaengigkeiten frei von Schwachstellen sind.

## Verifikation Dieses Audits

- Commit, sauberer Ausgangs-Arbeitsbaum, integrierte Upstream-Basis und Dateizugehoerigkeit mit Git geprueft.
- Rohbilanz und whitespace-bereinigte Bilanz separat berechnet; alle 214 Dateieintraege in der begleitenden CSV.
- Import-/Aufrufsuche fuer die konkreten Loeschkandidaten und deren bedingte Renderpfade geprueft.
- `npm run test:viewer` mit dem lokalen Node 22 erneut ausgefuehrt: **69 Tests in 6 Dateien bestanden**.
- `git diff --check` fuer `src/` und `backend/open_webui/` gegen die Basis bestanden. Der gesamte historische Fork-Diff meldet fuenf nachgestellte Leerzeichen in zwei bestehenden Markdown-Specs; keine Produktivcode-Whitespace-Fehler. Die Dokumente wurden nicht nebenbei umformatiert.
- Browsermatrix, Backend-Suite, Gesamt-Typecheck und Build wurden fuer dieses reine Audit nicht erneut ausgefuehrt. Ihre vorherigen Ergebnisse und Einschraenkungen stehen in `docs/workspace-qa-2026-09-23.md`.

## Empfohlene Reihenfolge

1. Offenes Zellbudget und WebKit-Problem als eigene funktionale Korrekturen behandeln; keine kosmetische Freigabe durch einen gruenen Unit-Testlauf.
2. Erreichbar belegten toten Code und unbenutzte Imports in einem kleinen Commit entfernen.
3. Workspace-Tools aus `builtin.py` auslagern; Tool-Schemata, Importpfade und Note-Synchronisierung mit bestehenden Tests pruefen.
4. XML-Scanner durch nativen Parser ersetzen und alle bisherigen Sicherheitsfaelle in Chromium, Firefox und WebKit absichern.
5. Nur danach die kleinen Middleware-/Layout-Auslagerungen vornehmen, wenn der tatsaechliche Diff kleiner und die Aufrufreihenfolge unveraendert bleibt.

Ziel ist eine kleinere und klarere Upstream-Integrationsflaeche, nicht eine schoenere Statistik durch verschobene Kopien oder entfernte Schutzlogik. Nach jedem Schritt erneut gegen dieselbe Upstream-Basis messen.
