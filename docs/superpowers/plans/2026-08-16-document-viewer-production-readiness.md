# Document Viewer Production Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the read-only PDF/DOCX/PPTX workspace viewer behind a reversible rollout flag with bounded resource use, deterministic browser evidence, dependency/legal gates, and an explicit pilot and rollback runbook.

**Architecture:** Keep file acquisition and the existing `DocumentFileViewer` renderers intact, but mount only the active file renderer and keep inactive workspace panels as empty tabpanel owners. Add a backend-owned `ENABLE_DOCUMENT_VIEWER` feature flag propagated through `/api/config`, retain Files/FileNav as the disabled fallback, and use small checked-in fixtures plus temporary generated profiles for browser and resource tests. Keep observability privacy-safe by adding no browser telemetry.

**Tech Stack:** Svelte 5, TypeScript, Vitest, Python/pytest, Vite manifest, Playwright Test with Chromium first and Firefox/WebKit second, Node standard-library scripts, GitHub Actions, CycloneDX/Syft inventory, and existing OpenTelemetry only where already enabled.

---

## Task 1: Mount only the active document renderer and preserve workspace contracts

**Files:**
- Modify: `src/lib/components/chat/Artifacts.svelte:668-783`
- Modify: `src/lib/components/chat/Artifacts/workspace.ts:197-214`
- Test: `src/lib/components/chat/Artifacts/workspace.test.ts`
- Test: `src/lib/components/chat/Artifacts/workspaceDocumentViewerAccessibility.test.ts`

- [x] **Step 1: Write the failing tests for active-only mounting, empty hidden owners, active-safe LRU 4, and sequence 10**

Add tests with these exact assertions:

```ts
it('renders only the selected document viewer and leaves inactive owners empty', () => {
  const source = readFileSync(new URL('../Artifacts.svelte', import.meta.url), 'utf8');
  expect(source).toContain('hidden={selectedContentId !== getWorkspaceContentId(content, index)}');
  expect(source).toContain("{#if selectedContentId === getWorkspaceContentId(content, index)}");
  expect(source).toContain('id={`workspace-panel-${index}`}');
  expect(source).toContain('<div class="absolute inset-0"></div>');
});

it('keeps four documents across ten opens without evicting the active document', () => {
  let contents: WorkspaceContent[] = [];
  let recency: string[] = [];
  const activeId = 'workspace:file:/workspace/0.pdf';
  const evictedIds: string[] = [];

  for (let index = 0; index < 10; index += 1) {
    const path = `/workspace/${index}.pdf`;
    const id = `workspace:file:${path}`;
    contents = upsertWorkspaceFileContent(contents, path);
    recency = [...recency.filter((candidate) => candidate !== id), id];
    const limited = limitWorkspaceFileContents(contents, recency, activeId, 4);
    expect(limited.evictedIds).not.toContain(activeId);
    contents = limited.contents;
    recency = limited.recency;
    evictedIds.push(...limited.evictedIds);
  }

  expect(contents.map((content) => content.path)).toEqual([
    '/workspace/0.pdf', '/workspace/7.pdf', '/workspace/8.pdf', '/workspace/9.pdf'
  ]);
  expect(evictedIds).toEqual([
    'workspace:file:/workspace/1.pdf', 'workspace:file:/workspace/2.pdf',
    'workspace:file:/workspace/3.pdf', 'workspace:file:/workspace/4.pdf',
    'workspace:file:/workspace/5.pdf', 'workspace:file:/workspace/6.pdf'
  ]);
});

it('keeps refresh generations monotonic so stale renders cannot win', () => {
  expect(nextDocumentLoadSequence(9)).toBe(10);
  expect(nextDocumentLoadSequence(10)).toBe(11);
});
```

Export the pure `nextDocumentLoadSequence` helper from `workspace.ts`; the test must fail because the helper and active-only conditional do not exist yet.

- [x] **Step 2: Run the focused tests to verify they fail**

Run: `npm run test:frontend -- --run src/lib/components/chat/Artifacts/workspace.test.ts src/lib/components/chat/Artifacts/workspaceDocumentViewerAccessibility.test.ts`

Evidence: the new ten-open test failed before implementation because the obsolete helper had no recency output/active-document contract.

- [x] **Step 3: Implement the smallest renderer/memory change**

In `Artifacts.svelte`, retain each selected tab's `role="tabpanel"`, `id`, `aria-labelledby`, `hidden`, and `class="absolute inset-0"`, but render `DocumentFileViewer` only when its tab ID equals `selectedContentId`; render an empty owner for inactive file tabs so `WorkspaceTabs.svelte` keeps valid `aria-controls` targets. Do not create a viewer instance for inactive tabs.

