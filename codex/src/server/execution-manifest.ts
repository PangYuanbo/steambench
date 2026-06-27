import type { BenchmarkTask } from "../benchmark/types";
import type { RuntimeRunPlan } from "../runtime/events";
import type { RuntimeReadiness } from "../runtime/readiness";
import type { AgentProfile, BenchmarkRun } from "./store";

export type ArtifactContract = {
  name: "output.mp4";
  path: "output/output.mp4";
  canonical: true;
  forbiddenAlternates: string[];
};

export type ProofRequirement = {
  type: "steam-achievement" | "canonical-artifact" | "manual-review";
  status: "verified";
};

export type ExecutionManifest = {
  schemaVersion: "steambench.execution-manifest.v1";
  generatedAt: string;
  run: BenchmarkRun;
  task: BenchmarkTask;
  agent?: AgentProfile | null;
  plan: RuntimeRunPlan;
  readiness: RuntimeReadiness;
  launch: {
    command: string;
    args: string[];
    runtimeProvider: BenchmarkRun["runtimeProvider"];
    provider: AgentProfile["provider"] | "local";
  };
  artifactContract: ArtifactContract;
  proofRequirements: ProofRequirement[];
  livestream: {
    title: string;
    playbackPath: string;
    ingestRef: string;
  };
  stage2Contract: {
    outputDirectory: "output";
    allowedStartActions: string[];
    forbiddenStartActions: string[];
    preserveExistingOutputs: true;
  };
};

export function buildExecutionManifest(input: {
  run: BenchmarkRun;
  task: BenchmarkTask;
  agent?: AgentProfile | null;
  plan: RuntimeRunPlan;
  readiness: RuntimeReadiness;
  apiBaseUrl: string;
  generatedAt?: string;
}): ExecutionManifest {
  const primaryProofType = input.task.track === "achievement" ? "steam-achievement" : "manual-review";
  return {
    schemaVersion: "steambench.execution-manifest.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    run: input.run,
    task: input.task,
    agent: input.agent,
    plan: input.plan,
    readiness: input.readiness,
    launch: {
      command: input.agent?.command ?? "node scripts/runtime-worker.mjs",
      args: [
        `--api=${input.apiBaseUrl}`,
        `--task=${input.task.id}`,
        `--competitor=${input.run.competitor}`,
        `--worker=worker-${input.run.id}`
      ],
      runtimeProvider: input.agent?.runtimeProvider ?? input.run.runtimeProvider,
      provider: input.agent?.provider ?? "local"
    },
    artifactContract: {
      name: "output.mp4",
      path: "output/output.mp4",
      canonical: true,
      forbiddenAlternates: ["output-test.mp4"]
    },
    proofRequirements: [
      {
        type: primaryProofType,
        status: "verified"
      },
      {
        type: "canonical-artifact",
        status: "verified"
      }
    ],
    livestream: {
      title: `${input.run.competitor} plays ${input.task.gameName}: ${input.task.title}`,
      playbackPath: `/streams/${input.run.id}.m3u8`,
      ingestRef: `rtmp://localhost/steambench/${input.run.id}`
    },
    stage2Contract: {
      outputDirectory: "output",
      allowedStartActions: ["makedirs", "small-eval-required-installs"],
      forbiddenStartActions: [
        "session.run_file",
        "copy_task_inputs_to_output",
        "copy_project_files_to_output",
        "gcs_sync",
        "clear_existing_output_directories"
      ],
      preserveExistingOutputs: true
    }
  };
}
