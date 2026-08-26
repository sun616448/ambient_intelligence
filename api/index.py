"""
Vercel entrypoint.

Vercel's Python runtime only picks up functions inside an `api/` directory, and
this repository already has an `api.py` at the root. Rather than rename it, this
module loads that file by explicit path under a different module name, so there
is never a question of whether `import api` means the file or this directory.

Everything else — routes, GCS access, state — lives in the root modules and is
completely unaware of Vercel. That is deliberate: the only Vercel-specific files
in the repository are this one and vercel.json, so moving to Cloud Run later
means writing a Dockerfile, not unpicking a deployment from the application.

Local development does not use this file at all:

    python3 -m uvicorn api:app --port 8000
"""

import importlib.util
import os
import sys

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# The application's own imports (config, loader, gap_detector, state, …) are
# resolved relative to the repository root, which is not on sys.path when a
# function is invoked from inside api/.
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

_spec = importlib.util.spec_from_file_location(
    "ami_api", os.path.join(_ROOT, "api.py")
)
_module = importlib.util.module_from_spec(_spec)
sys.modules["ami_api"] = _module
_spec.loader.exec_module(_module)

# Vercel's Python runtime serves whatever ASGI application is bound to `app`.
app = _module.app