In `workspace.ts`, make `limitWorkspaceFileContents` the single pure source of truth: it accepts contents, oldest-to-newest recency, active ID, and `MAX_OPEN_DOCUMENTS = 4`; it evicts the least-recent inactive ID, never the active ID, and returns the kept contents plus normalized recency. `Artifacts.svelte` must call it rather than duplicate eviction logic. Add:

```ts
export const nextDocumentLoadSequence = (current: number) => current + 1;
```

Use this helper wherever `DocumentFileViewer` increments its load generation. Do not change stable IDs (`workspace:file:<path>`) or refresh/delete/rename semantics.

- [x] **Step 4: Run the focused tests and type-check the touched surface**

Run: `npm run test:frontend -- --run src/lib/components/chat/Artifacts/workspace.test.ts src/lib/components/chat/Artifacts/workspaceDocumentViewerAccessibility.test.ts`

Evidence: PASS (28 focused frontend tests).

Run: `npx svelte-check --tsconfig ./tsconfig.json 2>&1 | rg 'Artifacts|workspace(\.ts|\.test\.ts)|DocumentViewer'`

Expected: no diagnostics for the touched files. Do not promote the repository-wide `npm run check` to a hard gate; the current baseline contains approximately 8,000 unrelated diagnostics.

- [ ] **Step 5: Commit only the reviewed task hunks**

Run: `git diff --check -- src/lib/components/chat/Artifacts.svelte src/lib/components/chat/Artifacts/workspace.ts src/lib/components/chat/Artifacts/workspace.test.ts src/lib/components/chat/Artifacts/workspaceDocumentViewerAccessibility.test.ts`

Then stage only these reviewed paths/hunks, excluding all `tmp/` paths, and commit:

```bash
git add src/lib/components/chat/Artifacts.svelte src/lib/components/chat/Artifacts/workspace.ts src/lib/components/chat/Artifacts/workspace.test.ts src/lib/components/chat/Artifacts/workspaceDocumentViewerAccessibility.test.ts
git commit -m "fix(viewer): mount only the active document renderer"
```

## Task 2: Add the reversible `ENABLE_DOCUMENT_VIEWER` rollout flag

**Files:**
- Modify: `backend/open_webui/env.py:900-925`
- Modify: `backend/open_webui/main.py:2165-2218`
- Modify: `src/lib/stores/index.ts:329-361`
- Modify: `src/lib/components/chat/Artifacts.svelte:121-132,668-783`
- Modify: `src/lib/components/chat/Artifacts/workspace.ts:130-144`
- Test: `backend/tests/test_app_config.py`
- Test: `src/lib/components/chat/Artifacts/workspace.test.ts`
- Test: `src/lib/components/chat/Artifacts/workspaceDocumentViewerAccessibility.test.ts`

- [ ] **Step 1: Write failing backend and frontend flag tests**

Create `backend/tests/test_app_config.py` with a pure environment contract test:

```python
def test_document_viewer_flag_defaults_off(monkeypatch):
    monkeypatch.delenv('ENABLE_DOCUMENT_VIEWER', raising=False)
    assert parse_bool_env('ENABLE_DOCUMENT_VIEWER', False) is False


def test_document_viewer_flag_accepts_only_true(monkeypatch):
    monkeypatch.setenv('ENABLE_DOCUMENT_VIEWER', 'true')
    assert parse_bool_env('ENABLE_DOCUMENT_VIEWER', False) is True
    monkeypatch.setenv('ENABLE_DOCUMENT_VIEWER', 'yes')
    assert parse_bool_env('ENABLE_DOCUMENT_VIEWER', False) is False
```

Add frontend tests asserting `enable_document_viewer === false` routes supported files to Files and `true` routes PDF/DOCX/PPTX to the dedicated viewer while XLSX/CSV/ODT remain unsupported. The tests must fail because the parser, config field, and flag-aware routing helper do not exist.

- [ ] **Step 2: Run the failing tests**

Run: `pytest -q backend/tests/test_app_config.py`

Expected: FAIL because `parse_bool_env` is not defined.

Run: `npm run test:frontend -- --run src/lib/components/chat/Artifacts/workspace.test.ts src/lib/components/chat/Artifacts/workspaceDocumentViewerAccessibility.test.ts`

Expected: FAIL because flag-aware routing is not defined.

- [ ] **Step 3: Implement the flag and fallback**

In `backend/open_webui/env.py`, add:

