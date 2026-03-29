module.exports = {
  commands: {
    init: require('./lib/commands/init'),
    validate: require('./lib/commands/validate'),
    build: require('./lib/commands/build'),
    studio: require('./lib/commands/studio')
  }
};
