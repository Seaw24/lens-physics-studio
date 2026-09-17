import type { ReactNode } from "react";
import { Download, ExternalLink } from "lucide-react";
import type { CoverageRef, DiscoveryEvent } from "../../shared/discovery";

export default function DiscoveryEventCard({
  event,
  concept,
  replaced,
  footer,
}: {
  event: DiscoveryEvent;
  /** The physics concept the judge named; one card per concept per video. */
  concept?: string | null;
  /** The earlier card of this concept that this one took over as the better card. */
  replaced?: CoverageRef | null;
  footer?: ReactNode;
}) {
  function downloadJson() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(event, null, 2)], { type: "application/json" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${event.id}.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }
  const opportunity = event.review.opportunity;
  return (
    <article className="discovery-event-card">
      <div className="discovery-media">
        {event.media.mimeType === "image/jpeg" ? (
          <img src={event.media.url} alt="Reviewed event evidence" />
        ) : (
          <video src={event.media.url} controls playsInline preload="metadata" />
        )}
      </div>
      <div className="discovery-event-copy">
        <span className="discovery-verdict">Grounded teachability review</span>
        {concept && <span className="concept-chip">Concept · {concept}</span>}
        {replaced && (
          <span className="concept-chip">
            Better card · replaced “{replaced.subject}”
            {replaced.startSeconds !== null
              ? ` at ${replaced.startSeconds.toFixed(1)} s`
              : ""}
          </span>
        )}
        <h3>{opportunity.subject}</h3>
        <p>{opportunity.observation}</p>
        <dl>
          <div>
            <dt>Course connection</dt>
            <dd>{opportunity.connection}</dd>
          </div>
          <div>
            <dt>Limits</dt>
            <dd>
              {opportunity.limitations.length
                ? opportunity.limitations.join(" ")
                : "No additional limitation was returned."}
            </dd>
          </div>
        </dl>
        <div className="discovery-event-actions">
          <button className="button secondary" onClick={downloadJson}>
            <Download size={15} /> Export JSON
          </button>
          <a className="button secondary" href={event.media.url} download>
            <ExternalLink size={15} /> Media
          </a>
        </div>
        {footer}
      </div>
    </article>
  );
}