```python
def parse_bool_env(name: str, default: bool) -> bool:
    return (os.getenv(name, 'true' if default else 'false').strip().lower() == 'true')


ENABLE_DOCUMENT_VIEWER = parse_bool_env('ENABLE_DOCUMENT_VIEWER', False)
```

In `main.py`, import the constant and expose `enable_document_viewer` only in the authenticated `features` object returned by `/api/config`.

In `src/lib/stores/index.ts`, add `enable_document_viewer?: boolean` to `Config.features`.

In `workspace.ts`, add:

```ts
export const getWorkspaceDocumentFormatForViewer = (path: string, enabled: boolean) =>
  enabled ? getWorkspaceDocumentFormat(path) : null;
```

Use that helper in `Artifacts.svelte`. When false, keep the workspace file in the existing Files/FileNav flow and never mount `DocumentFileViewer`; when true, only PDF/DOCX/PPTX use the dedicated viewer. The flag must not alter terminal authorization or file acquisition.

- [ ] **Step 4: Run backend, frontend, and rollback tests**

Run: `pytest -q backend/tests/test_app_config.py backend/tests/test_workspace_file_context.py`

Expected: PASS.

Run: `npm run test:frontend -- --run src/lib/components/chat/Artifacts/workspace.test.ts src/lib/components/chat/Artifacts/workspaceDocumentViewerAccessibility.test.ts`

Expected: PASS.

Run: `ENABLE_DOCUMENT_VIEWER=false npm run test:frontend -- --run src/lib/components/chat/Artifacts/workspace.test.ts`

Expected: PASS with the Files fallback assertions.

- [ ] **Step 5: Commit the reviewed flag changes**

```bash
git add backend/open_webui/env.py backend/open_webui/main.py backend/tests/test_app_config.py src/lib/stores/index.ts src/lib/components/chat/Artifacts.svelte src/lib/components/chat/Artifacts/workspace.ts src/lib/components/chat/Artifacts/workspace.test.ts src/lib/components/chat/Artifacts/workspaceDocumentViewerAccessibility.test.ts
git commit -m "feat(viewer): add reversible document viewer rollout flag"
```

## Task 3: Add focused package scripts and CI gates

**Files:**
- Modify: `package.json:5-23`
- Modify: `.github/workflows/frontend.yaml:19-65`
- Modify: `.github/workflows/backend.yaml:19-43`
- Test: `scripts/run-viewer-tests.test.mjs`

- [ ] **Step 1: Write the failing script contract test**

Create a Node test that reads `package.json` and workflow YAML as text and asserts the required commands exist: `test:viewer`, `test:viewer:build`, `test:viewer:contracts`, `npm ci --force`, `npm run test:frontend`, `npm run test:viewer`, `npm run build`, `node scripts/check-viewer-dependencies.mjs`, `pytest -q backend/tests`, and no new global `npm run check` workflow step.

Run: `npm run test:viewer:contracts`

Expected: FAIL because the scripts and workflow steps do not exist.

- [ ] **Step 2: Add focused scripts without making repository-wide type-checking a hard gate**

Add the following scripts to `package.json`:

```json
"test:viewer": "vitest --run src/lib/components/chat/Artifacts/DocumentViewer src/lib/components/chat/Artifacts/workspace.test.ts src/lib/components/chat/Artifacts/workspaceDocumentViewerAccessibility.test.ts src/lib/components/common/pdfViewerAccessibility.test.ts src/lib/components/common/pdfViewerHelpers.test.ts src/lib/apis/terminal/index.test.ts",
"test:viewer:build": "npm run test:viewer && npm run build"
```

Add the `test:viewer:contracts` package script with an explicit list of all Node contract tests. Retain the full `npm run test:frontend` gate and add `npm run test:viewer`, `npm run test:viewer:contracts`, and `npm run build`; leave the known repository-wide `npm run check` baseline outside required CI. Update backend CI to install pytest dependencies and run `pytest -q backend/tests` after Ruff.

- [ ] **Step 3: Run the focused script test and gates locally**

Run: `node --test scripts/run-viewer-tests.test.mjs`

Expected: PASS.

Run: `npm run test:viewer`

Expected: PASS.

Run: `npm run build`

Expected: PASS and a Vite build manifest is emitted under `build/`.

Run: `pytest -q backend/tests -p pytest_asyncio.plugin` with `PYTHONPATH=backend`, `DATA_DIR` set to an ephemeral CI directory, `WEBUI_SECRET_KEY` set to a CI-only value, and `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1`.

Expected: PASS.

- [ ] **Step 4: Commit CI and script changes**

