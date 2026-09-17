// Revalidate saved responses locally. Never invoke a model or rewrite raw results.
import fs from 'node:fs/promises';
import path from 'node:path';
import {windowsFor, validateResponse} from './vision-eval-core.mjs';
const args=process.argv.slice(2), val=flag=>args[args.indexOf(flag)+1];
for(const flag of ['--manifest','--run','--output']) if(!args.includes(flag)||!val(flag)||val(flag).startsWith('--')) throw new Error(`Missing ${flag}`);
const m=JSON.parse(await fs.readFile(val('--manifest'),'utf8'));
const windows=new Map(m.sources.flatMap(windowsFor).map(w=>[w.id,w]));
const rows=[], opportunities=[];
for(const name of (await fs.readdir(val('--run'))).filter(n=>/^clip-\d+-\d+\.json$/.test(n)).sort()) {
  const r=JSON.parse(await fs.readFile(path.join(val('--run'),name),'utf8'));
  const w=windows.get(r.windowId);
  if(!w)throw new Error('Run source not in supplied manifest');
  const row={windowId:r.windowId,modelId:r.modelId,sourceId:r.sourceId,start:r.start,end:r.end,originalStatus:r.status,latencyMs:r.latencyMs,usage:r.usage,stopReason:r.stopReason};
  try {
    if(r.stopReason==='max_tokens'||r.status==='failed'||!r.rawText)throw new Error(r.error?.name||'Incomplete invocation');
    const v=validateResponse(r.rawText,w);
    row.status='valid';row.formatNormalization=r.rawText.trim().startsWith('```')?'outer_json_code_fence':'none';row.opportunities=v.opportunities.length;
    const idx=new Map(w.frames.map(f=>[f.frameId,f.sourceTimeSeconds]));
    opportunities.push(...v.opportunities.map((o,i)=>({candidateId:`${w.id}-o${i}`,sourceId:r.sourceId,windowId:r.windowId,...o,startSeconds:idx.get(o.startFrameId),endSeconds:idx.get(o.endFrameId)})));
  }catch(e){row.status='invalid';row.error=String(e.message).slice(0,1000);}
  rows.push(row);
}
const latencies=rows.map(r=>r.latencyMs).filter(Number.isFinite).sort((a,b)=>a-b);
const p=q=>latencies.length?latencies[Math.ceil(q*latencies.length)-1]:null;
const summary={parserVersion:'v1.1-single-outer-fence',attempts:rows.length,valid:rows.filter(r=>r.status==='valid').length,invalid:rows.filter(r=>r.status==='invalid').length,emptyWindows:rows.filter(r=>r.status==='valid'&&r.opportunities===0).length,latencyMs:{p50:p(.5),p95:p(.95)},usage:rows.reduce((a,r)=>({inputTokens:a.inputTokens+(r.usage?.inputTokens||0),outputTokens:a.outputTokens+(r.usage?.outputTokens||0)}),{inputTokens:0,outputTokens:0}),usageComplete:rows.every(r=>r.usage),opportunitiesBeforeDeduplication:opportunities.length,verdictCounts:Object.fromEntries(['teachable','not_teachable','insufficient_evidence'].map(v=>[v,opportunities.filter(o=>o.verdict===v).length]))};
await fs.writeFile(val('--output'),JSON.stringify({summary,windows:rows,opportunities},null,2),{flag:'wx'});
console.log(JSON.stringify(summary,null,2));
