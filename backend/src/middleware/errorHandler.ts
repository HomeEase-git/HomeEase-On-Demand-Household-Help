import { Request, Response, NextFunction } from 'express';
import { ApiError } from '@utils/errorResponse';

const isProduction = process.env.NODE_ENV === 'production';

export const errorHandler = (
  error: Error | ApiError,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  if (error instanceof ApiError) {
    // A 4xx is the client's mistake, not a bug — logged quietly so it isn't
    // sent to error monitoring (which reports console.error).
    if (error.statusCode >= 500) console.error('Error:', error);
    else console.warn('Request error:', error.statusCode, error.message);
    res.status(error.statusCode).json({
      success: false,
      message: error.message,
      error: error.message,
    });
    return;
  }

  // Errors from Express's own middleware (malformed JSON, body too large)
  // carry a 4xx status: the client's mistake, answered as such.
  const status = (error as { status?: unknown }).status;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    console.warn('Request error:', status, error.message);
    res.status(status).json({ success: false, message: error.message, error: error.message });
    return;
  }

  console.error('Error:', error);
  const message = isProduction ? 'Internal server error' : error.message;

  res.status(500).json({
    success: false,
    message,
    error: message,
  });
};
