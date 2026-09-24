# Workspace QA - 2026-09-23

## Scope and baseline

- Branch: `codex/koby-canvas-workspace`, HEAD `8e88c7f6f`, including the existing uncommitted UI changes.
- Local application: `http://localhost:5050`.
- Files, persistent tabs, Outputs, document viewers, Canvas, selection editing, changes/Undo, Notes promotion, Web Preview, persistence and permission boundaries.
- Existing work was preserved. No database schema or migration files changed. Permission tests used a separate disposable database and server on port 5089; that server was stopped afterwards.
- This is focused regression and usability evidence, not a guarantee of zero bugs or a full penetration test.

## Bugs fixed during this audit

1. Reload still restored only four file tabs despite removal of automatic tab eviction. Restore now retains up to 100 bounded file references, consistent with the existing session metadata limits. Unit and real-app tests verify ten tabs and persistence of a closed tab.
2. DOCX pages overflowed a 320px viewport by 30px. Fit calculation now uses the actual available width and explicit horizontal wrapper padding. Checked at 320px and 390px in both themes across all three browser engines.
3. WebKit intermittently intercepted tab clicks with the tab strip's native hover scrollbar. The strip now uses the existing fully hidden scrollbar utility while retaining scrolling and keyboard navigation. Repeated targeted runs and the full matrix passed.
4. CSV parsing changed ISO dates into Excel serial numbers and removed leading zeros/trailing decimal zeros. CSV now keeps raw source strings. XLS/XLSX cells now display their stored number/date/percentage formats while preserving numeric alignment. Download bytes are unchanged.
5. Removed an unused reactive state copy left behind by the earlier tab-eviction removal.

## Verification

| Check | Result |
| --- | --- |
| Focused frontend unit tests | 225 passed in 22 files |
| Backend tests | 184 passed, 10 warnings |
| Viewer browser matrix | 66 passed: Chromium, Firefox, WebKit |
| Main application suite | 33 passed; permission scenario intentionally gated |
| Restricted-user scenario on isolated authenticated backend | 1 passed |
| Final app recheck after spreadsheet changes | 2 passed: ten-tab reload and durable Outputs |
| Repeated WebKit tab/DOCX regression | 6 passed |
| Viewer runner/build contract tests | 5 passed |
| Viewer dependency/license policy | Passed for 4 packages |
| Production build | Passed with Node 22; static adapter output written |
| Viewer bundle budget | Passed against the final build |
| Global typecheck | Not clean: 7,553 errors and 200 warnings in 340 files |
| Whitespace checks | `git diff --check` passed |

The global typecheck log did not name the changed viewer, tab, Outputs, DOCX or spreadsheet-renderer files. This is not proof that every reported error predates these changes; no clean baseline comparison was made. The global check is not a green release gate.

### Browser coverage

- PDF, DOCX, PPTX, CSV, XLSX, XLS, Markdown, plain text/code, unsupported binary download-only fallback.
- Light/dark, desktop and narrow 320px/390px layouts; measured overflow and screenshots.
- PDF page navigation; document zoom, pan, reset, reopen, floating action placement and keyboard access.
- Spreadsheet sheet switching, sticky row/column headers and corner, horizontal/vertical scrolling, Unicode, escaped HTML, CSV BOM and quoted multiline values, stored Excel cell formats.
- Ten open tabs with only the active viewer mounted; focus after close; reload and remembered closed tabs; narrow tab strip navigation.
- Missing files, unavailable runtime, corrupt refresh, oversized response, stale async responses and unchanged downloads.
- Outputs menu row spacing, multiple compact output cards, persisted file reopening without the original Pyodide catalogue.
- Canvas autosave, failed saves, conflicts, immediate chat switches, formatted selection, preserving composer drafts, formatted change highlights, Undo and linked Notes.
- Web Preview code/preview switching, inline/root assets, classic/module scripts, literal closing tags, sandbox restrictions, bounded runtime errors and narrow code layouts.
- Restricted users cannot upload, promote to Notes or read another user's private file/chat; allowed Canvas functionality remains usable.

### Manual computer-use checks

Opened the existing real chat in a temporary in-app-browser tab. Checked the Outputs list, XLSX sheet switching, a 3,000-row/30-column CSV, horizontal scrolling, corrected date display, a multi-page PDF and its page navigation. The 37.2 MB CSV was rejected by the preview size limit. The temporary tab was closed; user documents were not edited.

## Remaining risks and follow-up priorities

