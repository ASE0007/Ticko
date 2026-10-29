import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';

export function notFoundHandler(req: Request, _res: Response, next: NextFunction) {
  next(new AppError(404, 'ROUTE_NOT_FOUND', `Route ${req.method} ${req.path} not found`));
}

/** Central error handler: every failure leaves the API in the same JSON shape. */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const requestId = String(req.id ?? '');
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Something went wrong';
  let details: unknown;

  if (err instanceof AppError) {
    ({ status, code, message, details } = err);
  } else if (err instanceof ZodError) {
    status = 400;
    code = 'VALIDATION_ERROR';
    message = 'Request validation failed';
    details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
  } else if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      status = 409;
      code = 'DUPLICATE';
      message = 'A record with the same unique value already exists';
    } else if (err.code === 'P2025') {
      status = 404;
      code = 'NOT_FOUND';
      message = 'Record not found';
    } else if (err.code === 'P2003') {
      status = 409;
      code = 'RELATION_CONFLICT';
      message = 'Operation violates a relation constraint';
    }
  } else if ((err as { type?: string })?.type === 'entity.parse.failed') {
    status = 400;
    code = 'INVALID_JSON';
    message = 'Malformed JSON body';
  }

  if (status >= 500) logger.error({ err, requestId }, 'Unhandled error');
  else logger.debug({ code, requestId }, message);

  res.status(status).json({ error: { code, message, details, requestId } });
}
