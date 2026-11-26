// Talks to AI providers over plain HTTPS (built-in fetch). Every call is logged.
import { TOOLS, schema } from './tools.js';

export const apiLog = []; // { method, url, status, ms, inTok, outTok, request, response }

async function call(url, headers, body) {
  const t0 = Date.now();
  const entry = { method: 'POST', url, status: 0, ms: 0, inTok: 0, outTok: 0, request: body, response: null };
  apiLog.push(entry);
  if (apiLog.length > 50) apiLog.shift();
  let res, json;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    const text = await res.text();
    try { json = JSON.parse(text); } catch { json = { raw: text }; }
  } catch (e) {
    entry.ms = Date.now() - t0;
    entry.response = { error: String(e.message || e) };
    throw new Error(`Network error: ${e.message}`);
  }
  entry.status = res.status;
  entry.ms = Date.now() - t0;
  entry.response = json;
  if (!res.ok) throw new Error(`API ${res.status}: ${json?.error?.message || json?.raw || JSON.stringify(json)}`);
  return { json, entry };
}

// ---- OpenAI-compatible (OpenAI, OpenRouter, Groq, DeepSeek, Gemini...) ----
async function openai(p, system, history) {
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
  const { json, entry } = await call(
    `${p.base}/chat/completions`,
    { authorization: `Bearer ${p.key}` },
    {
      model: p.model,
      messages,
      tools: TOOLS.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: schema(t) } })),
    }
  );
  entry.inTok = json.usage?.prompt_tokens || 0;
  entry.outTok = json.usage?.completion_tokens || 0;
  const msg = json.choices?.[0]?.message || {};
  return {
    text: msg.content || '',
    calls: (msg.tool_calls || []).map((c) => {
      let args = {};
      try { args = JSON.parse(c.function.arguments || '{}'); } catch {}
      return { id: c.id, name: c.function.name, args };
    }),
    entry,
  };
}

// ---- Anthropic Messages API ----
async function anthropic(p, system, history) {
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
  const { json, entry } = await call(
    `${p.base}/messages`,
    { 'x-api-key': p.key, 'anthropic-version': '2023-06-01' },
    {
      model: p.model,
      max_tokens: 8192,
      system,
      messages,
      tools: TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: schema(t) })),
    }
  );
  entry.inTok = json.usage?.input_tokens || 0;
  entry.outTok = json.usage?.output_tokens || 0;
  const blocks = json.content || [];
  return {
    text: blocks.filter((b) => b.type === 'text').map((b) => b.text).join(''),
    calls: blocks.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, args: b.input || {} })),
    entry,
  };
}

export function chat(p, system, history) {
  if (!p.key) throw new Error(`No API key for ${p.name}. Use /key <your-key> or set ${p.env}.`);
  return p.kind === 'anthropic' ? anthropic(p, system, history) : openai(p, system, history);
}
