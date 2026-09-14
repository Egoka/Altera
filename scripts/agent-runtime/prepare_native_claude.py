#!/usr/bin/python3 -I
import importlib.util
from pathlib import Path
import sys
spec = importlib.util.spec_from_file_location('prepare_native', Path(__file__).with_name('prepare_native.py'))
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
try: raise SystemExit(module.main('claude', sys.argv[1:]))
except Exception: raise SystemExit(78)
