export class DiscoveryError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public retryable = false,
  ) {
    super(message);
    this.name = "DiscoveryError";
  }
}

export function safeError(error: unknown) {
  if (error instanceof DiscoveryError)
    return {
      status: error.status,
      body: {
        error: {
          code: error.code,
          message: error.message,
          retryable: error.retryable,
        },
      },
    };
  const name = error instanceof Error ? error.name : "";
  if (/AccessDenied|Unrecognized|Expired|Credentials|Unauthorized/.test(name))
    return {
      status: 503,
      body: {
        error: {
          code: "MODEL_AUTH_UNAVAILABLE",
          message: "Model access is unavailable or has expired.",
          retryable: false,
        },
      },
    };
  if (/Abort|Timeout/.test(name))
    return {
      status: 503,
      body: {
        error: {
          code: "MODEL_TIMEOUT",
          message:
            "The model request timed out; its billing outcome may be unknown.",
          retryable: false,
        },
      },
    };
  return {
    status: 500,
    body: {
      error: {
        code: "INTERNAL_ERROR",
        message: "The Discovery request could not be completed.",
        retryable: false,
      },
    },
  };
}
