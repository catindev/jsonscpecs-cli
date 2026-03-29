const path = require('path');
const { Operators: BaseOperators } = require('jsonspecs');
const { CliError } = require('./errors');

function createOperators(project) {
  const merged = {
    predicate: { ...BaseOperators.predicate },
    check: { ...BaseOperators.check }
  };

  const meta = {
    operators: {}
  };

  const packs = getNodeOperatorPackSpecs(project?.manifest);
  for (const spec of packs) {
    const loaded = loadOperatorPack(spec, project?.root);
    mergeOperatorGroup(merged.check, loaded.check || {}, spec, 'check');
    mergeOperatorGroup(merged.predicate, loaded.predicate || {}, spec, 'predicate');
    mergeMeta(meta, loaded.meta);
  }

  return { operators: merged, meta };
}

function getNodeOperatorPackSpecs(manifest) {
  const specs = manifest?.operatorPacks?.node;
  if (specs == null) return [];
  if (!Array.isArray(specs)) throw new CliError('manifest.json: operatorPacks.node must be an array of module paths');
  return specs;
}

function loadOperatorPack(spec, projectRoot = process.cwd()) {
  if (!spec || typeof spec !== 'string') throw new CliError('Operator pack spec must be a non-empty string');

  let request = spec;
  if (spec.startsWith('.') || spec.startsWith('/')) request = path.resolve(projectRoot, spec);

  let pack;
  try {
    pack = require(request);
  } catch (err) {
    throw new CliError(`Failed to load operator pack "${spec}": ${err.message}`);
  }

  if (!pack || typeof pack !== 'object') {
    throw new CliError(`Operator pack "${spec}" must export an object`);
  }

  const normalized = pack.operators && typeof pack.operators === 'object'
    ? { ...pack.operators, meta: pack.meta }
    : pack;

  if (normalized.check != null && typeof normalized.check !== 'object') {
    throw new CliError(`Operator pack "${spec}": "check" must be an object`);
  }
  if (normalized.predicate != null && typeof normalized.predicate !== 'object') {
    throw new CliError(`Operator pack "${spec}": "predicate" must be an object`);
  }

  return normalized;
}

function mergeOperatorGroup(target, source, spec, role) {
  for (const [name, fn] of Object.entries(source)) {
    if (typeof fn !== 'function') {
      throw new CliError(`Operator pack "${spec}": ${role}.${name} must be a function`);
    }
    if (Object.prototype.hasOwnProperty.call(target, name)) {
      throw new CliError(`Operator pack "${spec}": ${role}.${name} conflicts with an existing operator`);
    }
    target[name] = fn;
  }
}

function mergeMeta(target, meta) {
  if (!meta || typeof meta !== 'object') return;
  const operators = meta.operators;
  if (!operators || typeof operators !== 'object') return;
  target.operators = target.operators || {};
  for (const [name, value] of Object.entries(operators)) target.operators[name] = value;
}

module.exports = { createOperators };
