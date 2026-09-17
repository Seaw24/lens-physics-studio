import { useEffect, useRef, useState } from "react";
import type { SessionSnapshot } from "../../shared/discovery";
import { discoveryApi } from "./api";

const terminal = new Set([
  "completed",
  "budget_exhausted",
  "interrupted",
  "failed",
  "canceled",
]);

export function useDiscoverySession(
  initial: SessionSnapshot | null,
  onError: (message: string) => void,
) {
  const [session, setSession] = useState<SessionSnapshot | null>(initial);
  const revision = useRef(initial?.revision || 0);
  useEffect(() => {
    setSession(initial);
    revision.current = initial?.revision || 0;
  }, [initial?.id]);
  useEffect(() => {
    if (!session || terminal.has(session.state)) return;
    let timer = 0;
    let stopped = false;
    let controller: AbortController | null = null;
    const poll = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      controller = new AbortController();
      try {
        const next = await discoveryApi.session(
          session.id,
          revision.current,
          controller.signal,
        );
        if (!("unchanged" in next)) {
          revision.current = next.revision;
          setSession(next);
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError"))
          onError(error instanceof Error ? error.message : "Polling failed.");
      } finally {
        if (!stopped) timer = window.setTimeout(poll, 1_000);
      }
    };
    timer = window.setTimeout(poll, 1_000);
    const visibility = () => {
      if (document.visibilityState === "visible") {
        window.clearTimeout(timer);
        void poll();
      } else controller?.abort();
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [session?.id, session?.state]);
  return { session, setSession };
}
