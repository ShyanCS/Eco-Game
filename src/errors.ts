/**
 * Structured error responses.
 * All error responses follow the shape: { error: { code: string, message: string } }
 */

export interface ErrorBody {
  error: {
    code: string;
    message: string;
  };
}

export function errorResponse(code: string, message: string): ErrorBody {
  return {
    error: { code, message },
  };
}
