#!/usr/bin/env node
'use strict';
// An app-owned MCP bridge. Every action still uses the same panel-scoped server.
const readline = require('readline');
const { main: control } = require('./panel-control');
const tools = [
  { name: 'whitebox_list_terminals', description: 'List live Claude/Codex terminals in this Whitebox panel. Use this when the user mentions the same panel or asks to contact another AI. Provider-native teammate lists and tmux do not describe Whitebox panel membership.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'whitebox_ask', description: 'Send the user-authorized request to another idle AI in the same Whitebox panel. Use a terminal ID from whitebox_list_terminals, or an unambiguous codex/claude name. Returns a job ID; use whitebox_wait for the actual reply. Never create a replacement agent merely because a target is busy.', inputSchema: { type: 'object', properties: { target: { type: 'string' }, message: { type: 'string' } }, required: ['target', 'message'], additionalProperties: false } },
  { name: 'whitebox_wait', description: 'Read the matched reply to a Whitebox job. A running state is not completion. Return the received answer to the user once completed.', inputSchema: { type: 'object', properties: { jobId: { type: 'string' }, seconds: { type: 'integer', minimum: 0, maximum: 45 } }, required: ['jobId'], additionalProperties: false } },
  { name: 'whitebox_read_terminal', description: 'Read current output of a terminal in this panel. Screen output alone does not establish completion of a request; use whitebox_wait for a sent job.', inputSchema: { type: 'object', properties: { target: { type: 'string' }, lines: { type: 'integer', minimum: 1, maximum: 200 } }, required: ['target'], additionalProperties: false } },
];
async function dispatch(method, params = {}, run = control) {
  if (method === 'initialize') return { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'whitebox-panel', version: '1.0.0' }, instructions: 'Use Whitebox tools for requests about other terminals in the same panel. List first, send only the user-authorized message, then wait for its matched reply.' };
  if (method === 'ping') return {};
  if (method === 'tools/list') return { tools };
  if (method !== 'tools/call') throw new Error('Unsupported method');
  const a = params.arguments || {};
  let args;
  if (params.name === 'whitebox_list_terminals') args = ['list-panels', '--json'];
  else if (params.name === 'whitebox_ask' && typeof a.target === 'string' && typeof a.message === 'string' && a.message.trim()) args = ['ask', '--surface', a.target, '--', a.message];
  else if (params.name === 'whitebox_wait' && typeof a.jobId === 'string' && /^[a-f0-9-]{36}$/iu.test(a.jobId)) args = ['wait', a.jobId, String(Math.max(0, Math.min(45, Number(a.seconds) || 0)))];
  else if (params.name === 'whitebox_read_terminal' && typeof a.target === 'string') args = ['read-screen', '--surface', a.target, '--lines', String(Math.max(1, Math.min(200, Number(a.lines) || 100))), '--json'];
  else return { isError: true, content: [{ type: 'text', text: 'Invalid Whitebox tool arguments' }] };
  try { const result = await run(args); return { content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result) }] }; }
  catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
}
function serve() {
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  input.on('line', async line => {
    if (line.length > 65536) return;
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (message.id === undefined) return;
    try { const result = await dispatch(message.method, message.params); process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\n'); }
    catch (error) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: error.message } }) + '\n'); }
  });
}
if (require.main === module) serve();
module.exports = { dispatch, tools };
