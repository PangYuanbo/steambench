import { pathToFileURL } from "node:url";
import { parseCliArgs } from "./steam-ingest.mjs";
import { verifyCertificate } from "./result-certificate-verify.mjs";

const args = parseCliArgs();

const certificateIndexKinds = new Set([
  "all",
  "run",
  "match",
  "challenge",
  "suite-race",
  "agent-campaign",
  "human-agent-comparison",
  "competition-event",
  "broadcast",
  "game-competition",
  "game-coverage-run"
]);

function boolArg(name, fallback = false) {
  const value = args.get(name);
  if (value === undefined) return fallback;
  return value === "1" || value === "true" || value === "yes";
}

function configFromArgs() {
  const kind = args.get("kind") ?? "all";
  if (!certificateIndexKinds.has(kind)) {
    throw new Error(`Invalid --kind=${kind}. Use one of: ${[...certificateIndexKinds].join(", ")}.`);
  }
  const requestedLimit = Number(args.get("limit") ?? 50);
  if (!Number.isFinite(requestedLimit) || requestedLimit < 1) {
    throw new Error("Invalid --limit. Use a positive number.");
  }
  return {
    baseUrl: args.get("api") ?? process.env.STEAMBENCH_API_URL ?? "http://127.0.0.1:8787",
    kind,
    limit: Math.min(200, Math.floor(requestedLimit)),
    verify: boolArg("verify", true),
    remote: boolArg("remote", true)
  };
}

function resolveUrl(baseUrl, url) {
  if (/^https?:\/\//.test(url)) return url;
  return `${baseUrl.replace(/\/$/, "")}${url.startsWith("/") ? url : `/${url}`}`;
}

async function readJsonUrl(url, options) {
  const response = await fetch(url, {
    headers: { "content-type": "application/json" },
    ...options
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const error = new Error(`${url} failed with ${response.status}: ${text}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function unwrapCertificate(payload) {
  return payload?.certificate ?? payload;
}

async function remoteVerify(baseUrl, certificate) {
  const response = await fetch(resolveUrl(baseUrl, "/api/result-certificates/verify"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ certificate })
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  return {
    status: response.status,
    verification: payload?.verification
  };
}

function entryErrors(entry) {
  const errors = [];
  if (!entry || typeof entry !== "object") {
    return ["invalid_index_entry"];
  }
  if (!certificateIndexKinds.has(entry.kind)) errors.push("invalid_kind");
  if (entry.readyForPublicShare !== true) errors.push("not_public_share_ready");
  if (entry.verificationMethod !== "sha256") errors.push("invalid_verification_method");
  if (!/^[a-f0-9]{64}$/.test(entry.fingerprint ?? "")) errors.push("invalid_index_fingerprint");
  if (typeof entry.links?.resultCertificate !== "string") errors.push("missing_result_certificate_link");
  if (entry.canonicalArtifactName !== "output.mp4") errors.push("invalid_canonical_artifact");
  return errors;
}

async function auditIndexEntry(config, entry) {
  const errors = entryErrors(entry);
  const resultCertificateUrl = typeof entry?.links?.resultCertificate === "string"
    ? resolveUrl(config.baseUrl, entry.links.resultCertificate)
    : undefined;

  if (!config.verify || !resultCertificateUrl) {
    return {
      kind: entry?.kind,
      id: entry?.id,
      readyForPublicShare: entry?.readyForPublicShare,
      fingerprint: entry?.fingerprint,
      resultCertificateUrl,
      localValid: undefined,
      remoteValid: undefined,
      valid: errors.length === 0,
      errors
    };
  }

  const certificate = unwrapCertificate(await readJsonUrl(resultCertificateUrl));
  const localVerification = verifyCertificate(certificate);
  const certificateFingerprint = certificate?.verification?.fingerprint;
  if (!localVerification.valid) errors.push(...localVerification.errors);
  if (entry.fingerprint !== certificateFingerprint) errors.push("index_certificate_fingerprint_mismatch");
  if (entry.fingerprint !== localVerification.actualFingerprint) errors.push("index_actual_fingerprint_mismatch");

  const remote = config.remote ? await remoteVerify(config.baseUrl, certificate) : undefined;
  const remoteVerification = remote?.verification;
  if (remoteVerification && !remoteVerification.valid) errors.push(...remoteVerification.errors.map((error) => `remote:${error}`));
  if (remoteVerification && remoteVerification.actualFingerprint !== localVerification.actualFingerprint) {
    errors.push("remote_actual_fingerprint_mismatch");
  }
  if (remoteVerification && remoteVerification.expectedFingerprint !== localVerification.expectedFingerprint) {
    errors.push("remote_expected_fingerprint_mismatch");
  }

  return {
    kind: entry.kind,
    id: entry.id,
    readyForPublicShare: entry.readyForPublicShare,
    fingerprint: entry.fingerprint,
    resultCertificateUrl,
    localValid: localVerification.valid,
    remoteStatus: remote?.status,
    remoteValid: remoteVerification?.valid,
    valid: errors.length === 0,
    errors
  };
}

async function runResultCertificateIndex(config = configFromArgs()) {
  const indexUrl = resolveUrl(
    config.baseUrl,
    `/api/result-certificates?kind=${encodeURIComponent(config.kind)}&limit=${encodeURIComponent(String(config.limit))}`
  );
  const payload = await readJsonUrl(indexUrl);
  const index = payload?.index;
  const certificates = Array.isArray(index?.certificates) ? index.certificates : [];
  const entries = [];
  for (const entry of certificates) {
    entries.push(await auditIndexEntry(config, entry));
  }
  const failed = entries.filter((entry) => !entry.valid);
  const byKind = entries.reduce((totals, entry) => {
    totals[entry.kind] = (totals[entry.kind] ?? 0) + 1;
    return totals;
  }, {});

  return {
    schemaVersion: "steambench.result-certificate-index-audit-cli.v1",
    generatedAt: new Date().toISOString(),
    api: config.baseUrl,
    source: {
      type: "url",
      url: indexUrl
    },
    request: {
      kind: config.kind,
      limit: config.limit,
      verify: config.verify,
      remote: config.remote
    },
    index: {
      schemaVersion: index?.schemaVersion,
      generatedAt: index?.generatedAt,
      requested: index?.requested,
      totals: index?.totals,
      links: index?.links
    },
    entries,
    summary: {
      valid: failed.length === 0,
      certificates: entries.length,
      verified: config.verify ? entries.length : 0,
      remoteVerified: config.verify && config.remote ? entries.length : 0,
      failed: failed.length,
      byKind
    }
  };
}

export { runResultCertificateIndex };

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runResultCertificateIndex()
    .then((summary) => {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
      if (!summary.summary.valid) process.exitCode = 2;
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
