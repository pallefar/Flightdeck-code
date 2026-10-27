"""Helpers for the optional DEVELOPMENT-only OpenHarness verifier."""
from pathlib import Path
import json
import os
import hashlib
import re
from urllib.parse import urlsplit
import base64
import io
import tarfile
import signal
import subprocess
import time
import argparse
import sys
import tempfile
import shutil
import platform
from pathlib import PurePosixPath


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description='Optional DEVELOPMENT-only actual OpenHarness verification (macOS sandbox-exec required).')
    parser.add_argument('--scratch-parent', type=Path, default=None, help='Existing trusted temporary directory; a new owned child is retained for reports.')
    args = parser.parse_args(argv)
    root = Path(tempfile.mkdtemp(prefix='flightdeck-openharness-', dir=args.scratch_parent)).resolve()
    here = Path(__file__).resolve().parent
    repo = here.parent.parent
    report = {'ok': False, 'productionIntegration': False, 'identity': 'DEVELOPMENT_PUBLIC_FIXTURE (not host authentication/grants)', 'processes': {}, 'reports': {}, 'failureStage': 'confinement-availability'}
    stage = 'confinement-availability'
    try:
        confined = sandbox_prefix(sys.platform, root)
        stage = 'prerequisites'
        node_name, npm_name = shutil.which('node'), shutil.which('npm')
        if not node_name or not npm_name:
            raise RuntimeError('Node and npm are required')
        node, npm = Path(node_name).resolve(), Path(npm_name).resolve()
        loader = repo / 'node_modules/tsx/dist/loader.mjs'
        tsc = repo / 'node_modules/typescript/bin/tsc'
        if not loader.is_file() or not tsc.is_file():
            raise RuntimeError('install the existing project development dependencies first')
        if not Path('/usr/bin/curl').is_file():
            raise RuntimeError('system curl required for pinned official artifact acquisition')
        for name in ['home', 'tmp', 'npm-cache']:
            (root / name).mkdir(mode=0o700)
        for name in ['empty-user.npmrc', 'empty-global.npmrc']:
            (root / name).write_bytes(b'')
        env = clean_environment(root, node)
        provenance = json.loads((here / 'provenance.json').read_bytes())
        lock_raw, manifest_raw = (here / 'package-lock.json').read_bytes(), (here / 'package.json').read_bytes()
        entries = validate_lock(lock_raw, manifest_raw, provenance['lockSha256'], provenance['manifestSha256'])
        report['provenance'] = provenance
        report['environment'] = env
        (root / 'package-lock.json').write_bytes(lock_raw)
        (root / 'package.json').write_bytes(manifest_raw)
        for name in ['confinement.mjs', 'runtime-proof.mjs', 'broker-proof.ts', 'api-conformance.mts', 'abort-drain.mjs']:
            shutil.copyfile(here / name, root / name)
        sources = ['packages/authoring-harness/src/' + name for name in ['broker.ts', 'internal.ts', 'schemas.ts', 'tools.ts', 'native.ts']]
        sources += ['packages/workflow/' + name for name in ['graph.ts', 'preservation.ts', 'data.ts']]
        sources += ['packages/guardrails/src/scrub.ts']
        report['flightdeckSourceSha256'] = {name: hashlib.sha256((repo / name).read_bytes()).hexdigest() for name in sources}
        # Each child gets an owned session, bounded wait, clean env and real exit record.
        commands = [
            ('confinement', confined + [str(node), str(root / 'confinement.mjs'), str(root.parent / (root.name + '-write-denied')), str(root / 'confinement.json')], 10, 2),
            ('runner-tests', confined + [sys.executable, '-B', '-m', 'unittest', 'discover', '-s', str(here), '-p', 'test_runner.py', '-v'], 20, None),
        ]
        for name, command, timeout, expected in commands:
            stage = name
            report['processes'][name] = run_process(command, root, env, root / (name + '.log'), timeout)
            report['processes'][name]['argv'] = command
            (root / 'process-status.json').write_text(json.dumps(report['processes'], indent=2) + '\n')
            if not report['processes'][name]['ok']:
                raise RuntimeError('required child process failed')
            if expected is not None:
                report['reports'][name] = checked_report(json.loads((root / (name + '.json')).read_bytes()), report['processes'][name], expected)
        # Acquisition can contact public npm; lifecycle execution stays disabled.
        # All child writes (including npm's) remain OS-confined to this owned root.
        acquisition = [confined[0], '-p', confined[2].replace('(deny network*)', '')]
        commands = [
            ('download', acquisition + ['/usr/bin/curl', '--disable', '--fail', '--silent', '--show-error', '--proto', '=https', '--tlsv1.2', '--max-time', '60', '--noproxy', '*', '--output', str(root / 'sdk.tgz'), provenance['tarball']], 70),
            ('install', acquisition + [str(node), str(npm), 'ci', '--ignore-scripts', '--no-audit', '--no-fund', '--include=optional', '--include=peer', '--registry=https://registry.npmjs.org/'], 180),
        ]
        for name, command, timeout in commands:
            stage = name
            report['processes'][name] = run_process(command, root, env, root / (name + '.log'), timeout)
            report['processes'][name]['argv'] = command
            (root / 'process-status.json').write_text(json.dumps(report['processes'], indent=2) + '\n')
            if not report['processes'][name]['ok']:
                raise RuntimeError('pinned artifact acquisition failed')
            if name == 'download':
                sdk = extract_sdk((root / 'sdk.tgz').read_bytes(), root / 'sdk', provenance['sha256'], provenance['integrity'], provenance['coreMembers'])
                sdk_manifest = json.loads((sdk / 'package.json').read_bytes())
                if sdk_manifest['name'] != provenance['package'] or sdk_manifest['version'] != provenance['version']:
                    raise ValueError('SDK manifest identity mismatch')
        stage = 'installed-graph'
        if (root / 'package-lock.json').read_bytes() != lock_raw or (root / 'package.json').read_bytes() != manifest_raw:
            raise ValueError('npm modified the audited lock or manifest')
        report['installedPackages'] = physical_packages(root, entries, sys.platform, 'arm64' if platform.machine() == 'arm64' else 'x64')
        report['lockedPackageCount'] = len(entries)
        report['installedPackageCount'] = len(report['installedPackages'])
        scope = root / 'node_modules/@open-harness'
        scope.mkdir(mode=0o700)
        (scope / 'sdk').symlink_to(sdk, target_is_directory=True)
        (sdk / 'node_modules').symlink_to(root / 'node_modules', target_is_directory=True)
        report['extractedSdkFilesSha256'] = {name: hashlib.sha256((root / 'sdk' / name).read_bytes()).hexdigest() for name in provenance['coreMembers']}
        broker_uri = (repo / 'packages/authoring-harness/src/broker.ts').as_uri()
        commands = [
            ('runtime', confined + [str(node), str(root / 'runtime-proof.mjs'), str(root / 'runtime.json')], 60, 27),
            ('broker', confined + [str(node), '--import', str(loader), str(root / 'broker-proof.ts'), broker_uri, str(root / 'broker.json')], 30, 6),
            ('abort-drain', confined + [str(node), '--import', str(loader), str(root / 'abort-drain.mjs'), broker_uri, str(root / 'abort-drain.json')], 30, 8),
            ('typecheck', confined + [str(node), str(tsc), '--noEmit', '--strict', '--skipLibCheck', 'false', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2022', '--types', 'node', '--typeRoots', str(repo / 'node_modules/@types'), str(root / 'api-conformance.mts')], 60, None),
        ]
        for name, command, timeout, expected in commands:
            stage = name
            report['processes'][name] = run_process(command, root, env, root / (name + '.log'), timeout)
            report['processes'][name]['argv'] = command
            (root / 'process-status.json').write_text(json.dumps(report['processes'], indent=2) + '\n')
            if not report['processes'][name]['ok']:
                raise RuntimeError('required real proof process failed')
            if expected is not None:
                report['reports'][name] = checked_report(json.loads((root / (name + '.json')).read_bytes()), report['processes'][name], expected)
        stage = 'final-boundaries'
        home = root / 'home/.openscaffold'
        if not home.is_dir() or list(home.iterdir()) or list((root / 'home').iterdir()) != [home]:
            raise ValueError('unexpected HOME persistence; explicit stores must avoid default database')
        if any(hashlib.sha256((repo / name).read_bytes()).hexdigest() != digest for name, digest in report['flightdeckSourceSha256'].items()):
            raise ValueError('Flightdeck source changed during verification')
        report['defaultDbExists'] = False
        report['checksPassed'] = sum(value['passed'] for value in report['reports'].values())
        report['ok'] = True
        report.pop('failureStage', None)
    except (RuntimeError, ValueError, OSError, KeyError, KeyboardInterrupt) as error:
        report['failureStage'] = stage
        report['failureCategory'] = type(error).__name__
    target = root / 'report.json'
    target.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'ok': report['ok'], 'checksPassed': report.get('checksPassed', 0), 'failureStage': report.get('failureStage'), 'report': str(target)}))
    return 0 if report['ok'] else 1


