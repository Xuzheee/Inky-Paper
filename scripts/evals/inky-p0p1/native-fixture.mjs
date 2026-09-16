// Synthetic C05 fixture adapter only. Never exposes an application state-import API.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {lstat, mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {factsFor, factsHash, validateCases} from './validate.mjs';

export const WORKSPACE_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const CANONICAL_PATH = new URL('./cases.json', import.meta.url);
const DAY = 86_400_000;
const sourceHashes = new WeakMap();
const clone = value => structuredClone(value);
const sha = text => createHash('sha256').update(text).digest('hex');
const strictDate = value => {
  assert.match(value || '', /^\d{4}-\d{2}-\d{2}$/, 'Invalid local date');
  assert.equal(new Date(`${value}T00:00:00Z`).toISOString().slice(0,10), value, 'Invalid local date');
  return value;
};
const epoch = value => {
  const at = typeof value === 'number' ? value : Date.parse(value);
  assert(Number.isFinite(at) && at >= 0, `Invalid fixture timestamp: ${value}`);
  return at;
};
const iso = value => value == null ? null : new Date(epoch(value)).toISOString();

export async function loadCanonicalSuite() {
  const raw = await readFile(CANONICAL_PATH, 'utf8');
  const suite = JSON.parse(raw);
  validateCases(suite);
  sourceHashes.set(suite, sha(raw));
  return suite;
}

