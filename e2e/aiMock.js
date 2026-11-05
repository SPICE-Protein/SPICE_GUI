// Local OpenAI-compatible stand-in for the Copilot E2E.
//
// The app talks to this server through the same frontend client used in
// production: SSE streaming, tool-call deltas, and the Rust non-streaming
// fallback (when the WebView blocks the direct request). The mock records every
// request so specs can assert what the client actually sent.

import http from 'node:http';

export const AI_MOCK_PORT = Number(process.env.AI_MOCK_PORT || 43118);
export const AI_MOCK_URL = `http://127.0.0.1:${AI_MOCK_PORT}`;

const requests = [];
let callSeq = 0;

function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'Content-Type, Authorization',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
  };
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function messageText(message) {
  return typeof message?.content === 'string' ? message.content : '';
}

function toolCall(name, args) {
  callSeq += 1;
  return {
    id: `call_e2e_${callSeq}`,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  };
}

/** Decide the scripted answer from the newest user text or a tool result. */
function completionFor(body) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const last = messages[messages.length - 1];
  if (last?.role === 'tool') {
    let ok = true;
    let summary = '';
    try {
      const parsed = JSON.parse(messageText(last));
      ok = parsed.ok !== false;
      summary = typeof parsed.summary === 'string' ? parsed.summary : '';
    } catch {
      ok = false;
    }
    return {
      content: `E2E tool finished: ${last.name} -> ${ok ? 'ok' : 'failed'}${summary ? ` (${summary})` : ''}`,
    };
  }

  const prompt = messages
    .filter((message) => message?.role === 'user')
    .map(messageText)
    .join('\n');

  if (prompt.includes('E2E-APPROVE') || prompt.includes('E2E-REJECT')) {
    return {
      toolCalls: [toolCall('apply_dna_sequence', {
        sequence: 'ATGCGTACGTAGCTAGCTAGCTAGCTAGCTAA',
        reason: 'E2E approval flow',
      })],
    };
  }
  if (prompt.includes('E2E-READ')) {
    return { toolCalls: [toolCall('get_workspace_context', {})] };
  }
  return { content: 'E2E streamed reply: Copilot transport is working.' };
}

function streamCompletion(res, answer) {
  const chunks = [];
  if (answer.toolCalls?.length) {
    const calls = answer.toolCalls.map((call, index) => ({
      index,
      id: call.id,
      type: call.type,
      function: { name: call.function.name, arguments: '' },
    }));
    chunks.push({ choices: [{ index: 0, delta: { role: 'assistant', tool_calls: calls } }] });
    for (const [index, call] of answer.toolCalls.entries()) {
      chunks.push({
        choices: [{ index: 0, delta: { tool_calls: [{ index, function: { arguments: call.function.arguments } }] } }],
      });
    }
    chunks.push({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] });
  } else {
    const parts = answer.content.match(/.{1,18}/gs) ?? [''];
    for (const part of parts) {
      chunks.push({ choices: [{ index: 0, delta: { content: part } }] });
    }
    chunks.push({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
  }

  res.writeHead(200, {
    ...corsHeaders(),
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  for (const chunk of chunks) {
    res.write(`data: ${JSON.stringify({ id: `chatcmpl_e2e_${callSeq}`, object: 'chat.completion.chunk', ...chunk })}\n\n`);
  }
  res.write('data: [DONE]\n\n');
  res.end();
}

function jsonCompletion(res, answer) {
  const message = answer.toolCalls?.length
    ? { role: 'assistant', content: null, tool_calls: answer.toolCalls }
    : { role: 'assistant', content: answer.content };
  res.writeHead(200, { ...corsHeaders(), 'content-type': 'application/json' });
  res.end(JSON.stringify({
    id: `chatcmpl_e2e_${callSeq}`,
    object: 'chat.completion',
    choices: [{
      index: 0,
      message,
      finish_reason: answer.toolCalls?.length ? 'tool_calls' : 'stop',
    }],
  }));
}

async function route(req, res) {
  const url = new URL(req.url || '/', AI_MOCK_URL);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  if (req.method === 'GET' && url.pathname === '/__requests') {
    res.writeHead(200, { ...corsHeaders(), 'content-type': 'application/json' });
    res.end(JSON.stringify(requests));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/v1/models') {
    res.writeHead(200, { ...corsHeaders(), 'content-type': 'application/json' });
    res.end(JSON.stringify({ object: 'list', data: [{ id: 'e2e-copilot', object: 'model' }] }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
    const body = await readBody(req);
    requests.push({
      at: requests.length,
      model: body.model,
      stream: body.stream !== false,
      toolCount: Array.isArray(body.tools) ? body.tools.length : 0,
      messages: (body.messages ?? []).map((message) => ({
        role: message.role,
        content: typeof message.content === 'string' ? message.content : '',
        tool_calls: Array.isArray(message.tool_calls) ? message.tool_calls : undefined,
        name: message.name,
      })),
    });
    const answer = completionFor(body);
    if (body.stream === false) jsonCompletion(res, answer);
    else streamCompletion(res, answer);
    return;
  }

  res.writeHead(404, { ...corsHeaders(), 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: { message: `no mock route for ${req.method} ${url.pathname}` } }));
}

export function startAiMock() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      void route(req, res).catch((error) => {
        res.writeHead(500, { ...corsHeaders(), 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: String(error) } }));
      });
    });
    server.once('error', reject);
    server.listen(AI_MOCK_PORT, '127.0.0.1', () => {
      console.log(`AI mock listening on ${AI_MOCK_URL}`);
      resolve(server);
    });
  });
}

export function stopAiMock(server) {
  return new Promise((resolve) => {
    if (!server) return resolve();
    server.close(() => resolve());
  });
}
