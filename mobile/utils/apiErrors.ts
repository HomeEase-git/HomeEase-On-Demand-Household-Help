export type ApiErrorType = "network" | "validation" | "server" | "timeout" | "unknown";

export type ApiErrorShape = {
  type: ApiErrorType;
  message: string;
  statusCode?: number;
};

export function normalizeError(err: unknown): ApiErrorShape {
  if (err instanceof TimeoutError) {
    return { type: "timeout", message: "Request timed out. Please try again." };
  }

  if (err instanceof NetworkError) {
    return {
      type: "network",
      message: "Unable to connect. Check your internet connection.",
    };
  }

  if (isHttpError(err)) {
    if (err.status >= 500) {
      return {
        type: "server",
        message: "Something went wrong on our side. Please try again later.",
        statusCode: err.status,
      };
    }
    return {
      type: "validation",
      message: err.message || "There was a problem with your request.",
      statusCode: err.status,
    };
  }

  return {
    type: "unknown",
    message: "An unexpected error occurred. Please try again.",
  };
}

export class NetworkError extends Error {}
export class TimeoutError extends Error {}

export type HttpError = {
  status: number;
  message: string;
};

export function isHttpError(err: unknown): err is HttpError {
  return (
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    typeof (err as any).status === "number"
  );
}

