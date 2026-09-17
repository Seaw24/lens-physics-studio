// Run from repository root with: node --import tsx docs/detection/v2/check-contract.ts
// This checks the specification seed only. It makes no model calls.
import assert from 'node:assert/strict';
import { EventSchema, ProposalSchema, ProposerResponseSchema, ReviewResponseSchema, validateEvidence } from './contracts';

const hash = 'a'.repeat(64);
const action = {
  kind: 'observed_action' as const,
  subject: 'visible panel', startFrameId: 'f0', endFrameId: 'f1',
  observation: 'The panel changes orientation relative to its surrounding frame.',
  before: { text: 'Panel aligned with frame.', frameIds: ['f0'] },
  after: { text: 'Panel angled relative to frame.', frameIds: ['f1'] },
  evidenceFrameIds: ['f0', 'f1'], objectiveIds: ['torque-rotation' as const], limitations: ['Force magnitude is not established.'],
};
const frames = [{ frameId:'f0', sourceTimeMs:1000, sha256:hash }, { frameId:'f1', sourceTimeMs:1500, sha256:hash }];
const model = { modelId: 'synthetic-fixture', promptHash: hash, invocationId: 'fixture-call' };
const video = {
  schemaVersion: '2.0', exampleOnly: true, id:'example-video', sessionId:'example-session', candidateId:'example-candidate', createdAt:'2026-09-16T00:00:00.000Z',
  course:{id:'intro-mechanics-forces-torque',version:'2'}, source:{kind:'video',sourceId:'example-source'},
  review:{verdict:'teachable',reason:'Synthetic contract fixture, not an actual inference.',opportunity:{...action,connection:'Visible rotation can ground qualitative torque reasoning.'},eventSourceInterval:{startSeconds:1,endSeconds:1.5},evidence:[{frameId:'f0',sourceTimeSeconds:1,clipTimeSeconds:1},{frameId:'f1',sourceTimeSeconds:1.5,clipTimeSeconds:1.5}]},
  media:{assetId:'example-asset',url:'/api/discovery/assets/example-asset',mimeType:'video/mp4',sha256:hash,width:540,height:960,fidelity:'source_video_clip',sourceInterval:{startSeconds:0,endSeconds:3},durationSeconds:3,timingUncertaintyMs:500,maxCaptureGapMs:null},
  provenance:{schedulingReasons:['uniform_evaluation'],proposer:model,reviewer:model,snapshotHash:hash},
};
const stillOpportunity = { ...action, kind:'scene_context' as const, subject:'visible support arrangement',startFrameId:'i0',endFrameId:'i0',observation:'A visible load rests on a support.',before:null,after:null,evidenceFrameIds:['i0'],objectiveIds:['equilibrium-support' as const],connection:'The arrangement supports a qualitative support-force discussion.' };
const image = {
  ...video, id:'example-image', source:{kind:'image',sourceId:'example-still'},
  review:{...video.review,opportunity:stillOpportunity,eventSourceInterval:null,evidence:[{frameId:'i0',sourceTimeSeconds:null,clipTimeSeconds:null}]},
  media:{...video.media,mimeType:'image/jpeg',fidelity:'normalized_still',sourceInterval:null,durationSeconds:null,timingUncertaintyMs:null,maxCaptureGapMs:null},
  provenance:{...video.provenance,schedulingReasons:['uploaded_image']},
};
let checks = 0;
function check(label: string, fn: () => void) { fn(); checks++; console.log(`PASS ${label}`); }
check('video fixture and temporal proposal validate', () => { EventSchema.parse(video); validateEvidence(ProposalSchema.parse(action), frames, 'video'); });
check('still fixture validates with null clocks', () => EventSchema.parse(image));
check('empty proposer and rejecting reviewer are valid', () => { ProposerResponseSchema.parse({proposals:[]}); ReviewResponseSchema.parse({verdict:'not_teachable',reason:'No specific connection.',opportunities:[]}); });
check('empty approval fails', () => assert.equal(ReviewResponseSchema.safeParse({verdict:'teachable',reason:'Unsupported.',opportunities:[]}).success,false));
check('unknown frame fails', () => assert.throws(() => validateEvidence({...action,endFrameId:'absent'},frames,'video')));
check('transition reversal fails', () => assert.throws(() => validateEvidence({...action,before:action.after,after:action.before},frames,'video')));
check('image cannot establish action', () => assert.throws(() => validateEvidence(action,[{frameId:'f0',sourceTimeMs:null,sha256:hash}],'image')));
check('evidence outside interval fails', () => assert.throws(() => validateEvidence({...action,endFrameId:'f0'},frames,'video')));
check('duplicate evidence fails', () => assert.throws(() => validateEvidence({...action,evidenceFrameIds:['f0','f1','f1']},frames,'video')));
check('extra model fields fail', () => assert.equal(ProposerResponseSchema.safeParse({proposals:[{...action,confidence:0.99}]}).success,false));
check('unsupported objective fails', () => assert.equal(ProposalSchema.safeParse({...action,objectiveIds:['made-up']}).success,false));
check('wrong clip clock fails', () => { const e=structuredClone(video); e.review.evidence[0].clipTimeSeconds=2; assert.equal(EventSchema.safeParse(e).success,false); });
check('wrong boundary clock fails', () => { const e=structuredClone(video); e.review.eventSourceInterval.startSeconds=.9; assert.equal(EventSchema.safeParse(e).success,false); });
check('temporal image field fails', () => assert.equal(EventSchema.safeParse({...image,media:{...image.media,durationSeconds:3}}).success,false));
check('large phone gap fails action approval', () => assert.equal(EventSchema.safeParse({...video,source:{kind:'phone',sourceId:'phone'},media:{...video.media,fidelity:'sampled_camera_frames',maxCaptureGapMs:750}}).success,false));
check('phone fixture within gap limit validates', () => EventSchema.parse({...video,source:{kind:'phone',sourceId:'phone'},media:{...video.media,fidelity:'sampled_camera_frames',maxCaptureGapMs:125}}));
check('arbitrary media URL fails', () => assert.equal(EventSchema.safeParse({...video,media:{...video.media,url:'https://outside.invalid/media'}}).success,false));
console.log(`${checks} contract checks passed. Fixtures are synthetic; no model inference was performed.`);
