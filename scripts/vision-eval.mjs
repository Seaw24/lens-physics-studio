import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { promptHash, settings, requestFor, validateResponse, windowsFor, sha256 } from './vision-eval-core.mjs';

export async function evaluate({ manifestPath, credentialsPath, split, runPath, modelId, invoke = false }) {
  if (!['development', 'holdout'].includes(split)) throw new Error('Specify development or holdout');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const sources = manifest.sources.filter(s => s.split === split);
  if (sources.length !== 1) throw new Error('Pilot requires exactly one source per split');
  if (manifest.samplingFps !== settings.fps || !manifest.cloudFramesPrivacyReviewed) throw new Error('Evidence preparation not approved for invocation');
  const windows = sources.flatMap(windowsFor);
  if (windows.length > settings.maxAttempts) throw new Error('Call cap exceeded');
  const frozen = { promptHash, settings, modelId, manifestSha256: sha256(await fs.readFile(manifestPath)), split, plannedWindows: windows.map(w => ({ id:w.id, start:w.start, end:w.end, frameIds:w.frames.map(f=>f.frameId) })) };
  if (!invoke) { console.log(JSON.stringify({ ...frozen, invoked: false }, null, 2)); return; }
  // Exclusive creation prevents reruns and accidental double billing. New evaluation = new explicit run path.
  await fs.mkdir(runPath, { recursive: false });
  await fs.writeFile(path.join(runPath, 'frozen-plan.json'), JSON.stringify(frozen, null, 2));
  const e = JSON.parse(await fs.readFile(credentialsPath, 'utf8'));
  const client = new BedrockRuntimeClient({ region: 'us-east-1', maxAttempts: 1, credentials: { accessKeyId:e.AWS_ACCESS_KEY_ID, secretAccessKey:e.AWS_SECRET_ACCESS_KEY, sessionToken:e.AWS_SESSION_TOKEN } });
  const results = []; let lastStart = 0;
  try {
    for (const w of windows) {
      const bytes = await Promise.all(w.frames.map(async f => {
        const file = path.resolve(path.dirname(manifestPath), f.path);
        const root = path.resolve(path.dirname(manifestPath)) + path.sep;
        if (!file.startsWith(root)) throw new Error('Frame path escapes evaluation root');
        const b = await fs.readFile(file);
        if (b.length > 2_000_000 || sha256(b) !== f.sha256) throw new Error('Frame integrity failed');
        return b;
      }));
      const remaining = settings.minStartIntervalMs - (Date.now() - lastStart);
      if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
      lastStart = Date.now();
      const row = { windowId:w.id, sourceId:w.sourceId, start:w.start, end:w.end, promptHash, modelId, frameIds:w.frames.map(f=>f.frameId), startedAt:new Date().toISOString(), status:'started' };
      const dest = path.join(runPath, `${w.id}.json`);
      await fs.writeFile(dest, JSON.stringify(row, null, 2));
      try {
        const r = await client.send(new ConverseCommand({ modelId, ...requestFor(w, bytes) }), { abortSignal:AbortSignal.timeout(60000) });
        row.latencyMs = Date.now()-lastStart; row.usage=r.usage; row.stopReason=r.stopReason;
        row.rawText=(r.output?.message?.content || []).filter(c=>typeof c.text==='string').map(c=>c.text).join('\n');
        row.formatNormalization = /^```(?:json)?\s*\n/.test(row.rawText.trim()) ? 'outer_json_code_fence' : 'none';
        if (r.stopReason === 'max_tokens') throw new Error('Truncated response');
        try { row.response = validateResponse(row.rawText, w); row.status='ok'; }
        catch (err) { row.status='invalid_output'; row.validationError=String(err.message).slice(0,1200); }
      } catch (err) {
        row.latencyMs=Date.now()-lastStart; row.status='failed'; row.error={name:err.name,message:String(err.message).slice(0,700)};
      }
      await fs.writeFile(dest, JSON.stringify(row,null,2)); results.push(row);
      console.log(JSON.stringify({window:row.windowId,status:row.status,opportunities:row.response?.opportunities.length ?? null,latencyMs:row.latencyMs,inputTokens:row.usage?.inputTokens ?? null}));
      // No hidden retries or repeated paid repairs. Stop if account/transport fails.
      if (row.status === 'failed') break;
    }
  } finally { client.destroy(); }
  const usage = results.reduce((a,r)=>({inputTokens:a.inputTokens+(r.usage?.inputTokens||0),outputTokens:a.outputTokens+(r.usage?.outputTokens||0)}),{inputTokens:0,outputTokens:0});
  const summary={...frozen,finishedAt:new Date().toISOString(),attempts:results.length,valid:results.filter(r=>r.status==='ok').length,invalid:results.filter(r=>r.status==='invalid_output').length,failed:results.filter(r=>r.status==='failed').length,unprocessedWindows:windows.length-results.length,usage,usageComplete:results.every(r=>r.usage),opportunitiesBeforeDeduplication:results.flatMap(r=>r.response?.opportunities||[]).length};
  await fs.writeFile(path.join(runPath,'summary.json'),JSON.stringify(summary,null,2));
  const {plannedWindows, ...compactSummary}=summary; console.log(JSON.stringify(compactSummary));
}

if (import.meta.url === pathToFileURL(process.argv[1]||'').href) {
  const args=process.argv.slice(2), val=(flag)=>args[args.indexOf(flag)+1];
  const required=['--manifest','--split','--run'];
  for(const flag of required) if(!args.includes(flag)||!val(flag)||val(flag).startsWith('--')) throw new Error(`Missing ${flag}`);
  const invoke=args.includes('--invoke');
  if(invoke && (!args.includes('--credentials')||!val('--credentials'))) throw new Error('Missing --credentials');
  await evaluate({manifestPath:path.resolve(val('--manifest')),credentialsPath:invoke?path.resolve(val('--credentials')):null,split:val('--split'),runPath:path.resolve(val('--run')),modelId:args.includes('--model')?val('--model'):'us.anthropic.claude-sonnet-4-6',invoke});
}
