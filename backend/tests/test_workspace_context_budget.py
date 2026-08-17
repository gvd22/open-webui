from open_webui.utils.canvas import CANVAS_ACTIVE_DOCUMENT_KEY, CANVAS_DOCUMENTS_KEY
from open_webui.utils.context_compaction import estimate_tokens
from open_webui.utils.web_preview import WEB_PREVIEW_ACTIVE_DOCUMENT_KEY, WEB_PREVIEW_DOCUMENTS_KEY
from open_webui.utils.workspace_context import (
    DEFAULT_MODEL_CONTEXT_TOKENS,
    HARD_OBJECT_CONTEXT_CHARS,
    SOFT_OBJECT_CONTEXT_CHARS,
    allocate_workspace_context_chars,
    build_workspace_context_prompt,
    normalize_workspace_focus,
    resolve_model_context_tokens,
)


def test_resolves_explicit_and_provider_context_windows():
    assert resolve_model_context_tokens({}, {'num_ctx': 8_192}) == 8_192
    assert resolve_model_context_tokens({}, {'options': {'num_ctx': 16_384}}) == 16_384
    assert resolve_model_context_tokens({'info': {'meta': {'context_window': 128_000}}}) == 128_000
    assert resolve_model_context_tokens({'ollama': {'model_info': {'llama.context_length': 65_536}}}) == 65_536
    assert resolve_model_context_tokens({}) == DEFAULT_MODEL_CONTEXT_TOKENS


def test_post_normalization_request_params_still_bound_workspace_budget():
    prompt = build_workspace_context_prompt(
        {
            CANVAS_ACTIVE_DOCUMENT_KEY: 'canvas-1',
            CANVAS_DOCUMENTS_KEY: {'canvas-1': {'title': 'Plan', 'content': 'body'}},
        },
        None,
        {},
        {
            'num_ctx': 4_096,
            'max_tokens': 2_048,
            'messages': [{'role': 'user', 'content': 'x' * 4_000}],
            'tools': [
                {'function': {'name': 'canvas_read_document'}},
                {'function': {'name': 'canvas_replace_text'}},
            ],
        },
    )

    assert '[CANVAS CONTEXT]' not in prompt


def test_workspace_focus_is_normalized_at_the_request_boundary():
    assert normalize_workspace_focus({'kind': 'canvas', 'id': 'canvas-1', 'ignored': True}) == {
        'kind': 'canvas',
        'id': 'canvas-1',
    }
    assert normalize_workspace_focus({'kind': 'terminal', 'id': 'terminal-1'}) is None
    assert normalize_workspace_focus({'kind': 'canvas', 'id': 'x' * 257}) is None


def test_unknown_workspace_focus_exposes_catalog_but_not_document_content():
    prompt = build_workspace_context_prompt(
        {
            CANVAS_DOCUMENTS_KEY: {
                'canvas-1': {'title': 'Known', 'content': 'private document body'},
            }
        },
        {'kind': 'canvas', 'id': 'missing'},
        {},
        {
            'params': {'num_ctx': 32_768},
            'messages': [{'role': 'user', 'content': 'continue'}],
            'tools': [
                {'function': {'name': 'canvas_read_document'}},
                {'function': {'name': 'canvas_replace_text'}},
            ],
        },
    )

    assert '"canvas_id":"canvas-1","title":"Known"' in prompt
    assert 'private document body' not in prompt


def test_missing_request_focus_uses_persisted_active_object_but_explicit_focus_wins():
    chat_data = {
        CANVAS_ACTIVE_DOCUMENT_KEY: 'canvas-1',
        CANVAS_DOCUMENTS_KEY: {
            'canvas-1': {'title': 'Canvas', 'content': 'persisted canvas body', 'updated_at': 3},
        },
        WEB_PREVIEW_ACTIVE_DOCUMENT_KEY: 'preview-1',
        WEB_PREVIEW_DOCUMENTS_KEY: {
            'preview-1': {
                'title': 'Preview',
                'entrypoint': 'index.html',
                'files': {'index.html': {'content': '<h1>persisted preview body</h1>', 'mime': 'text/html'}},
                'updated_at': 4,
            }
        },
    }
    form_data = {
        'params': {'num_ctx': 32_768},
        'messages': [{'role': 'user', 'content': 'continue'}],
        'tools': [
            {'function': {'name': 'canvas_read_document'}},
            {'function': {'name': 'canvas_replace_text'}},
            {'function': {'name': 'web_preview_read_file'}},
            {'function': {'name': 'web_preview_replace_text'}},
        ],
    }

    fallback = build_workspace_context_prompt(chat_data, None, {}, form_data)
    explicit = build_workspace_context_prompt(
        chat_data,
        {'kind': 'canvas', 'id': 'canvas-1'},
        {},
        form_data,
    )

    assert 'persisted canvas body' in fallback
    assert r'\u003ch1\u003epersisted preview body\u003c/h1\u003e' in fallback
    assert 'persisted canvas body' in explicit
    assert 'persisted preview body' not in explicit


