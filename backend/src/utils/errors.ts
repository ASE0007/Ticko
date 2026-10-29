/** Application error with a stable machine-readable code (API design, section 7). */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const Errors = {
  badRequest: (message: string, details?: unknown) => new AppError(400, 'VALIDATION_ERROR', message, details),
  unauthorized: (message = 'Authentication required') => new AppError(401, 'UNAUTHORIZED', message),
  forbidden: (message = 'You do not have permission to do this') => new AppError(403, 'FORBIDDEN', message),
  notFound: (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found`),
  versionConflict: () =>
    new AppError(409, 'VERSION_CONFLICT', 'This record was changed by someone else. Reload and try again.'),
  alreadyAssigned: () => new AppError(409, 'ALREADY_ASSIGNED', 'This ticket already has an owner.'),
  atCapacity: () => new AppError(409, 'TECHNICIAN_AT_CAPACITY', 'Technician has reached the active ticket limit.'),
  invalidTransition: (from: string, to: string) =>
    new AppError(422, 'INVALID_TRANSITION', `Cannot move from ${from} to ${to}`),
  technicianUnavailable: () => new AppError(409, 'TECHNICIAN_UNAVAILABLE', 'Technician is off duty.'),
  conflict: (code: string, message: string) => new AppError(409, code, message),
  unprocessable: (code: string, message: string) => new AppError(422, code, message),
  stepLocked: () => new AppError(422, 'STEP_LOCKED', 'This step is waiting for previous steps to finish.'),
  tooMany: () => new AppError(429, 'RATE_LIMITED', 'Too many requests, slow down.'),
};
