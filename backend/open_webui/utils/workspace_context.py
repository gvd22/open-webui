"""Context-aware budgets for chat workspace objects."""

from __future__ import annotations

import json
from copy import deepcopy
from typing import Any

from open_webui.utils.canvas import CANVAS_DOCUMENTS_KEY, build_active_canvas_prompt
from open_webui.utils.context_compaction import estimate_messages_tokens, estimate_tokens
from open_webui.utils.web_preview import (
    WEB_PREVIEW_DOCUMENTS_KEY,
    build_active_web_preview_prompt,
)

DEFAULT_MODEL_CONTEXT_TOKENS = 32_768
WORKSPACE_CONTEXT_SHARE = 0.20
WORKSPACE_AVAILABLE_SHARE = 0.25
WORKSPACE_CHARS_PER_TOKEN = 3
MIN_OBJECT_CONTEXT_CHARS = 1_200
SOFT_OBJECT_CONTEXT_CHARS = {'canvas': 16_000, 'web_preview': 32_000}
HARD_OBJECT_CONTEXT_CHARS = {'canvas': 64_000, 'web_preview': 128_000}

WORKSPACE_TOOL_PREFIXES = ('canvas_', 'web_preview_')
WORKSPACE_CONTEXT_MARKERS = (
    '[CANVAS CONTEXT]',
    '[WEB PREVIEW CONTEXT]',
    '[WEB PREVIEW ROUTING]',
    '[WEB PREVIEW RUNTIME FILES]',
)
WORKSPACE_TOOL_ARGUMENT_KEYS = {
    'canvas_id',
    'preview_id',
    'path',
    'title',
    'entrypoint',
    'start_line',
    'end_line',
    'expected_content_hash',
    'expected_updated_at',
    'source_path',
    'target_path',
}
WORKSPACE_RESULT_CONTENT_TYPES = {
    'canvas.document': {'content'},
    'canvas.document_excerpt': {'content'},
    'web_preview.document': {'files'},
    'web_preview.file_excerpt': {'content'},
}

WEB_PREVIEW_ROUTING_PROMPT = """[WEB PREVIEW ROUTING]
When the user asks you to create, build, prototype, or revise a browser-native website, web app,
HTML, CSS, or JavaScript experience, use the web_preview tools. Do not answer with a complete
HTML/CSS/JavaScript code block instead. Use web_preview_create for a new preview and update the
existing preview when the request refers to one already in this chat. You may still use short code
snippets when the user explicitly asks for code rather than an interactive preview."""

WEB_PREVIEW_RUNTIME_IMPORT_PROMPT = """[WEB PREVIEW RUNTIME FILES]
When code execution or a Terminal command creates a text data file that an existing Web Preview
should display, call web_preview_import_runtime_file with the active preview version. This copies
one snapshot into the preview; do not paste large generated data into web_preview_update."""


def _compact_workspace_arguments(arguments: Any) -> str:
    try:
        parsed = json.loads(arguments) if isinstance(arguments, str) else arguments
    except (TypeError, ValueError):
        return '{}'
    if not isinstance(parsed, dict):
        return '{}'
    return json.dumps(
        {key: value for key, value in parsed.items() if key in WORKSPACE_TOOL_ARGUMENT_KEYS},
        ensure_ascii=False,
        separators=(',', ':'),
    )


def _compact_workspace_result_text(text: str) -> str:
    try:
        result = json.loads(text)
    except (TypeError, ValueError):
        return text
    if not isinstance(result, dict) or result.get('type') not in WORKSPACE_RESULT_CONTENT_TYPES:
        return text
    compact = {
        key: value
        for key, value in result.items()
        if key not in WORKSPACE_RESULT_CONTENT_TYPES[result['type']]
    }
    compact['contentOmitted'] = True
    return json.dumps(compact, ensure_ascii=False, separators=(',', ':'))


def _compact_workspace_result_item(item: dict) -> None:
    parts = item.get('output', [])
    if isinstance(parts, str):
        item['output'] = _compact_workspace_result_text(parts)
        return
    if isinstance(parts, dict):
        parts = [parts]
    if not isinstance(parts, list):
        return
    for part in parts:
        if isinstance(part, dict) and part.get('type') == 'input_text':
            part['text'] = _compact_workspace_result_text(str(part.get('text', '')))


