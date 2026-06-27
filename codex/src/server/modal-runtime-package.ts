import type { BenchmarkTask } from "../benchmark/types";
import type { AgentProfile, BenchmarkRun, RuntimeDispatch } from "./store";

export type ModalRuntimePackage = {
  schemaVersion: "steambench.modal-runtime-package.v1";
  generatedAt: string;
  dispatchId: string;
  runId: string;
  taskId: string;
  agentId?: string;
  workerId: string;
  apiBaseUrl: string;
  command: string;
  entrypoint: {
    file: "modal/steambench_runtime.py";
    localEntrypoint: "main";
    remoteFunction: "run_steambench";
  };
  image: {
    base: "modal.Image.debian_slim";
    pythonVersion: "3.13";
    aptPackages: string[];
    pipPackages: string[];
    localMounts: Array<{
      localPath: string;
      remotePath: string;
      copy: false;
      ignore: string[];
    }>;
    workdir: string;
  };
  modal: {
    appName: "steambench-runtime";
    timeoutSeconds: number;
    cpu: number;
    memoryMb: number;
    secrets: Array<{
      name: string;
      requiredKeys: string[];
    }>;
    volumes: Array<{
      name: string;
      mountPath: string;
      purpose: string;
    }>;
  };
  runtime: {
    manifestUrl: string;
    runtimePackageUrl: string;
    targetArtifactName: "output.mp4";
    outputPath: "output/output.mp4";
    stage2StartPolicy: {
      preserveExistingOutputs: true;
      allowedStartActions: string[];
      forbiddenStartActions: string[];
    };
  };
  context: {
    run: Pick<BenchmarkRun, "id" | "taskId" | "competitor" | "runtimeProvider" | "status">;
    task: Pick<BenchmarkTask, "id" | "appid" | "gameName" | "title" | "track" | "estimatedRuntimeMinutes">;
    agent?: Pick<AgentProfile, "id" | "handle" | "provider" | "runtimeProvider" | "capabilities">;
  };
};

function absoluteUrl(apiBaseUrl: string, path: string): string {
  return `${apiBaseUrl.replace(/\/$/, "")}${path}`;
}

export function buildModalRuntimePackage(input: {
  dispatch: RuntimeDispatch;
  run: BenchmarkRun;
  task: BenchmarkTask;
  agent?: AgentProfile | null;
  apiBaseUrl: string;
  generatedAt?: string;
}): ModalRuntimePackage {
  const apiBaseUrl = input.apiBaseUrl.replace(/\/$/, "");
  const timeoutSeconds = Math.max(600, (input.task.estimatedRuntimeMinutes + 10) * 60);

  return {
    schemaVersion: "steambench.modal-runtime-package.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    dispatchId: input.dispatch.id,
    runId: input.run.id,
    taskId: input.task.id,
    agentId: input.agent?.id,
    workerId: input.dispatch.workerId,
    apiBaseUrl,
    command: input.dispatch.command,
    entrypoint: {
      file: "modal/steambench_runtime.py",
      localEntrypoint: "main",
      remoteFunction: "run_steambench"
    },
    image: {
      base: "modal.Image.debian_slim",
      pythonVersion: "3.13",
      aptPackages: ["nodejs", "npm", "curl", "ffmpeg", "xvfb"],
      pipPackages: ["requests"],
      localMounts: [
        {
          localPath: ".",
          remotePath: "/root/steambench",
          copy: false,
          ignore: ["node_modules", "dist", "data", ".git", "../claude"]
        }
      ],
      workdir: "/root/steambench"
    },
    modal: {
      appName: "steambench-runtime",
      timeoutSeconds,
      cpu: 2,
      memoryMb: 4096,
      secrets: [
        {
          name: "steambench-worker-runtime",
          requiredKeys: ["STEAMBENCH_API_URL", "STEAMBENCH_WORKER_TOKEN"]
        }
      ],
      volumes: [
        {
          name: "steambench-steam-state",
          mountPath: "/steam-state",
          purpose: "Persist Steam account state and downloaded app files between runs."
        }
      ]
    },
    runtime: {
      manifestUrl: absoluteUrl(apiBaseUrl, input.dispatch.manifestUrl),
      runtimePackageUrl: absoluteUrl(apiBaseUrl, input.dispatch.runtimePackageUrl),
      targetArtifactName: "output.mp4",
      outputPath: "output/output.mp4",
      stage2StartPolicy: {
        preserveExistingOutputs: true,
        allowedStartActions: ["makedirs", "small-eval-required-installs"],
        forbiddenStartActions: [
          "session.run_file",
          "copy_task_inputs_to_output",
          "copy_project_files_to_output",
          "gcs_sync",
          "clear_existing_output_directories"
        ]
      }
    },
    context: {
      run: {
        id: input.run.id,
        taskId: input.run.taskId,
        competitor: input.run.competitor,
        runtimeProvider: input.run.runtimeProvider,
        status: input.run.status
      },
      task: {
        id: input.task.id,
        appid: input.task.appid,
        gameName: input.task.gameName,
        title: input.task.title,
        track: input.task.track,
        estimatedRuntimeMinutes: input.task.estimatedRuntimeMinutes
      },
      agent: input.agent
        ? {
            id: input.agent.id,
            handle: input.agent.handle,
            provider: input.agent.provider,
            runtimeProvider: input.agent.runtimeProvider,
            capabilities: input.agent.capabilities
          }
        : undefined
    }
  };
}
