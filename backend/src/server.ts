import http from 'node:http';
import { createApp } from './app';
import { env } from './config/env';
import { logger } from './utils/logger';
import { prisma } from './repositories/prisma';
import { hub } from './realtime/wsHub';
import { jobQueue } from './queue/jobQueue';
import { registerHandlers } from './queue/handlers';
import { scheduler } from './services/slaScheduler';

async function main() {
  await prisma.$connect();
  logger.info('Database connected');

  const app = createApp();
  const server = http.createServer(app);
  hub.attach(server);

  // Background processing: handlers -> crash recovery -> start the worker pool
  registerHandlers();
  await jobQueue.recover();
  jobQueue.start();
  scheduler.start();

  server.listen(env.PORT, () => {
    logger.info({ port: env.PORT, workers: env.WORKER_CONCURRENCY, timeScale: env.DEMO_TIME_SCALE }, 'Ticko backend listening (REST + WebSocket /ws)');
  });

  // Graceful shutdown (NFR-09): stop intake, return running jobs to the queue, close sockets, close DB
  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    logger.info({ signal }, 'Shutting down...');
    setTimeout(() => process.exit(1), 10_000).unref();
    scheduler.stop();
    await jobQueue.shutdown();
    await hub.close();
    server.close(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start');
  process.exit(1);
});
