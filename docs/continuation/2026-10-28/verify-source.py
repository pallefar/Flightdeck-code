#!/usr/bin/env python3
"""Read-only finite source identity verification; never executes application code."""
from pathlib import Path, PurePosixPath
import argparse
import hashlib
import json
import os
import subprocess
import sys

BANNED={'StudioIdeHeader.test.tsx','ide-header-layout.browser.tsx','ide-header-layout.test.tsx'}
def sha(data):return hashlib.sha256(data).hexdigest()
def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo',type=Path,default=Path.cwd())
    parser.add_argument('--manifest',type=Path,default=Path(__file__).with_name('public-source.json'))
    parser.add_argument('--source-dir',type=Path,help='Optional finite exported source directory; defaults to repository worktree')
    parser.add_argument('--git-only',action='store_true',help='Verify committed blobs only, useful for an index-only clone')
    args=parser.parse_args();repo=args.repo.resolve();source=(args.source_dir or repo).resolve()
    manifest=json.loads(args.manifest.read_bytes());rows=manifest['files']
    if len(rows)!=manifest['fileCount'] or len({r['path'] for r in rows})!=len(rows):raise ValueError('Invalid finite membership')
    for row in rows:
        p=PurePosixPath(row['path'])
        if p.is_absolute() or '..' in p.parts or any(x in BANNED or x=='.git' or x=='.env' or x.startswith('.env.') for x in p.parts):raise ValueError('Forbidden manifest member')
    env=dict(os.environ,GIT_OPTIONAL_LOCKS='0',GIT_CONFIG_NOSYSTEM='1',GIT_CONFIG_GLOBAL=os.devnull,GIT_TERMINAL_PROMPT='0')
    def git(*words):
        x=subprocess.run(['git','-c','core.fsmonitor=false','-c','core.hooksPath='+os.devnull,'-C',str(repo),*words],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=30)
        if x.returncode:raise RuntimeError('Git read failed: '+x.stderr.decode(errors='replace'))
        return x.stdout
    head=git('rev-parse','HEAD').decode().strip();errors=[]
    for row in rows:
        name=row['path'];b=git('show','HEAD:'+name)
        blob=hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()
        if len(b)!=row['bytes'] or sha(b)!=row['sha256'] or blob!=row['gitBlob']:errors.append({'path':name,'phase':'committed-blob-drift'})
        if not args.git_only:
            p=source/name
            cursor=p
            while cursor!=source:
                if cursor.is_symlink():errors.append({'path':name,'phase':'symlink-refused'});break
                cursor=cursor.parent
            else:
                if not p.is_file():errors.append({'path':name,'phase':'worktree-file-missing'})
                else:
                    b=p.read_bytes()
                    if len(b)!=row['bytes'] or sha(b)!=row['sha256']:errors.append({'path':name,'phase':'worktree-drift'})
    print(json.dumps({'passed':not errors,'checkedFinitePaths':len(rows),'head':head,'referenceSourceCommit':manifest['sourceCommit'],'mode':'committed-blobs-only' if args.git_only else 'committed-and-worktree','behaviorOrWholeRepositoryVerified':False,'readOnly':True,'errors':errors},indent=2))
    return 0 if not errors else 1
if __name__=='__main__':
    try:sys.exit(main())
    except (OSError,ValueError,KeyError,RuntimeError,subprocess.TimeoutExpired) as error:
        print(json.dumps({'passed':False,'readOnly':True,'error':str(error)},indent=2));sys.exit(2)