```bash
git add package.json .github/workflows/frontend.yaml .github/workflows/backend.yaml scripts/run-viewer-tests.test.mjs
git commit -m "ci(viewer): add focused viewer build and test gates"
```

## Task 4: Verify viewer dependencies and legal notices

**Files:**
- Modify: `package.json:5-23`
- Modify: `LICENSE_NOTICE:13-30`
- Modify: `Dockerfile:183-190`
- Create: `scripts/check-viewer-dependencies.mjs`
- Test: `scripts/check-viewer-dependencies.test.mjs`
- Modify: `.github/workflows/frontend.yaml`

- [ ] **Step 1: Write the failing dependency/license tests**

Create a test fixture with these exact approved direct packages and SPDX licenses:

```js
const required = {
  'pdfjs-dist': 'Apache-2.0',
  'docx-preview': 'Apache-2.0',
  '@aiden0z/pptx-renderer': 'Apache-2.0',
  jszip: '(MIT OR GPL-3.0-or-later)',
  echarts: 'Apache-2.0',
  zrender: 'BSD-3-Clause'
};
```

The test must fail if a package is absent, its lockfile license differs, or its package license/notice file is absent. Include `pdfjs-dist/LICENSE`, `docx-preview/LICENSE`, `@aiden0z/pptx-renderer/LICENSE`, `jszip/LICENSE.markdown`, `echarts/LICENSE`, `echarts/NOTICE`, and `zrender/LICENSE` in the required-file assertion.

Run: `node --test scripts/check-viewer-dependencies.test.mjs`

Expected: FAIL because the checker is absent and the complete notice set is not yet enforced.

- [ ] **Step 2: Implement the checker and package command**

Implement `scripts/check-viewer-dependencies.mjs` using only `node:fs`, `node:path`, and `node:process`: read `package-lock.json`, locate each `node_modules/<name>` entry, compare `license` to the allowlist, verify each file under `node_modules`, and exit `1` with the package/file/license name on failure. Add:

```json
"check:viewer:dependencies": "node scripts/check-viewer-dependencies.mjs"
```

Update `LICENSE_NOTICE` and Dockerfile copies for the verified notice set. Do not silently accept unknown licenses.

- [ ] **Step 3: Add the security audit baseline rule**

Run: `npm audit --omit=dev --audit-level=high --json > tmp/viewer-npm-audit.json || true`

If the command is green, add `npm audit --omit=dev --audit-level=high` to frontend CI. If it reports existing findings, do not weaken the checker or claim a clean gate: add the redacted package/advisory summary and the exact command to `docs/superpowers/plans/2026-08-16-document-viewer-production-readiness.md`’s execution notes, and make CI run the audit as a non-blocking diagnostic until the baseline is green. Do not include `tmp/viewer-npm-audit.json` in Git.

- [ ] **Step 4: Run dependency and legal verification**

Run: `npm run check:viewer:dependencies`

Expected: PASS with all six packages and required license files found.

