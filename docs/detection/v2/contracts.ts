// Specification seed, not yet connected to application routes.
// Copy into shared/discovery.ts during implementation; retain these wire semantics.
import { z } from 'zod';

export const objectiveIds = ['force-interaction', 'torque-rotation', 'equilibrium-support', 'released-object-motion'] as const;
const id = z.string().min(1).max(160);
const ids = z.array(id).min(1).max(12);
const text = z.string().trim().min(1).max(1200);
const objective = z.enum(objectiveIds);
const Fact = z.object({ text, frameIds: ids }).strict();
const base = {
  kind: z.enum(['observed_action', 'scene_context']),
  subject: z.string().trim().min(1).max(120), // Free description, not a trained action class.
  startFrameId: id,
  endFrameId: id,
  observation: text,
  before: Fact.nullable(),
  after: Fact.nullable(),
  evidenceFrameIds: ids,
  objectiveIds: z.array(objective).min(1).max(4),
  limitations: z.array(text).max(8),
};
export const ProposalSchema = z.object(base).strict();
export const ProposerResponseSchema = z.object({ proposals: z.array(ProposalSchema).max(3) }).strict();
export const GroundedOpportunitySchema = z.object({ ...base, connection: text }).strict();
export const ReviewResponseSchema = z.object({
  verdict: z.enum(['teachable', 'not_teachable', 'insufficient_evidence']),
  reason: text,
  opportunities: z.array(GroundedOpportunitySchema).max(3),
}).strict().superRefine((r, ctx) => {
  if ((r.verdict === 'teachable') !== (r.opportunities.length > 0))
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Only teachable reviews contain opportunities; teachable requires at least one.' });
});

