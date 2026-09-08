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
from open_webui.utils.workspace_outputs import WORKSPACE_OUTPUTS_KEY, normalize_workspace_output

DEFAULT_MODEL_CONTEXT_TOKENS = 32_768
WORKSPACE_CONTEXT_SHARE = 0.20
WORKSPACE_AVAILABLE_SHARE = 0.25
WORKSPACE_CHARS_PER_TOKEN = 3
MIN_OBJECT_CONTEXT_CHARS = 1_200
SOFT_OBJECT_CONTEXT_CHARS = {'canvas': 16_000, 'web_preview': 32_000}
HARD_OBJECT_CONTEXT_CHARS = {'canvas': 64_000, 'web_preview': 128_000}
WORKSPACE_OUTPUT_CONTEXT_MAX_CHARS = 12_000
WORKSPACE_RESULT_MAX_CHARS = 4_096

WORKSPACE_TOOL_PREFIXES = ('canvas_', 'web_preview_')
WORKSPACE_CONTEXT_MARKERS = (
    '[CANVAS CONTEXT]',
    '[WEB PREVIEW CONTEXT]',
    '[WEB PREVIEW ROUTING]',
    '[WEB PREVIEW RUNTIME FILES]',
    '[WORKSPACE OUTPUT FILES]',
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

WORKSPACE_ARGUMENT_LIMITS = {
    'canvas_id': 256,
    'preview_id': 256,
    'path': 512,
    'title': 256,
    'entrypoint': 512,
    'expected_content_hash': 128,
    'source_path': 1_024,
    'target_path': 512,
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


def build_workspace_outputs_prompt(
    chat_data: dict,
    max_chars: int = WORKSPACE_OUTPUT_CONTEXT_MAX_CHARS,
) -> str:
    """Describe only durable outputs owned by the current chat."""
    max_chars = min(max(0, max_chars), WORKSPACE_OUTPUT_CONTEXT_MAX_CHARS)
    raw_outputs = chat_data.get(WORKSPACE_OUTPUTS_KEY)
    outputs = [
        normalized
        for candidate in (raw_outputs if isinstance(raw_outputs, list) else [])[:100]
        if (normalized := normalize_workspace_output(candidate)) is not None and normalized.get('fileId')
    ][:20]
    if not outputs:
        return ''

    prefix = (
        '[WORKSPACE OUTPUT FILES]\n'
        'These are durable file snapshots produced or edited in this chat. Prefer these files '
        'when the user refers to prior outputs. The shared runtime can contain unrelated files '
        'from other chats; do not treat unlisted runtime files as current-chat context.\n'
    )

    def safe(value: str) -> str:
        return value.replace('[', r'\u005b').replace(']', r'\u005d')

    payload = []
    for item in outputs:
        candidate = {
            'name': safe(item['name']),
            'path': safe(item['path']),
            'file_id': safe(item['fileId']),
            **({'content_type': safe(item['contentType'])} if item.get('contentType') else {}),
        }
        serialized = json.dumps([*payload, candidate], ensure_ascii=True, separators=(',', ':'))
        if len(prefix) + len(serialized) > max_chars:
            break
        payload.append(candidate)
    if not payload:
        return ''
    return prefix + json.dumps(payload, ensure_ascii=True, separators=(',', ':'))


def _compact_workspace_arguments(arguments: Any) -> str:
    try:
        parsed = json.loads(arguments) if isinstance(arguments, str) else arguments
    except (TypeError, ValueError):
        return '{}'
    if not isinstance(parsed, dict):
        return '{}'
    compact = {}
    for key, value in parsed.items():
        if key not in WORKSPACE_TOOL_ARGUMENT_KEYS:
            continue
        if key in WORKSPACE_ARGUMENT_LIMITS:
            if isinstance(value, str):
                compact[key] = value[: WORKSPACE_ARGUMENT_LIMITS[key]]
        elif key in {'start_line', 'end_line', 'expected_updated_at'}:
            if isinstance(value, int) and not isinstance(value, bool):
                compact[key] = value
    return json.dumps(compact, ensure_ascii=True, separators=(',', ':'))


def _compact_workspace_result_text(text: str) -> str:
    try:
        result = json.loads(text)
    except (TypeError, ValueError):
        return json.dumps(
            {'contentOmitted': True, 'invalidResult': True},
            separators=(',', ':'),
        )
    compact = result
    if isinstance(result, dict) and result.get('type') in WORKSPACE_RESULT_CONTENT_TYPES:
        compact = {
            key: value for key, value in result.items() if key not in WORKSPACE_RESULT_CONTENT_TYPES[result['type']]
        }
        compact['contentOmitted'] = True
    serialized = json.dumps(compact, ensure_ascii=True, separators=(',', ':'))
    if len(serialized) <= WORKSPACE_RESULT_MAX_CHARS:
        return serialized
    return json.dumps(
        {
            **(
                {'type': result['type'][:128]}
                if isinstance(result, dict) and isinstance(result.get('type'), str)
                else {}
            ),
            'contentOmitted': True,
            'resultTruncated': True,
        },
        separators=(',', ':'),
    )


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
    completed_call_ids = {item.get('call_id') for item in output or [] if item.get('type') == 'function_call_output'}
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
        and not any(ord(char) < 32 or ord(char) == 127 for char in value['id'])
    ):
        return None
    return {'kind': value['kind'], 'id': value['id']}


def _positive_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def _first_positive(*values: Any) -> int | None:
    return next((parsed for value in values if (parsed := _positive_int(value))), None)


def resolve_model_context_tokens(model: dict, params: dict | None = None) -> int:
    """Resolve the selected model's context window from common provider metadata."""
    model = model if isinstance(model, dict) else {}
    params = params if isinstance(params, dict) else {}
    options = params.get('options') if isinstance(params.get('options'), dict) else {}
    info = model.get('info') if isinstance(model.get('info'), dict) else {}
    meta = info.get('meta') if isinstance(info.get('meta'), dict) else {}
    ollama = model.get('ollama') if isinstance(model.get('ollama'), dict) else {}
    model_info = ollama.get('model_info') if isinstance(ollama.get('model_info'), dict) else {}

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


def resolve_workspace_context_chars(
    model: dict,
    params: dict | None,
    messages: list[dict],
    tools: list[dict] | None = None,
) -> int:
    params = params if isinstance(params, dict) else {}
    window = resolve_model_context_tokens(model, params)
    used = estimate_messages_tokens(messages)
    if tools:
        used += estimate_tokens(tools)
    output_reserve = _first_positive(
        params.get('max_completion_tokens'),
        params.get('max_output_tokens'),
        params.get('max_tokens'),
        params.get('num_predict'),
        (params.get('options') if isinstance(params.get('options'), dict) else {}).get('num_predict'),
    ) or min(8_192, max(2_048, window // 10))
    safety = max(512, window // 20)
    available = max(0, window - used - output_reserve - safety)
    workspace_tokens = min(
        int(available * WORKSPACE_AVAILABLE_SHARE),
        int(window * WORKSPACE_CONTEXT_SHARE),
    )
    return workspace_tokens * WORKSPACE_CHARS_PER_TOKEN


def allocate_workspace_context_chars(
    model: dict,
    params: dict | None,
    messages: list[dict],
    tools: list[dict] | None = None,
    *,
    include_canvas: bool,
    include_web_preview: bool,
    focused_kind: str | None = None,
    max_chars: int | None = None,
) -> dict[str, int]:
    """Allocate bounded context to active workspace renderers.

    The workspace receives at most 20% of the model window and never consumes
    space reserved for the response or a request safety margin.
    """
    workspace_chars = resolve_workspace_context_chars(model, params, messages, tools)
    if max_chars is not None:
        workspace_chars = min(workspace_chars, max(0, max_chars))

    weights = {
        'canvas': 1 if include_canvas else 0,
        'web_preview': 2 if include_web_preview else 0,
    }
    enabled = {kind for kind, weight in weights.items() if weight}
    focused_kind = focused_kind if focused_kind in enabled else None
    if focused_kind:
        weights[focused_kind] *= 4

    total_weight = sum(weights.values())
    if total_weight == 0 or workspace_chars <= 0:
        return {'canvas': 0, 'web_preview': 0}

    result = {}
    for kind, weight in weights.items():
        chars = workspace_chars * weight // total_weight
        limit = HARD_OBJECT_CONTEXT_CHARS[kind] if kind == focused_kind else SOFT_OBJECT_CONTEXT_CHARS[kind]
        result[kind] = min(chars, limit) if chars >= MIN_OBJECT_CONTEXT_CHARS else 0
    return result


def _workspace_tool_names(form_data: dict, registered_tools: dict | None) -> set[str]:
    names = set(registered_tools.keys()) if isinstance(registered_tools, dict) else set()
    raw_tools = form_data.get('tools')
    names.update(
        name
        for item in (raw_tools if isinstance(raw_tools, list) else [])
        if isinstance(item, dict)
        and isinstance(item.get('function'), dict)
        and (name := item['function'].get('name'))
        and isinstance(name, str)
    )
    return names


def _append_bounded_prompt(prompts: list[str], prompt: str, max_chars: int) -> bool:
    if not prompt:
        return False
    separator = 2 if prompts else 0
    if sum(map(len, prompts)) + max(0, len(prompts) - 1) * 2 + separator + len(prompt) > max_chars:
        return False
    prompts.append(prompt)
    return True


def _build_workspace_prefix_prompts(
    chat_data: dict,
    tool_names: set[str],
    total_budget: int,
    include_objects: bool,
) -> list[str]:
    prompts: list[str] = []
    _append_bounded_prompt(
        prompts,
        WEB_PREVIEW_ROUTING_PROMPT if 'web_preview_create' in tool_names else '',
        total_budget,
    )
    _append_bounded_prompt(
        prompts,
        WEB_PREVIEW_RUNTIME_IMPORT_PROMPT if 'web_preview_import_runtime_file' in tool_names else '',
        total_budget,
    )
    used_chars = sum(map(len, prompts)) + max(0, len(prompts) - 1) * 2
    output_share = total_budget // 4 if include_objects else total_budget
    outputs_prompt = build_workspace_outputs_prompt(
        chat_data,
        min(output_share, total_budget - used_chars - (2 if prompts else 0)),
    )
    _append_bounded_prompt(prompts, outputs_prompt, total_budget)
    return prompts


def build_workspace_context_prompt(
    chat_data: dict,
    focus: dict[str, str] | None,
    model: dict,
    form_data: dict,
    registered_tools: dict | None = None,
) -> str:
    """Build context for available workspace objects without guessing user focus."""
    raw_messages = form_data.get('messages')
    raw_tools = form_data.get('tools')
    messages = raw_messages if isinstance(raw_messages, list) else []
    tools = raw_tools if isinstance(raw_tools, list) else []
    tool_names = _workspace_tool_names(form_data, registered_tools)

    raw_canvas_documents = chat_data.get(CANVAS_DOCUMENTS_KEY)
    raw_preview_documents = chat_data.get(WEB_PREVIEW_DOCUMENTS_KEY)
    canvas_documents = raw_canvas_documents if isinstance(raw_canvas_documents, dict) else {}
    preview_documents = raw_preview_documents if isinstance(raw_preview_documents, dict) else {}
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

    total_budget = resolve_workspace_context_chars(model, form_data, messages, tools)
    if total_budget <= 0:
        return ''

    prompts = _build_workspace_prefix_prompts(
        chat_data,
        tool_names,
        total_budget,
        include_canvas or include_web_preview,
    )
    used_chars = sum(map(len, prompts)) + max(0, len(prompts) - 1) * 2
    budgets = allocate_workspace_context_chars(
        model,
        form_data,
        messages,
        tools,
        include_canvas=include_canvas,
        include_web_preview=include_web_preview,
        focused_kind=focused_kind,
        max_chars=max(0, total_budget - used_chars - (2 if prompts else 0) - 2),
    )
    if budgets['canvas']:
        prompt = build_active_canvas_prompt(
            chat_data,
            max_chars=budgets['canvas'],
            focused_canvas_id=focused_id if focused_kind == 'canvas' else None,
            use_persisted_active=not explicit_focus_supplied or focused_kind == 'canvas',
        )
        _append_bounded_prompt(prompts, prompt, total_budget)
    if budgets['web_preview']:
        prompt = build_active_web_preview_prompt(
            chat_data,
            max_chars=budgets['web_preview'],
            focused_preview_id=focused_id if focused_kind == 'web_preview' else None,
            use_persisted_active=not explicit_focus_supplied or focused_kind == 'web_preview',
        )
        _append_bounded_prompt(prompts, prompt, total_budget)
    return '\n\n'.join(prompts)
