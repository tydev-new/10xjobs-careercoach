"""Portable configuration adapter only. No replacement pipeline implementation."""
from pathlib import Path
import importlib.util
import yaml

_PROFILE_MOD = None

def profile_module():
    """The one profile loader, workspace/job-apps/lib/profile.py."""
    global _PROFILE_MOD
    if _PROFILE_MOD is not None:
        return _PROFILE_MOD
    path = Path(__file__).resolve().parent / "workspace/job-apps/lib/profile.py"
    spec = importlib.util.spec_from_file_location("jobbi_profile", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    _PROFILE_MOD = mod
    return mod

def policy(root):
    path = Path(root) / "workspace/job-search/profile/policy.yaml"
    return yaml.safe_load(path.read_text()) or {} if path.exists() else {}

def candidate(root):
    """Identity and contact from profile.yaml. Intake answers are separate fields."""
    return profile_module().identity(root)
