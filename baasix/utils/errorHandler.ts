/**
 * API Error class for standardized error handling
 */
export class APIError extends Error {
  public statusCode: number;
  public isOperational: boolean;
  public details: any;

  constructor(message: string, statusCode: number = 500, details: any = null) {
    super(message);
    this.name = 'APIError';
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;

    // Capture stack trace
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Error handler middleware
 */
export function errorHandler(error: Error | APIError, req: any, res: any, next: any): void {
  // Check for APIError by instanceof OR by properties (handles npm link scenarios)
  const isAPIError = error instanceof APIError ||
                     (error as any).name === 'APIError' ||
                     (typeof (error as any).statusCode === 'number' && (error as any).isOperational);

  if (isAPIError) {
    const apiError = error as APIError;
    res.status(apiError.statusCode).json({
      error: {
        message: apiError.message,
        details: apiError.details,
        statusCode: apiError.statusCode
      }
    });
  } else {
    // Handle PostgreSQL/database errors
    const pgError = error as any;

    // Unique constraint violation (PostgreSQL error code 23505)
    if (pgError.code === '23505' || pgError.message?.includes('unique constraint') || pgError.message?.includes('duplicate key')) {
      return res.status(409).json({
        error: {
          message: 'Unique constraint violation',
          details: pgError.detail || pgError.message || 'A record with this value already exists',
          statusCode: 409
        }
      });
    }

    // Foreign key constraint violation (PostgreSQL error code 23503)
    if (pgError.code === '23503' || pgError.message?.includes('foreign key constraint')) {
      return res.status(409).json({
        error: {
          message: 'Foreign key constraint violation',
          details: pgError.detail || pgError.message || 'Referenced record does not exist',
          statusCode: 409
        }
      });
    }

    // Not null constraint violation (PostgreSQL error code 23502)
    if (pgError.code === '23502' || pgError.message?.includes('not null constraint')) {
      return res.status(400).json({
        error: {
          message: 'Required field missing',
          details: pgError.column || pgError.message || 'A required field was not provided',
          statusCode: 400
        }
      });
    }

    console.error('Unexpected error:', error);
    res.status(500).json({
      error: {
        message: 'Internal server error',
        details: pgError.message || error.message || 'An unexpected error occurred',
        statusCode: 500
      }
    });
  }
}
