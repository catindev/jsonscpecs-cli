function getJsonspecsVersion() {
  try {
    const mainPath = require.resolve('jsonspecs');
    const fs = require('fs');
    const path = require('path');
    let current = path.dirname(mainPath);
    for (let i = 0; i < 4; i++) {
      const candidate = path.join(current, 'package.json');
      if (fs.existsSync(candidate)) return JSON.parse(fs.readFileSync(candidate, 'utf8')).version || 'unknown';
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  } catch (_) {}
  return 'unknown';
}

const path = require('path');
const { resolveProject } = require('../project');
const { loadArtifactsFromDir } = require('../loader-fs');
const { createCliEngine, CompilationError } = require('../engine');
const { ensureDir, writeJson } = require('../fs-utils');

function runBuild(cwd = process.cwd()) {
  const project = resolveProject(cwd);
  const { artifacts, sources } = loadArtifactsFromDir(project.rulesDir);
  const { engine } = createCliEngine(project);
  try {
    engine.compile(artifacts, { sources });
  } catch (err) {
    if (err instanceof CompilationError && Array.isArray(err.errors)) {
      console.error('[jsonspecs-cli] build failed:');
      err.errors.forEach((e, i) => console.error(`  ${i + 1}. ${e}`));
      return 1;
    }
    throw err;
  }

  ensureDir(project.distDir);
  const snapshotFile = path.join(project.distDir, project.manifest.build.snapshotFile);
  const buildInfoFile = path.join(project.distDir, project.manifest.build.buildInfoFile);
  const now = new Date().toISOString();
  const snapshot = {
    version: '1',
    createdAt: now,
    createdBy: process.env.USER || process.env.USERNAME || 'unknown',
    description: project.manifest.project.description,
    manifest: project.manifest,
    artifactCount: artifacts.length,
    artifacts
  };
  const buildInfo = {
    projectId: project.manifest.project.id,
    projectTitle: project.manifest.project.title,
    builtAt: now,
    jsonspecsVersion: getJsonspecsVersion(),
    artifactCount: artifacts.length,
    entrypoints: artifacts.filter((a) => a.type === 'pipeline' && a.entrypoint === true).map((a) => a.id),
    nodeOperatorPacks: Array.isArray(project.manifest.operatorPacks?.node) ? project.manifest.operatorPacks.node : []
  };
  writeJson(snapshotFile, snapshot);
  writeJson(buildInfoFile, buildInfo);
  console.log(`[jsonspecs-cli] build OK`);
  console.log(`[jsonspecs-cli] snapshot: ${snapshotFile}`);
  console.log(`[jsonspecs-cli] build info: ${buildInfoFile}`);
  return 0;
}

module.exports = runBuild;
