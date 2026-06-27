from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path


TASK_PATH = Path(__file__).with_name("task.py")


def load_task_module():
    spec = importlib.util.spec_from_file_location("achievement_capture_task", TASK_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load task module at {TASK_PATH}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def main() -> None:
    parser = argparse.ArgumentParser(description="Blind evaluator for the achievement_capture task contract.")
    parser.add_argument("--output-dir", default="output", help="Directory containing the evaluated output.mp4 artifact.")
    args = parser.parse_args()

    task = load_task_module()
    result = task.evaluate(output_dir=args.output_dir)
    print(json.dumps(result, indent=2, sort_keys=True))
    raise SystemExit(0 if result["passed"] else 1)


if __name__ == "__main__":
    main()
