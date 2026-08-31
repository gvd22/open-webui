# Unified Workspace v0.11.1: Configuration and Acceptance

**Date:** 31 August 2026  
**Scope:** `codex/koby-canvas-workspace`, isolated development only.  
**Status:** Upgrade integrated and tested, with a confirmed local-app Browser blocker.
Full release acceptance remains incomplete; known failures, unexercised journeys,
and configuration limitations below are not passes.

## 1. Upgrade and Data Preservation

- Exact upstream tag: `v0.11.1`, commit
  `d3e8bf3405e848cfba377814d0aa7ba7290e414d`. No moving `main` merge.
- Before merging, runtime snapshot imports were checkpointed as `4e258d4e6`;
  the consolidated specification as `a3f962d60`.
- Merge commit: `c8087c2d8`. Custom and upstream histories remain intact.
- Follow-up commits separate Terminal corrections (`038d6a3e1`), integration tests
  (`47e9b292d`), isolated supervisor maintenance (`bd3868edc`), and the known
  Browser failure reproducer (`bf7c5718f`).
- Protected backup: `.tmp/backups/upgrade-20260830/dev-before-upgrade.tar.gz`.
  Its directory is private and archive mode 600. It contains development
  data/configuration and must not be committed or attached to reports.
- Migration was exercised against a database copy before the isolated database.
  The head advanced from `f0bd01a18a3d` to `d4c1a8e37b62`; integrity checks passed.
  The pre-upgrade 34 chats, three files, and three users were preserved.
- Existing chats without explicit bindings were pinned to their legacy Terminal
  connection before installing the new default. No legacy files were moved.
- Production services, containers, and data were not changed. An initial test
  process used the checkout's default development database on port 8080 before
  being stopped; it did not use production storage.

## 2. Development Configuration

| Component | Isolated setting |
| --- | --- |
| Frontend | Node 22, Vite on `127.0.0.1:5050` |
| Backend | Uvicorn on `127.0.0.1:8081`, `DATA_DIR=.codex-dev-data` |
| Orchestrator | Official Open WebUI Terminals 0.2.2 on `127.0.0.1:18081` |
| Managed connection | `workspace-dev-v0111`, type `orchestrator` |
| Chat context | `config.contexts.chat.context_id = "chat_id"` |
| Automation context | `config.contexts.automation.context_id = "automation_id"` |
| Uploads | Native `chat_uploads = "default"` |
| Tool permissions | Enabled; unset `tool_approval_mode` resolves to `ask` |
| Authentication | Existing isolated no-auth workflow; never use it for production |
| Viewers | `ENABLE_DOCUMENT_VIEWER=true` |
| Pyodide persistence | `ENABLE_PYODIDE_FILE_PERSISTENCE=true` |
| CORS | `http://localhost:5050;http://127.0.0.1:5050` |

The existing development secret is reused, not rotated. The Terminal key is in
`.codex-dev-data/terminals-v0111/.api-key` with mode 600. Neither belongs in source,
command output, screenshots, or reports. The orchestrator has its own database
and files under `.codex-dev-data/terminals-v0111` and uses the already installed
official Open Terminal image without replacing another runtime.

The private machine-specific launcher is `.tmp/launch-upgrade-dev.py`; its
`backend`, `frontend`, and `orchestrator` commands check the port before starting
a detached process. They do not kill another process. Logs are private
`.tmp/upgrade-*.log` files. This is not a production deployment mechanism.

For a fresh installation, configure the context mapping through native Terminal
settings. API, Shell, Files, ports, imports, and exports must use the same
authenticated saved-chat identity. Do not use an unscoped direct worker URL.
Unsaved chats must not acquire shared storage. An unavailable selected Terminal
fails closed rather than silently switching to Pyodide.

Terminal connections were temporarily disabled for Pyodide-only checks, then
restored from a protected snapshot. They are enabled in the final development
configuration. Unrelated integrations were not enabled.

### Local Orchestrator Corrections

