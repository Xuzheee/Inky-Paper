import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,readFile,rm,symlink} from 'node:fs/promises';
import path from 'node:path';
import {factsHash,validateCases,validateResults,emptyResults} from './validate.mjs';
import {WORKSPACE_ROOT,loadCanonicalSuite,adaptSuiteDates,buildNativeFixture,assertNativeFixture,initializeCaseDatabase,projectActualFacts} from './native-fixture.mjs';

const suite=await loadCanonicalSuite();
const now=Date.parse('2020-09-16T20:00:00+08:00');
const adaptation=adaptSuiteDates(suite,{today:'2020-09-16'});
const fixture=(id,options={})=>buildNativeFixture(adaptation,id,{now,...options});
const executeFile=promisify(execFile);

async function cleanup(directory) {
  const resolved=path.resolve(directory),relative=path.relative(path.resolve(WORKSPACE_ROOT,'output'),resolved);
  assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative) && /^p0p1-m5-fixture-test-/.test(relative));
  await rm(resolved,{recursive:true,force:true});
}

test('date adaptation preserves canonical bytes, every absolute date, timezone and cross-midnight relation',async()=>{
  const canonicalHash=factsHash(suite);
  const adapted=adaptSuiteDates(suite,{today:'2020-09-16'});
  assert.equal(factsHash(suite),canonicalHash);
  assert.equal(adapted.manifest.originalFileSha256,createHash('sha256').update(await readFile(new URL('./cases.json',import.meta.url))).digest('hex'));
  assert.equal(adapted.manifest.dateMap['2030-03-03'],'2020-09-15');
  assert.equal(adapted.manifest.dateMap['2030-03-06'],'2020-09-18');
  assert(!JSON.stringify(adapted.adapted).includes('2030-03-'));
  assert.deepEqual(adapted.adapted.cases.map(c=>[c.id,c.repeatSample,c.tags]),suite.cases.map(c=>[c.id,c.repeatSample,c.tags]));
  const review=fixture('REVIEW-03');
  const session=review.adaptedFacts.sessions[0];
  assert.equal(session.startedAt,'2020-09-15T23:50:00+08:00');
  assert.equal(session.finishedAt,'2020-09-16T00:10:00+08:00');
  assert(review.actualCase.expectedBehavior[0].includes('9 月 15 日'));
  const plan=fixture('PLAN-04');
  assert.equal(plan.actualCase.context.today,'2020-09-16');
  assert.equal(plan.actualCase.context.requestDate,'2020-09-18');
  assert(plan.actualCase.expectedBehavior[0].includes('2020-09-18'));
  assert.equal(validateCases(adapted.adapted).caseCount,24);
});

test('date adapter rejects unsupported offsets and malformed local dates',()=>{
  assert.throws(()=>adaptSuiteDates(suite,{today:'2020-09-16',utcOffsetMinutes:0}));
  assert.throws(()=>adaptSuiteDates(suite,{today:'2020-09-16',timeZone:'UTC'}));
  assert.throws(()=>adaptSuiteDates(suite,{today:'2020-02-30'}));
  assert.throws(()=>adaptSuiteDates(suite,{today:'2020-2-01'}));
});

test('all 24 cases and six repeats map to cold native state without duplicate reconciliation',()=>{
  let total=0;
  for(const c of suite.cases) {
    for(const repeat of c.repeatSample?[1,2]:[1]) {
      const f=fixture(c.id,{repeat});
      assertNativeFixture(f.state);
      assert.equal(f.manifest.caseId,c.id);
      assert.equal(f.manifest.repeat,repeat);
      assert.equal(f.manifest.initialStateHash,factsHash(f.state));
      assert.equal(f.state.planning.batches.length,0);
      assert.equal(f.state.planning.adjustments.length,0);
      assert.equal(f.state.coach.settings.hermes,false);
      total++;
    }
  }
  assert.equal(total,30);
  assert.throws(()=>fixture('REVIEW-02',{repeat:2}));
  assert.throws(()=>fixture('missing'));
});

