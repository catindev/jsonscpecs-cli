const { createEngine, CompilationError } = require('jsonspecs');
const { createOperators } = require('./operators');

function createCliEngine(project) {
  const { operators, meta } = createOperators(project);
  return {
    engine: createEngine({ operators }),
    operatorMeta: meta
  };
}

module.exports = { createCliEngine, CompilationError };
