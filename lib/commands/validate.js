const { resolveProject } = require('../project');
const { loadArtifactsFromDir } = require('../loader-fs');
const { createCliEngine, CompilationError } = require('../engine');
const { CliError } = require('../errors');

function runValidate(cwd = process.cwd()) {
  const project = resolveProject(cwd);
  const { artifacts, sources } = loadArtifactsFromDir(project.rulesDir);
  const { engine } = createCliEngine(project);
  try {
    engine.compile(artifacts, { sources });
    console.log(`[jsonspecs-cli] validate OK (${artifacts.length} artifacts)`);
    return 0;
  } catch (err) {
    if (err instanceof CompilationError && Array.isArray(err.errors)) {
      console.error('[jsonspecs-cli] validation failed:');
      err.errors.forEach((e, i) => console.error(`  ${i + 1}. ${e}`));
      return 1;
    }
    throw new CliError(err.message || String(err));
  }
}

module.exports = runValidate;
