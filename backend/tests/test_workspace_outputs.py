import asyncio
import json
from tempfile import TemporaryFile
from unittest.mock import Mock

import pytest
from fastapi import HTTPException, UploadFile
from open_webui.utils.workspace_outputs import (
    WORKSPACE_OUTPUT_MAX_UPLOAD_BYTES,
    merge_workspace_outputs,
    validate_workspace_output_upload,
)
from starlette.requests import Request


@pytest.mark.parametrize('extra', [0, 1])
def test_workspace_output_upload_limit_uses_actual_bytes_and_restores_position(extra):
    with TemporaryFile() as file:
        file.truncate(WORKSPACE_OUTPUT_MAX_UPLOAD_BYTES + extra)
        file.seek(7)
        metadata = {'source': 'workspace-output', 'size': 1}
        if extra:
            with pytest.raises(ValueError, match='25 MB'):
                validate_workspace_output_upload(file, metadata)
        else:
            validate_workspace_output_upload(file, metadata)
        assert file.tell() == 7


def test_output_limit_leaves_ordinary_upload_policy_and_output_registration_unchanged():
    with TemporaryFile() as file:
        file.truncate(WORKSPACE_OUTPUT_MAX_UPLOAD_BYTES + 1)
        for metadata in (None, {}, {'source': 'upload'}):
            validate_workspace_output_upload(file, metadata)
    output = {'path': '/mnt/uploads/large.csv', 'size': WORKSPACE_OUTPUT_MAX_UPLOAD_BYTES + 1}
    assert merge_workspace_outputs([], [output], [])[0]['size'] == output['size']


@pytest.mark.parametrize('serialized', [False, True])
def test_oversized_output_is_rejected_before_storage(monkeypatch, serialized):
    import open_webui.routers.files as files_router

    store = Mock()
    insert = Mock()
    monkeypatch.setattr(files_router.Storage, 'upload_file', store)
    monkeypatch.setattr(files_router.Files, 'insert_new_file', insert)
    with TemporaryFile() as file:
        file.truncate(WORKSPACE_OUTPUT_MAX_UPLOAD_BYTES + 1)
        metadata = {'source': 'workspace-output', 'size': 1}
        with pytest.raises(HTTPException) as error:
            asyncio.run(
                files_router.upload_file_handler(
                    Request({'type': 'http', 'method': 'POST', 'path': '/'}),
                    file=UploadFile(file=file, filename='large.csv', size=1),
                    metadata=json.dumps(metadata) if serialized else metadata,
                )
            )
        assert error.value.status_code == 413
        assert error.value.detail['code'] == 'workspace_output_too_large'
    store.assert_not_called()
    insert.assert_not_called()


def test_workspace_outputs_are_bounded_to_pyodide_uploads():
    files = merge_workspace_outputs(
        [],
        [
            {
                'path': '/mnt/uploads/report.pdf',
                'name': 'ignored.pdf',
                'source': 'terminal',
                'page': 2,
                'updatedAt': 10,
            }
        ],
        [],
    )
    assert files == [
        {
            'path': '/mnt/uploads/report.pdf',
            'name': 'report.pdf',
            'source': 'pyodide',
            'page': 2,
            'updatedAt': 10,
        }
    ]

    with pytest.raises(ValueError, match='Invalid Pyodide output file'):
        merge_workspace_outputs([], [{'path': '/etc/private.pdf'}], [])

    with pytest.raises(ValueError, match='Invalid Pyodide output file'):
        merge_workspace_outputs([], [{'path': '/mnt/uploads/../private.pdf'}], [])

    with pytest.raises(ValueError, match='Invalid Pyodide output file'):
        merge_workspace_outputs([], [{'path': '/mnt/uploads//report.pdf'}], [])


def test_workspace_outputs_normalize_untrusted_metadata():
    files = merge_workspace_outputs(
        [],
        [
            {
                'path': '/mnt/uploads/report.pdf',
                'page': True,
                'updatedAt': float('inf'),
            }
        ],
        [],
    )

    assert files[0]['page'] is None
    assert files[0]['updatedAt'] == 0


def test_workspace_outputs_preserve_valid_snapshot_metadata():
    files = merge_workspace_outputs(
        [],
        [
            {
                'path': '/mnt/uploads/report.pdf',
                'fileId': 'file-1',
                'messageId': 'message-1',
                'originChatId': 'chat-1',
                'contentType': 'application/pdf',
                'size': 42,
                'persistedAt': 20,
                'updatedAt': 10,
            }
        ],
        [],
    )

    assert files[0] == {
        'path': '/mnt/uploads/report.pdf',
        'name': 'report.pdf',
        'source': 'pyodide',
        'page': None,
        'updatedAt': 10,
        'fileId': 'file-1',
        'messageId': 'message-1',
        'originChatId': 'chat-1',
        'contentType': 'application/pdf',
        'size': 42,
        'persistedAt': 20,
    }

    refreshed = merge_workspace_outputs(
        files,
        [{'path': '/mnt/uploads/report.pdf', 'size': WORKSPACE_OUTPUT_MAX_UPLOAD_BYTES + 1, 'updatedAt': 30}],
        [],
    )
    assert refreshed[0]['fileId'] == 'file-1'
    assert refreshed[0]['updatedAt'] == 30
    assert refreshed[0]['size'] == 42


def test_workspace_outputs_merge_remove_and_limit():
    current = [
        {'path': '/mnt/uploads/old.pdf', 'updatedAt': 1},
        {'path': '/mnt/uploads/report.pdf', 'updatedAt': 5},
    ]
    result = merge_workspace_outputs(
        current,
        [{'path': '/mnt/uploads/report.pdf', 'page': 4, 'updatedAt': 10}],
        ['/mnt/uploads/old.pdf'],
    )
    assert len(result) == 1
    assert result[0]['path'] == '/mnt/uploads/report.pdf'
    assert result[0]['page'] == 4
    assert result[0]['updatedAt'] == 10

    many = merge_workspace_outputs(
        [],
        [{'path': f'/mnt/uploads/{index}.pdf', 'updatedAt': index} for index in range(120)],
        [],
    )
    assert len(many) == 100
    assert many[0]['path'] == '/mnt/uploads/119.pdf'
    assert many[-1]['path'] == '/mnt/uploads/20.pdf'