The isolated supervisor additionally uses the reproducible development-only
patch and three mocked-Docker regressions in `scripts/dev`. Its cached published
port was stale after a worker restart. Port refresh, loopback-only new workers,
and reconciliation restricted to the configured data directory correct this.
The old chat's authenticated file read then returned 200 in 0.01 seconds, and
the model-driven Terminal snapshot import succeeded in the browser.

Forty-nine worktree-owned test workers were stopped and retained under backup
names; mounted files were preserved and replacements created on demand. Their
private metadata snapshot is alongside the upgrade backup. A potentially shared
system discovery worker was explicitly excluded after the safety check blocked
restarting it. Its existing non-loopback binding remains unchanged; altering it
requires separately authorized maintenance. No production worker was stopped.

## 3. Integration and Corrective Changes

| Area | Behavior and correction |
| --- | --- |
| Native approvals | Use upstream approval/answer flow. Atomic claim prevents concurrent duplicate execution; already claimed calls are not replayed after reload. |
| Approval target | Preserve original chat, object, files, focus, and Terminal binding. Validate the actual resuming socket's ownership, not an arbitrary recent tab. Recheck versions before mutation. |
| Continuations | Preserve system policy/current-turn tool output and rebuild bounded workspace context after mutations. Nullable builtin metadata is supported. |
| Focus and persistence | Late selections from a previous chat cannot switch the current object. Historical snapshots cannot overwrite newer manual edits. |
| Previews | Virtual `fetch()` reads JSON/CSV/text from the package; unknown paths return 404 and write methods fail. No host filesystem access. |
| Preview exports | New folders include the stable preview ID to avoid equal-title collisions. Existing export paths remain compatible. |
| Runtime imports | Route to the exact requesting client and read bounded UTF-8 snapshots. Pyodide RPC no longer waits on an unrelated render/focus lifecycle. |
| Files | Preserve an in-flight preview across refresh; separate incoming initial-path tracking from local clicks. JSON opens on the first click without immediately closing. |
| Notes promotion | Seed the collaborative editor from Markdown before autosave. Programmatic content changes emit no blank snapshot. Initialize counters without writing. |
| Code interpreter | Persist explicit enabled/disabled choice through reload; legacy chats without a preference do not inherit another chat's selection. |
| Utility tabs | One Files tab, multiple Terminal/Browser tabs, saved ordering through hydration, no focus stealing on object updates. |
| Shell sessions | Do not pass the chat's cwd header as the native PTY creation ID. Worker ownership/context stays pinned while the server allocates independent shells. Failed shells expose an explicit reconnect control. |
| Document viewers | Shared navigation, 10% zoom buttons, modifier-wheel zoom, two-axis pan, and fit/reset for PDF/DOCX/PPTX. |
| Security flags | Native script/download preferences apply; preview iframe still excludes `allow-same-origin`. |

No tool-contract rename, Notes redesign, automation-management UI, voice redesign,
or parallel approval framework was introduced.

## 4. Automated Verification

| Check | Recorded result | Evidence scope |
| --- | --- | --- |
| Frontend Vitest | 179 passed in 25 files | Workspace, runtime routing, permissions, previews/security, save queues, Files races, interpreter persistence, viewer contracts |
| Backend `backend/tests` | 157 passed | Canvas/preview/context, ownership/version checks, native permissions, HTTP/WS scoping, atomic approvals/continuations, unique PTYs |
| Viewer browser matrix | 36 passed | Actual PDF/DOCX/PPTX in Chromium, Firefox, WebKit; navigation, zoom, XY pan, reset/reopen |
| Viewer source contracts | 9 passed | Shared viewer integration contracts |
| Full-app Playwright | 9 passed, 1 expected failure, 1 configuration-specific skip | Six seeded UI journeys, three live Terminal API diagnostics, and the unresolved local-script Browser reproducer |
| Local orchestrator patch | 3 passed | Mocked Docker verifies localhost binding, mount-scoped reconciliation, and changed-port refresh |
| CSV upload, separate Pyodide-only run | 1 passed | Visible chooser, native upload, visible composer attachment |
| Production build | Passed, Node 22.23.2, 75 seconds | Client/server compilation and static output |
| Full type check | Not clean | Exact upstream: 7,790 errors/200 warnings/341 files; current measured: 7,662 errors/198 warnings/339 files, before a few final annotations |
| Production dependency audit | Not clean; upstream-identical findings | 80 findings: 0 critical, 65 high, 13 moderate, 2 low. This is not a clean-security claim. |

