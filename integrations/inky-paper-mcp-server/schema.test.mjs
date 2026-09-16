import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

test('actual MCP advertisement requires evidence and cannot expose direct task or clock writes', async () => {
  const transport=new StdioClientTransport({command:process.execPath,args:[path.resolve('integrations/inky-paper-mcp-server/index.mjs')],env:{...process.env,INKY_PAPER_CONNECTION_FILE:path.resolve('output/p0p1-m5-schema/no-connection.json')},stderr:'pipe'});
  const client=new Client({name:'isolated-schema-check',version:'1'});
  try {
    await client.connect(transport);
    const {tools}=await client.listTools();
    assert.equal(tools.length,12);
    assert(!tools.some(tool=>/start_session|adopt_|create_task|update_task|finish_session/.test(tool.name)));
    const summary=tools.find(tool=>tool.name==='inky_paper_save_daily_summary');
    assert(summary);
    assert(summary.inputSchema.required.includes('evidenceRefs'));
    assert.equal(summary.inputSchema.properties.evidenceRefs.maxItems,24);
    assert.equal(summary.inputSchema.properties.evidenceRefs.items.additionalProperties,false);
    const argumentsBase={requestId:'10000000-0000-4000-8000-000000000001',date:'2030-03-04',utcOffsetMinutes:480,expectedDataVersion:'fake',expectedNotesVersion:'fake',sourceAsOf:1,body:'未知'};
    // Invalid schema must fail before attempting any bridge access.
    for(const args of [argumentsBase,{...argumentsBase,evidenceRefs:[{kind:'session',id:'fake',snapshot:{invented:true}}]}]) {
      const result=await client.callTool({name:summary.name,arguments:args});
      assert.equal(result.isError,true);
      assert.match(JSON.stringify(result.content), /Invalid arguments|validation|evidenceRefs|snapshot/i);
      assert.doesNotMatch(JSON.stringify(result.content), /ENOENT|Connection rejected/);
    }
  } finally {await client.close();}
});