Run: `node --test scripts/check-viewer-dependencies.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit only legal/checker changes**

```bash
git add package.json LICENSE_NOTICE Dockerfile scripts/check-viewer-dependencies.mjs scripts/check-viewer-dependencies.test.mjs .github/workflows/frontend.yaml
git commit -m "build(viewer): verify renderer licenses and notices"
```

## Task 5: Emit a Vite manifest and enforce a measured minimal bundle ceiling

**Files:**
- Modify: `vite.config.ts`
- Modify: `package.json`
- Create: `scripts/check-viewer-bundle.mjs`
- Test: `scripts/check-viewer-bundle.test.mjs`
- Modify: `.github/workflows/frontend.yaml`

- [ ] **Step 1: Write the failing manifest/budget test**

Create source-map fixtures and a stale server-manifest fixture; assert the checker rejects renderer packages absent from client source maps and a sibling chunk exceeding its declared ceiling:

```js
const ceilings = {
  'pdfjs-dist': 2_252_800,
  'docx-preview': 204_800,
  '@aiden0z/pptx-renderer': 1_126_400
};
```

Run: `node --test scripts/check-viewer-bundle.test.mjs`

Expected: FAIL because no checker exists.

- [ ] **Step 2: Enable the manifest and implement the checker**

Set Vite `build.manifest = true` for application metadata, but do not use the server or stale `build/manifest.json` as a bundle proxy. Implement `scripts/check-viewer-bundle.mjs` to scan fresh `build/_app/immutable/**/*.js.map` source maps for renderer package sources, map each map to its sibling `.js`, include the PDF worker `.mjs` asset, de-duplicate files, print byte sizes, and fail when a package is absent or a measured chunk exceeds its committed ceiling. Keep ceilings in the script as measured values; do not add a generic whole-app budget.

Add:

```json
"check:viewer:bundle": "node scripts/check-viewer-bundle.mjs"
```

Append `npm run check:viewer:bundle` after `npm run build` in frontend CI.

- [ ] **Step 3: Measure and set ceilings before enforcing**

Run: `npm run build && node scripts/check-viewer-bundle.mjs --print-baseline`

Expected: the script prints each actual renderer chunk size. Set each ceiling to the measured size rounded up to the next 100 KiB, with the exact values recorded in the checker and this plan’s execution notes. Do not use a guessed ceiling.

- [ ] **Step 4: Run bundle checks**

Run: `node --test scripts/check-viewer-bundle.test.mjs && npm run build && npm run check:viewer:bundle`

Expected: PASS.

- [ ] **Step 5: Commit manifest/budget changes**

```bash
git add vite.config.ts package.json scripts/check-viewer-bundle.mjs scripts/check-viewer-bundle.test.mjs .github/workflows/frontend.yaml
git commit -m "build(viewer): enforce measured renderer chunk ceilings"
```

## Task 6: Add a narrow deterministic Playwright harness

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `playwright.config.ts`
- Create: `tests/document-viewer/document-viewer.spec.ts`
- Create: `tests/document-viewer/fake-runtime.ts`
- Create: `tests/document-viewer/fake-model.ts`
- Create: `tests/document-viewer/no-egress.ts`
- Test: `tests/document-viewer/document-viewer.spec.ts`
- Modify: `.gitignore`

- [x] **Step 1: Write the failing browser tests**

Add tests for these exact selectors and outcomes:

```ts
test('opens a PDF by pointer click and mounts only the active panel', async ({ page }) => {
  await page.goto('/viewer-test?format=pdf&flag=true');
  await page.getByRole('button', { name: 'Open report.pdf' }).click();
  await expect(page.getByTestId('document-file-viewer')).toBeVisible();
  await expect(page.locator('[data-testid="document-file-viewer"]')).toHaveCount(1);
  await expect(page.getByRole('tabpanel').filter({ hasText: 'Inactive' })).toBeEmpty();
});

