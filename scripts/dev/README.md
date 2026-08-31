# Isolated Terminals 0.2.2 Development Setup

`terminals-v0.2.2-local.patch` applies only to the official Terminals `v0.2.2`
checkout (commit `45f7a98e0d0dce0bbe97a86d2eec4afbfd075a3a`). It is a local
development dependency patch, not an Open WebUI production change. Do not apply
it to a shared or remote orchestrator.

The patch has three deliberately narrow effects:

1. Publish new Docker worker API ports on `127.0.0.1`, not all interfaces.
2. Reconcile only workers whose `/home/user` mount is within this supervisor's
   configured `TERMINALS_DOCKER_DATA_DIR`.
3. Refresh a tracked worker's published port when checking its running state.
   Docker can reassign an ephemeral host port after restart. The unpatched
   supervisor otherwise keeps using its stale address indefinitely.

Apply from the exact Terminals checkout, then install that checkout into a
dedicated Python 3.11+ environment. The WebUI repository root is `$WEBUI_ROOT`:

```sh
git apply --check "$WEBUI_ROOT/scripts/dev/terminals-v0.2.2-local.patch"
git apply "$WEBUI_ROOT/scripts/dev/terminals-v0.2.2-local.patch"
uv pip install --python "$TERMINALS_PYTHON" -e .
"$TERMINALS_PYTHON" "$WEBUI_ROOT/scripts/dev/test_terminals_local.py"
```

Run the tests and service from the Terminal checkout or a dedicated directory,
not the WebUI root: their Pydantic settings must not load WebUI's `.env`.
The three tests use mocked Docker; they do not stop or create containers.
Port refresh is subject to the native status-cache TTL (30 seconds by default).

Configure a dedicated data directory, private API key, localhost listen address,
and native per-chat context mapping as described in the acceptance report. This
patch does not change existing container port bindings. Replacing an existing
worker requires separately approved, scoped maintenance and preservation of its
mounted files. Do not remove volumes or stop shared discovery/production workers.
The acceptance run retained its old chat workers under backup names and reused
their existing file mounts; a potentially shared discovery worker was untouched.

This patch does not provide remote networking, multi-supervisor coordination,
or a production deployment. Prefer an upstream release carrying equivalent fixes
when updating this separately versioned dependency, and remove the patch then.
