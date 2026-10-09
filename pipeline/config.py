"""Region config loading. Thin wrapper over the YAML in pipeline/config/."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

CONFIG_DIR = Path(__file__).resolve().parent / "config"
DATA_DIR = Path(__file__).resolve().parent.parent / "data"


def load(region: str) -> dict[str, Any]:
    path = CONFIG_DIR / f"{region}.yaml"
    if not path.exists():
        available = sorted(p.stem for p in CONFIG_DIR.glob("*.yaml"))
        raise FileNotFoundError(f"no config for {region!r}; have: {', '.join(available)}")
    return yaml.safe_load(path.read_text())


def region_data_dir(region: str) -> Path:
    d = DATA_DIR / region
    d.mkdir(parents=True, exist_ok=True)
    return d
