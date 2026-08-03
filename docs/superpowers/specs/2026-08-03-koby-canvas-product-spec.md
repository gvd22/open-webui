# KOBY Canvas Product Specification

Status: product baseline

Audience: KOBY/Open WebUI product, design, and implementation teams

## 1. Product intent

Canvas turns a chat answer into a focused, editable work result. The user stays
in one conversation: chat explains and directs the work; a persistent right-hand
work surface is where the resulting document is read and edited.

Canvas is the first renderer in a future extensible work surface. It must feel
like a natural continuation of chat, not like a dashboard, a separate workspace,
or a developer tool.

The user-facing product vocabulary is deliberately small:

- Chat
- document
- Notes
- edit

Terms such as Canvas mode, artifact, renderer, tool call, MCP, Pyodide, or
workspace are implementation concepts and must not be required to understand
the interface.

## 2. Experience principles

1. **Chat remains primary.** A user can continue talking normally before,
   during, and after editing a document.
2. **One focused work surface.** On desktop, the work surface is a persistent
   pane to the right of chat. It never takes over the whole screen.
3. **Direct editing first.** Documents are ordinary editable Markdown, using the
   established Notes editor rather than a second editor implementation.
4. **Quiet, document-first UI.** The document and its title are the identity.
   Do not add generic frames such as “Workspace”, “Artifact”, or “Draft”.
5. **Tools are reliable plumbing, not visible product UI.** Tool execution is
   visible only as a compact status row consistent with other Open WebUI tool
   calls.
6. **The user decides what becomes durable.** A Canvas document is temporary
   until it is explicitly added to Notes.

## 3. Core layout and navigation

### 3.1 Desktop layout

- The chat remains on the left.
- The right pane appears when a document is opened or when the assistant creates
  a new Canvas document in a saved desktop chat.
- The right pane contains one active work result at a time.
- Opening or switching an already-open document must not collapse and rebuild
  the pane, change the chat scroll position, or cause vertical layout jumps.
- Closing the pane returns the chat to its normal width. It does not delete any
  transient document.

### 3.2 Work-surface tabs

- A tab strip is always visible whenever the right pane is open, including when
  it currently contains one document. This makes the navigation stable as more
  work-result types are added.
- Each tab has an icon, an automatically generated or user-edited title, and a
  close control with an accessible `Close <title>` label.
- Closing a tab hides that item for the current session only. It does not delete
  the Canvas document, its Note, or chat history.
- Closing the active tab selects the adjacent remaining tab. Closing the final
  tab closes the right pane.
- A closed item can be reopened from its compact chat card.

The same tab contract will later host files, rendered HTML/images generated in
the browser, terminal sessions, Jira issues, Confluence pages, and Bitbucket
pull requests. These future types are not part of the first Canvas delivery.

### 3.3 Responsive behavior

- On small screens, the work surface opens as the existing full-height drawer.
- The document remains editable; no desktop-only feature may be required to
  complete text work.

## 4. Chat behavior

### 4.1 Canvas creation and preview

- The assistant may create a Canvas document only through an explicit Canvas
  tool result. Fenced code blocks, special Markdown markers, and text parsing
  must never create or select a document.
- The assistant’s prose before and after a Canvas tool result stays in the same
  message and in the original order.
- The first creation of each document has exactly one compact document card in
  chat. It shows a document icon, title, and a clear edit affordance.
- When the right pane is closed, that card expands to a readable Notes-style
  Markdown preview with one right-aligned `Edit` action.
- When the right pane is open, the card is compact. It must not repeat the full
  document body in chat.
- Later assistant updates to the same document never create another document
  card. They update the existing document and add only one compact activity row
  at the appropriate response position.
- Different documents retain their own card. A chat may therefore show one card
  per document, never one card per revision.

### 4.2 Canvas activity rows

Canvas activity must visually follow the standard Open WebUI completed-tool
pattern:

- success icon and neutral, readable text;
- one sentence such as `Canvas updated: Day Trip to Bern`;
- no bespoke green panel, badge, toast, animation, or different color system;
- no chevron, because the row opens a document rather than expanding a tool
  payload;
- clicking the row selects and opens that document without scrolling the chat.

While an update is executing, reuse the standard tool-call progress treatment.
On completion, the right editor refreshes to the new content. A subtle local
content transition is acceptable only when it does not duplicate text, change
the document layout, or compete with the normal tool-call progress signal.

### 4.3 Continuing work with the assistant

- A normal follow-up message can continue the currently focused document. No
  special mode or separate input is needed.
- Selecting a document in the right pane makes it the active document for the
  next assistant request.
- The assistant may create another document only when the user asks for a new
  or separate result. A request to continue, expand, shorten, rewrite, correct,
  or add to the focused document updates that same document.
- A request naming a different document selects that document and updates it.
- If no document is active and the request is ambiguous, the assistant asks a
  concise clarifying question instead of changing an arbitrary document.

## 5. Document editing and titles

### 5.1 Editor

- Canvas uses the existing Notes Markdown editor, toolbar, rendering, word and
  character metadata, and save behavior. Canvas must not introduce a parallel
  editor.
