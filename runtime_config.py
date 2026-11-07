"""Portable configuration adapter only. No replacement pipeline implementation."""
from pathlib import Path
import os
import yaml

def policy(root):
    path = Path(root) / "workspace/job-search/profile/policy.yaml"
    return yaml.safe_load(path.read_text()) or {} if path.exists() else {}

def candidate(root):
    path = Path(root) / "workspace/job-search/profile/candidate.yaml"
    return yaml.safe_load(path.read_text()) or {} if path.exists() else {}
