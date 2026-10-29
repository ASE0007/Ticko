import rateLimit from 'express-rate-limit';
import { env } from '../config/env';

const skip = () => !env.RATE_LIMIT_ENABLED || env.NODE_ENV === 'test';
const body = { error: { code: 'RATE_LIMITED', message: 'Too many requests, slow down.' } };

export const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: true, legacyHeaders: false, skip, message: body });
export const apiLimiter = rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: true, legacyHeaders: false, skip, message: body });
export const publicLimiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false, skip, message: body });
