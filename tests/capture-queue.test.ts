import assert from "node:assert/strict";
import test from "node:test";
import { CaptureQueue } from "../src/discovery/captureQueue";

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
test("camera backpressure keeps one upload and the two newest waiting batches", async () => {
  const seen:number[]=[];
  let release!:()=>void;
  let dropped=0, active=0, maximum=0;
  const blocked=new Promise<void>(resolve=>{release=resolve;});
  const queue=new CaptureQueue<number>(async n=>{
    active++; maximum=Math.max(maximum,active); seen.push(n);
    if(n===1) await blocked;
    active--;
  },()=>dropped++,error=>{throw error;});
  queue.enqueue(1); await tick();
  queue.enqueue(2); queue.enqueue(3); queue.enqueue(4);
  assert.equal(dropped,1);
  assert.deepEqual(seen,[1]);
  release(); await queue.drain();
  assert.deepEqual(seen,[1,3,4]);
  assert.equal(maximum,1);
});
test("camera cancellation drops waiting work and a failed upload is not retried", async()=>{
  const sent:number[]=[]; const failures:unknown[]=[];
  const queue=new CaptureQueue<number>(async n=>{sent.push(n); throw new Error("disconnected");},()=>{},error=>failures.push(error));
  queue.enqueue(1);queue.enqueue(2);
  await queue.drain();queue.enqueue(3);await tick();
  assert.deepEqual(sent,[1]);assert.equal(failures.length,1);
  const closed=new CaptureQueue<number>(async n=>{sent.push(n);},()=>{},error=>failures.push(error));
  closed.close();closed.enqueue(4);await closed.drain();
  assert.deepEqual(sent,[1]);
});
