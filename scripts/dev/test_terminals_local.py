"""Run with the patched Terminals 0.2.2 interpreter from its source directory."""

import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from terminals.backends.docker import DockerBackend
from terminals.config import settings


def container_info(source):
    return {
        'Id': 'owned', 'Name': '/terminals-test', 'State': {'Running': True},
        'Mounts': [{'Destination': '/home/user', 'Source': source}],
        'Config': {'Labels': {'openwebui.com/user-id': 'test-user'},
                   'Env': ['OPEN_TERMINAL_API_KEY=test-only']},
        'NetworkSettings': {'Ports': {'8000/tcp': [{'HostPort': '55123'}]}},
    }


class LocalTerminalTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.root = tempfile.TemporaryDirectory()
        self.addCleanup(self.root.cleanup)
        for key, value in [('docker_data_dir', self.root.name), ('docker_network', ''),
                           ('docker_host', '127.0.0.1')]:
            self.enterContext(patch.object(settings, key, value))
        self.backend = DockerBackend()
        self.container = SimpleNamespace(
            show=AsyncMock(return_value=container_info(self.root.name + '/user')),
            start=AsyncMock(),
        )
        self.docker = SimpleNamespace(containers=SimpleNamespace(
            get=AsyncMock(return_value=self.container),
            create=AsyncMock(return_value=self.container),
            list=AsyncMock(return_value=[self.container]),
        ))
        self.backend._get_docker = AsyncMock(return_value=self.docker)

    async def test_provision_binds_only_loopback(self):
        self.backend._wait_until_ready = AsyncMock()
        await self.backend.provision('test-user', context_id='chat:test')
        config = self.docker.containers.create.call_args.args[0]['HostConfig']
        self.assertNotIn('PublishAllPorts', config)
        self.assertEqual(config['PortBindings'], {
            '8000/tcp': [{'HostIp': '127.0.0.1', 'HostPort': ''}],
        })

    async def test_status_refreshes_reassigned_port_in_place(self):
        tracked = {'instance_id': 'owned', 'instance_name': 'terminals-test',
                   'api_key': 'test-only', 'host': '127.0.0.1', 'port': 55006}
        self.backend._instances[('test-user', 'default', 'default')] = tracked
        self.assertEqual(await self.backend.status('owned'), 'running')
        self.assertEqual(tracked['port'], 55123)

    async def test_reconcile_ignores_other_data_roots(self):
        foreign = SimpleNamespace(show=AsyncMock(return_value=container_info(
            self.root.name + '-other/user'
        )))
        self.docker.containers.list.return_value = [foreign, self.container]
        self.backend._adopted_spec = AsyncMock(return_value={})
        self.backend._seed_adopted_activity = AsyncMock()
        await self.backend.reconcile()
        self.assertEqual(len(self.backend._instances), 1)
        self.backend._seed_adopted_activity.assert_awaited_once()


if __name__ == '__main__':
    unittest.main()
