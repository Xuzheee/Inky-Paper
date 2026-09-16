import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '../../inky-paper-mcp-server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '../../inky-paper-mcp-server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';

const calls = [];
const uuid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let mode = 'ok';
const server = createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const input = JSON.parse(body);
  assert.equal(req.headers.authorization, 'Bearer test-only-paper-token');
  calls.push({ action: req.url, input });
  res.setHeader('Content-Type', 'application/json');
  if (mode === 'conflict') {
    res.writeHead(400);
    res.end(JSON.stringify({ error: 'CONFLICT: fixture changed' }));
  } else res.end(JSON.stringify({ data: { batch: { id: uuid(1), revision: 1 }, dataVersion: 'facts-v1', notesVersion: 'notes-v1', sampledAt: 12345 } }));
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const folder = await mkdtemp(join(tmpdir(), 'inky-coach-mcp-'));
const connectionFile = join(folder, 'connection.json');
const connection = { app: 'inky-paper', protocolVersion: 1, url: `http://127.0.0.1:${server.address().port}`, token: 'test-only-paper-token' };
await writeFile(connectionFile, JSON.stringify(connection));
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL('../../inky-paper-mcp-server/index.mjs', import.meta.url))],
  env: { ...process.env, INKY_PAPER_CONNECTION_FILE: connectionFile }, stderr: 'pipe',
});
const client = new Client({ name: 'inky-coach-contract-test', version: '1.0.0' });
try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  const names = tools.map(tool => tool.name);
  for (const name of ['list_tasks', 'get_task', 'propose_plan_adjustment', 'get_plan_adjustment', 'read_history', 'read_events', 'get_coach_context', 'propose_coaching_action', 'propose_plan_batch', 'get_plan_batch', 'get_daily_record', 'save_daily_summary']) {
    assert(names.includes(`inky_paper_${name}`), `missing ${name}`);
  }
  assert.equal(names.length, 12);
  assert(!names.some(name => /adopt|revise|create_task|update_task|start_session|stop_session|runtime_tick/.test(name)));
  const proposed = { requestId: uuid(2), batchId: uuid(1), cards: [{ id: uuid(3), taskId: uuid(4), taskTitle: '测试任务', text: '起草结论', plannedSeconds: 1500 }] };
  const invoke = (name, args) => client.callTool({ name: `inky_paper_${name}`, arguments: args });
  assert(!(await invoke('propose_plan_batch', proposed)).isError);
  assert(!(await invoke('propose_plan_batch', proposed)).isError);
  assert.deepEqual(calls[0], calls[1]);
  const daily = await invoke('get_daily_record', { date: '2026-09-13', utcOffsetMinutes: 480 });
  assert.equal(daily.structuredContent.notesVersion, 'notes-v1');
  const summary = { requestId: uuid(5), date: '2026-09-13', utcOffsetMinutes: 480, expectedDataVersion: 'facts-v1', expectedNotesVersion: 'notes-v1', sourceAsOf: 12345, body: '记录到一轮工作，产出尚未报告。' };
  assert(!(await invoke('save_daily_summary', summary)).isError);
  assert.deepEqual(calls.at(-1).input, summary);
  const beforeInvalid = calls.length;
  const { expectedNotesVersion, ...missingNotesVersion } = summary;
  assert((await invoke('save_daily_summary', missingNotesVersion)).isError);
  assert.equal(calls.length, beforeInvalid);
  mode = 'conflict';
  assert((await invoke('save_daily_summary', summary)).isError);
  mode = 'ok';
  const adjust = {requestId:uuid(6),batchId:uuid(7),groups:[{id:uuid(8),reason:'只预留明确可用时间',actions:[{kind:'reservation',taskId:uuid(4),stepId:uuid(9),expectedTaskRevision:1,expectedStepRevision:1,itemId:uuid(10),expectedItemRevision:1,durationMinutes:30}]}]};
  assert(!(await invoke('propose_plan_adjustment',adjust)).isError);
  assert.deepEqual(calls.at(-1).input,adjust);
  const beforeForbidden=calls.length;
  assert((await invoke('create_task',{requestId:uuid(11),taskId:uuid(12),title:'不应创建'})).isError);
  assert((await invoke('adopt_plan_adjustment',{requestId:uuid(11)})).isError);
  assert.equal(calls.length,beforeForbidden);
  await writeFile(connectionFile, JSON.stringify({ ...connection, app: 'inky' }));
  const beforeForeign = calls.length;
  assert((await invoke('get_plan_batch', { batchId: uuid(1) })).isError);
  assert.equal(calls.length, beforeForeign);
  const source = await readFile(fileURLToPath(new URL('../../inky-paper-mcp-server/index.mjs', import.meta.url)), 'utf8');
  assert(source.includes('ON-DEMAND'));
  assert(source.includes('inky-coach:coach'));
  console.log('PASS: 12 MCP tools; explicit card-adoption boundary; same-request retry; daily fact/notes versions; conflict and foreign-connection rejection. No model calls.');
} finally {
  await client.close();
  server.close();
  if (!basename(folder).startsWith('inky-coach-mcp-')) throw new Error('Unexpected test directory');
  await rm(folder, { recursive: true, force: true });
}
