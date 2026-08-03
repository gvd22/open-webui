# KOBY Canvas Acceptance Matrix

Scope: isolated Open WebUI v0.11 development instance only. Canvas documents
are transient chat state until the user explicitly adds one to Notes.

| Scenario | Steps | Expected result |
| --- | --- | --- |
| Create two documents | Ask for a risk list and a recipe as two Canvas documents in one saved chat. | Two different `canvasId` values, generated titles, and two compact chat cards. |
| Select documents | Open each card with `Bearbeiten`. | The right pane switches to the exact selected document without changing the other. |
| Direct editing | Change title and Markdown in each document, then reload the chat. | Both edits remain isolated and are restored from chat-scoped Canvas state. |
| AI update | Ask to update the risk list by title, then select the recipe and ask to update that. | The model calls `canvas_update_document` with the intended `canvasId`; only that document changes. |
| Message order | Ask the model to write prose before and after creating a Canvas document. | Prose and the document card appear in the original response order. |
| Open and close | Close the right Canvas pane, then open the card again. | Closed card shows the rich Markdown preview; open card shows the compact preview and right editor. |
| Add one Note | Open one document and select `Zu Notizen hinzufuegen`. | Only that document gains a Note link and reopens in the Notes editor; the other remains transient and absent from Notes. |
| Saved Note lifecycle | Reopen the linked document, edit it, and save through Notes. | The saved Note changes through the normal Notes lifecycle; the chat card remains the assistant snapshot. |
| Missing context | Request an update with no saved chat or an unknown Canvas ID. | A clear Canvas error is returned; chat and UI remain usable. |

## Automated evidence

- Direct Canvas tool lifecycle: create two documents, update one, select the other, and list both. The two IDs remain distinct and the update retains the first ID.
- Authenticated direct-edit endpoint: manual title/content changes persist in `_canvas_documents`; the sibling document remains unchanged.
- Note promotion regression: the first promotion creates one Note and stores its `note_id`; repeating the same promotion returns that same Note without creating a duplicate. Only the selected Canvas document receives `note_id`; the sibling does not.
- Error handling: a missing saved chat returns `canvas.error`; an unknown document update returns HTTP 404.

## Required browser evidence

Run the table above in the authenticated isolated app at `http://localhost:5050`.
Capture the response cards and the right editor after the two-create and two-follow-up sequence. API and backend tests do not substitute for this visual confirmation.
