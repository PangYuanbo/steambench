# Achievement Capture Task Contract

This Stage 2 task contract validates that a human or runtime agent produced the canonical gameplay capture artifact for a Steam achievement attempt.

## Canonical Artifact

`TARGET_VIDEO_NAME` defaults to `output.mp4`. Keep this value aligned across code, bucket fixtures, VM packages, task docs, and local smoke helpers.

## Stage 2 `start()` Boundary

`start()` is intentionally minimal:

- creates the output directory if needed;
- returns the expected artifact path and app metadata;
- does not run project files;
- does not copy task inputs or software projects into `output/`;
- does not sync with GCS;
- does not clear existing output directories.

## Local Smoke

```bash
npm run smoke:task
```

## Blind Eval

```bash
python3 benchmark_tasks/achievement_capture/blind_eval.py --output-dir output
```

The evaluator only accepts the canonical `output.mp4` artifact.