- The right-pane header is minimal: editable title, subtle saved state, and
  only actions needed in context.
- Read-aloud, download/export, access controls, and a separate “generate with
  AI” button are not part of the Canvas editor. The normal chat is the place to
  ask the assistant for changes.

### 5.2 Titles

- Every new document gets an automatic content-derived title. Static placeholders
  such as `Project Note` are not acceptable.
- Prefer a meaningful Markdown heading. If none exists, derive a concise title
  from the document content.
- The title is editable directly in the document header.
- A manual title is preserved across later content updates. The assistant may
  rename a manually titled document only when the user explicitly asks for it.
- Title changes persist with the document and appear consistently in the tab,
  chat card, activity rows, and Notes when linked.

## 6. Transient and Notes lifecycle

### 6.1 Before saving to Notes

- A newly created Canvas document belongs to its saved chat and is not visible
  in Notes.
- It persists across reloads of that chat.
- Deleting the chat deletes its transient Canvas documents.
- The title, Markdown, active selection, and stable document identity are saved
  in the chat-scoped Canvas state.

### 6.2 Explicit promotion to Notes

- `Add to Notes` is the only action that creates or links a durable Note.
- Promotion is explicit and applies only to the currently selected Canvas
  document.
- The UI confirms success by changing the action/state in the editor. No other
  transient document is promoted implicitly.
- Repeating promotion for the same document reuses its existing Note rather
  than creating a duplicate.

### 6.3 After saving to Notes

- The linked Note becomes the durable document record. Its normal Notes editor
  and save lifecycle remain authoritative.
- Edits made in the right pane write to the linked Note and update the
  chat-scoped Canvas state so the assistant always receives current content.
- Assistant Canvas updates write to the same linked Note and update the active
  Canvas view. A user-edited title remains user-controlled.
- The compact chat card is an immutable record of the assistant result at that
  moment. It is not silently rewritten after manual edits.
- Deleting the source chat removes the transient Canvas reference but leaves the
  saved Note intact and editable from Notes.

## 7. Assistant tool contract and context

### 7.1 Required tools

The model receives these focused, backend-registered tools in Canvas-capable
saved chats:

- `canvas_create_document`
- `canvas_update_document`
- `canvas_select_document`
- `canvas_list_documents`

Create, update, and select return a typed `canvas.document` result containing
at least a stable `canvasId`, title, and complete Markdown content. List returns
the available identities and titles. The frontend chooses the Canvas renderer
only for this typed tool output.

### 7.2 Model awareness

For every normal assistant request in a Canvas-enabled saved chat, the backend
adds trusted, request-only context containing:

1. a catalog of all Canvas documents in that chat with stable IDs and titles;
2. the complete current Markdown and title of the user’s active document, when
   one is selected; and
3. the instruction to update that ID for ordinary continuation requests.

Selection in the right pane and from a chat card updates the server-side active
document before the next request. The model must never rely on an old card,
browser-local selection, or assistant prose to infer the current document.

### 7.3 Capacity and errors

- Warn after 10 transient documents in one chat.
- Reject creation after 15 transient documents. Existing documents remain
  selectable, editable, and promotable to Notes.
- An unknown document ID, an unsaved chat, or an ambiguous no-active-document
  request returns a clear user-facing action or error and must not crash the
  chat or replace another document.

## 8. Implementation boundary

Canvas must remain modular and upstream-friendly:

- existing Notes components and persistence are reused rather than copied;
- chat integration is limited to typed Canvas tool-output dispatch, transient
  state hydration, and active-document selection;
- transient Canvas state belongs to the chat and is owner-scoped on the backend;
- the future work surface shares a small item contract: type, stable ID, title,
  content/reference, and optional persistence link;
- Pyodide, files, terminal, and connector renderers plug into this contract but
  do not change the chat layout or the Canvas document contract.

For connector-specific UIs, an MCP App or other embedded UI may provide a
specialized renderer, but KOBY still presents it as the actual object (for
example, a Jira issue or Confluence page), keeps approval and permissions under
KOBY control, and uses the same tab/navigation behavior.

## 9. Acceptance criteria

The Canvas slice is acceptable when a live authenticated browser flow proves:

1. A normal chat creates two distinct transient documents through actual tool
   calls, each with an automatic editable title and exactly one chat card.
2. Selecting either card or tab opens the correct right-pane document without a
   vertical chat jump.
3. Direct title/content edits remain isolated after reload.
4. Ordinary follow-up requests update the focused document, then a specifically
   named second document, through `canvas_update_document` without duplicates.
5. Assistant prose before and after tool output remains in message order.
6. The right pane’s tabs are always present, individual tabs close correctly,
   and reopening from chat restores the document.
7. Only the selected document is added to Notes; it remains after chat deletion,
   while unsaved sibling documents do not.
8. Edits after promotion and assistant updates keep the linked Note and active
   Canvas content in sync while leaving the original chat card unchanged.
9. Activity rows use the same visual language as regular completed tool calls
   and do not create a new color scheme, chevron, or disruptive animation.
