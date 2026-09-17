import { EventSchema } from "../../shared/discovery";

export async function loadDiscoveryEvent(eventId: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(eventId)) throw new Error("Invalid event ID");
  const response = await fetch(`/api/discovery/events/${eventId}`, {
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error(`Event fetch failed (${response.status})`);
  const event = EventSchema.parse(await response.json());
  if (event.schemaVersion !== "2.0" || event.exampleOnly)
    throw new Error("Fixture or unsupported event contract");
  if (!event.media.url.startsWith("/api/discovery/assets/"))
    throw new Error("Media must use the authenticated same-origin asset route");
  // scene_context is an arrangement, not evidence that an action happened.
  const actionObserved = event.review.opportunity.kind === "observed_action";
  return { event, actionObserved };
}
