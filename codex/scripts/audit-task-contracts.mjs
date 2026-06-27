import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const taskRoot = new URL("../benchmark_tasks/", import.meta.url);
const requiredForbiddenStartActions = [
  "session.run_file",
  "copy_task_inputs_to_output",
  "copy_project_files_to_output",
  "gcs_sync",
  "clear_existing_output_directories"
];
const forbiddenStartSourcePatterns = [
  "session.run_file",
  "gsutil",
  "gcloud",
  "shutil.copy",
  "shutil.copy2",
  "shutil.copyfile",
  "shutil.copytree",
  "shutil.rmtree",
  ".rmtree(",
  ".unlink(",
  "copy_task_inputs_to_output",
  "copy_project_files_to_output",
  "gcs_sync",
  "clear_existing_output_directories",
  "clear_output_directory"
];

function extractStartBlock(source) {
  const match = source.match(/\ndef start\([\s\S]*?(?=\n\ndef |\n\nclass |\n\n@dataclass|\n*$)/);
  return match?.[0] ?? "";
}

async function taskDirectories() {
  const entries = await readdir(taskRoot, { withFileTypes: true });
  const directories = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const path = join(taskRoot.pathname, entry.name);
    try {
      await stat(join(path, "task.json"));
      directories.push(path);
    } catch {
      // Directories without task.json are not task packages.
    }
  }
  return directories;
}

const failures = [];
const checked = [];

for (const directory of await taskDirectories()) {
  const manifestPath = join(directory, "task.json");
  const taskPath = join(directory, "task.py");
  const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
  const source = await readFile(taskPath, "utf-8");
  const startBlock = extractStartBlock(source);
  const label = manifest.id ?? directory;
  checked.push(label);

  if (manifest.targetVideoName !== "output.mp4") {
    failures.push(`${label}: targetVideoName must be output.mp4`);
  }
  if (manifest.contract?.requiresArtifact !== "output/output.mp4") {
    failures.push(`${label}: contract.requiresArtifact must be output/output.mp4`);
  }
  for (const action of requiredForbiddenStartActions) {
    if (!manifest.contract?.forbiddenStartActions?.includes(action)) {
      failures.push(`${label}: forbiddenStartActions missing ${action}`);
    }
  }
  if (!source.includes('TARGET_VIDEO_NAME = os.environ.get("TARGET_VIDEO_NAME", "output.mp4")')) {
    failures.push(`${label}: TARGET_VIDEO_NAME default must be output.mp4`);
  }
  if (!startBlock) {
    failures.push(`${label}: task.py must define start()`);
  }
  for (const pattern of forbiddenStartSourcePatterns) {
    if (startBlock.includes(pattern)) {
      failures.push(`${label}: start() contains forbidden pattern ${pattern}`);
    }
  }
}

if (failures.length > 0) {
  console.error("task contract audit failed");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`task contract audit passed for ${checked.length} task package${checked.length === 1 ? "" : "s"}`);
