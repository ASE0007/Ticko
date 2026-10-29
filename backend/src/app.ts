import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { randomUUID } from 'node:crypto';
import { env } from './config/env';
import { logger } from './utils/logger';
import { prisma } from './repositories/prisma';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { api } from './routes';
import { apiLimiter } from './middleware/rateLimit';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // behind nginx / a load balancer: use the real client IP (rate limiting, logs)

  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const id = (req.headers['x-request-id'] as string) || randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },
      autoLogging: { ignore: (req) => req.url === '/healthz' },
    }),
  );
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN.split(','), credentials: true }));
  app.use(express.json({ limit: '100kb' }));

  // Liveness: process is up
  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok', uptimeSec: Math.round(process.uptime()) });
  });

  // Readiness: dependencies are reachable
  app.get('/readyz', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: 'ready', db: 'up' });
    } catch {
      res.status(503).json({ status: 'not_ready', db: 'down' });
    }
  });

  app.use('/api', apiLimiter, api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
