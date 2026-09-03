import pytest

from open_webui.utils.workspace_outputs import merge_workspace_outputs


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
        [
            {'path': f'/mnt/uploads/{index}.pdf', 'updatedAt': index}
            for index in range(120)
        ],
        [],
    )
    assert len(many) == 100
    assert many[0]['path'] == '/mnt/uploads/119.pdf'
    assert many[-1]['path'] == '/mnt/uploads/20.pdf'