Full-app tests run the real application but seed object data explicitly:

- `tests/workspace/workspace.spec.ts`: two Canvas/two preview lifecycle,
  autosave/local JSON fetch, close/reopen/reload, singleton Files, utility-tab
  order, JSON first-click preview, failed-shell retry/distinct second shell, and
  a configuration-gated upload journey.
- `tests/workspace/notes.spec.ts`: freshly promoted Markdown Note opens with
  content/counters, reloads intact, emits no blank Socket.IO snapshot, and keeps
  its linked Canvas data.
- `tests/workspace/runtime-api.spec.ts`: two live chat contexts have separate
  files/cwd/commands; the owned HTTP server is proxied and invalid scopes fail
  closed. Distinct shells also have different process IDs. These three tests
  are API diagnostics, not browser proof. Its fourth test opens a real local app
  in the Browser and reproduces the authenticated-script failure. That test is
  explicitly marked as expected to fail, not accepted behavior.

Seeded fixtures are not real-model creation evidence. Model journeys were
separately exercised below. The final full-app run took 42.6 seconds.
The upload test skips with managed Terminal enabled;
its separate Pyodide-only pass took 5.3 seconds. Playwright's console counts an
expected failure in its aggregate "passed" total. The table above deliberately
separates that failure; it must not be cited as ten working journeys.

### Reproduction

Use an isolated no-auth database and development orchestrator, never production.
Tests remove only their own chats/Notes. Runtime files intentionally survive chat
deletion; stop owned test workers separately without deleting their volumes.

```sh
npm run test:frontend -- --run --maxWorkers=1 --minWorkers=1
npm run test:viewer:contracts
npm run test:workspace:e2e
npm run build
```

Run backend tests with `PYTHONPATH=backend`, a separate test `DATA_DIR`, test-only
signing/encryption keys, `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1`, and
`pytest -p pytest_asyncio.plugin backend/tests -q`. Full-app configuration accepts
`WORKSPACE_E2E_BASE_URL`; live runtime diagnostics accept
`OPEN_WEBUI_RUNTIME_API_BASE_URL` (default isolated backend port 8081).

Browser execution required macOS browser-launch permission outside the sandbox.
The earlier launch-denied run was not a pass or a demonstrated product defect.
Full-app output is under `.tmp/workspace-e2e-results`, including `report.json` and
failure traces. Traces are private: requests can contain development tokens.

## 5. Real-Model Browser Journeys

Configured model `Gian` was exercised in normal chat with native approval controls.