test('cross-midnight fixture keeps exact intervals, historical plan link and full session fields',()=>{
  const f=fixture('REVIEW-03'),session=f.state.sessions[0];
  assert.equal(session.plannedSeconds,1200);
  assert.equal(session.elapsedSeconds,1200);
  assert.equal(session.action.text,'核对关键数字');
  assert.equal(session.feedback.output,'核对完三项');
  assert.equal(session.lastResumedAt,null);
  assert.equal(f.state.planning.sessionLinks[0].planDate,'2020-09-15');
  const interval=f.state.planning.intervals[0];
  const midnight=Date.parse('2020-09-16T00:00:00+08:00');
  assert.equal((midnight-interval.startedAt)/1000,600);
  assert.equal((interval.endedAt-midnight)/1000,600);
  assert.deepEqual(Object.keys(session).sort(),['id','taskId','taskTitle','action','taskRevision','kind','status','revision','plannedSeconds','elapsedSeconds','startedAt','lastResumedAt','endedAt','pauseCount','resumeCue','feedback'].sort());
});

test('live session is requested through real start instead of seeding an already-expired clock',()=>{
  const f=fixture('ADJUST-05');
  assert.equal(f.state.sessions.length,0);
  assert.equal(f.state.planning.intervals.length,0);
  assert.equal(f.requiresLiveSession.length,1);
  assert.equal(f.requiresLiveSession[0].canonicalElapsedSeconds,300);
  assert.equal(f.requiresLiveSession[0].plannedSeconds,900);
  assert.equal(f.manifest.idMap.sessions[f.requiresLiveSession[0].canonicalSessionId],null);
});

test('future finished history is rejected while historical manual events stay separate from sessions',()=>{
  assert.throws(()=>fixture('REVIEW-02',{now:Date.parse('2020-09-16T08:00:00+08:00')}),/FIXTURE_FUTURE_SESSION/);
  const f=fixture('REVIEW-01');
  assert.equal(f.state.sessions.length,0);
  assert.equal(f.state.planning.intervals.length,0);
  assert.equal(f.state.planning.manualStepChanges.length,2);
  assert.deepEqual(f.state.planning.manualStepChanges.map(c=>c.completed),[true,false]);
  assert.equal(f.state.planning.steps[0].completed,false);
  assert.equal(f.state.planning.manualStepChanges[0].taskTitle,'提交周报');
});

test('old preference and stale summary mappings are explicit without faking current version reads',()=>{
  const preference=fixture('PLAN-07');
  assert.equal(preference.state.planning.context.preferences[0].scope,'global');
  assert.equal(preference.state.planning.context.preferences[0].text,'通常首轮15分钟');
  assert.equal(preference.state.planning.context.preferencesRevision,1);
  assert.equal(preference.adaptedFacts.preferences[0].scope,'long-term');
  assert(preference.manifest.defaults.some(d=>d.objectType==='preferences'));
  const summary=fixture('REVIEW-06');
  assert.equal(summary.state.planning.summaries[0].sourceVersion,'synthetic-stale:fixture-base-v1');
  assert.equal(summary.state.planning.summaries[0].sourceNotesVersion,'synthetic-stale:fixture-notes-v1');
  assert.equal(summary.state.planning.summaries[0].date,'2020-09-16');
  assert(summary.manifest.summaryVersionPolicy.includes('native get_daily_record'));
});