def compact_workspace_tool_output(output: list[dict]) -> list[dict]:
    """Remove durable Workspace content from stored tool history.

    The canonical content remains attached to the chat and can be loaded with
    the read tools. Non-Workspace output is returned unchanged.
    """
    completed_call_ids = {
        item.get('call_id') for item in output or []
        if item.get('type') == 'function_call_output'
    }
    # Pending approvals must retain executable arguments until a result exists.
    tool_names = {
        item.get('call_id'): item.get('name', '')
        for item in output or []
        if item.get('type') == 'function_call'
        and item.get('call_id') in completed_call_ids
        and str(item.get('name', '')).startswith(WORKSPACE_TOOL_PREFIXES)
    }
    if not tool_names:
        return output

    compact = deepcopy(output)
    for item in compact:
        call_id = item.get('call_id')
        if call_id not in tool_names:
            continue
        if item.get('type') == 'function_call':
            item['arguments'] = _compact_workspace_arguments(item.get('arguments', '{}'))
        elif item.get('type') == 'function_call_output':
            _compact_workspace_result_item(item)
    return compact


def remove_workspace_context_prompts(messages: list[dict]) -> list[dict]:
    """Remove generated workspace sections before rebuilding current context."""
    cleaned = []
    for message in messages or []:
        if message.get('role') != 'system' or not isinstance(message.get('content'), str):
            cleaned.append(message)
            continue

        content = message['content']
        marker_positions = [content.find(marker) for marker in WORKSPACE_CONTEXT_MARKERS]
        marker_positions = [position for position in marker_positions if position >= 0]
        if not marker_positions:
            cleaned.append(message)
            continue

        content = content[: min(marker_positions)].rstrip()
        if content:
            cleaned.append({**message, 'content': content})
    return cleaned


def build_cancelled_workspace_output_update(output: list[dict], *, realtime: bool) -> dict:
    """Build the final persisted message patch for a cancelled tool stream."""
    compact = compact_workspace_tool_output(output)
    if not realtime or compact != output:
        return {'done': True, 'output': compact}
    return {'done': True}


def normalize_workspace_focus(value: Any) -> dict[str, str] | None:
    if not (
        isinstance(value, dict)
        and value.get('kind') in {'canvas', 'web_preview'}
        and isinstance(value.get('id'), str)
        and 0 < len(value['id']) <= 256
    ):
        return None
    return {'kind': value['kind'], 'id': value['id']}


def _positive_int(value: Any) -> int | None:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def _first_positive(*values: Any) -> int | None:
    return next((parsed for value in values if (parsed := _positive_int(value))), None)


def resolve_model_context_tokens(model: dict, params: dict | None = None) -> int:
    """Resolve the selected model's context window from common provider metadata."""
    params = params or {}
    options = params.get('options') or {}
    info = model.get('info') or {}
    meta = info.get('meta') or {}
    ollama = model.get('ollama') or {}
    model_info = ollama.get('model_info') or {}

    explicit = _first_positive(
        params.get('num_ctx'),
        params.get('context_length'),
        params.get('context_window'),
        params.get('max_context_tokens'),
        options.get('num_ctx'),
        options.get('context_length'),
        options.get('context_window'),
        meta.get('context_length'),
        meta.get('context_window'),
        meta.get('max_context_tokens'),
        model.get('context_length'),
        model.get('context_window'),
        ollama.get('context_length'),
    )
    if explicit:
        return explicit

    provider_contexts = [
        value
        for key, value in model_info.items()
        if str(key).endswith(('.context_length', '.context_window')) and _positive_int(value)
    ]
    return max(map(int, provider_contexts), default=DEFAULT_MODEL_CONTEXT_TOKENS)


