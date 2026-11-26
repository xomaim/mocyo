// Talks to AI providers over plain HTTPS (built-in fetch), streaming replies. Every call is logged.
import { TOOLS, schema } from './tools.js';

export const apiLog = []; // { method, url, status, ms, inTok, outTok, request, response }
export const IDLE_TIMEOUT_MS = 90_000; // give up if the API sends nothing for this long

let current = null; // AbortController of the in-flight request
export function cancel() { if (current) { current.abort(new Error('cancelled')); return true; } return false; }

// POST and stream Server-Sent Events. onEvent(obj) is called for each JSON "data:" line.
async function stream(url, headers, body, onEvent) {
  const t0 = Date.now();
  const entry = { method: 'POST', url, status: 0, ms: 0, inTok: 0, outTok: 0, request: body, response: null };
  apiLog.push(entry);
  if (apiLog.length > 50) apiLog.shift();

  const ac = new AbortController();
  current = ac;
  let idle;
  const kick = () => {
    clearTimeout(idle);
    idle = setTimeout(() => ac.abort(new Error(`no response for ${IDLE_TIMEOUT_MS / 1000}s, timed out`)), IDLE_TIMEOUT_MS);
  };
  const fail = (msg) => { entry.ms = Date.now() - t0; entry.response ??= { error: msg }; throw new Error(msg); };

  try {
    kick();
    let res;
    try {
      res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ac.signal });
    } catch (e) { fail(ac.signal.aborted ? String(ac.signal.reason?.message || 'cancelled') : `Network error: ${e.message}`); }
    entry.status = res.status;

    if (!res.ok) {
      const text = await res.text();
      let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
      entry.response = json;
      fail(`API ${res.status}: ${json?.error?.message || json?.detail || json?.raw || JSON.stringify(json)}`);
    }

    const events = [];
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        kick();
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          let obj; try { obj = JSON.parse(data); } catch { continue; }
          if (obj.error) { entry.response = obj; fail(`API error: ${obj.error.message || JSON.stringify(obj.error)}`); }
          if (events.length < 400) events.push(obj);
          onEvent(obj);
        }
      }
    } catch (e) {
      if (ac.signal.aborted) fail(String(ac.signal.reason?.message || 'cancelled'));
      throw e;
    }
    entry.ms = Date.now() - t0;
    entry.response = { streamed_events: events.length, events };
    return entry;
  } finally {
    clearTimeout(idle);
    if (current === ac) current = null;
  }
}

// ---- OpenAI-compatible (OpenAI, OpenRouter, Groq, DeepSeek, Gemini, NVIDIA...) ----
async function openai(p, system, history, on) {
  const messages = [{ role: 'system', content: system }];
  for (const m of history) {
    if (m.role === 'user') messages.push({ role: 'user', content: m.text });
    else if (m.role === 'assistant')
      messages.push({
        role: 'assistant',
        content: m.text || null,
        ...(m.calls?.length && {
          tool_calls: m.calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })),
        }),
      });
    else if (m.role === 'tool') messages.push({ role: 'tool', tool_call_id: m.id, content: m.text });
  }
  let text = '';
  const calls = [];
  let usage = null;
  const entry = await stream(
    `${p.base}/chat/completions`,
    { authorization: `Bearer ${p.key}`, accept: 'text/event-stream' },
    {
      model: p.model,
      messages,
      stream: true,
      ...(!p.noUsage && { stream_options: { include_usage: true } }),
      ...(!p.noTools && { tools: TOOLS.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: schema(t) } })) }),
    },
    (ev) => {
      if (ev.usage) usage = ev.usage;
      const d = ev.choices?.[0]?.delta;
      if (!d) return;
      const think = d.reasoning_content || d.reasoning;
      if (think) on.think(think);
      if (d.content) { text += d.content; on.text(d.content); }
      for (const tc of d.tool_calls || []) {
        const i = tc.index ?? calls.length;
        calls[i] ??= { id: '', name: '', argStr: '' };
        if (tc.id) calls[i].id = tc.id;
        if (tc.function?.name) calls[i].name += tc.function.name;
        if (tc.function?.arguments) calls[i].argStr += tc.function.arguments;
      }
    }
  );
  entry.inTok = usage?.prompt_tokens || 0;
  entry.outTok = usage?.completion_tokens || 0;
  return {
    text,
    calls: calls.filter(Boolean).map((c, i) => {
      let args = {};
      try { args = JSON.parse(c.argStr || '{}'); } catch {}
      return { id: c.id || `call_${Date.now()}_${i}`, name: c.name, args };
    }),
    entry,
  };
}