export function adaptSuiteDates(canonical, {today, utcOffsetMinutes=480, timeZone='Asia/Shanghai'}={}) {
  validateCases(canonical);
  strictDate(today);
  assert.equal(timeZone, 'Asia/Shanghai', 'C05 fixtures require the documented timezone');
  assert.equal(utcOffsetMinutes, 480, 'Do not silently change the fixture UTC offset');
  const canonicalToday = '2030-03-04';
  const dayShift = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${canonicalToday}T00:00:00Z`))/DAY;
  assert(Number.isInteger(dayShift));
  const dateMap = Object.fromEntries([...new Set(JSON.stringify(canonical).match(/\d{4}-\d{2}-\d{2}/g))].map(value => {
    strictDate(value);
    return [value,new Date(Date.parse(`${value}T00:00:00Z`)+dayShift*DAY).toISOString().slice(0,10)];
  }));
  const chineseMap = {};
  for (const [before,after] of Object.entries(dateMap)) {
    const [,m,d] = before.split('-').map(Number), [,nextM,nextD] = after.split('-').map(Number);
    const key = `${m}/${d}`;
    assert(!chineseMap[key] || chineseMap[key] === `${nextM} 月 ${nextD} 日`, 'Ambiguous month/day reference');
    chineseMap[key] = `${nextM} 月 ${nextD} 日`;
  }
  const shift = value => {
    if (typeof value === 'string') return value.replace(/\d{4}-\d{2}-\d{2}/g, date => dateMap[date])
      .replace(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/g, (whole,m,d) => chineseMap[`${+m}/${+d}`] || whole);
    if (Array.isArray(value)) return value.map(shift);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key,item]) => [key,shift(item)]));
    return value;
  };
  const adapted = shift(canonical);
  validateCases(adapted);
  return {canonical:clone(canonical), adapted, manifest:{
    adapterVersion:1, syntheticOnly:true, canonicalToday, actualToday:today,
    appliedDateShift:dayShift, utcOffsetMinutes, timeZone, dateMap,
    originalFileSha256:sourceHashes.get(canonical) || null,
    originalFixtureHash:factsHash(canonical), adaptedDatasetHash:factsHash(adapted),
  }};
}

function findCase(dataset, id) {
  const found = dataset.cases.find(item => item.id === id);
  assert(found, `Unknown canonical case: ${id}`);
  return found;
}

function identityMap(facts) {
  return Object.fromEntries(['tasks','steps','dayItems','sessions','manualStepChanges','notes','summaries','projects','preferences']
    .map(kind => [kind,Object.fromEntries(facts[kind].map(item => [item.id,item.id]))]));
}

export function buildNativeFixture(adaptation, caseId, {repeat=1, now=Date.now()}={}) {
  assert(Number.isInteger(repeat) && repeat >= 1 && repeat <= 2, 'Unsupported repeat index');
  const canonicalCase = clone(findCase(adaptation.canonical,caseId));
  const actualCase = clone(findCase(adaptation.adapted,caseId));
  if (repeat > 1) assert(actualCase.repeatSample, 'Only designated cases are repeat samples');
  const canonicalFacts = factsFor(adaptation.canonical,canonicalCase);
  const adaptedFacts = factsFor(adaptation.adapted,actualCase);
  const sampledAt = Math.min(epoch(adaptedFacts.sampledAt), epoch(now));
  const historicalTimes = [sampledAt,...adaptedFacts.sessions.map(session => epoch(session.startedAt)),
    ...adaptedFacts.manualStepChanges.map(change => epoch(change.recordedAt))];
  const createdAt = Math.max(0,Math.min(...historicalTimes)-60_000);
  const defaults = [];
  const requiresLiveSession = [];
  const steps = adaptedFacts.steps.map(step => ({...clone(step),source:step.source || 'user',createdAt,updatedAt:createdAt}));
  const actionFor = step => ({id:step.id,text:step.text,completed:step.completed,source:step.source});
  const tasks = adaptedFacts.tasks.map(task => ({...clone(task),due:task.due ?? null,dueDate:task.dueDate ?? null,projectId:task.projectId ?? null,
    category:task.category || 'work',priority:task.priority || 'medium',nextAction:steps.find(step => step.taskId === task.id) ? actionFor(steps.find(step => step.taskId === task.id)) : null,
    source:task.source || 'user',createdAt,updatedAt:createdAt,completedAt:task.completed ? createdAt : null}));
  const dayItems = adaptedFacts.dayItems.map(item => ({...clone(item),startMinute:item.startMinute ?? null,durationMinutes:item.durationMinutes ?? null,
    removedAt:item.removedAt == null ? null : epoch(item.removedAt),resolvedAt:null,resolution:null,continuedTo:null}));
  const intervals = [], sessionLinks = [];
  const sessions = [];
  for (const session of adaptedFacts.sessions) {
    const step = steps.find(step => step.id === session.stepId && step.taskId === session.taskId);
    assert(step, `Missing step for ${session.id}`);
    const task = tasks.find(task => task.id === session.taskId);
    assert(task, `Missing task for ${session.id}`);
    if (session.status === 'running') {
      requiresLiveSession.push({canonicalSessionId:session.id,taskId:session.taskId,stepId:session.stepId,
        plannedSeconds:step.plannedSeconds,canonicalElapsedSeconds:session.elapsedSeconds,reason:'Arm through real start_session after native launch; do not seed an expired running timer.'});
      continue;
    }
    assert.equal(session.status,'finished','Unsupported synthetic session status');
    const startedAt=epoch(session.startedAt), endedAt=epoch(session.finishedAt);
    assert(endedAt >= startedAt, 'Session ends before it starts');
    assert(endedAt <= now, `FIXTURE_FUTURE_SESSION: ${session.id} ends after the actual run time`);
    assert.equal(endedAt-startedAt,session.elapsedSeconds*1000,'Fixtures represent continuous known intervals; do not invent pause history');
    const plannedSeconds=Math.max(step.plannedSeconds,session.elapsedSeconds);
    assert(plannedSeconds >= 60 && plannedSeconds <= 7200);
    sessions.push({id:session.id,taskId:session.taskId,taskTitle:session.taskTitle,action:{id:session.stepId,text:session.actionText,completed:false,source:'user'},
      taskRevision:task.revision,kind:'focus',status:'finished',revision:session.revision,plannedSeconds,elapsedSeconds:session.elapsedSeconds,
      startedAt,lastResumedAt:null,endedAt,pauseCount:0,resumeCue:null,
      feedback:{outcome:session.stepCompleted ? 'step_completed':'stopped',output:session.output ?? null,blocker:session.blocker ?? null,nextCue:session.nextCue ?? null}});
    intervals.push({sessionId:session.id,startedAt,endedAt});
    const localStart=new Date(startedAt+actualCase.context.utcOffsetMinutes*60_000).toISOString().slice(0,10);
    const matching=dayItems.filter(item => item.taskId === session.taskId && item.stepId === session.stepId && item.removedAt == null && item.date <= localStart)
      .sort((a,b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
    if (matching.length) sessionLinks.push({sessionId:session.id,dayItemId:matching[0].id,planDate:matching[0].date});
    defaults.push({objectType:'sessions',objectId:session.id,field:'plannedSeconds',value:plannedSeconds,reason:'Missing in evaluation projection; at least recorded continuous duration, not an observed user estimate.'});
  }
  const manualStepChanges=adaptedFacts.manualStepChanges.map(change => {
    const recordedAt=epoch(change.recordedAt);
    assert(recordedAt <= now, `FIXTURE_FUTURE_EVENT: ${change.id} is after the actual run time`);
    return {...clone(change),recordedAt,taskTitle:tasks.find(task=>task.id===change.taskId)?.title,
      stepText:steps.find(step=>step.id===change.stepId)?.text};
  });
  const notes=adaptedFacts.notes.map(note => {
    const session=sessions.find(session=>session.id===note.sessionId),task=tasks.find(task=>task.id===note.taskId);
    return {...clone(note),revision:note.revision || 1,createdAt:session?.endedAt ?? sampledAt,source:'user',
      sessionId:note.sessionId ?? null,taskId:note.taskId ?? null,taskTitle:session?.taskTitle ?? task?.title ?? null,action:session?.action ?? null};
  });
  const summaries=adaptedFacts.summaries.map(summary => ({id:summary.id,date:summary.date || actualCase.context.requestDate,body:summary.body,
    sourceVersion:`synthetic-stale:${summary.sourceVersion}`,sourceNotesVersion:`synthetic-stale:${summary.sourceNotesVersion}`,
    sourceAsOf:epoch(summary.sourceAsOf),createdAt:epoch(summary.sourceAsOf),source:'synthetic-fixture',utcOffsetMinutes:actualCase.context.utcOffsetMinutes}));
  const preferences=adaptedFacts.preferences.map(preference => {
    if (preference.scope === 'long-term') {
      assert.equal(preference.value?.firstRoundMinutes,15,'Unrecognized old preference projection');
      defaults.push({objectType:'preferences',objectId:preference.id,field:'scope/text',before:clone(preference),reason:'Map the fixed M0 long-term 15-minute preference to the explicit current global text schema.'});
      return {id:preference.id,text:'通常首轮15分钟',scope:'global',date:null,projectId:null,enabled:preference.enabled,
        revision:preference.revision,confirmedAt:createdAt,updatedAt:createdAt,source:'user'};
    }
    return {...clone(preference),date:preference.date ?? null,projectId:preference.projectId ?? null,
      confirmedAt:createdAt,updatedAt:createdAt,source:'user'};
  });
  const projects=adaptedFacts.projects.map(project => ({...clone(project),goal:project.goal || '',criteria:project.criteria || '',
    referenceLinks:project.referenceLinks || [],archived:project.archived ?? false,revision:project.revision || 1,updatedAt:createdAt,source:'user'}));
  const days=adaptedFacts.constraints.availableMinutes == null ? [] : [{date:actualCase.context.requestDate,revision:1,
    availableMinutes:adaptedFacts.constraints.availableMinutes,unavailable:[],updatedAt:createdAt,source:'user'}];
  const state={tasks,sessions,notes,coach:{settings:{enabled:false,hermes:false,revision:1}},planning:{steps,batches:[],dayItems,summaries,intervals,sessionLinks,
    manualStepChanges,prepared:null,planChanges:[],adjustments:[],taskCompletionAcknowledgements:[],context:{days,projects,preferences,preferencesRevision:preferences.length}}};
  assertNativeFixture(state);
  const idMap=identityMap(adaptedFacts);
  for (const live of requiresLiveSession) idMap.sessions[live.canonicalSessionId]=null;
  const revisionMap=Object.fromEntries(['tasks','steps','dayItems','sessions'].map(kind=>[kind,Object.fromEntries(adaptedFacts[kind].map(item=>[item.id,{canonical:item.revision,actual:kind==='sessions'&&idMap.sessions[item.id]===null ? null:item.revision}]))]));
  const manifest={...clone(adaptation.manifest),caseId,repeat,canonicalCaseHash:factsHash(canonicalCase),adaptedCaseHash:factsHash(actualCase),
    canonicalFactsHash:factsHash(canonicalFacts),adaptedFactsHash:factsHash(adaptedFacts),initialStateHash:factsHash(state),idMap,revisionMap,defaults,
    summaryVersionPolicy:'Synthetic old versions are explicitly prefixed synthetic-stale. Current versions must be read from the native get_daily_record response.',
    activeSessionPolicy:'Running fixtures are never imported; the runner must create a real session and record its actual identity/timestamps.'};
  return {caseId,repeat,canonicalCase,actualCase,canonicalFacts,adaptedFacts,state,personalNotes:adaptedFacts.personalNotes,manifest,requiresLiveSession};
}

export function assertNativeFixture(state) {
  const unique = (items,label) => assert.equal(new Set(items.map(item=>item.id)).size,items.length,`Duplicate ${label} IDs`);
  unique(state.tasks,'task'); unique(state.planning.steps,'step'); unique(state.planning.dayItems,'day item'); unique(state.sessions,'session');
  for (const task of state.tasks) if (task.nextAction) {
    const step=state.planning.steps.find(step=>step.taskId===task.id&&step.id===task.nextAction.id);
    assert(step && step.text===task.nextAction.text && step.completed===task.nextAction.completed,'reconcile_steps would change the prepared fixture');
  }
  for (const item of state.planning.dayItems) assert(state.tasks.some(task=>task.id===item.taskId) && state.planning.steps.some(step=>step.taskId===item.taskId&&step.id===item.stepId),'Dangling arrangement');
  for (const session of state.sessions) {
    assert.equal(session.status,'finished','Live sessions require real user start');
    assert(state.planning.intervals.some(interval=>interval.sessionId===session.id),'Missing explicit session interval');
  }
  return true;
}

function permittedCasePath(caseRoot) {
  const absolute=path.resolve(caseRoot),relative=path.relative(path.join(WSPACE(),'output'),absolute);
  const parts=relative.split(path.sep);
  assert(relative && !path.isAbsolute(relative) && !parts.includes('..') && /^p0p1-m5-[A-Za-z0-9_-]+$/.test(parts[0]),'Case root must stay inside this checkout output/p0p1-m5-*');
  assert(parts.every(part=>/^[A-Za-z0-9_-]+$/.test(part)),'Unsafe case path segment');
  return absolute;
}
function WSPACE() { return path.resolve(WORKSPACE_ROOT); }

async function assertNoLinks(absolute) {
  let cursor=path.parse(absolute).root;
  for (const part of absolute.slice(cursor.length).split(path.sep)) {
    cursor=path.join(cursor,part);
    try { assert(!(await lstat(cursor)).isSymbolicLink(),`Fixture path must not follow a link: ${cursor}`); }
    catch(error) { if (error.code !== 'ENOENT') throw error; }
  }
}

const PYTHON_INIT = String.raw`import json,os,sqlite3,sys
p=sys.argv[1]
payload=json.load(sys.stdin)
fd=os.open(p,os.O_CREAT|os.O_EXCL|os.O_WRONLY)
os.close(fd)
c=sqlite3.connect(p)
try:
 c.executescript('PRAGMA user_version=1; CREATE TABLE paper_state(id INTEGER PRIMARY KEY CHECK(id=1),data TEXT NOT NULL); CREATE TABLE paper_events(seq INTEGER PRIMARY KEY AUTOINCREMENT,data TEXT NOT NULL); CREATE TABLE paper_requests(id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,result TEXT NOT NULL);')
 c.execute('INSERT INTO paper_state(id,data) VALUES(1,?)',(json.dumps(payload,ensure_ascii=False,separators=(',',':')),))
 c.commit()
 print(json.dumps({'initialized':True,'schemaVersion':1,'taskCount':len(payload['tasks'])}))
finally:
 c.close()
`;

async function pythonInitialize(executable,databasePath,state) {
  return new Promise((resolve,reject)=>{
    const child=spawn(executable,['-c',PYTHON_INIT,databasePath],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,PYTHONUTF8:'1'}});
    let out='',error='';
    child.stdout.on('data',chunk=>{out+=chunk}); child.stderr.on('data',chunk=>{error+=chunk});
    child.on('error',reject);
    child.on('close',code=>code===0 ? resolve(JSON.parse(out)) : reject(new Error(`Fixture SQLite initializer failed (${code}): ${error.slice(-3000)}`)));
    child.stdin.on('error',reject);
    child.stdin.end(JSON.stringify(state));
  });
}

export async function initializeCaseDatabase({caseRoot,fixture,pythonExecutable='python'}) {
  const root=permittedCasePath(caseRoot);
  await assertNoLinks(root);
  // Refuse even an existing empty case directory, preventing accidental resume or live DB writes.
  await mkdir(path.dirname(root),{recursive:true});
  await assertNoLinks(root);
  await mkdir(root);
  const dataDir=path.join(root,'paper-test'),webviewDir=path.join(root,'webview'),evidenceDir=path.join(root,'evidence');
  await Promise.all([dataDir,webviewDir,evidenceDir].map(folder=>mkdir(folder)));
  assertNativeFixture(fixture.state);
  for (const session of fixture.state.sessions) assert(session.endedAt<=Date.now(),'FIXTURE_FUTURE_SESSION');
  const databasePath=path.join(dataDir,'paper.sqlite3');
  await pythonInitialize(pythonExecutable,databasePath,fixture.state);
  const fixturePath=path.join(evidenceDir,'fixture.json'),manifestPath=path.join(evidenceDir,'fixture-manifest.json');
  await writeFile(fixturePath,JSON.stringify(fixture,null,2)+'\n',{flag:'wx'});
  await writeFile(manifestPath,JSON.stringify(fixture.manifest,null,2)+'\n',{flag:'wx'});
  return {caseRoot:root,dataDir,databasePath,webviewDir,evidenceDir,fixturePath,manifestPath};
}

export function projectActualFacts(state,dailyRecord,{fixture,sessionIdMap={}}={}) {
  const day=dailyRecord.record || dailyRecord.day || dailyRecord;
  assert(typeof day.dataVersion==='string' && typeof day.notesVersion==='string','Use a real enriched get_daily_record response');
  assert(Number.isFinite(day.sampledAt),'Use the native sampledAt');
  const planning=state.planning || {};
  const facts={sampledAt:iso(day.sampledAt),dataVersion:day.dataVersion,notesVersion:day.notesVersion,
    tasks:clone(state.tasks),steps:clone(planning.steps || []),dayItems:clone(planning.dayItems || []),
    sessions:state.sessions.filter(session=>session.kind==='focus'&&session.taskId&&session.action).map(session=>({
      id:session.id,taskId:session.taskId,stepId:session.action.id,revision:session.revision,status:session.status,
      startedAt:iso(session.startedAt),finishedAt:iso(session.endedAt),elapsedSeconds:session.elapsedSeconds,
      taskTitle:session.taskTitle,actionText:session.action.text,output:session.feedback?.output ?? null,blocker:session.feedback?.blocker ?? null,
      nextCue:session.feedback?.nextCue ?? null,stepCompleted:session.feedback?.outcome==='step_completed',
    })),manualStepChanges:clone(planning.manualStepChanges || []).map(change=>({...change,recordedAt:iso(change.recordedAt)})),
    notes:clone(state.notes),summaries:clone(planning.summaries || []).map(summary=>({...summary,sourceAsOf:iso(summary.sourceAsOf)})),
    personalNotes:day.personalNotes ?? '',constraints:{availableMinutes:day.capacity?.availableMinutes ?? day.dayConstraints?.availableMinutes ?? null,reportedEnergy:null},
    preferences:clone(planning.context?.preferences || []),projects:clone(planning.context?.projects || []),
  };
  const idMap=fixture ? clone(fixture.manifest.idMap) : identityMap(facts),revisionMap={},deviations=[];
  for (const [oldId,newId] of Object.entries(sessionIdMap)) {
    assert(facts.sessions.some(session=>session.id===newId),`Live session mapping points to a missing actual session: ${newId}`);
    idMap.sessions[oldId]=newId;
  }
  if (fixture) for (const kind of Object.keys(idMap)) {
    revisionMap[kind]={};
    for (const original of fixture.adaptedFacts[kind]) {
      const actualId=idMap[kind][original.id];
      const actual=facts[kind].find(item=>item.id===actualId);
      if (!actual) deviations.push({objectType:kind,canonicalId:original.id,actualId:actualId??null,reason:'No actual object currently corresponds to this fixture object.'});
      if (original.revision!=null) revisionMap[kind][original.id]={canonical:original.revision,actual:actual?.revision??null};
      if (kind==='sessions'&&actual&&original.status==='running') deviations.push({objectType:kind,canonicalId:original.id,actualId,
        reason:'Real user-started session replaces the canonical running history.',canonicalStartedAt:original.startedAt,actualStartedAt:actual.startedAt,
        canonicalElapsedSeconds:original.elapsedSeconds,actualElapsedSeconds:actual.elapsedSeconds});
    }
  }
  return {facts,factsSha256:factsHash(facts),idMap,revisionMap,deviations};
}
