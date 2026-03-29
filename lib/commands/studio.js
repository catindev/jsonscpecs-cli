const { resolveProject } = require('../project');
const { startStudio } = require('../studio-server');

function runStudio(cwd = process.cwd()) {
  const project = resolveProject(cwd);
  return startStudio(project);
}

module.exports = runStudio;
