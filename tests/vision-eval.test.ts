import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Evaluation harness is standalone ESM, outside the app runtime.
import { windowsFor, requestFor, validateResponse } from '../scripts/vision-eval-core.mjs';
const frames = Array.from({length:20},(_,i)=>({frameId:`f${i}`,sourceTimeSeconds:i/2}));
const source = {sourceId:'anonymous',durationSeconds:10,frames};
const w = windowsFor(source)[0];
const valid = {kind:'observed_action',startFrameId:'f2',endFrameId:'f6',verdict:'teachable',observation:'An object visibly turns.',objectiveIds:['torque-rotation'],connection:'Visible rotation supports a qualitative torque discussion.',limitations:['No force measurement.'],evidenceFrameIds:['f2','f6']};
test('scan windows are uniform and independent of reference labels',()=>{
  assert.deepEqual(windowsFor({...source,referenceEvents:[{start:4,end:5}]}),windowsFor(source));
  assert.deepEqual(windowsFor(source).map((x:any)=>x.start),[0,3,6,9]);
  assert.equal(new Set(windowsFor(source).flatMap((x:any)=>x.frames.map((f:any)=>f.frameId))).size,20);
});
test('ground truth and private source filenames cannot leak into model request',()=>{
  const request=requestFor({...w,referenceEvents:'SECRET_EXPECTED_ACTION',path:'PRIVATE_SOURCE_PATH',expectedAction:'SECRET_LABEL'},w.frames.map(()=>Buffer.from('image')));
  const s=JSON.stringify(request);assert.ok(!/SECRET_|PRIVATE_SOURCE_PATH/.test(s));
});
test('unseen IDs, reversed boundaries, duplicate evidence and single-time actions fail validation',()=>{
  assert.equal(validateResponse(JSON.stringify({opportunities:[valid]}),w).opportunities.length,1);
  for(const patch of [{startFrameId:'unknown'},{startFrameId:'f7'},{evidenceFrameIds:['f2','f2']},{endFrameId:'f2',evidenceFrameIds:['f2']},{evidenceFrameIds:['f0','f6']},{objectiveIds:[]}]) {
    assert.throws(()=>validateResponse(JSON.stringify({opportunities:[{...valid,...patch}]}),w));
  }
});
test('one outer JSON fence is losslessly normalized; prose and unexpected fields fail',()=>{
  assert.deepEqual(validateResponse('{"opportunities":[]}',w),{opportunities:[]});
  assert.deepEqual(validateResponse('```json\n{"opportunities":[]}\n```',w),{opportunities:[]});
  assert.throws(()=>validateResponse('Here is JSON: {"opportunities":[]}',w));
  assert.throws(()=>validateResponse('```json\n{"opportunities":[]}\n```\nUnrequested prose',w));
  assert.throws(()=>validateResponse('{"opportunities":[],"answer":"extra"}',w));
});
