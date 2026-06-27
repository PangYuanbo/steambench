from __future__ import annotations

import importlib.util
import sys
import tempfile
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
    task = load_task_module()
    with tempfile.TemporaryDirectory() as tmp:
        output_dir = Path(tmp) / "output"
        sentinel = output_dir / "keep.txt"
        output_dir.mkdir()
        sentinel.write_text("do not delete", encoding="utf-8")

        start_result = task.start(output_dir=str(output_dir))
        assert start_result.target_video_name == "output.mp4"
        assert sentinel.exists(), "start() must not clear an existing output directory"
        assert not Path(start_result.target_video_path).exists(), "start() must not fabricate evaluated output"

        missing = task.evaluate(output_dir=str(output_dir))
        assert missing["passed"] is False

        Path(start_result.target_video_path).write_bytes(b"fake-video")
        passed = task.evaluate(output_dir=str(output_dir))
        assert passed["passed"] is True
        assert passed["targetVideoName"] == "output.mp4"

        wrong_name = output_dir / "output-test.mp4"
        wrong_name.write_bytes(b"wrong-video")
        Path(start_result.target_video_path).unlink()
        missing_canonical = task.evaluate(output_dir=str(output_dir))
        assert missing_canonical["passed"] is False
        assert missing_canonical["targetVideoName"] == "output.mp4"

    print("achievement_capture smoke passed")


if __name__ == "__main__":
    main()
