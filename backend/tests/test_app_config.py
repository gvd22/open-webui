from open_webui.env import parse_bool_env


def test_document_viewer_flag_defaults_off(monkeypatch):
    monkeypatch.delenv('ENABLE_DOCUMENT_VIEWER', raising=False)

    assert parse_bool_env('ENABLE_DOCUMENT_VIEWER', False) is False


def test_document_viewer_flag_accepts_only_true(monkeypatch):
    monkeypatch.setenv('ENABLE_DOCUMENT_VIEWER', 'true')
    assert parse_bool_env('ENABLE_DOCUMENT_VIEWER', False) is True

    monkeypatch.setenv('ENABLE_DOCUMENT_VIEWER', 'yes')
    assert parse_bool_env('ENABLE_DOCUMENT_VIEWER', False) is False
