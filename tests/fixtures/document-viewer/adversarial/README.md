# Adversarial document-viewer cases

The checked-in fixtures are ordinary, deterministic, and intentionally small.
Security and limit testing should construct adversarial inputs in a temporary
directory at test time and remove them afterwards. Do not commit ZIP bombs,
oversized media, malformed cross-reference tables, files with path traversal
entries, or documents containing personal data.

Recommended cases include truncated PDFs, PDFs with excessive page counts,
DOCX/PPTX archives with duplicate names or expansion ratios above the renderer
limit, external relationships using unsupported protocols, and archive entries
whose names contain `..` or absolute paths. These cases are expected to be
rejected before rendering and must never trigger a network request.
