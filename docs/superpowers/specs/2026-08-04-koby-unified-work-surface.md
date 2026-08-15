# KOBY Unified Work Surface Specification

Status: approved product direction

Audience: KOBY/Open WebUI product, design, and implementation teams

## 1. Product decision

KOBY has one conversation and one adjacent work surface. The work surface is not
a mode picker and does not expose implementation concepts. It is a stable place
for the concrete objects produced or used during the conversation.

The document, file, and terminal mockups are therefore not alternative designs.
They are three active states of the same system. Future Jira, Confluence, and
Bitbucket objects use that system without introducing another side panel.

## 2. Layout

- Chat remains on the left and is always usable.
- The work surface opens on the right and never becomes a desktop full-screen
  editor.
- The split is resizable and remembers the user's preferred width.
- Opening or switching an item must not move the chat scroll position.
- Model controls and conversation overview are settings/navigation. They are not
  work-surface items and must not appear as document tabs.
- Browser is a local-app preview backed by the configured managed Terminal. It
  is available only when that Terminal integration is enabled.

## 3. Stable tab rail

The tab rail is the permanent navigation of the open work surface.

- It is visible whenever the work surface is open, including with one item.
- Each tab represents an actual object or useful working context, not a product
  mode.
- A tab has a type icon, human title, active state, and accessible close action.
- Documents use their generated or edited title.
- Files uses the stable title `Files`.
- Each terminal session is a normal work-surface tab. Multiple terminal tabs
  may be open at once.
- Future connector tabs use object identities such as `KOBY-142` or a
  Confluence page title.
- Tabs scroll horizontally when space is limited. They do not wrap or resize the
  content area.
- Closing a tab hides its renderer but never deletes the underlying object,
  document, file, session, or chat record.
- Closing the active tab selects the nearest remaining tab. Closing the final tab
  closes the work surface.
- Reopening an object from chat, file activity, or another product affordance
  restores its tab and focuses it.

## 4. Object behavior

### 4.1 Document

The existing Canvas contract remains authoritative. The document uses the Notes
editor, supports direct editing and focused AI selection, and keeps its existing
transient/Notes lifecycle. Only the first creation produces a compact document
card in chat; later AI edits produce activity rows.

### 4.2 Files

Files is the browse-and-preview surface for the currently active execution
environment. It reuses the managed Terminal file navigator when a managed
Terminal is configured. Otherwise, it uses Pyodide when the code interpreter is
enabled for the chat.
Only one Files navigator may be open. Opening a file creates or focuses a
separate file-object tab appended to the tab rail. HTML, image, PDF, Markdown,
CSV, and office renderers use that file tab and do not replace the Files
navigator.

### 4.3 Terminal

Terminal is a full right-hand work-surface page and is never nested below Files.

- Starting a terminal creates and focuses a normal terminal tab.
- Multiple simultaneous sessions are allowed, including sessions for the same
  managed connection.
- Selecting a session changes only the active work-surface tab.
- Closing a terminal tab hides its session without changing other tabs.
- Later terminal output stays in its current session and does not steal focus.
- Direct user-configured Terminal connections are not part of this product.
  Administrators provide managed Terminal connections centrally.

When a managed Terminal is configured, it is authoritative for Files, shell,
and local-app ports. An unavailable Terminal shows an error in its renderer and
does not silently fall back to Pyodide. Pyodide is selected only when no managed
Terminal is configured and the chat has code interpreter enabled.

### 4.4 Browser

Browser lists local web apps exposed through ports of the managed Terminal. It
is unavailable without a managed Terminal. A stopped or unreachable service
shows a clear retry state instead of pretending that no ports are open.

### 4.5 Web Preview

Web Preview is a chat-bound browser-native HTML, CSS, and JavaScript object. It
does not require Terminal or Pyodide. It has a compact chat card and a dedicated
work-surface tab with preview and code views. Exporting to Files is explicit and
uses the authoritative runtime; later edits are not synchronized automatically.

### 4.6 Connector objects