1. **Spreadsheet resource budget:** `excelToTable.ts` still materializes the complete declared sheet range. File-byte/ZIP limits do not bound the number of cells in a sparse or very large worksheet. The 3,000 x 30 CSV worked, but adversarial sparse ranges and much larger cell counts were not load-tested. Before broad untrusted-file use, add an explicit rendered-cell budget with a clear download fallback; use pagination/virtualization only if the product needs larger interactive sheets.
2. **Oversized-file recovery (resolved 2026-09-24):** a size-limit rejection now offers Download instead of retry. Saved files use the existing authenticated attachment endpoint and the browser download manager. Runtime files are read for download only after an explicit click and never passed to the renderer. Pending runtime downloads are discarded on close, deletion or source change. A displayed older version retains its separate snapshot download. Preview limits remain unchanged.
3. **Global typecheck debt:** repair or baseline the repository-wide errors before making an unqualified production-readiness claim.
4. **Coverage boundaries:** no physical iOS/Android devices, multi-hour sessions, arbitrary complex Office documents, every language, or external model/provider reliability was certified. Tool/API behavior is covered deterministically; this run did not execute a new model-generated document journey against a paid provider.
5. **Security boundary:** covered sanitization, unsafe links, archive budgets, sandbox behavior, ownership/permissions and concurrency. Dependency/license checks are not a comprehensive vulnerability audit. Office layout fidelity and imported document content quality remain renderer/source dependent.
6. **WebKit tab-click regression (reopened 2026-09-24):** the ten-tab viewer scenario again intermittently fails when clicking the first tab after horizontal scrolling: WebKit reports that the tab strip intercepts the pointer. The earlier hidden-scrollbar change did not eliminate this failure. A positioned-strip experiment passed six isolated runs but failed in the full matrix, so it was removed. This needs a separate root-cause fix; download tests do not certify tab navigation.

## Oversized-file follow-up - 2026-09-24

- Replaced retry with a localized Download action specifically for preview size-limit errors. Other load errors retain retry.
- Saved files use the existing `/api/v1/files/{id}/content?attachment=true` endpoint; backend ownership checks and cookie authentication are unchanged. Browser tests use a test-only HTTP attachment endpoint, not the authenticated production backend.
- Runtime downloads require an explicit click, have busy/error states, and discard late responses after close, deletion or source change. Original-file bytes never enter the preview renderer.
- An existing preview remains visible after an oversized refresh and retains its own displayed-version download.
- All 18 targeted oversized browser cases passed across Chromium, Firefox and WebKit, including byte-for-byte hashes, recovery after a failed download, and cancellation on close/deletion. The 69 viewer unit tests passed. Node 22 production build and viewer bundle checks passed.
- The initial full matrix had 79 passes and two failures: a test-setup connection reset while a build ran, and the WebKit tab-click issue above. The connection-reset scenario passed separately in every engine. The later complete run had 80 passes and the one WebKit tab-click failure; the ineffective CSS experiment was then removed. No broad release approval is implied.
- Evidence: `.tmp/workspace-oversized-download`, `.tmp/workspace-download-regression`, `.tmp/workspace-download-recheck`, `.tmp/workspace-tab-position-check`, `.tmp/workspace-download-final`, `.tmp/workspace-download-unit.log` and `.tmp/workspace-download-build.log`.

## Reproduction

Use Node 22 from `.tmp/node-v22.23.2-darwin-arm64/bin` and set `TMPDIR="$PWD/.tmp"` in this checkout.

```sh
npm run test:frontend -- --run src/lib/components/chat/Artifacts src/lib/components/chat/FileNav src/lib/components/chat/Messages src/lib/components/common/documentZoom.test.ts src/lib/pyodide/workspace.test.ts
npx playwright test --workers=1 --reporter=list --output=.tmp/workspace-audit-viewer-final
npx playwright test --config playwright.workspace.config.ts --reporter=list --output=.tmp/workspace-audit-app-final
npm run test:viewer:contracts
npm run check:viewer:dependencies
npm run build
npm run check:viewer:bundle
git diff --check
```

The main app suite creates and cleans up its own test chats/files. The restricted permission test requires its documented dedicated authenticated server and restricted settings; do not enable it against a production database.

Local evidence is under `.tmp/workspace-audit-*` and `.tmp/workspace-permissions-audit/results`. These logs/screenshots are local test output, not committed artifacts. Do not run builds or SvelteKit sync concurrently with live-app browser tests: development reloads can invalidate an in-progress interaction.
