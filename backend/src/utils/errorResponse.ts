export class ApiError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export const errorResponse = (statusCode: number, message: string) => {
  return {
    success: false,
    statusCode,
    message,
    error: message,
  };
};