test('actual facts come from native reads with live identity/revision mappings, not fixture version labels',()=>{
  const f=fixture('ADJUST-05'),state=structuredClone(f.state),spec=f.requiresLiveSession[0];
  state.sessions.push({id:'actual-live-session',taskId:spec.taskId,action:{id:spec.stepId,text:'核对关键数字'},taskTitle:'提交周报',
    kind:'focus',status:'running',revision:2,startedAt:now,endedAt:null,elapsedSeconds:0,feedback:null});
  const day={dataVersion:'actual-day-hash',notesVersion:'actual-notes-hash',sampledAt:now,personalNotes:'实际读取的笔记',capacity:{availableMinutes:null}};
  const out=projectActualFacts(state,day,{fixture:f,sessionIdMap:{[spec.canonicalSessionId]:'actual-live-session'}});
  assert.equal(out.facts.dataVersion,'actual-day-hash');
  assert.equal(out.facts.notesVersion,'actual-notes-hash');
  assert.equal(out.facts.personalNotes,'实际读取的笔记');
  assert.equal(out.facts.sampledAt,new Date(now).toISOString());
  assert.equal(out.facts.sessions[0].stepId,spec.stepId);
  assert.equal(out.idMap.sessions[spec.canonicalSessionId],'actual-live-session');
  assert.equal(out.revisionMap.sessions[spec.canonicalSessionId].actual,2);
  assert(out.deviations.some(d=>d.canonicalElapsedSeconds===300&&d.actualElapsedSeconds===0));
  assert.equal(out.factsSha256,factsHash(out.facts));
  assert.throws(()=>projectActualFacts(state,{sampledAt:now},{fixture:f}),/native|real enriched/);
  assert.throws(()=>projectActualFacts(state,day,{fixture:f,sessionIdMap:{[spec.canonicalSessionId]:'missing'}}));
  // No calls or answers are fabricated to test the result schema.
  const empty=emptyResults(adaptation.adapted);
  assert.equal(validateResults(adaptation.adapted,empty).notRun,24);
});

test('cold SQLite initialization writes only a new permitted directory and refuses any reuse',async()=>{
  const caseRoot=path.join(WORKSPACE_ROOT,'output',`p0p1-m5-fixture-test-${randomUUID()}`);
  try {
    const f=fixture('REVIEW-03');
    const result=await initializeCaseDatabase({caseRoot,fixture:f});
    assert.equal(result.databasePath,path.join(caseRoot,'paper-test','paper.sqlite3'));
    const script="import json,sqlite3,sys; c=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True); print(json.dumps({'state':json.loads(c.execute('SELECT data FROM paper_state').fetchone()[0]),'version':c.execute('PRAGMA user_version').fetchone()[0],'events':c.execute('SELECT COUNT(*) FROM paper_events').fetchone()[0],'requests':c.execute('SELECT COUNT(*) FROM paper_requests').fetchone()[0]}))";
    const read=JSON.parse((await executeFile('python',['-c',script,result.databasePath],{windowsHide:true,encoding:'utf8'})).stdout);
    assert.deepEqual(read.state,f.state);
    assert.equal(read.version,1);
    assert.equal(read.events,0);
    assert.equal(read.requests,0);
    const dbBefore=createHash('sha256').update(await readFile(result.databasePath)).digest('hex');
    await assert.rejects(initializeCaseDatabase({caseRoot,fixture:f}),/EEXIST/);
    assert.equal(createHash('sha256').update(await readFile(result.databasePath)).digest('hex'),dbBefore);
    assert.deepEqual(JSON.parse(await readFile(result.manifestPath,'utf8')),f.manifest);
    assert.equal(JSON.parse(await readFile(result.fixturePath,'utf8')).personalNotes,'');
  } finally { await cleanup(caseRoot); }
});

test('initializer rejects wrong output roots, traversal, existing empty folders and symlink redirects',async()=>{
  const f=fixture('PLAN-01');
  for(const root of [path.join(WORKSPACE_ROOT,'app','fake-case'),path.join(WORKSPACE_ROOT,'output','ordinary-case'),
    path.join(WORKSPACE_ROOT,'output','p0p1-m5-safe','..','escaped')]) {
    await assert.rejects(initializeCaseDatabase({caseRoot:root,fixture:f}),/output\/p0p1-m5/);
  }
  const base=path.join(WORKSPACE_ROOT,'output',`p0p1-m5-fixture-test-${randomUUID()}`);
  try {
    await mkdir(base);
    await assert.rejects(initializeCaseDatabase({caseRoot:base,fixture:f}),/EEXIST/);
    await mkdir(path.join(base,'target'));
    await symlink(path.join(base,'target'),path.join(base,'redirect'),process.platform==='win32'?'junction':'dir');
    await assert.rejects(initializeCaseDatabase({caseRoot:path.join(base,'redirect','new-case'),fixture:f}),/must not follow a link/);
  } finally { await cleanup(base); }
});
