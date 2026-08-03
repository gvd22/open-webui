# KOBY Canvas Renderer Integration

Status: first working slice
Base: Open WebUI `v0.11.0`

## Scope

This slice adds the first visible KOBY Canvas renderer inside the existing Open WebUI artifact side panel. That panel is treated as the first implementation seam for a persistent right-hand Workspace: chat stays on the left, one focused work surface stays on the right.

It intentionally does not add a dashboard, workspace navigation, Files/Pyodide renderers, Terminal renderers, or connector renderers for Jira, Confluence, or Bitbucket.

## User-facing behavior

The chat remains primary. When an assistant tool call creates, updates, or selects a Canvas document, the chat shows the assistant prose before the Canvas, the Canvas document at the tool-output position, and any assistant prose after it in the same message flow. The Canvas preview has an explicit edit affordance.

Canvas is transient by default. A Canvas document stays part of the chat until the user explicitly chooses `Zu Notizen hinzufügen`. Only that action creates or links a visible Note. Before that action, deleting the chat deletes the transient Canvas with it. After that action, the Note is independent from the chat and remains available even if the chat is deleted.

After a Canvas has been added to Notes, the right-side editor switches to the existing Notes editor for the new note ID. Further edits in that right-side editor use the normal Notes save lifecycle and update the saved Note. The chat card remains the original assistant output snapshot; it is the audit trail of what the assistant produced, not a live mirror of later manual Note edits.

The Canvas editor does not take over the full screen. The intended layout is side by side: conversation on the left, one persistent Workspace page on the right. Canvas is the first page in that Workspace; Files/Pyodide, Terminal, and connector pages should later plug into the same right-side surface without changing the chat layout.

The visible UI uses Notes-style document behavior: generated title, document metadata, rich Markdown editing controls, word/character metadata, and, once saved to Notes, the Notes persistence lifecycle. No technical implementation terms are shown in the Canvas UI. Canvas audio/read-aloud controls are not shown.

## Assistant output contract

Canvas creation and selection must be tool-backed. Fenced code blocks are not a Canvas creation or selection mechanism.

Preferred tool output contract:

```json
{
  "type": "canvas.document",
  "action": "create",
  "canvasId": "stable-transient-canvas-id",
  "content": {
    "md": "Editable markdown text",
    "html": "<p>Optional rendered HTML</p>"
  },
  "proposal": "Optional suggested replacement or patch text"
}
```

Open WebUI recognizes this JSON when it is returned by a `function_call_output`. `canvasId` is the transient chat-local identity. `noteId` is optional and means the Canvas is already linked to a saved Note. The UI derives the visible title from the document content rather than trusting a static tool title.

A Canvas-capable model registers these focused tools through the Open WebUI built-in tool registry:

- `canvas_create_document`
- `canvas_update_document`
- `canvas_select_document`
- `canvas_list_documents`

The tools store transient documents in the owning chat under a private Canvas state key. They return `canvas.document` payloads for create, update, and select; listing returns document identities only. Canvas capability is enabled per model, so models that do not opt in do not receive these tools. The model should call these tools instead of emitting Canvas fences or artifact markers.

## Integration seam

The implementation reuses the existing artifact path:

- `src/lib/components/chat/Chat.svelte` extracts tool-returned `canvas.document` payloads from `function_call_output` via `Artifacts/canvas.ts` and pushes `{ type: 'canvas-note', title, content, proposal, canvasId, noteId, source: 'tool' }` into `artifactContents`.
- `src/lib/components/chat/Messages/StructuredOutputRenderer.svelte` renders Canvas at the tool-output position so assistant prose before and after the Canvas stays in order.
- `src/lib/components/chat/Messages/CanvasPreview.svelte` renders the card and selects the exact `canvasId` or linked `noteId` in the right panel when `Bearbeiten` is clicked.
- `src/lib/components/chat/Artifacts.svelte` keeps the existing right-side panel as the Workspace container and delegates `canvas-note` items to a Notes-backed renderer.
- `src/lib/components/chat/Artifacts/NoteCanvas.svelte` embeds either a transient Canvas editor or the existing Notes editor when a note ID exists.
- `src/lib/components/notes/NoteEditor.svelte` exposes a small `canvas` embed mode that keeps Notes editor/save behavior while hiding page-only Notes chat and workspace controls.
- `src/lib/components/chat/Artifacts/canvas.ts` owns the tool-output recognizer and Notes persistence adapter.
- `backend/open_webui/tools/builtin.py` owns the chat-scoped Canvas document lifecycle. `backend/open_webui/utils/tools.py` registers the four Canvas functions only for Canvas-capable models in saved chats.

This keeps the future Workspace foundation modular without creating a second side-panel system.

## Future renderers

Later renderers should plug into the same artifact item shape and side-panel path:

- Files/Pyodide outputs
- Terminal outputs
- Jira issue review
- Confluence draft review
- Bitbucket pull request review

Those renderers are out of scope for this first slice.