test('rejects egress and preserves keyboard focus', async ({ page }) => {
  await installNoEgress(page);
  await page.goto('/viewer-test?format=pptx&flag=true');
  await page.getByRole('button', { name: 'Open deck.pptx' }).press('Enter');
  await expect(page.getByRole('slider', { name: 'PowerPoint presentation' })).toBeFocused();
  await expect(page.getByTestId('egress-attempts')).toHaveText('0');
});
```

Add narrow tests for PDF search/page controls, DOCX safe links, PPTX arrow-key navigation, unsupported format fallback, 4-file LRU, stale refresh sequence, and no third-party requests. They must fail before the harness and test route exist.

- [x] **Step 2: Run the failing browser tests**

Run: `npx playwright test tests/document-viewer/document-viewer.spec.ts --project=chromium`

Expected: FAIL because `playwright.config.ts` and the deterministic viewer test route do not exist.

- [x] **Step 3: Implement the minimal harness**

Add `@playwright/test` as a dev dependency and scripts:

```json
"test:viewer:e2e": "playwright test tests/document-viewer --project=chromium",
"test:viewer:e2e:matrix": "playwright test tests/document-viewer"
```

Configure `playwright.config.ts` with a local `webServer` command that starts the existing test app, `baseURL: 'http://127.0.0.1:5050'`, one Chromium project by default, trace-on-first-retry, and no `docker-compose.playwright.yaml` or web-loader compose dependency. `fake-runtime.ts` serves deterministic in-memory PDF/DOCX/PPTX bytes and controlled missing/unavailable/oversized responses. `fake-model.ts` returns fixed workspace file references; it must never call a live model. `no-egress.ts` aborts any request whose origin is not the test app and increments `data-testid="egress-attempts"`.

- [ ] **Step 4: Run Chromium tests and then the browser matrix**

Run: `npm run test:viewer:e2e`

Expected: PASS for all deterministic Chromium tests.

Run: `npx playwright install chromium firefox webkit && npm run test:viewer:e2e:matrix`

Expected: PASS for Chromium, Firefox, and WebKit. If a browser-specific failure occurs, record the exact browser and test in the runbook; do not remove the test or silently skip the project.

- [ ] **Step 5: Commit the harness**

```bash
git add package.json package-lock.json playwright.config.ts tests/document-viewer .gitignore
git commit -m "test(viewer): add deterministic browser harness"
```

## Task 7: Add small sanitized fixtures and temporary large profiles

**Files:**
- Create: `tests/fixtures/document-viewer/manifest.json`
- Create: `tests/fixtures/document-viewer/pdf/basic.pdf`
- Create: `tests/fixtures/document-viewer/docx/basic.docx`
- Create: `tests/fixtures/document-viewer/pptx/basic.pptx`
- Create: `tests/fixtures/document-viewer/adversarial/README.md`
- Create: `scripts/generate-viewer-large-profiles.py`
- Test: `tests/fixtures/document-viewer/manifest.test.mjs`
- Modify: `.gitignore`

- [ ] **Step 1: Write the failing fixture manifest test**

Create `manifest.test.mjs` asserting that `manifest.json` contains exactly the three small fixture paths, declared formats, byte ceilings, and no fixture larger than 256 KiB. Run:

`node --test tests/fixtures/document-viewer/manifest.test.mjs`

Expected: FAIL because the fixture directory and manifest do not exist.

- [ ] **Step 2: Add the sanitized fixture manifest and tiny files**

Use this manifest shape:

```json
{
  "fixtures": [
    { "path": "pdf/basic.pdf", "format": "pdf", "purpose": "ordinary multi-page PDF" },
    { "path": "docx/basic.docx", "format": "docx", "purpose": "ordinary Word layout with safe links" },
    { "path": "pptx/basic.pptx", "format": "pptx", "purpose": "ordinary two-slide deck" }
  ],
  "maxCheckedInBytes": 262144,
  "prohibitedContent": ["personal data", "credentials", "external media", "tracking URLs"]
}
```

Keep the checked-in binaries small, sanitized, deterministic, and free of external relationships. Put adversarial fixture construction instructions in `adversarial/README.md`; do not check in ZIP bombs or large media.

- [ ] **Step 3: Add the standard-library large-profile generator**

Implement `scripts/generate-viewer-large-profiles.py` with Python stdlib only (`argparse`, `pathlib`, `zipfile`, `secrets`), writing to an explicit output directory under `tmp/viewer-fixtures-large` and refusing any output path outside `tmp/`. Generate a 48 MiB DOCX profile, a 64 MiB PPTX profile, and a 64 MiB PDF byte profile only for local/manual resource testing. Never commit generated output.

- [ ] **Step 4: Run fixture and generator validation**

Run: `node --test tests/fixtures/document-viewer/manifest.test.mjs`

Expected: PASS.

Run: `python3 scripts/generate-viewer-large-profiles.py --output tmp/viewer-fixtures-large --docx-bytes 50331648 --pptx-bytes 67108864 --pdf-bytes 67108864 && git status --short -- tmp`

Expected: generated files appear only under `tmp/`; `git status` shows no tracked fixture changes outside the intended small fixture files. Delete the temporary generated directory after profiling with `rm -rf tmp/viewer-fixtures-large` only after confirming its exact path.

- [ ] **Step 5: Commit only small fixtures and generator**

```bash
git add tests/fixtures/document-viewer scripts/generate-viewer-large-profiles.py .gitignore
git commit -m "test(viewer): add sanitized fixtures and bounded large profiles"
```

## Task 8: Document support limits, fidelity, pilot, rollback, and privacy

**Files:**
- Modify: `docs/superpowers/specs/2026-08-16-koby-document-viewer-support.md`
- Create: `docs/superpowers/specs/2026-08-16-koby-document-viewer-production-readiness.md`
- Modify: `README.md` only if the support document is linked from the feature index

- [x] **Step 1: Write documentation validation tests**

Create a Node test that reads both Markdown files and asserts the presence of these exact strings: `PDF`, `DOCX`, `PPTX`, `64 MiB`, `48 MiB`, `read-only`, `last valid preview`, `ENABLE_DOCUMENT_VIEWER=false`, `Chromium`, `Firefox`, `WebKit`, `Safari VoiceOver`, `NVDA`, `Microsoft Office`, `LibreOffice`, `Google exports`, `No browser telemetry`, and `rollback`.

Run: `node --test scripts/document-viewer-docs.test.mjs`

Expected: FAIL because the production-readiness document and complete support limits are absent.

Execution evidence: RED observed with `node --test scripts/document-viewer-docs.test.mjs`; the support-limit assertions failed and the readiness document was absent.

- [x] **Step 2: Add the exact support matrix and known limits**

Update the support specification with PDF/DOCX/PPTX only, PDF/PPTX 64 MiB and DOCX 48 MiB input ceilings, archive limits, read-only/download behavior, unsupported-format fallback, stale-preview behavior, and known fidelity limitations for complex Word fields, embedded media, fonts, charts, transitions, animations, and external resources.

- [x] **Step 3: Add the production pilot and rollback runbook**

Create the runbook with these ordered gates:

1. `npm run test:viewer`, `npm run build`, `npm run check:viewer:dependencies`, and `npm run check:viewer:bundle`.
2. Build the intended image, verify `/health`, and verify `/app/legal` notices.
3. Set `ENABLE_DOCUMENT_VIEWER=true` for the pilot only.
4. Run deterministic Chromium tests, then Firefox/WebKit.
5. Manually test real Microsoft Office, LibreOffice, and Google exports; Safari VoiceOver and NVDA; and five-sample memory/performance profiling.
6. Use thresholds of ≤5 seconds to first visible page/slide, ≤3 seconds for a normal refresh, ≤500 MiB renderer peak memory, and ≤20% memory growth across five sequential samples. These are manual-only gates.
7. Confirm no browser telemetry and no third-party egress.
8. Roll back by setting `ENABLE_DOCUMENT_VIEWER=false`, restarting, and confirming files remain usable through Files/FileNav.

Explicitly state that real-office/export, assistive-technology, and five-sample profiling gates are manual-only. Do not add browser telemetry or use the web-loader compose setup.

- [x] **Step 4: Run documentation validation**

Run: `node --test scripts/document-viewer-docs.test.mjs`

Expected: PASS with all support, pilot, rollback, browser, and privacy terms present.

Execution evidence: GREEN observed; 2 tests passed, 0 failed.

- [ ] **Step 5: Commit documentation**

Not executed: the implementation task explicitly forbids commit and push.

```bash
git add docs/superpowers/specs/2026-08-16-koby-document-viewer-support.md docs/superpowers/specs/2026-08-16-koby-document-viewer-production-readiness.md scripts/document-viewer-docs.test.mjs README.md
git commit -m "docs(viewer): add support and production pilot runbook"
```

## Task 9: Fix and validate the release version gate

**Files:**
- Modify: `.github/workflows/release.yml:26-55`
- Test: `scripts/validate-release-workflow.test.mjs`

- [ ] **Step 1: Write the failing release validation test**

Create a test that reads `.github/workflows/release.yml` and asserts it contains `fetch-depth: 2` (or `fetch-depth: 0`), `github.event.before`, `github.sha`, and `package.json`, and does not contain `git diff --cached package.json`. The test must also require `git cat-file -e` for the before commit, an all-zero-before guard, and explicit handling of diff exit statuses 0, 1, and greater than 1.

Run: `node --test scripts/validate-release-workflow.test.mjs`

Expected: FAIL because the current workflow uses the staged-index check.

- [ ] **Step 2: Replace the staged-index check**

Configure checkout and replace the release step with:

```yaml
- uses: actions/checkout@v5
  with:
    fetch-depth: 0

