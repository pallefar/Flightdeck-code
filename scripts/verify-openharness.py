#!/usr/bin/env python3
"""Optional development verifier. No application/runtime imports here."""
import sys
from pathlib import Path
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent / 'openharness'))
from runner import main

if __name__ == '__main__':
    raise SystemExit(main())
