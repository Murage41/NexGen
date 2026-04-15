import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

/**
 * Express middleware factory: validates req.body against a Zod schema.
 * Returns 400 with structured errors on failure.
 */
export function validate(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const errors = (result.error as ZodError).issues.map((i) => ({
        field: i.path.join('.'),
        message: i.message,
      }));
      // Flatten into the top-level `error` string so clients that only read
      // `error` (most of our UIs) still see the real reason instead of a
      // useless generic "Validation failed".
      const summary = errors
        .map((e) => (e.field ? `${e.field}: ${e.message}` : e.message))
        .join('; ');
      return res.status(400).json({
        success: false,
        error: summary || 'Validation failed',
        details: errors,
      });
    }
    req.body = result.data;
    next();
  };
}
