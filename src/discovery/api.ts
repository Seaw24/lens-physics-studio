import type {
  CandidateOpportunity,
  DiscoveryEvent,
  SessionSnapshot,
} from "../../shared/discovery";
import type {
  CardKind,
  FeedbackRequest,
  HumanFeedback,
  Lesson,
  LessonAction,
  LearningReport,
} from "../../shared/learning";

export interface DiscoveryClientConfig {
  enabled: boolean;
  region: string;
  proposerModelId: string;
  reviewerModelId: string;
  drafterModelId: string;
  bindHost: string;
  publicOrigin: string | null;
  secureContextRequired: boolean;
  accessCodeGenerated: boolean;
  dependencies: { ffmpeg: boolean; ffprobe: boolean; credentials: boolean };
  limits: Record<string, number>;
  course: {
    id: string;
    version: string;
    objectives: Array<{ id: string; description: string }>;
  };
}

export class DiscoveryApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
    public retryable: boolean,
  ) {
    super(message);
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  signal?: AbortSignal,
) {
  const response = await fetch(`/api/discovery${path}`, {
    credentials: "same-origin",
    ...options,
    signal,
  });
  const data =
    response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const error = data?.error;
    throw new DiscoveryApiError(
      error?.message || "The Discovery request could not finish.",
      error?.code || "REQUEST_FAILED",
      response.status,
      Boolean(error?.retryable),
    );
  }
  return data as T;
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const discoveryApi = {
  login: (code: string) => request<{ authenticated: true }>("/auth", json({ code })),
  logout: () => request<void>("/auth", { method: "DELETE" }),
  config: (signal?: AbortSignal) =>
    request<DiscoveryClientConfig>("/config", {}, signal),
  preflight: (invoke = false) => request<any>("/preflight", json({ invoke })),
  createSession: (
    sourceKind: "image" | "video" | "phone",
    mode: "scan" | "replay" | "live",
    idempotencyKey: string,
  ) =>
    request<SessionSnapshot>("/sessions", {
      ...json({ sourceKind, mode }),
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
    }),
  uploadSource: (
    sessionId: string,
    file: File,
    onProgress?: (fraction: number) => void,
  ) =>
    // XHR rather than fetch: fetch cannot report upload progress.
    new Promise<SessionSnapshot>((resolve, reject) => {
      const form = new FormData();
      form.append("source", file);
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `/api/discovery/sessions/${sessionId}/source`);
      xhr.withCredentials = true;
      xhr.responseType = "json";
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress?.(event.loaded / event.total);
      };
      xhr.onload = () => {
        const data = xhr.response;
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else
          reject(
            new DiscoveryApiError(
              data?.error?.message || "The upload could not finish.",
              data?.error?.code || "REQUEST_FAILED",
              xhr.status,
              Boolean(data?.error?.retryable),
            ),
          );
      };
      xhr.onerror = () =>
        reject(
          new DiscoveryApiError(
            "The upload was interrupted.",
            "NETWORK_ERROR",
            0,
            true,
          ),
        );
      xhr.send(form);
    }),
  action: (
    sessionId: string,
    generation: number,
    action: "start" | "pause" | "resume" | "stop" | "cancel",
  ) =>
    request<SessionSnapshot>(
      `/sessions/${sessionId}/${action}`,
      json({ generation }),
    ),
  session: (sessionId: string, afterRevision?: number, signal?: AbortSignal) =>
    request<SessionSnapshot | { unchanged: true; revision: number }>(
      `/sessions/${sessionId}${afterRevision ? `?afterRevision=${afterRevision}` : ""}`,
      {},
      signal,
    ),
  pair: (sessionId: string, generation: number) =>
    request<{ url: string; qrDataUrl: string; expiresAt: string }>(
      `/sessions/${sessionId}/pair`,
      json({ generation }),
    ),
  event: (eventId: string) => request<DiscoveryEvent>(`/events/${eventId}`),
};

export interface CandidateDetail {
  candidateId: string;
  cardKind: CardKind | null;
  state: string;
  sourceKind: "image" | "video" | "phone";
  sourceInterval: { startSeconds: number; endSeconds: number } | null;
  proposals: Array<{
    kind: "observed_action" | "scene_context";
    subject: string;
    observation: string;
    before: { text: string; frameIds: string[] } | null;
    after: { text: string; frameIds: string[] } | null;
    evidenceFrameIds: string[];
    objectiveIds: string[];
    limitations: string[];
  }>;
  review: { verdict: string; reason: string } | null;
  /** The judge's opportunities with concepts and what they repeat. */
  opportunities: CandidateOpportunity[];
  frames: Array<{
    index: number;
    frameId: string;
    sourceTimeMs: number | null;
    evidence: boolean;
    url: string;
  }>;
  feedback: HumanFeedback | null;
}

export interface LearningOverview {
  lessons: Lesson[];
  versions: { proposer: string; reviewer: string };
  report: LearningReport;
  checkCases: { proposer: number; reviewer: number };
}

export const learningApi = {
  candidate: (sessionId: string, candidateId: string) =>
    request<CandidateDetail>(`/sessions/${sessionId}/candidates/${candidateId}`),
  feedback: (sessionId: string, candidateId: string, body: FeedbackRequest) =>
    request<{ feedback: HumanFeedback; holdout: boolean; framesKept: number }>(
      `/sessions/${sessionId}/candidates/${candidateId}/feedback`,
      json(body),
    ),
  overview: () => request<LearningOverview>("/learning"),
  draftLessons: () =>
    request<{ added: Lesson[]; suggestions: Lesson[]; images: number }>(
      "/learning/lessons/draft",
      { method: "POST" },
    ),
  updateLesson: (id: string, action: LessonAction, text?: string) =>
    request<Lesson>(`/learning/lessons/${id}`, json(text ? { action, text } : { action })),
  checkLesson: (id: string) =>
    request<Lesson>(`/learning/lessons/${id}/check`, { method: "POST" }),
};
