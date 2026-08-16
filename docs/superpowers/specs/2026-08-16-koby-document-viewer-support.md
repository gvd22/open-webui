# KOBY document viewer support

Status: current implementation boundary

The dedicated, read-only document tab is intentionally limited to the following
formats:

| Format               | Dedicated tab | Behaviour              |
| -------------------- | ------------- | ---------------------- |
| PDF (`.pdf`)         | Yes           | PDF viewer             |
| Word (`.docx`)       | Yes           | Paginated Word preview |
| PowerPoint (`.pptx`) | Yes           | Slide preview          |

No other format is presented as supported by this viewer. In particular, this
does **not** include Excel (`.xlsx`, `.xls`), CSV, OpenDocument (`.odt`, `.ods`,
`.odp`), or legacy Word/PowerPoint (`.doc`, `.ppt`). Selecting one of these
files stays in Files and uses its existing preview or download path; it does not
open an empty or misleading document tab.

This boundary is about preview rendering only. A runtime may still create or
modify files through its separately governed Python or terminal capabilities.
Adding another dedicated format requires its own renderer, security review,
large-file acceptance checks, and explicit support-table update.

## Current resource limits

These are implementation limits, not guarantees that every file below the
limit will render successfully:

| Format | Input limit | Additional renderer limits |
| --- | ---: | --- |
| PDF | 64 MiB | Maximum 1,000 pages; text search indexes at most 24,000,000 text-index bytes; each canvas is capped at 24,000,000 canvas pixels; maximum 4x zoom. |
| DOCX | 48 MiB | Maximum 1,500 archive entries; each entry is at most 16 MiB; total archive expansion is capped at 96 MiB uncompressed; media is at most 64 MiB; compression ratio is at most 120:1. |
| PPTX | 64 MiB | Maximum 1,500 archive entries; each uncompressed entry is at most 16 MiB; total archive expansion is capped at 96 MiB uncompressed; media is at most 64 MiB; slide media work is limited to four concurrent operations. |

The input limit is enforced while acquiring runtime files. The archive and
render limits are checked before DOCX/PPTX rendering. A limit failure is shown
as a non-sensitive error and does not initiate an external fetch.

## Read-only and version behavior

The dedicated tab is read-only. It supports navigation appropriate to the
format, PDF search and zoom, fullscreen, and download of the displayed byte
version. It does not provide Word or PowerPoint editing controls.

When a file changes, the new bytes become a candidate. The candidate replaces
the visible preview only after the renderer confirms a successful render. If a
refresh, renderer, or runtime request fails, the last valid preview remains
visible and the user receives a retryable status. A deleted or renamed file
does not retain a misleading download target.

## Fidelity and security boundaries

The renderers are browser previews, not Microsoft Office compatibility engines.
Complex Word fields, uncommon fonts, tracked changes, embedded media, charts,
PowerPoint transitions, animations, unsupported media, and layout dependent on
Office-specific behavior may differ from the source application. External
PowerPoint resources are rejected; ordinary document hyperlinks may remain
clickable after link hardening. No document format is silently converted into
an editable representation.

The security checks reject malformed archives, excessive expansion, excessive
media, and unsafe external relationships. Sanitized links are limited to
fragments and the explicitly supported `http`, `https`, `mailto`, and `tel`
protocols. This is a preview boundary; runtime code that creates or modifies a
file remains governed by the separately authorized Python or terminal runtime.

## Fallback and unsupported formats

Excel (`.xlsx`, `.xls`), CSV, OpenDocument (`.odt`, `.ods`, `.odp`), and legacy
Word/PowerPoint (`.doc`, `.ppt`) remain in Files/FileNav and use its existing
preview or download behavior. They must not open a blank dedicated tab. If the
document viewer feature flag is disabled, PDF/DOCX/PPTX also remain in the
Files/FileNav path.

The automated browser harness verifies the shared Terminal/Pyodide file-open
decision seam for these unsupported extensions. It does not mount the complete
FileNav or PyodideFileNav interfaces; their directory listing, preview, and
download flows remain a manual integration check.