def physical_packages(root: Path, entries: dict, platform: str, arch: str) -> list:
    stack = [root / 'node_modules']
    found = []
    while stack:
        modules = stack.pop()
        if not modules.is_dir():
            continue
        packages = []
        for path in modules.iterdir():
            if path.name.startswith('.'):
                continue
            if path.is_symlink():
                raise ValueError('unexpected dependency symlink')
            packages.extend(path.iterdir() if path.name.startswith('@') else [path])
        for package in packages:
            key = package.relative_to(root).as_posix()
            if key not in entries or package.is_symlink() or not package.is_dir():
                raise ValueError('unlocked physical dependency')
            manifest = json.loads((package / 'package.json').read_bytes())
            identity = package.name if not package.parent.name.startswith('@') else package.parent.name + '/' + package.name
            if manifest.get('name') != identity or manifest.get('version') != entries[key]['version']:
                raise ValueError('physical dependency manifest differs from lock')
            found.append({'path': key, 'name': identity, 'version': manifest['version']})
            stack.append(package / 'node_modules')
    present = {item['path'] for item in found}
    for key, value in entries.items():
        if key not in present:
            incompatible = ('os' in value and platform not in value['os']) or ('cpu' in value and arch not in value['cpu'])
            if not value.get('optional') or not incompatible:
                raise ValueError('required physical dependency missing')
    return sorted(found, key=lambda item: item['path'])


