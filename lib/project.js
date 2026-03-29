const fs = require('fs');
const path = require('path');
const { CliError } = require('./errors');
const { readJson } = require('./fs-utils');

function findProjectRoot(startDir = process.cwd()) {
  let current = path.resolve(startDir);
  while (true) {
    const manifest = path.join(current, 'manifest.json');
    if (fs.existsSync(manifest)) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function resolveProject(startDir = process.cwd()) {
  const root = findProjectRoot(startDir);
  if (!root) throw new CliError('manifest.json not found. Run this command from a jsonspecs rules project.');
  const manifestPath = path.join(root, 'manifest.json');
  const manifest = readJson(manifestPath);
  validateManifestShape(manifest, manifestPath);

  const pathsCfg = manifest.paths || {};
  const project = {
    root,
    manifestPath,
    manifest,
    rulesDir: path.resolve(root, pathsCfg.rules || './rules'),
    samplesDir: path.resolve(root, pathsCfg.samples || './samples'),
    docsDir: path.resolve(root, pathsCfg.docs || './docs'),
    distDir: path.resolve(root, pathsCfg.dist || './dist')
  };
  return project;
}

function validateManifestShape(manifest, manifestPath = 'manifest.json') {
  if (!manifest || typeof manifest !== 'object') throw new CliError(`${manifestPath}: manifest must be a JSON object`);
  const required = [
    ['project.id', manifest.project && manifest.project.id],
    ['project.title', manifest.project && manifest.project.title],
    ['project.description', manifest.project && manifest.project.description],
    ['project.language', manifest.project && manifest.project.language],
    ['paths.rules', manifest.paths && manifest.paths.rules],
    ['paths.samples', manifest.paths && manifest.paths.samples],
    ['paths.docs', manifest.paths && manifest.paths.docs],
    ['paths.dist', manifest.paths && manifest.paths.dist],
    ['studio.port', manifest.studio && manifest.studio.port],
    ['studio.openBrowser', manifest.studio && typeof manifest.studio.openBrowser === 'boolean' ? manifest.studio.openBrowser : undefined],
    ['build.snapshotFile', manifest.build && manifest.build.snapshotFile],
    ['build.buildInfoFile', manifest.build && manifest.build.buildInfoFile],
    ['catalog.fields', manifest.catalog && manifest.catalog.fields],
    ['catalog.entrypoints', manifest.catalog && manifest.catalog.entrypoints],
    ['catalog.artifacts', manifest.catalog && manifest.catalog.artifacts]
  ];
  const missing = required.filter(([, value]) => value === undefined || value === null || value === '').map(([key]) => key);
  if (missing.length) throw new CliError(`${manifestPath}: missing required fields: ${missing.join(', ')}`);

  const packs = manifest.operatorPacks && manifest.operatorPacks.node;
  if (packs != null && !Array.isArray(packs)) throw new CliError(`${manifestPath}: operatorPacks.node must be an array`);
}

function toStudioManifest(manifest, operatorMeta = null) {
  return {
    name: manifest.project?.title || manifest.project?.id || 'jsonspecs studio',
    description: manifest.project?.description || '',
    fields: manifest.catalog?.fields || {},
    entrypoints: manifest.catalog?.entrypoints || {},
    artifacts: manifest.catalog?.artifacts || {},
    operators: mergeOperatorDescriptions(manifest.catalog?.operators || {}, operatorMeta?.operators || {})
  };
}

function mergeOperatorDescriptions(manifestOperators, metaOperators) {
  return Object.assign({}, manifestOperators || {}, metaOperators || {});
}

module.exports = { resolveProject, findProjectRoot, validateManifestShape, toStudioManifest };
