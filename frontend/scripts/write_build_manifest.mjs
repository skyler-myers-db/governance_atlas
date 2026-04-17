import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FRONTEND_ROOT = path.resolve(__dirname, "..");
const PROJECT_ROOT = path.resolve(FRONTEND_ROOT, "..");
const DIST_DIR = path.join(FRONTEND_ROOT, "dist");
const OUTPUT_PATH = path.join(DIST_DIR, "govhub-build-manifest.json");

const FRONTEND_HASH_FILE_PATHS = [
  "frontend/index.html",
  "frontend/package.json",
  "frontend/package-lock.json",
  "frontend/eslint.config.js",
  "frontend/tsconfig.json",
  "frontend/vite.config.js",
];
const FRONTEND_HASH_DIRS = ["frontend/src"];

async function existingFile(relativePath) {
  const absolutePath = path.join(PROJECT_ROOT, relativePath);
  try {
    const stats = await fs.stat(absolutePath);
    return stats.isFile() ? absolutePath : null;
  } catch {
    return null;
  }
}

async function collectDirFiles(relativeDir) {
  const absoluteDir = path.join(PROJECT_ROOT, relativeDir);
  try {
    const stats = await fs.stat(absoluteDir);
    if (!stats.isDirectory()) return [];
  } catch {
    return [];
  }

  const files = [];
  async function visit(currentDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const nextPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await visit(nextPath);
        continue;
      }
      if (entry.isFile()) files.push(nextPath);
    }
  }

  await visit(absoluteDir);
  return files;
}

async function frontendSourceHash() {
  const digest = crypto.createHash("sha256");
  const files = [];

  for (const relativePath of FRONTEND_HASH_FILE_PATHS) {
    const absolutePath = await existingFile(relativePath);
    if (absolutePath) files.push(absolutePath);
  }

  for (const relativeDir of FRONTEND_HASH_DIRS) {
    files.push(...(await collectDirFiles(relativeDir)));
  }

  for (const absolutePath of files) {
    const relativePath = path.relative(PROJECT_ROOT, absolutePath).split(path.sep).join("/");
    digest.update(relativePath);
    digest.update("\0");
    digest.update(await fs.readFile(absolutePath));
    digest.update("\0");
  }

  return digest.digest("hex");
}

await fs.mkdir(DIST_DIR, { recursive: true });

const sourceHash = await frontendSourceHash();
const buildId = process.env.GOVHUB_BUILD_ID || `frontend-${sourceHash.slice(0, 12)}`;
const manifest = {
  buildId,
  generatedAt: new Date().toISOString(),
  sourceHash,
  runtimeChain: {
    appYaml: "app.yaml",
    launcher: "run_app.py",
    backendModule: "runtime_app.py",
    frontendDist: "frontend/dist/index.html",
  },
};

await fs.writeFile(OUTPUT_PATH, JSON.stringify(manifest, null, 2));
