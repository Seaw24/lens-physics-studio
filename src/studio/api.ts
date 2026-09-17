import type {
  DayResponse,
  StudioEventResponse,
} from "../../shared/studio/schema";

export class StudioApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}, signal?: AbortSignal) {
  const response = await fetch(`/api/discovery/studio${path}`, {
    credentials: "same-origin",
    ...init,
    signal,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new StudioApiError(
      data?.error?.message || "The studio request could not finish.",
      response.status,
      data?.error?.code || "REQUEST_FAILED",
    );
  return data as T;
}

export const studioApi = {
  day: (signal?: AbortSignal) => request<DayResponse>("/day", {}, signal),
  event: (eventId: string, signal?: AbortSignal) =>
    request<StudioEventResponse>(`/events/${eventId}`, {}, signal),
  generate: (eventId: string, force = false) =>
    request<StudioEventResponse>(`/events/${eventId}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force }),
    }),
};
