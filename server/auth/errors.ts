export class AuthError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export function safeAuthError(error: unknown) {
  if (error instanceof AuthError)
    return {
      status: error.status,
      body: { error: { code: error.code, message: error.message } },
    };
  if (error instanceof Error && error.name === "ZodError")
    return {
      status: 400,
      body: { error: { code: "INVALID_REQUEST", message: "Invalid request." } },
    };
  return {
    status: 500,
    body: {
      error: {
        code: "INTERNAL_ERROR",
        message: "The request could not be completed.",
      },
    },
  };
}