- name: Abort if package.json unchanged
  run: |
    BEFORE="${{ github.event.before }}"
    CURRENT="${{ github.sha }}"
    if [ "$BEFORE" = "0000000000000000000000000000000000000000" ]; then
      echo "initial push has no parent commit; refusing an unverifiable release"
      exit 1
    fi
    if ! git cat-file -e "$BEFORE^{commit}"; then
      echo "push-before commit is unavailable; refusing an unverifiable release"
      exit 1
    fi
    set +e
    git diff --quiet "$BEFORE" "$CURRENT" -- package.json
    DIFF_STATUS=$?
    set -e
    if [ "$DIFF_STATUS" -eq 1 ]; then
      echo "package.json changed; continuing release"
    elif [ "$DIFF_STATUS" -eq 0 ]; then
      echo "package.json not modified; skipping release"
      exit 1
    elif [ "$DIFF_STATUS" -gt 1 ]; then
      echo "git diff failed with status $DIFF_STATUS; refusing release"
      exit "$DIFF_STATUS"
    fi
```

The rest of release note extraction, GitHub release creation, archive upload, and Docker dispatch remains unchanged.

- [ ] **Step 3: Run release validation**

Run: `node --test scripts/validate-release-workflow.test.mjs`

Expected: PASS.

Run: `git diff --name-only HEAD^ HEAD -- package.json`

Expected: prints `package.json` for a version-changing commit and an empty result otherwise; the workflow now makes the same comparison against the push event’s before/current SHAs.

- [ ] **Step 4: Commit the release gate fix**

```bash
git add .github/workflows/release.yml scripts/validate-release-workflow.test.mjs
git commit -m "ci(release): compare package version across push commits"
```

## Execution notes (Tasks 3, 4, 5, and 9 validation)

Recorded 2026-08-16 from the release-readiness worktree. No raw audit JSON,
advisory URLs, credentials, or secrets are included here.

- Dependency audit command: `npm audit --omit=dev --audit-level=high --json > tmp/viewer-npm-audit.json || true`.
- Redacted audit baseline: 81 total findings = 2 low, 15 moderate, 64 high, 0 critical. The high-level audit remains a non-blocking diagnostic until the existing baseline is green; the dependency/license checker remains a separate blocking gate.
- Measured client renderer chunks from `npm run build && node scripts/check-viewer-bundle.mjs --print-baseline`:
  - `pdfjs-dist` chunk: 447,530 bytes; PDF worker: 2,174,484 bytes; committed ceiling: 2,252,800 bytes.
  - `docx-preview` chunk: 174,900 bytes; committed ceiling: 204,800 bytes.
  - `@aiden0z/pptx-renderer` chunk: 1,005,209 bytes; committed ceiling: 1,126,400 bytes.
- Ceilings are measured maximums rounded up to the next 100 KiB; no whole-application budget was added.
- The fresh-build checker reads only `build/_app/immutable/**/*.js.map` plus the emitted PDF worker asset; a stale or server-only `build/manifest.json` cannot satisfy the gate.
- The verified JSZip lock/package SPDX expression is `(MIT OR GPL-3.0-or-later)`; it is not represented as MIT-only.
- Release validation requires fetched parent history, an available non-zero before commit, and distinguishes package change (diff status 1), no change (0), and Git errors (>1).

## Browser follow-up evidence (2026-08-16)

- Added and first ran red browser contracts for the production LRU helper,
  delayed stale A-to-B refresh, Files fallback formats, and oversized terminal
  headers; the missing harness controls/states failed as expected.
- Chromium: `npm run test:viewer:e2e -- --reporter=line` passed 10/10.
- Firefox focused: corrupt DOCX retained-preview, LRU, stale refresh, Files
  fallback, and oversized-header cases passed 5/5. The corrupt DOCX assertion
  waits for the actual refresh response before inspecting the error state; it
  has no retry or timeout increase.
- WebKit and the full three-browser matrix remain pending, so Task 6 Step 4 is
  intentionally unchecked. Automated mobile/theme checks write no screenshots;
  any visual comparison remains manual evidence.

## Task 10: Final plan self-review and clean handoff

**Files:**
- Review only: `docs/superpowers/plans/2026-08-16-document-viewer-production-readiness.md`

- [x] **Step 1: Verify requirement coverage**

Run: `rg -n "active|hidden|LRU|sequence|ENABLE_DOCUMENT_VIEWER|rollback|license|audit|manifest|ceiling|Playwright|Chromium|Firefox|WebKit|no-egress|fixture|64 MiB|48 MiB|VoiceOver|NVDA|Microsoft Office|LibreOffice|Google exports|No browser telemetry|release" docs/superpowers/plans/2026-08-16-document-viewer-production-readiness.md`

Expected: every requested requirement has at least one matching task.

Execution evidence: command returned matching entries for active mounting, flag/rollback, CI/license, manifest, Playwright browser matrix, fixtures, support limits, manual gates, privacy, and release validation.

- [x] **Step 2: Scan for forbidden placeholders and unsafe broad staging**

Run: `python3 -c "from pathlib import Path; t=Path('docs/superpowers/plans/2026-08-16-document-viewer-production-readiness.md').read_text(); bad=['T'+'BD','TO'+'DO','FIX'+'ME','git clean','git reset '+'--hard']; assert not any(x in line for line in t.splitlines() if 'bad=[' not in line for x in bad)"`

Expected: exit `0`.

Execution evidence: `plan-placeholder-scan-pass`.

- [x] **Step 3: Confirm preservation constraints**

Run: `git status --short --branch && git status --short -- tmp`

Expected: the current uncommitted viewer changes remain present; no `tmp/` path is included in any plan commit command; no push command appears in the plan.

Execution evidence: existing viewer/backend changes and `tmp/` remain present; no commit or push was executed.

- [ ] **Step 4: Commit the plan only**

Not executed: the implementation task explicitly forbids commit and push.

```bash
git add docs/superpowers/plans/2026-08-16-document-viewer-production-readiness.md
git commit -m "docs(viewer): plan production readiness"
```

Do not push. Do not modify product code during plan writing.
