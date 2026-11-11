import { createPlugin } from './plugin'

// Signal K loads a plugin as a CommonJS module whose export is the constructor.
module.exports = createPlugin