// ---- Anthropic Messages API ----
async function anthropic(p, system, history, on) {
  const messages = [];
  const push = (role, block) => {
    const last = messages[messages.length - 1];
    if (last && last.role === role) last.content.push(block);
    else messages.push({ role, content: [block] });
  };
  for (const m of history) {
    if (m.role === 'user') push('user', { type: 'text', text: m.text });
    else if (m.role === 'assistant') {
      if (m.text) push('assistant', { type: 'text', text: m.text });
      for (const c of m.calls || []) push('assistant', { type: 'tool_use', id: c.id, name: c.name, input: c.args });
    } else if (m.role === 'tool') push('user', { type: 'tool_result', tool_use_id: m.id, content: m.text });
  }
  let text = '', inTok = 0, outTok = 0;
  const blocks = {};
  const entry = await stream(
    `${p.base}/messages`,
    { 'x-api-key': p.key, 'anthropic-version': '2023-06-01' },
    {
      model: p.model,
      max_tokens: 8192,
      stream: true,
      system,
      messages,
      tools: TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: schema(t) })),
    },
    (ev) => {
      if (ev.type === 'message_start') inTok = ev.message?.usage?.input_tokens || 0;
      else if (ev.type === 'message_delta') outTok = ev.usage?.output_tokens || outTok;
      else if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use')
        blocks[ev.index] = { id: ev.content_block.id, name: ev.content_block.name, argStr: '' };
      else if (ev.type === 'content_block_delta') {
        const d = ev.delta;
        if (d.type === 'text_delta') { text += d.text; on.text(d.text); }
        else if (d.type === 'thinking_delta') on.think(d.thinking);
        else if (d.type === 'input_json_delta' && blocks[ev.index]) blocks[ev.index].argStr += d.partial_json;
      }
    }
  );
  entry.inTok = inTok;
  entry.outTok = outTok;
  return {
    text,
    calls: Object.values(blocks).map((b) => {
      let args = {};
      try { args = JSON.parse(b.argStr || '{}'); } catch {}
      return { id: b.id, name: b.name, args };
    }),
    entry,
  };
}

// Quick probe used by /test: one request with a short timeout, returns status + time.
export async function probe(p, { stream: st, tools }, ms = 30000) {
  const t0 = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  const body = { model: p.model, messages: [{ role: 'user', content: 'Say hi in one word.' }], max_tokens: 20 };
  if (st) body.stream = true;
  if (tools) body.tools = TOOLS.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: schema(t) } }));
  try {
    const res = await fetch(`${p.base}/chat/completions`, {
      method: 'POST', signal: ac.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${p.key}` },
      body: JSON.stringify(body),
    });
    const head = Date.now() - t0;
    const text = await res.text();
    return { ok: res.ok, status: res.status, head, ms: Date.now() - t0, text: text.slice(0, 200) };
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - t0, text: ac.signal.aborted ? `no response in ${ms / 1000}s` : e.message };
  } finally { clearTimeout(timer); }
}

export function chat(p, system, history, on = {}) {
  if (!p.key) throw new Error(`No API key for ${p.name}. Use /key <your-key> or set ${p.env}.`);
  const handlers = { text: on.text || (() => {}), think: on.think || (() => {}) };
  return p.kind === 'anthropic' ? anthropic(p, system, history, handlers) : openai(p, system, history, handlers);
}
