import fs from "node:fs";
import path from "node:path";

function repoRoot() {
  return path.resolve(process.cwd());
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function fileExists(p) {
  try {
    fs.statSync(p);
    return true;
  } catch {
    return false;
  }
}

function normalizeArtifactPath(p) {
  const hashIndex = p.indexOf("#");
  return hashIndex === -1 ? p : p.slice(0, hashIndex);
}

const root = repoRoot();
const featuresPath = path.join(root, "apps/vscode-extension/features.json");
const spec = readJson(featuresPath);

const minFeatureCoverage = spec?.qualityGate?.minFeatureCoverage ?? 0.9;
const features = Array.isArray(spec.features) ? spec.features : [];
if (features.length === 0) {
  console.error("Feature coverage: no features defined.");
  process.exitCode = 1;
  process.exit();
}

let covered = 0;
const missingArtifacts = [];

for (const feature of features) {
  const verification = Array.isArray(feature.verification) ? feature.verification : [];
  if (verification.length > 0) covered += 1;
  for (const artifact of verification) {
    if (!artifact?.path) continue;
    const artifactPath = normalizeArtifactPath(String(artifact.path));
    const abs = path.join(root, artifactPath);
    if (!fileExists(abs)) missingArtifacts.push({ featureId: feature.id, path: artifactPath });
  }
}

const coverage = covered / features.length;
if (missingArtifacts.length > 0) {
  console.error("Feature coverage: missing verification artifacts:");
  for (const m of missingArtifacts) console.error(`- ${m.featureId}: ${m.path}`);
  process.exitCode = 1;
}

if (coverage < minFeatureCoverage) {
  console.error(
    `Feature coverage: ${(coverage * 100).toFixed(1)}% < ${(minFeatureCoverage * 100).toFixed(1)}%`,
  );
  process.exitCode = 1;
} else {
  console.log(
    `Feature coverage: ${(coverage * 100).toFixed(1)}% >= ${(minFeatureCoverage * 100).toFixed(1)}%`,
  );
}
