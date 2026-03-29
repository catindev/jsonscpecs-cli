const fs = require('fs');
const path = require('path');
const { CliError } = require('./errors');

function loadArtifactsFromDir(rulesDir) {
  if (!rulesDir || typeof rulesDir !== 'string') throw new CliError('rulesDir must be a non-empty string');
  const root = path.resolve(rulesDir);
  if (!fs.existsSync(root)) throw new CliError(`Rules directory not found: ${root}`);

  const artifacts = [];
  const sources = new Map();
  walk(root, root, artifacts, sources);
  return { artifacts, sources };
}

function walk(root, dir, artifacts, sources) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(root, full, artifacts, sources);
      continue;
    }
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.json')) continue;
    const raw = fs.readFileSync(full, 'utf8');
    const obj = JSON.parse(raw);
    const rel = path.relative(root, full).replace(/\\/g, '/');
    if (typeof obj.id !== 'string' || !obj.id) {
      throw new CliError(`Artifact in ${rel} is missing required string field \"id\"`);
    }
    artifacts.push(obj);
    sources.set(obj.id, { file: full, rel });
  }
}

module.exports = { loadArtifactsFromDir };
