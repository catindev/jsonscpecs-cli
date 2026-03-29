class CliError extends Error {
  constructor(message, code = 1) {
    super(message);
    this.name = 'CliError';
    this.exitCode = code;
  }
}
module.exports = { CliError };
