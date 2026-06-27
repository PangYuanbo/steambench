import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseCliArgs } from "./steam-ingest.mjs";

const args = parseCliArgs();

const certificateSignedFields = [
  "schemaVersion",
  "kind",
  "id",
  "title",
  "status",
  "verdict",
  "canonicalArtifactName",
  "participants",
  "tasks",
  "result",
  "evidence",
  "links",
  "integrity"
];

function boolArg(name, fallback = false) {
  const value = args.get(name);
  if (value === undefined) return fallback;
  return value === "1" || value === "true" || value === "yes";
}

function configFromArgs() {
  const certificatePath = args.get("certificate") ?? args.get("file");
  const url = args.get("url");
  if (!certificatePath && !url) {
    throw new Error("Provide --certificate=<certificate.json> or --url=<certificate_endpoint>.");
  }
  if (certificatePath && url) {
    throw new Error("Provide only one certificate source: --certificate or --url.");
  }
  return {
    baseUrl: args.get("api") ?? process.env.STEAMBENCH_API_URL ?? "http://127.0.0.1:8787",
    certificatePath,
    url,
    remote: boolArg("remote", false)
  };
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function recordValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}

function signedFieldsMatch(fields) {
  return Array.isArray(fields) &&
    fields.length === certificateSignedFields.length &&
    fields.every((field, index) => field === certificateSignedFields[index]);
}

function unwrapCertificate(payload) {
  return payload?.certificate ?? payload;
}

function verifyCertificate(certificateInput) {
  const certificate = recordValue(certificateInput);
  const verification = recordValue(certificate?.verification);
  const expectedFingerprint = typeof verification?.fingerprint === "string" ? verification.fingerprint : undefined;
  const errors = [];

  if (!certificate) errors.push("invalid_certificate");
  if (certificate?.schemaVersion !== "steambench.result-certificate.v1") errors.push("invalid_certificate_schema");
  if (verification?.method !== "sha256") errors.push("invalid_verification_method");
  if (!expectedFingerprint || !/^[a-f0-9]{64}$/.test(expectedFingerprint)) errors.push("invalid_expected_fingerprint");
  if (!signedFieldsMatch(verification?.signedFields)) errors.push("invalid_signed_fields");

  const missingSignedFields = certificateSignedFields.filter((field) => certificate && !(field in certificate));
  if (missingSignedFields.length > 0) {
    errors.push(`missing_signed_fields:${missingSignedFields.join(",")}`);
  }

  let actualFingerprint;
  if (certificate) {
    const signedPayload = Object.fromEntries(certificateSignedFields.map((field) => [field, certificate[field]]));
    actualFingerprint = createHash("sha256").update(stableJson(signedPayload)).digest("hex");
    if (expectedFingerprint && actualFingerprint !== expectedFingerprint) {
      errors.push("fingerprint_mismatch");
    }
  }

  return {
    schemaVersion: "steambench.result-certificate-verification.v1",
    valid: errors.length === 0,
    method: "sha256",
    expectedFingerprint,
    actualFingerprint,
    signedFields: certificateSignedFields,
    errors,
    certificate: certificate
      ? {
          schemaVersion: typeof certificate.schemaVersion === "string" ? certificate.schemaVersion : undefined,
          kind: typeof certificate.kind === "string" ? certificate.kind : undefined,
          id: typeof certificate.id === "string" ? certificate.id : undefined,
          status: typeof certificate.status === "string" ? certificate.status : undefined,
          verdict: typeof certificate.verdict === "string" ? certificate.verdict : undefined,
          readyForPublicShare: typeof recordValue(certificate.integrity)?.readyForPublicShare === "boolean"
            ? recordValue(certificate.integrity)?.readyForPublicShare
            : undefined
        }
      : undefined
  };
}

function resolveUrl(baseUrl, url) {
  if (/^https?:\/\//.test(url)) return url;
  return `${baseUrl.replace(/\/$/, "")}${url.startsWith("/") ? url : `/${url}`}`;
}

async function readJsonUrl(url) {
  const response = await fetch(url, {
    headers: { "content-type": "application/json" }
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

async function loadCertificate(config) {
  if (config.certificatePath) {
    const payload = JSON.parse(await readFile(config.certificatePath, "utf8"));
    return {
      source: { type: "file", path: config.certificatePath },
      certificate: unwrapCertificate(payload)
    };
  }
  const resolvedUrl = resolveUrl(config.baseUrl, config.url);
  const payload = await readJsonUrl(resolvedUrl);
  return {
    source: { type: "url", url: resolvedUrl },
    certificate: unwrapCertificate(payload)
  };
}

async function remoteVerify(config, certificate) {
  const response = await fetch(resolveUrl(config.baseUrl, "/api/result-certificates/verify"), {
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

async function runResultCertificateVerify(config = configFromArgs()) {
  const loaded = await loadCertificate(config);
  const verification = verifyCertificate(loaded.certificate);
  const remote = config.remote ? await remoteVerify(config, loaded.certificate) : undefined;
  const remoteVerification = remote?.verification;
  return {
    schemaVersion: "steambench.result-certificate-verify-cli.v1",
    generatedAt: new Date().toISOString(),
    api: config.baseUrl,
    source: loaded.source,
    verification,
    remoteVerification,
    summary: {
      valid: verification.valid,
      kind: verification.certificate?.kind,
      id: verification.certificate?.id,
      readyForPublicShare: verification.certificate?.readyForPublicShare,
      expectedFingerprint: verification.expectedFingerprint,
      actualFingerprint: verification.actualFingerprint,
      errors: verification.errors,
      remoteStatus: remote?.status,
      remoteValid: remoteVerification?.valid,
      remoteMatches: remoteVerification
        ? remoteVerification.actualFingerprint === verification.actualFingerprint &&
          remoteVerification.expectedFingerprint === verification.expectedFingerprint &&
          remoteVerification.valid === verification.valid
        : undefined
    }
  };
}

export { runResultCertificateVerify, verifyCertificate };

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runResultCertificateVerify()
    .then((summary) => {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
      if (!summary.verification.valid) process.exitCode = 2;
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
