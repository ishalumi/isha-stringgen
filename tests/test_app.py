import tempfile
import unittest
from pathlib import Path

import app as app_module
from storage import StringStorage


class ConfigApiTestCase(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.env_path = Path(self.temp_dir.name) / '.env'
        self.db_path = Path(self.temp_dir.name) / 'strings.db'

        self.original_env_path = app_module.app.config.get('ENV_FILE_PATH')
        self.original_storage = app_module.storage
        self.original_prefix = app_module.generator.prefix

        app_module.app.config['TESTING'] = True
        app_module.app.config['ENV_FILE_PATH'] = self.env_path
        app_module.generator.prefix = 'custom-'
        app_module.storage = StringStorage(str(self.db_path))
        self.client = app_module.app.test_client()

    def tearDown(self):
        app_module.app.config['ENV_FILE_PATH'] = self.original_env_path
        app_module.storage = self.original_storage
        app_module.generator.prefix = self.original_prefix
        self.client = None
        self.temp_dir.cleanup()

    def test_patch_prefix_updates_runtime_and_examples(self):
        response = self.client.patch('/api/config/prefix', json={'prefix': 'live-'})
        self.assertEqual(response.status_code, 200)

        data = response.get_json()
        self.assertEqual(data['prefix'], 'live-')
        self.assertTrue(data['formats']['uuid']['example'].startswith('live-'))
        self.assertEqual(app_module.generator.prefix, 'live-')
        self.assertIn('STRING_PREFIX=live-', self.env_path.read_text(encoding='utf-8'))

        generate_response = self.client.post('/api/generate', json={
            'format': 'uuid_hex',
            'length': 32
        })
        self.assertEqual(generate_response.status_code, 200)
        self.assertTrue(generate_response.get_json()['value'].startswith('live-'))

    def test_get_config_reads_saved_host_and_port_from_env(self):
        self.env_path.write_text(
            'STRING_PREFIX=saved-\nSERVER_HOST=0.0.0.0\nSERVER_PORT=9001\n',
            encoding='utf-8'
        )
        app_module.generator.prefix = 'runtime-'

        response = self.client.get('/api/config')
        self.assertEqual(response.status_code, 200)

        data = response.get_json()
        self.assertEqual(data['prefix'], 'runtime-')
        self.assertEqual(data['saved_prefix'], 'saved-')
        self.assertEqual(data['server_host'], '0.0.0.0')
        self.assertEqual(data['server_port'], 9001)

    def test_save_generated_value_after_prefix_change_does_not_duplicate_prefix(self):
        app_module.generator.prefix = 'old-'
        app_module.persist_config(prefix='old-')

        app_module.generator.prefix = 'new-'
        app_module.persist_config(prefix='new-')

        response = self.client.post('/api/entries', json={
            'name': 'generated_key',
            'value': 'old-token-123',
            'format': 'hex',
            'length': 12,
            'enforce_prefix': False
        })
        self.assertEqual(response.status_code, 201)

        entry = response.get_json()['entry']
        self.assertEqual(entry['value'], 'old-token-123')


if __name__ == '__main__':
    unittest.main()
