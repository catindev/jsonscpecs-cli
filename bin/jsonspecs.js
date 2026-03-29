#!/usr/bin/env node
const { CliError } = require('../lib/errors');

function printHelp() {
  console.log(`jsonspecs-cli v1.0.0\n\nCommands:\n  jsonspecs init <project-name>\n  jsonspecs studio\n  jsonspecs build\n  jsonspecs validate\n`);
}

(async function main() {
  const [, , command, ...args] = process.argv;
  try {
    switch (command) {
      case 'init':
        return require('../lib/commands/init')(args[0]);
      case 'studio':
        return require('../lib/commands/studio')();
      case 'build': {
        const code = require('../lib/commands/build')();
        process.exitCode = code;
        return;
      }
      case 'validate': {
        const code = require('../lib/commands/validate')();
        process.exitCode = code;
        return;
      }
      case '-h':
      case '--help':
      case undefined:
        return printHelp();
      default:
        throw new CliError(`Unknown command: ${command}`);
    }
  } catch (err) {
    if (err instanceof CliError) {
      console.error(`[jsonspecs-cli] ${err.message}`);
      process.exit(err.exitCode || 1);
    }
    console.error(err);
    process.exit(1);
  }
})();
