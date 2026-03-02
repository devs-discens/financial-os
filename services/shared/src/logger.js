/**
 * Structured logger for Financial OS services.
 * Controlled via LOG_LEVEL env var: DEBUG, INFO, WARN, ERROR (default: INFO).
 */

const LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };

const currentLevel = LEVELS[
  (process.env.LOG_LEVEL || 'INFO').toUpperCase()
] ?? LEVELS.INFO;

function ts() {
  return new Date().toISOString();
}

function createLogger(service) {
  function log(level, levelName, ...args) {
    if (level < currentLevel) return;
    const prefix = `${ts()} ${service} [${levelName}]`;
    if (level >= LEVELS.ERROR) {
      console.error(prefix, ...args);
    } else if (level >= LEVELS.WARN) {
      console.warn(prefix, ...args);
    } else {
      console.log(prefix, ...args);
    }
  }

  return {
    debug: (...args) => log(LEVELS.DEBUG, 'DEBUG', ...args),
    info: (...args) => log(LEVELS.INFO, 'INFO', ...args),
    warn: (...args) => log(LEVELS.WARN, 'WARN', ...args),
    error: (...args) => log(LEVELS.ERROR, 'ERROR', ...args),
  };
}

module.exports = { createLogger };