def allocate_workspace_context_chars(
    model: dict,
    params: dict | None,
    messages: list[dict],
    tools: list[dict] | None = None,
    *,
    include_canvas: bool,
    include_web_preview: bool,
    focused_kind: str | None = None,
) -> dict[str, int]:
    """Allocate bounded context to active workspace renderers.

    The workspace receives at most 20% of the model window and never consumes
    space reserved for the response or a request safety margin.
    """
    params = params or {}
    window = resolve_model_context_tokens(model, params)
    used = estimate_messages_tokens(messages)
    if tools:
        used += estimate_tokens(tools)
    output_reserve = _first_positive(
        params.get('max_completion_tokens'),
        params.get('max_output_tokens'),
        params.get('max_tokens'),
        params.get('num_predict'),
        (params.get('options') or {}).get('num_predict'),
    ) or min(8_192, max(2_048, window // 10))
    safety = max(512, window // 20)
    available = max(0, window - used - output_reserve - safety)
    workspace_tokens = min(
        int(available * WORKSPACE_AVAILABLE_SHARE),
        int(window * WORKSPACE_CONTEXT_SHARE),
    )

    weights = {
        'canvas': 1 if include_canvas else 0,
        'web_preview': 2 if include_web_preview else 0,
    }
    enabled = {kind for kind, weight in weights.items() if weight}
    focused_kind = focused_kind if focused_kind in enabled else None
    if focused_kind:
        weights[focused_kind] *= 4

    total_weight = sum(weights.values())
    if total_weight == 0 or workspace_tokens <= 0:
        return {'canvas': 0, 'web_preview': 0}

    result = {}
    for kind, weight in weights.items():
        chars = workspace_tokens * weight // total_weight * WORKSPACE_CHARS_PER_TOKEN
        limit = HARD_OBJECT_CONTEXT_CHARS[kind] if kind == focused_kind else SOFT_OBJECT_CONTEXT_CHARS[kind]
        result[kind] = min(chars, limit) if chars >= MIN_OBJECT_CONTEXT_CHARS else 0
    return result


def build_workspace_context_prompt(
    chat_data: dict,
    focus: dict[str, str] | None,
    model: dict,
    form_data: dict,
    registered_tools: dict | None = None,
) -> str:
    """Build context for available workspace objects without guessing user focus."""
    messages = form_data.get('messages') or []
    tools = form_data.get('tools') or []
    tool_names = set((registered_tools or {}).keys())
    for item in tools or []:
        name = ((item or {}).get('function') or {}).get('name')
        if name:
            tool_names.add(name)

    canvas_documents = chat_data.get(CANVAS_DOCUMENTS_KEY) or {}
    preview_documents = chat_data.get(WEB_PREVIEW_DOCUMENTS_KEY) or {}
    include_canvas = (
        bool(canvas_documents)
        and {
            'canvas_read_document',
            'canvas_replace_text',
        }
        <= tool_names
    )
    include_web_preview = (
        bool(preview_documents)
        and {
            'web_preview_read_file',
            'web_preview_replace_text',
        }
        <= tool_names
    )

    explicit_focus_supplied = focus is not None
    focus = normalize_workspace_focus(focus)
    focused_kind = focus.get('kind') if focus else None
    focused_id = focus.get('id') if focus else None
    if focused_kind == 'canvas' and focused_id not in canvas_documents:
        focused_kind = focused_id = None
    elif focused_kind == 'web_preview' and focused_id not in preview_documents:
        focused_kind = focused_id = None

    budgets = allocate_workspace_context_chars(
        model,
        form_data,
        messages,
        tools,
        include_canvas=include_canvas,
        include_web_preview=include_web_preview,
        focused_kind=focused_kind,
    )
    prompts = []
    if 'web_preview_create' in tool_names:
        prompts.append(WEB_PREVIEW_ROUTING_PROMPT)
    if 'web_preview_import_runtime_file' in tool_names:
        prompts.append(WEB_PREVIEW_RUNTIME_IMPORT_PROMPT)
    if budgets['canvas']:
        prompt = build_active_canvas_prompt(
            chat_data,
            max_chars=budgets['canvas'],
            focused_canvas_id=focused_id if focused_kind == 'canvas' else None,
            use_persisted_active=not explicit_focus_supplied or focused_kind == 'canvas',
        )
        if prompt:
            prompts.append(prompt)
    if budgets['web_preview']:
        prompt = build_active_web_preview_prompt(
            chat_data,
            max_chars=budgets['web_preview'],
            focused_preview_id=focused_id if focused_kind == 'web_preview' else None,
            use_persisted_active=not explicit_focus_supplied or focused_kind == 'web_preview',
        )
        if prompt:
            prompts.append(prompt)
    return '\n\n'.join(prompts)
