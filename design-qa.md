# Document viewer design QA

Reference: user-provided simplified PowerPoint viewer screenshot.

Implementation capture: `design-qa-ppt.png` at 1424 x 800.

## Comparison

- The reference and implementation were inspected together in the same comparison input.
- The implementation intentionally keeps KOBY's existing split chat/workspace layout while carrying over the reference's calm, centered slide, restrained dark chrome, floating navigation pill, download control and fullscreen control.
- The slide remains the dominant object and no editing or thumbnail chrome is introduced.
- Word renders as a clean paper surface with explicit page boundaries, tables and web-safe list bullets.
- PDF keeps the same quiet document surface with scrolling and zoom controls.

## Iterations

- P1: A document preview could consume the final click when switching tabs. Fixed by selecting tabs on pointer down.
- P2: Word list bullets used a missing Symbol font and appeared as squares. Fixed by mapping the generated marker to a web-safe bullet.
- P1: Reloading inside a child directory hid the workspace root and trapped navigation. Fixed by retaining a clickable `Files` root breadcrumb.
- P1: Stale DOCX/PPTX renders and offscreen PDF renders could outlive newer work. Fixed with generation guards, candidate renderers and per-page task tokens.
- Security: An adversarial DOCX with an AltChunk and a `javascript:` hyperlink produced no iframe, executable link or script side effect.
- Resource QA: Terminal reads are stream-bounded; Pyodide checks size before read; PDF canvases are viewport-virtualized; open document tabs are capped at four.
- No remaining P0, P1 or P2 visual issues were found in the final browser pass.

## Final result

passed
