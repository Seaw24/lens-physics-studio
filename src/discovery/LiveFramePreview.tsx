import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import type { SessionSnapshot } from "../../shared/discovery";

/** Poll the latest ingest JPEG so the laptop stage mirrors the phone/camera feed. */
export default function LiveFramePreview({
  session,
  label = "Live camera",
}: {
  session: SessionSnapshot;
  label?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [hint, setHint] = useState("Waiting for the first live frame…");
  const active = ["ingesting", "paused"].includes(session.state);
  const observed = session.observedSourceMs ?? 0;

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    let timer = 0;
    let inFlight = false;

    const tick = async () => {
      if (inFlight || cancelled) return;
      inFlight = true;
      try {
        const response = await fetch(
          `/api/discovery/sessions/${session.id}/preview?t=${Date.now()}`,
          { credentials: "same-origin" },
        );
        if (cancelled) return;
        if (response.status === 204) {
          setHint(
            observed > 0
              ? "Frames arrived, refreshing preview…"
              : "Waiting for the first live frame…",
          );
          return;
        }
        if (response.status === 401 || response.status === 403) {
          setHint("Sign in again to watch the live preview.");
          return;
        }
        if (!response.ok) {
          setHint("Live preview unavailable right now.");
          return;
        }
        const blob = await response.blob();
        if (cancelled) return;
        const next = URL.createObjectURL(blob);
        const previous = objectUrl;
        objectUrl = next;
        setUrl(next);
        if (previous) URL.revokeObjectURL(previous);
      } catch {
        if (!cancelled) setHint("Live preview reconnecting…");
      } finally {
        inFlight = false;
      }
    };

    void tick();
    timer = window.setInterval(() => void tick(), 150);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [session.id, active, observed]);

  return (
    <div className="live-stream">
      {url ? (
        <img className="wired-preview" src={url} alt={label} />
      ) : (
        <div className="live-stream-waiting">
          <LoaderCircle className="spin" size={22} />
          <span>{hint}</span>
        </div>
      )}
    </div>
  );
}