Jira issues, Confluence pages, and Bitbucket pull requests register object tabs
only after a typed MCP tool result identifies the concrete object. They are not
permanent tabs and do not appear in a generic launcher before such a result
exists. Repeated results for the same stable object ID update the existing tab
instead of creating duplicates. Connector approval and external writes remain
governed by KOBY and are not implied by opening a tab.

## 5. Automatic focus rules

- A newly created document may open the work surface and focus that document.
- A document update refreshes its renderer but does not steal focus from another
  active tab.
- A display-file event opens or restores the matching file-object tab and keeps
  the single Files navigator available independently.
- Selecting a terminal opens or restores its work-surface tab without forcing
  Files open.
- Subsequent terminal output updates that tab without stealing focus from
  another item.
- Creating a Web Preview may open it once. Later updates refresh it without
  reopening a tab the user deliberately closed.
- A new MCP-created Jira, Confluence, or Bitbucket object may open and focus its
  new tab. Later updates refresh the existing tab without stealing focus.
- Background file writes may refresh Files without changing the active tab.
- Errors appear in the responsible renderer and as concise chat feedback. A
  renderer failure must not collapse the whole work surface.

## 6. Shared item contract

Every work-surface item provides:

- `id`: stable within its owning scope;
- `kind`: document, files, terminal, browser, web-preview, Jira, Confluence,
  Bitbucket, or a future registered type;
- `title`: human-readable tab identity;
- `renderer`: isolated component responsible for the active page;
- `closable`: whether the visible tab may be hidden;
- optional `source`, persistence link, dirty state, and selection context.

The shell owns tab selection, close/reopen behavior, layout, and accessibility.
Renderers own their content and domain actions. Chat owns progress, completion,
and conversational instructions.

## 7. Visual rules

- Use Open WebUI typography, spacing, icons, and light/dark tokens.
- The tab rail has one border and one active indicator; avoid layered headers.
- The active renderer carries visual focus. Shell chrome remains quiet.
- Do not show `Workspace`, `Artifact`, `Canvas mode`, `Pyodide`, `MCP`, or
  `renderer` as required user-facing labels.
- Avoid dashboard cards, success-colored editor backgrounds, duplicate toasts,
  and bespoke progress systems.
- Use icon buttons with tooltips for close, overflow, undo, search, and other
  familiar commands.

## 8. Delivery sequence

1. Use one shell and tab rail for Canvas, Web Preview, Files, Browser, and
   Terminal sessions.
2. Remove the nested Terminal and legacy direct-user Terminal selector.
3. Support multiple file-object, Terminal, and Browser tabs while keeping one
   stable Files navigator.
4. Route document, Web Preview, and display-file events to the correct tab
   without changing chat layout.
5. Resolve Files through managed Terminal first and Pyodide only when no managed
   Terminal is configured.
6. Add connector renderers only through typed MCP object results later; no
   connector UI is part of this slice.

## 9. Acceptance criteria for the first slice

1. Canvas, Web Preview, Files, Browser, and Terminal can be sibling tabs in the
   right-hand work surface when their prerequisites are available.
2. The tab rail remains visible with one item and does not move on selection.
3. Each tab selects the correct existing renderer without remounting unrelated
   chat content.
4. Files remains unique and a display-file event opens the requested path as a
   separate file-object tab at the end of the rail.
5. Selecting a terminal opens its work-surface tab, not Files.
6. Two or more terminal sessions can remain connected and switch independently.
7. Closing a terminal tab does not change the other open work-surface items.
8. No terminal panel appears inside Files and no legacy bottom dock is rendered.
9. Closing and reopening each work-surface tab does not delete state or content.
10. Closing the final tab closes the work surface; opening an item restores it.
11. Existing Canvas creation, editing, Undo AI, focused selection, and Notes
    promotion tests remain green.
12. Web Preview remains usable without a runtime and updates its open renderer
    without creating duplicate chat cards.
13. A configured but unavailable managed Terminal remains authoritative and
    shows a clear failure state. With no managed Terminal, enabled Pyodide
    provides Files but not Terminal or Browser.
14. Desktop and mobile layouts remain usable, with the existing mobile drawer as
    the small-screen container.
