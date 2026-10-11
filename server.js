import { createGameServer } from './server/game-server.js';
import { logger } from './server/logger.js';
import { GRACEFUL_SHUTDOWN_TIMEOUT_MS } from './shared/constants.js';

const server = createGameServer();
const port = await server.listen(Number(process.env.PORT) || 3000);
logger.info('Cannonfall server listening', { port });

function gracefulShutdown(signal) {
  logger.info('Graceful shutdown initiated', { signal });
  // Force exit if draining stalls
  setTimeout(() => {
    logger.warn('Forced shutdown after timeout');
    process.exit(1);
  }, GRACEFUL_SHUTDOWN_TIMEOUT_MS).unref();
  server.close().then(() => {
    logger.info('Server shut down gracefully');
    process.exit(0);
  });
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
