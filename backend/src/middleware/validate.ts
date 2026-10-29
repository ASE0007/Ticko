import type { RequestHandler } from 'express';
import type { ZodTypeAny } from 'zod';

/** Validate + coerce body/query/params with Zod; unknown keys are stripped. */
export const validate =
  (schemas: { body?: ZodTypeAny; query?: ZodTypeAny; params?: ZodTypeAny }): RequestHandler =>
  (req, _res, next) => {
    try {
      if (schemas.params) req.params = schemas.params.parse(req.params);
      if (schemas.query) (req as { query: unknown }).query = schemas.query.parse(req.query);
      if (schemas.body) req.body = schemas.body.parse(req.body);
      next();
    } catch (e) {
      next(e);
    }
  };