def checked_report(report: dict, status: dict, expected: int) -> dict:
    checks = report.get('checks')
    if not status.get('ok') or status.get('exitCode') != 0 or not isinstance(checks, list):
        raise ValueError('probe process did not succeed')
    ids = [check.get('id') for check in checks if isinstance(check, dict)]
    if (len(checks) != expected or report.get('passed') != expected or len(ids) != expected
            or any(not isinstance(identity, str) or not identity for identity in ids)
            or len(set(ids)) != expected or any(check.get('passed') is not True for check in checks)):
        raise ValueError('probe checks missing, duplicate, failed or miscounted')
    return report


def run_process(argv: list, cwd: Path, env: dict, log: Path, timeout: float) -> dict:
    """Own the process group and record real exit state, not stdout sentinels."""
    started = time.monotonic()
    timed_out = False
    interrupted = False
    with log.open('xb') as output:
        process = subprocess.Popen(argv, cwd=cwd, env=env, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
        try:
            process.wait(timeout=timeout)
        except (subprocess.TimeoutExpired, KeyboardInterrupt) as error:
            timed_out = isinstance(error, subprocess.TimeoutExpired)
            interrupted = not timed_out
            # Signal only this session's group, even if the direct child exited.
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                process.wait(timeout=0.25)
            except subprocess.TimeoutExpired:
                pass
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait(timeout=5)
    return {'exitCode': process.returncode, 'ok': process.returncode == 0 and not timed_out and not interrupted,
            'timedOut': timed_out, 'interrupted': interrupted,
            'elapsedSeconds': time.monotonic() - started, 'log': log.name}


def extract_sdk(raw: bytes, destination: Path, sha256: str, integrity: str, members=None) -> Path:
    actual = 'sha512-' + base64.b64encode(hashlib.sha512(raw).digest()).decode('ascii')
    if len(raw) > 4_000_000 or hashlib.sha256(raw).hexdigest() != sha256 or actual != integrity:
        raise ValueError('SDK tarball integrity mismatch')
    selected = set(members) if members is not None else None
    with tarfile.open(fileobj=io.BytesIO(raw), mode='r:gz') as archive:
        members = archive.getmembers()
        seen = set()
        total = 0
        for member in members:
            path = PurePosixPath(member.name)
            total += member.size
            if (path.is_absolute() or '..' in path.parts or not path.parts or path.parts[0] != 'package'
                    or '\\' in member.name or member.name in seen or not (member.isfile() or member.isdir())
                    or member.size < 0 or total > 4_000_000 or len(members) > 256):
                raise ValueError('unsafe SDK tarball member')
            seen.add(member.name)
        if selected is not None and not selected.issubset(seen):
            raise ValueError('required SDK core member missing')
        destination.mkdir(mode=0o700)
        for member in members:
            if selected is not None and member.name not in selected:
                continue
            target = destination.joinpath(*PurePosixPath(member.name).parts)
            if member.isdir():
                target.mkdir(mode=0o700, parents=True, exist_ok=True)
            else:
                target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                source = archive.extractfile(member)
                if source is None:
                    raise ValueError('SDK tarball file missing')
                with source, target.open('xb') as output:
                    output.write(source.read())
                target.chmod(0o600)
    return destination / 'package'


def validate_lock(raw: bytes, manifest_raw: bytes, lock_sha: str, manifest_sha: str) -> dict:
    if hashlib.sha256(raw).hexdigest() != lock_sha or hashlib.sha256(manifest_raw).hexdigest() != manifest_sha:
        raise ValueError('audited dependency digest mismatch')
    lock, manifest = json.loads(raw), json.loads(manifest_raw)
    roots = manifest.get('dependencies', {})
    expected = {'effect': '3.19.15', 'immer': '10.2.0', 'zod': '3.25.76', '@effect/platform': '0.94.2', '@effect/sql': '0.49.0', '@effect/sql-libsql': '0.39.0', '@effect/experimental': '0.58.0', '@libsql/client': '0.12.0'}
    if lock.get('lockfileVersion') != 3 or roots != expected or lock['packages']['']['dependencies'] != expected:
        raise ValueError('not the audited core dependency closure')
    entries = {key: value for key, value in lock['packages'].items() if key}
    for key, value in entries.items():
        url = urlsplit(value.get('resolved', ''))
        if (not key.startswith('node_modules/') or any(word in key for word in ['@anthropic-ai', 'claude', 'ralph', '@open-harness'])
                or url.scheme != 'https' or url.netloc != 'registry.npmjs.org' or url.query or url.fragment
                or not re.fullmatch(r'\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?', value.get('version', ''))
                or not re.fullmatch(r'sha512-[A-Za-z0-9+/]{86}==', value.get('integrity', ''))):
            raise ValueError('unreviewed dependency lock entry')
    return entries


def sandbox_prefix(platform: str, root: Path, executable: Path = Path('/usr/bin/sandbox-exec')) -> list:
    """No unconfined fallback; native sensitivity checks must also succeed."""
    if platform != 'darwin' or not executable.is_file() or not os.access(executable, os.X_OK):
        raise RuntimeError('required macOS sandbox-exec confinement unavailable')
    profile = '(version 1)(allow default)(deny network*)(deny file-write* (require-not (subpath ' + json.dumps(str(root)) + ')))'
    return [str(executable), '-p', profile]


def clean_environment(root: Path, node: Path) -> dict:
    """Construct, never merge, child environments. No provider/auth lookup."""
    return {
        'PATH': str(node.parent) + ':/usr/bin:/bin',
        'HOME': str(root / 'home'), 'TMPDIR': str(root / 'tmp'),
        'TSX_DISABLE_CACHE': '1', 'NODE_DISABLE_COMPILE_CACHE': '1',
        'NPM_CONFIG_USERCONFIG': str(root / 'empty-user.npmrc'),
        'NPM_CONFIG_GLOBALCONFIG': str(root / 'empty-global.npmrc'),
        'NPM_CONFIG_CACHE': str(root / 'npm-cache'),
        'NPM_CONFIG_REGISTRY': 'https://registry.npmjs.org/',
    }
