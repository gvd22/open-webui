# KOBY document viewer production readiness

Status: pilot preparation; manual evidence is not yet recorded here and no
production rollout is approved by this document.

## Release scope

The release scope is the read-only PDF, DOCX, PPTX, XLS, and XLSX workspace viewer. The
support boundary and exact implementation limits are defined in
`2026-08-16-koby-document-viewer-support.md`. The viewer is not an Office editor.

## Required automated gates

Run these gates against the exact release commit and retain their output with
the release evidence:

```text
npm run test:viewer
npm run build
npm run check:viewer:dependencies
npm run check:viewer:bundle
node --test scripts/document-viewer-docs.test.mjs
pytest -q backend/tests
```

The repository-wide `npm run check` is not a new hard gate for this feature;
the current baseline contains unrelated legacy diagnostics. The focused viewer
tests and production build are the required frontend checks.

The dependency/license gate must cover `pdfjs-dist`, `docx-preview`, `jszip`, and `xlsx`, including their
resolved lockfile licenses and distributed license/notice files. `npm audit
--omit=dev --audit-level=high` is blocking only when the existing baseline is
green. If the baseline is not green, retain the redacted advisory output and
run the audit as a documented non-blocking diagnostic; do not claim a clean
security gate.

## Feature flag, pilot, and rollback

The backend environment variable is `ENABLE_DOCUMENT_VIEWER`. It defaults to
`false`, so an ordinary deployment continues to use Files/FileNav. For a pilot,
Build the intended image before enabling the pilot. The release operator must
complete these checks in order:

1. Build the intended image from the exact release commit.
2. verify `/health` is healthy for that image.
3. verify `/app/legal` notices are present in that image.

Only after those checks pass, set `ENABLE_DOCUMENT_VIEWER=true`, restart the
application, and verify that the authenticated `/api/config` response exposes
the matching frontend feature.

Rollback is deliberately configuration-only:

```text
ENABLE_DOCUMENT_VIEWER=false
```

Restart or redeploy the same image, reopen a PDF/DOCX/PPTX from Files, and
confirm that the existing Files/FileNav preview or download path remains usable.
Do not remove renderer packages as part of rollback. Record the flag value,
image digest, restart time, and fallback result in the release evidence.

## Browser and manual pilot gates

The deterministic Playwright harness runs first on Chromium and then on
Firefox/WebKit. It must use the fake runtime/model, sanitized fixtures, a local
test server, and a no-egress request guard. It must not use
`docker-compose.playwright.yaml` or the web-loader compose setup.

Automated browser evidence must cover pointer and keyboard opening, active-only
mounting, hidden inactive panel owners, stable workspace IDs, the active-safe
four-document LRU sequence, stale refresh ordering and displayed-download
version, unsupported-format fallback,
PDF navigation/zoom without an in-viewer search control, DOCX safe links, PPTX slide navigation, malformed or
oversized terminal header rejection before allocation, missing/unavailable runtime responses, and the
absence of third-party requests.

The automated mobile/light/dark check is structural only and does not write
screenshots. Screenshots and visual comparison are manual evidence only: no
approved Linux image baseline is checked in or compared. Creating that baseline
remains pending a named reviewer on Linux; macOS output must not be committed as
a substitute.

The focused browser harness uses the production `WorkspaceTabs` and
`WorkspaceDocumentPanels` components with real sanitized runtime files. It does
not mount `FileNav` or `PyodideFileNav`: those navigators require their full
runtime/listing contracts and are already integrated by `Artifacts.svelte` via
the shared `onOpenFile` callback. The harness visibly states the existing Files
fallback boundary for `.xlsx`, `.xls`, `.csv`, `.odt`, `.ods`, `.odp`, `.doc`,
and `.ppt`, while exercising the production format gate. A full Files
navigation browser flow remains a separate integration test gap.

These gates remain manual-only and must not be represented as passed until a
named reviewer records evidence:

- Real exports from Microsoft Office, LibreOffice, and Google applications.
- Safari VoiceOver and NVDA keyboard/focus review.
- Five-sample memory and performance profiling using representative files.

### Format-specific profiling thresholds

Each format requires five sequential samples, with the same browser profile and
the same sanitized or approved pilot file class. These are pilot acceptance
thresholds, not claims about the renderer for every document:

All formats: normal refresh <= 3 seconds.

| Format | First visible result                 | Repeat interaction                               | Peak renderer memory                 | Five-sample stability                                                                                                                                           |
| ------ | ------------------------------------ | ------------------------------------------------ | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PDF    | PDF: first visible page <= 5 seconds | next page visible <= 2 seconds after selection   | PDF peak renderer memory <= 500 MiB  | no more than 20% peak-memory growth; retain the 24,000,000 canvas-pixel, 1,000-page, and 4x-zoom implementation limits                                          |
| DOCX   | DOCX: complete preview <= 5 seconds  | retry or refresh <= 3 seconds after bytes arrive | DOCX peak renderer memory <= 400 MiB | no more than 20% peak-memory growth; remain within the 48 MiB input, 1,500-entry, 96 MiB uncompressed, 64 MiB media, and 120:1 compression-ratio limits         |
| PPTX   | PPTX: first slide <= 5 seconds       | next slide visible <= 2 seconds after selection  | PPTX peak renderer memory <= 500 MiB | no more than 20% peak-memory growth; remain within the 64 MiB input, 1,500-entry, 96 MiB uncompressed, 64 MiB media, and four-concurrent-media-operation limits |

Record cold-load and warm-refresh measurements separately. A failed sample,
browser crash, visible egress request, content/path-bearing log, or limit
violation is a failed manual gate requiring triage before pilot approval.

## Privacy-safe observability

There is no browser telemetry for this feature. Do not add analytics, Sentry,
PostHog, or a new browser exporter. Existing opt-in backend OpenTelemetry may
remain enabled by deployment policy, but viewer work must not add document
content, filename, workspace path, URL query, user prompt, or file bytes as
attributes or log fields. No document content or path logging is permitted in
browser console, application logs, traces, or metrics; verify this explicitly.

The no-egress browser test must reject requests outside the local test origin.
The manual pilot review must inspect the browser network panel and confirm that
only the expected local application/runtime file requests occur.

## Evidence and sign-off

The release record must contain these fields and links:

```text
Release owner:
Security/legal owner:
QA owner:
Pilot environment:
Image digest:
Feature flag value:
Automated test run links:
License/notice evidence links:
Bundle manifest and ceiling evidence links:
Playwright Chromium evidence links:
Playwright Firefox evidence links:
Playwright WebKit evidence links:
Microsoft Office evidence links:
LibreOffice evidence links:
Google exports evidence links:
Safari VoiceOver evidence links:
NVDA evidence links:
Five-sample PDF profiling evidence:
Five-sample DOCX profiling evidence:
Five-sample PPTX profiling evidence:
Privacy/no-egress evidence:
Rollback command and timestamp:
Rollback verified:
Decision:
Known deviations and follow-up:
```

No manual evidence has passed merely because these fields exist. A release
decision is valid only after the named owners attach evidence or explicitly
record a rejected pilot.