| Journey | Observed result |
| --- | --- |
| Canvas | Workshop Agenda and Launch Checklist created with separate stable IDs/cards. Targeted updates, manual edits, Undo, manual-edit Undo invalidation, close/reopen worked. |
| Approved target | Agenda updated while another document was selected. Manual edit during pending approval produced conflict rather than overwriting the edit. |
| Native question | `ask_user` offered Online/In person, survived pending reload, and resumed with the selected answer. |
| Native denial | Denied runtime import left preview unchanged; completed/error states stayed distinguishable. |
| Two previews | Workshop Counter (HTML/CSS/JS) and Team Directory (HTML/CSS/JSON), one compact creation card each; virtual JSON fetch rendered names. |
| Preview changes | Manual JSON autosaved. Targeted Counter update preserved the other preview and did not reopen a closed tab. Stale multi-file edit conflicted; fresh read/retry succeeded. |
| Preview interaction | Updated +2 button incremented to 2 in the real iframe. |
| Export | Explicitly copied both previews to separate Terminal folders; inspected exported JSON through Files/Terminal. No automatic synchronization. |
| Pyodide analysis/import | Approved Python on sample CSV, wrote JSON, created Sales Summary, approved `web_preview_import_runtime_file`. Rendered total 300: North 120, South 80, West 100. |
| Snapshot independence | Closed/reloaded Sales Summary stayed closed until opened, then rendered data without its original execution session. |
| Notes repair | Repaired disposable Note preserved content after reload; separate fresh-promotion browser regression passed. |
| Terminal import | After the isolated supervisor repair, imported the preserved runtime JSON into Team Directory. The preview rendered Alex, Sam, Jo, Mia without changing its HTML, CSS, title, or identity. |
| Utilities | Two independent shells ran separate servers simultaneously. A command in the second shell did not affect the first. Reconnect recovered the existing failed shell. Two Browser tabs discovered ports 8765/8766 independently. |
| Inline local app | A one-file HTTP page in Browser 2 rendered and its inline button changed from 0 to 1. Both temporary test servers were stopped afterward; files and shells were retained. |
| Multi-file local app | **Failed.** Exported Workshop Counter HTML rendered, but its separate `styles.css` and `app.js` requests returned 401. Its button stayed at 0. This is distinct from the working packaged Web Preview. |

Private screenshots: `.tmp/upgrade-evidence/real-model-pyodide-preview.jpg` and
`.tmp/upgrade-evidence/real-model-preview-update.png`, and
`.tmp/upgrade-evidence/real-model-terminal-preview.jpg`. Local Browser evidence is
`.tmp/upgrade-evidence/local-server-inline-interaction.jpg` (button at 1) and
`.tmp/upgrade-evidence/local-server-browser.jpg` (blocked multi-file app at 0).
The Pyodide image shows the computed result. One in-app native chooser attempt produced no attachment; the
separate full-app upload test proves that step, not the in-app attempt. A single
continuous uploaded-CSV-to-model-to-preview journey is therefore not fully proven.

## 6. Remaining Gaps and Release Decision

1. **Local Browser subresource authentication (functional blocker):** the opaque
   iframe's separate CSS/JavaScript requests omit the Open WebUI session cookie.
   The authenticated proxy returns 401 even though the initial HTML navigation
   succeeds. Reproduced live and in `tests/workspace/runtime-api.spec.ts`, test
   `known gap: isolated Browser loads session-protected local script files`.
   Inline scripts work; multi-file local apps cannot be marked accepted. Do not
   fix this by giving untrusted app code Open WebUI same-origin privileges or by
   making the proxy public. A separately isolated app origin or a narrowly scoped
   asset authorization design still needs implementation and security review.
2. **Shared discovery worker:** its pre-existing non-loopback binding is unchanged.
   New worktree chat workers are localhost-only, but changing that potentially
   shared worker requires separate approval. The local orchestrator patch must
   be retained until equivalent fixes are available upstream.
3. **Live configuration matrix:** restricted-user/disabled-feature/unavailable
   service behavior has deterministic coverage, but not every requested
   configuration has a real-model browser journey. Automation artifact creation
   was not exercised live.
4. **Upload continuity:** chooser passed separately; real-model analysis used
   sample CSV from the prompt. Complete the one-piece uploaded-file workflow.
5. **Visual/accessibility breadth:** viewer engines/sizes/controls are covered and
   light/dark surfaces inspected, not every feature's narrow-layout, keyboard,
   screen-reader, and theme journey.
6. **Inherited baseline debt:** full type check and dependency audit are not
   clean. Exact-upstream comparison is retained under `.tmp` for separate triage.

The exact-version upgrade and recorded fixes can be reviewed and reproduced.
These outstanding items prevent marking the entire requested matrix accepted.
Development verification does not authorize a production rollout.
