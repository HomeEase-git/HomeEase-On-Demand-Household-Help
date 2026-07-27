import { Request, Response, NextFunction } from 'express';
import { ApiError } from '@utils/errorResponse';

const isProduction = process.env.NODE_ENV === 'production';

export const errorHandler = (
  error: Error | ApiError,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  console.error('Error:', error);

  if (error instanceof ApiError) {
    res.status(error.statusCode).json({
      success: false,
      message: error.message,
      error: error.message,
    });
    return;
  }

  const message = isProduction ? 'Internal server error' : error.message;

  res.status(500).json({
    success: false,
    message,
    error: message,
  });
};