export const FrameSchema = z.object({
  frameId: id,
  sourceTimeMs: z.number().int().nonnegative().nullable(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type Frame = z.infer<typeof FrameSchema>;
export type Proposal = z.infer<typeof ProposalSchema>;

// Structural and temporal validation only. Visual truth requires evaluated review.
export function validateEvidence(p: Proposal, frames: Frame[], sourceKind: 'image' | 'video' | 'phone') {
  const index = new Map(frames.map(f => [f.frameId, f]));
  if (index.size !== frames.length) throw new Error('Duplicate frame identity');
  const get = (value: string) => {
    const f = index.get(value);
    if (!f) throw new Error('Unknown frame reference');
    return f;
  };
  const start = get(p.startFrameId), end = get(p.endFrameId);
  if (new Set(p.evidenceFrameIds).size !== p.evidenceFrameIds.length) throw new Error('Duplicate evidence');
  p.evidenceFrameIds.forEach(get);
  if (!p.evidenceFrameIds.includes(p.startFrameId) || !p.evidenceFrameIds.includes(p.endFrameId)) throw new Error('Boundary absent from evidence');
  if (sourceKind === 'image') {
    if (frames.length !== 1 || frames[0].sourceTimeMs !== null || p.kind !== 'scene_context' || p.before !== null || p.after !== null || p.startFrameId !== p.endFrameId)
      throw new Error('Image may only establish static context');
  } else {
    if (frames.some(f => f.sourceTimeMs === null)) throw new Error('Temporal source needs times');
    if (start.sourceTimeMs! > end.sourceTimeMs!) throw new Error('Reversed interval');
    if (p.evidenceFrameIds.some(x => get(x).sourceTimeMs! < start.sourceTimeMs! || get(x).sourceTimeMs! > end.sourceTimeMs!))
      throw new Error('Evidence outside interval');
  }
  if (p.kind === 'scene_context') {
    if (p.before !== null || p.after !== null) throw new Error('Static context has no claimed transition');
  } else {
    if (!p.before || !p.after || start.sourceTimeMs === null || end.sourceTimeMs === null) throw new Error('Missing observed transition');
    const times = (fact: { frameIds: string[] }) => fact.frameIds.map(x => {
      if (!p.evidenceFrameIds.includes(x)) throw new Error('Transition references evidence not declared');
      return get(x).sourceTimeMs!;
    });
    if (Math.max(...times(p.before)) >= Math.min(...times(p.after))) throw new Error('Before must precede after');
  }
}

const Interval = z.object({ startSeconds: z.number().finite().nonnegative(), endSeconds: z.number().finite().nonnegative() }).strict();
const Model = z.object({ modelId: id, promptHash: z.string().regex(/^[a-f0-9]{64}$/), invocationId: id }).strict();
const Media = z.object({
  assetId: id,
  url: z.string().regex(/^\/api\/discovery\/assets\/[a-zA-Z0-9-]+$/),
  mimeType: z.enum(['image/jpeg', 'video/mp4']),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  width: z.number().int().positive(), height: z.number().int().positive(),
  fidelity: z.enum(['normalized_still', 'source_video_clip', 'sampled_camera_frames']),
  sourceInterval: Interval.nullable(),
  durationSeconds: z.number().finite().positive().nullable(),
  timingUncertaintyMs: z.number().finite().nonnegative().nullable(),
  maxCaptureGapMs: z.number().finite().nonnegative().nullable(),
}).strict();
const Evidence = z.object({ frameId: id, sourceTimeSeconds: z.number().finite().nonnegative().nullable(), clipTimeSeconds: z.number().finite().nonnegative().nullable() }).strict();
export const EventSchema = z.object({
  schemaVersion: z.literal('2.0'),
  exampleOnly: z.boolean(),
  id, sessionId: id, candidateId: id,
  createdAt: z.string().datetime(),
  course: z.object({ id: z.literal('intro-mechanics-forces-torque'), version: z.literal('2') }).strict(),
  source: z.object({ kind: z.enum(['image', 'video', 'phone']), sourceId: id }).strict(),
  review: z.object({
    verdict: z.literal('teachable'),
    reason: text,
    opportunity: GroundedOpportunitySchema,
    eventSourceInterval: Interval.nullable(),
    evidence: z.array(Evidence).min(1).max(12),
  }).strict(),
  media: Media,
  provenance: z.object({
    schedulingReasons: z.array(z.enum(['activity', 'periodic', 'uniform_evaluation', 'uploaded_image'])).min(1),
    proposer: Model.nullable(), // Null only for explicit direct-review evaluation.
    reviewer: Model,
    snapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict(),
}).strict().superRefine((e, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  const image = e.source.kind === 'image';
  if (image) {
    if (e.media.mimeType !== 'image/jpeg' || e.media.fidelity !== 'normalized_still' || e.media.sourceInterval !== null || e.media.durationSeconds !== null || e.media.timingUncertaintyMs !== null || e.media.maxCaptureGapMs !== null || e.review.eventSourceInterval !== null || e.review.opportunity.kind !== 'scene_context' || e.review.evidence.some(f => f.sourceTimeSeconds !== null || f.clipTimeSeconds !== null)) fail('Image event has temporal claims');
  } else {
    const m = e.media.sourceInterval, t = e.review.eventSourceInterval;
    if (e.media.mimeType !== 'video/mp4' || e.media.fidelity !== (e.source.kind === 'phone' ? 'sampled_camera_frames' : 'source_video_clip') || !m || !t || e.media.durationSeconds === null || e.media.timingUncertaintyMs === null) { fail('Missing or inconsistent temporal media'); return; }
    if (m.endSeconds <= m.startSeconds || t.endSeconds < t.startSeconds || t.startSeconds < m.startSeconds || t.endSeconds > m.endSeconds) fail('Invalid media/event bounds');
    const first = e.review.evidence.find(f => f.frameId === e.review.opportunity.startFrameId);
    const last = e.review.evidence.find(f => f.frameId === e.review.opportunity.endFrameId);
    if (first?.sourceTimeSeconds !== t.startSeconds || last?.sourceTimeSeconds !== t.endSeconds) fail('Event interval differs from boundary evidence');
    if (Math.abs(e.media.durationSeconds - (m.endSeconds - m.startSeconds)) > Math.max(.15, e.media.timingUncertaintyMs / 1000)) fail('Clip duration mismatch');
    for (const f of e.review.evidence) {
      if (f.sourceTimeSeconds === null || f.clipTimeSeconds === null || f.sourceTimeSeconds < t.startSeconds || f.sourceTimeSeconds > t.endSeconds || f.clipTimeSeconds < 0 || f.clipTimeSeconds > e.media.durationSeconds || Math.abs(f.clipTimeSeconds - (f.sourceTimeSeconds - m.startSeconds)) > .002) fail('Inconsistent evidence clock');
    }
    if (e.source.kind === 'phone' && (e.media.maxCaptureGapMs === null || (e.review.opportunity.kind === 'observed_action' && e.media.maxCaptureGapMs > 500))) fail('Action crosses a capture gap');
  }
  const actual = e.review.evidence.map(f => f.frameId);
  if (actual.length !== new Set(actual).size || actual.length !== e.review.opportunity.evidenceFrameIds.length || actual.some(x => !e.review.opportunity.evidenceFrameIds.includes(x))) fail('Evidence identity mismatch');
  try {
    validateEvidence(e.review.opportunity, e.review.evidence.map(f => ({ frameId: f.frameId, sourceTimeMs: f.sourceTimeSeconds === null ? null : Math.round(f.sourceTimeSeconds * 1000), sha256: '0'.repeat(64) })), e.source.kind);
  } catch { fail('Invalid opportunity evidence'); }
});
export type DiscoveryEvent = z.infer<typeof EventSchema>;