def test_web_preview_tools_route_web_app_requests_without_existing_preview():
    prompt = build_workspace_context_prompt(
        {},
        None,
        {},
        {
            'messages': [{'role': 'user', 'content': 'Build a calculator website'}],
            'tools': [{'function': {'name': 'web_preview_create'}}],
        },
    )

    assert '[WEB PREVIEW ROUTING]' in prompt
    assert 'Do not answer with a complete' in prompt


def test_web_preview_routing_is_absent_without_registered_tools():
    assert (
        build_workspace_context_prompt(
            {},
            None,
            {},
            {'messages': [{'role': 'user', 'content': 'Build a calculator website'}]},
        )
        == ''
    )


def test_workspace_budget_scales_with_model_and_keeps_soft_targets_when_ambiguous():
    small = allocate_workspace_context_chars(
        {},
        {'num_ctx': 8_192},
        [{'role': 'user', 'content': 'short'}],
        include_canvas=True,
        include_web_preview=False,
        focused_kind='canvas',
    )
    large = allocate_workspace_context_chars(
        {},
        {'num_ctx': 128_000},
        [{'role': 'user', 'content': 'short'}],
        include_canvas=True,
        include_web_preview=False,
        focused_kind='canvas',
    )
    shared = allocate_workspace_context_chars(
        {},
        {'num_ctx': 128_000},
        [{'role': 'user', 'content': 'Please improve it'}],
        include_canvas=True,
        include_web_preview=True,
    )

    assert large['canvas'] > small['canvas']
    assert large['canvas'] == HARD_OBJECT_CONTEXT_CHARS['canvas']
    assert shared['web_preview'] == shared['canvas'] * 2
    assert shared == SOFT_OBJECT_CONTEXT_CHARS


def test_visible_workspace_focus_can_grow_past_its_soft_target():
    canvas = allocate_workspace_context_chars(
        {},
        {'num_ctx': 128_000},
        [{'role': 'user', 'content': 'Change the selected Canvas document'}],
        include_canvas=True,
        include_web_preview=True,
        focused_kind='canvas',
    )
    preview = allocate_workspace_context_chars(
        {},
        {'num_ctx': 256_000},
        [{'role': 'user', 'content': 'Update the HTML in the web preview'}],
        include_canvas=True,
        include_web_preview=True,
        focused_kind='web_preview',
    )

    assert canvas['canvas'] > SOFT_OBJECT_CONTEXT_CHARS['canvas']
    assert canvas['canvas'] <= HARD_OBJECT_CONTEXT_CHARS['canvas']
    assert preview['web_preview'] > SOFT_OBJECT_CONTEXT_CHARS['web_preview']
    assert preview['web_preview'] <= HARD_OBJECT_CONTEXT_CHARS['web_preview']


def test_workspace_budget_disappears_when_request_has_no_safe_room():
    budget = allocate_workspace_context_chars(
        {},
        {'num_ctx': 4_096, 'max_tokens': 2_048},
        [{'role': 'user', 'content': 'x' * 20_000}],
        include_canvas=True,
        include_web_preview=True,
    )

    assert budget == {'canvas': 0, 'web_preview': 0}


def test_unicode_heavy_messages_are_not_undercounted_for_workspace_budget():
    assert estimate_tokens('a' * 4_000) == 1_000
    assert estimate_tokens('🧪' * 3_000) >= 12_000

    budget = allocate_workspace_context_chars(
        {},
        {'num_ctx': 8_192, 'max_tokens': 2_048},
        [{'role': 'user', 'content': '🧪' * 3_000}],
        include_canvas=True,
        include_web_preview=True,
    )

    assert budget == {'canvas': 0, 'web_preview': 0}


def test_workspace_budget_accounts_for_tool_schema_tokens():
    without_tools = allocate_workspace_context_chars(
        {},
        {'num_ctx': 8_192},
        [{'role': 'user', 'content': 'short'}],
        include_canvas=True,
        include_web_preview=False,
    )
    with_tools = allocate_workspace_context_chars(
        {},
        {'num_ctx': 8_192},
        [{'role': 'user', 'content': 'short'}],
        [{'type': 'function', 'function': {'name': 'large', 'description': 'x' * 12_000}}],
        include_canvas=True,
        include_web_preview=False,
    )

    assert with_tools['canvas'] < without_tools['canvas']
