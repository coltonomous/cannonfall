/**
 * Structured JSON logger for the game server.
 * Outputs one JSON object per line — easy to parse with log aggregators.
 */

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const minLevel = LEVELS[process.env.LOG_LEVEL || 'info'] ?? LEVELS.info;

function log(level, message, data) {
  if (LEVELS[level] < minLevel) return;
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...data,
  };
  const out = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  out.write(JSON.stringify(entry) + '\n');
}

export const logger = {
  debug: (msg, data) => log('debug', msg, data),
  info:  (msg, data) => log('info', msg, data),
  warn:  (msg, data) => log('warn', msg, data),
  error: (msg, data) => log('error', msg, data),
};
