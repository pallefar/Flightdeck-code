"""Current runner tests; execute with Python unittest, not Vitest."""
import importlib.util
import pathlib
import tempfile
import unittest

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('openharness_runner', HERE / 'runner.py')
assert spec is not None and spec.loader is not None
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)

class RunnerTests(unittest.TestCase):
    def test_children_receive_owned_home_and_no_ambient_environment(self):
        self.assertTrue(callable(getattr(runner, 'clean_environment', None)), 'clean_environment missing')
        root = pathlib.Path('/owned/development-fixture')
        env = runner.clean_environment(root, pathlib.Path('/public/node/bin/node'))
        self.assertEqual(env, {
            'PATH': '/public/node/bin:/usr/bin:/bin',
            'HOME': str(root / 'home'), 'TMPDIR': str(root / 'tmp'),
            'TSX_DISABLE_CACHE': '1', 'NODE_DISABLE_COMPILE_CACHE': '1',
            'NPM_CONFIG_USERCONFIG': str(root / 'empty-user.npmrc'),
            'NPM_CONFIG_GLOBALCONFIG': str(root / 'empty-global.npmrc'),
            'NPM_CONFIG_CACHE': str(root / 'npm-cache'),
            'NPM_CONFIG_REGISTRY': 'https://registry.npmjs.org/',
        })

    def test_missing_platform_confinement_fails_before_execution(self):
        self.assertTrue(callable(getattr(runner, 'sandbox_prefix', None)), 'sandbox_prefix missing')
        with self.assertRaisesRegex(RuntimeError, 'confinement unavailable'):
            runner.sandbox_prefix('linux', pathlib.Path('/owned'), pathlib.Path('/missing'))
        with self.assertRaisesRegex(RuntimeError, 'confinement unavailable'):
            runner.sandbox_prefix('darwin', pathlib.Path('/owned'), pathlib.Path('/missing'))
        with tempfile.TemporaryDirectory() as directory:
            executable = pathlib.Path(directory) / 'sandbox-exec'
            executable.write_text('# public fixture only\n')
            executable.chmod(0o700)
            prefix = runner.sandbox_prefix('darwin', pathlib.Path('/owned/quote"slash\\'), executable)
            self.assertEqual(prefix[:2], [str(executable), '-p'])
            self.assertIn('(deny network*)', prefix[2])
            self.assertIn('(deny file-write*', prefix[2])
            self.assertIn('quote\\"slash\\\\', prefix[2])

    def test_only_the_exact_official_core_lock_is_admitted(self):
        import hashlib
        import json
        self.assertTrue(callable(getattr(runner, 'validate_lock', None)), 'validate_lock missing')
        raw = (HERE / 'package-lock.json').read_bytes()
        manifest = (HERE / 'package.json').read_bytes()
        sha = lambda value: hashlib.sha256(value).hexdigest()
        entries = runner.validate_lock(raw, manifest, sha(raw), sha(manifest))
        self.assertEqual(len(entries), 49)
        with self.assertRaisesRegex(ValueError, 'digest'):
            runner.validate_lock(raw + b' ', manifest, sha(raw), sha(manifest))
        for field, value in [('resolved', 'https://untrusted.invalid/effect.tgz'), ('integrity', 'sha1-unreviewed'), ('version', 'latest')]:
            data = json.loads(raw)
            data['packages']['node_modules/effect'][field] = value
            mutated = json.dumps(data).encode()
            with self.assertRaises(ValueError):
                runner.validate_lock(mutated, manifest, sha(mutated), sha(manifest))
        data = json.loads(raw)
        data['packages']['node_modules/@anthropic-ai/claude-agent-sdk'] = data['packages']['node_modules/effect']
        mutated = json.dumps(data).encode()
        with self.assertRaises(ValueError):
            runner.validate_lock(mutated, manifest, sha(mutated), sha(manifest))

    def test_tarball_bytes_are_verified_before_safe_regular_extraction(self):
        import base64
        import hashlib
        import io
        import tarfile
        self.assertTrue(callable(getattr(runner, 'extract_sdk', None)), 'extract_sdk missing')
        def archive(name, link=False):
            out = io.BytesIO()
            with tarfile.open(fileobj=out, mode='w:gz') as tar:
                member = tarfile.TarInfo(name)
                if link:
                    member.type = tarfile.SYMTYPE
                    member.linkname = '/unowned'
                    tar.addfile(member)
                else:
                    member.size = 7
                    tar.addfile(member, io.BytesIO(b'fixture'))
            return out.getvalue()
        def integrity(raw):
            return 'sha512-' + base64.b64encode(hashlib.sha512(raw).digest()).decode()
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            raw = archive('package/dist/core.mjs')
            with self.assertRaisesRegex(ValueError, 'integrity'):
                runner.extract_sdk(raw, root / 'wrong', '0' * 64, integrity(raw))
            self.assertFalse((root / 'wrong').exists())
            package = runner.extract_sdk(raw, root / 'valid', hashlib.sha256(raw).hexdigest(), integrity(raw))
            self.assertEqual((package / 'dist/core.mjs').read_bytes(), b'fixture')
            for index, (name, link) in enumerate([('package/../../escape', False), ('/package/absolute', False), ('package/link', True)]):
                raw = archive(name, link)
                target = root / str(index)
                with self.assertRaises(ValueError):
                    runner.extract_sdk(raw, target, hashlib.sha256(raw).hexdigest(), integrity(raw))
                self.assertFalse(target.exists())

    def test_success_text_cannot_hide_a_later_process_failure(self):
        import sys
        self.assertTrue(callable(getattr(runner, 'run_process', None)), 'run_process missing')
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            status = runner.run_process([sys.executable, '-c', 'print("{\\"passed\\":99}"); raise SystemExit(7)'], root, {}, root / 'late.log', 5)
            self.assertEqual(status['exitCode'], 7)
            self.assertFalse(status['ok'])
            self.assertFalse(status['timedOut'])
            self.assertIn('"passed":99', (root / 'late.log').read_text())

    def test_timed_out_owned_process_is_killed_and_cannot_pass(self):
        import os
        import signal
        import sys
        self.assertTrue(callable(getattr(runner, 'run_process', None)))
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            pid_file = root / 'owned.pid'
            code = 'import os, pathlib, signal, time; pathlib.Path(' + repr(str(pid_file)) + ').write_text(str(os.getpid())); signal.signal(signal.SIGTERM, signal.SIG_IGN); time.sleep(5)'
            try:
                status = runner.run_process([sys.executable, '-c', code], root, {}, root / 'timeout.log', 0.1)
                self.assertTrue(status['timedOut'])
                self.assertFalse(status['ok'])
                self.assertEqual(status['exitCode'], -signal.SIGKILL)
                with self.assertRaises(ProcessLookupError):
                    os.kill(int(pid_file.read_text()), 0)
            finally:
                if pid_file.exists():
                    try:
                        os.kill(int(pid_file.read_text()), signal.SIGKILL)
                    except ProcessLookupError:
                        pass

    def test_reports_require_successful_process_and_exact_unique_checks(self):
        self.assertTrue(callable(getattr(runner, 'checked_report', None)), 'checked_report missing')
        valid = {'passed': 1, 'checks': [{'id': 'actual-check', 'passed': True}]}
        self.assertEqual(runner.checked_report(valid, {'ok': True, 'exitCode': 0}, 1), valid)
        invalid = [
            {'passed': 2, 'checks': valid['checks']},
            {'passed': 1, 'checks': [{'id': 'actual-check', 'passed': False}]},
            {'passed': 2, 'checks': valid['checks'] * 2},
        ]
        for report in invalid:
            with self.assertRaises(ValueError):
                runner.checked_report(report, {'ok': True, 'exitCode': 0}, report['passed'])
        with self.assertRaises(ValueError):
            runner.checked_report(valid, {'ok': False, 'exitCode': 7}, 1)
        with self.assertRaises(ValueError):
            runner.checked_report(valid, {'ok': True, 'exitCode': 0}, 27)

    def test_physical_packages_must_match_the_reviewed_lock(self):
        import json
        self.assertTrue(callable(getattr(runner, 'physical_packages', None)), 'physical_packages missing')
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            package = root / 'node_modules/effect'
            package.mkdir(parents=True)
            manifest = package / 'package.json'
            manifest.write_text(json.dumps({'name': 'effect', 'version': '3.19.15'}))
            entries = {'node_modules/effect': {'version': '3.19.15'}}
            self.assertEqual(len(runner.physical_packages(root, entries, 'darwin', 'arm64')), 1)
            manifest.write_text(json.dumps({'name': 'effect', 'version': '0.0.0'}))
            with self.assertRaises(ValueError):
                runner.physical_packages(root, entries, 'darwin', 'arm64')
            manifest.write_text(json.dumps({'name': 'effect', 'version': '3.19.15'}))
            unknown = root / 'node_modules/claude-agent-sdk'
            unknown.mkdir()
            (unknown / 'package.json').write_text('{}')
            with self.assertRaises(ValueError):
                runner.physical_packages(root, entries, 'darwin', 'arm64')

    def test_only_requested_core_members_are_extracted(self):
        import base64
        import hashlib
        import io
        import tarfile
        output = io.BytesIO()
        with tarfile.open(fileobj=output, mode='w:gz') as archive:
            for name in ['package/dist/core.mjs', 'package/dist/server.mjs']:
                member = tarfile.TarInfo(name)
                member.size = 7
                archive.addfile(member, io.BytesIO(b'fixture'))
        raw = output.getvalue()
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            package = runner.extract_sdk(raw, root / 'sdk', hashlib.sha256(raw).hexdigest(), 'sha512-' + base64.b64encode(hashlib.sha512(raw).digest()).decode(), members=['package/dist/core.mjs'])
            self.assertTrue((package / 'dist/core.mjs').is_file())
            self.assertFalse((package / 'dist/server.mjs').exists())

    def test_cli_refuses_unsupported_platform_without_acquisition(self):
        import contextlib
        import io
        import json
        from unittest.mock import patch
        self.assertTrue(callable(getattr(runner, 'main', None)), 'main missing')
        with tempfile.TemporaryDirectory() as directory:
            output = io.StringIO()
            with patch('sys.platform', 'linux'), contextlib.redirect_stdout(output):
                status = runner.main(['--scratch-parent', directory])
            self.assertEqual(status, 1)
            result = json.loads(output.getvalue())
            self.assertFalse(result['ok'])
            report = json.loads(pathlib.Path(result['report']).read_text())
            self.assertEqual(report['processes'], {})
            self.assertEqual(report['failureStage'], 'confinement-availability')
            self.assertFalse((pathlib.Path(result['report']).parent / 'npm-cache').exists())

if __name__ == '__main__':
    unittest.main()
