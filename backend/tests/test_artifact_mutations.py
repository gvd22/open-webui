import pytest

from open_webui.utils.canvas import (
    CanvasConflictError,
    build_canvas_document_update,
    canvas_content_hash,
)
from open_webui.utils.web_preview import (
    WebPreviewConflictError,
    build_web_preview_document_update,
    web_preview_content_hash,
)


def test_canvas_ai_and_manual_updates_share_version_and_undo_rules():
    current = {
        'canvas_id': 'canvas-1',
        'title': 'Draft',
        'content': '# Draft\n\nBefore',
        'title_edited': False,
        'updated_at': 10,
        'last_ai_update': None,
    }
    ai_update = build_canvas_document_update(
        'canvas-1',
        current,
        content='# Revised\n\nAfter',
        expected_updated_at=10,
        expected_content_hash=canvas_content_hash(current['content']),
        source='ai',
    )

    assert ai_update['title'] == 'Revised'
    assert ai_update['last_ai_update'] == {
        'title': 'Draft',
        'content': '# Draft\n\nBefore',
        'title_edited': False,
    }

    manual_update = build_canvas_document_update(
        'canvas-1',
        ai_update,
        title=ai_update['title'],
        content='# Revised\n\nManual change',
        title_edited=False,
        expected_updated_at=ai_update['updated_at'],
        expected_content_hash=canvas_content_hash(ai_update['content']),
        source='manual',
    )
    assert manual_update['last_ai_update'] is None


def test_canvas_shared_update_rejects_stale_and_invalid_mutations():
    current = {
        'title': 'Current',
        'content': 'Current body',
        'title_edited': True,
        'updated_at': 12,
    }
    with pytest.raises(CanvasConflictError):
        build_canvas_document_update(
            'canvas-1',
            current,
            content='Stale body',
            expected_updated_at=11,
            expected_content_hash=canvas_content_hash(current['content']),
            source='ai',
        )
    with pytest.raises(ValueError, match='Invalid Canvas update source'):
        build_canvas_document_update(
            'canvas-1',
            current,
            content='Body',
            expected_updated_at=12,
            expected_content_hash=canvas_content_hash(current['content']),
            source='manual',
        )


def test_web_preview_shared_update_normalizes_and_preserves_export_metadata():
    current = {
        'preview_id': 'preview-1',
        'title': 'Current preview',
        'entrypoint': 'index.html',
        'files': {'index.html': {'content': '<h1>Current</h1>', 'mime': 'text/html'}},
        'exported_path': '/mnt/uploads/previews/current',
        'exported_runtime': 'pyodide',
        'updated_at': 20,
    }
    updated = build_web_preview_document_update(
        'preview-1',
        current,
        files={'index.html': '<title>Updated preview</title>'},
        expected_updated_at=20,
        expected_content_hash=web_preview_content_hash(current),
    )

    assert updated['title'] == 'Current preview'
    assert updated['files']['index.html']['mime'] == 'text/html'
    assert updated['exported_path'] == current['exported_path']
    assert updated['exported_runtime'] == 'pyodide'


def test_web_preview_shared_update_checks_versions_and_html_entrypoint():
    current = {
        'title': 'Preview',
        'entrypoint': 'index.html',
        'files': {'index.html': {'content': '<h1>Current</h1>', 'mime': 'text/html'}},
        'updated_at': 30,
    }
    content_hash = web_preview_content_hash(current)

    with pytest.raises(WebPreviewConflictError):
        build_web_preview_document_update(
            'preview-1',
            current,
            files={'index.html': '<h1>Stale</h1>'},
            expected_updated_at=29,
            expected_content_hash=content_hash,
        )
    with pytest.raises(ValueError, match='entrypoint must reference an HTML file'):
        build_web_preview_document_update(
            'preview-1',
            current,
            files={'index.html': {'content': '{}', 'mime': 'application/json'}},
            expected_updated_at=30,
            expected_content_hash=content_hash,
        )
