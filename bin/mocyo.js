#!/usr/bin/env node
// mocyo: lightweight AI coding agent. API-only, zero dependencies.
import readline from 'node:readline';
import process from 'node:process';
import * as config from '../src/config.js';
import { chat, apiLog } from '../src/api.js';
import { byName } from '../src/tools.js';

// ---------- tiny color helpers ----------
const c = (n) => (s) => (process.stdout.isTTY ? `\x1b[${n}m${s}\x1b[0m` : String(s));
const dim = c(2), bold = c(1), cyan = c(36), green = c(32), red = c(31), yellow = c(33), magenta = c(35);

let cfg = config.load();
const history = [];
const SYSTEM = () =>
  `You are mocyo, a concise AI coding agent running in the user's terminal.
Working directory: ${process.cwd()}  OS: ${process.platform}
Use the tools to read, edit and create files and to run commands. Inspect before you change things.
Keep replies short. When you are done, summarise what you changed.`;

// ---------- low-CPU spinner (only redraws ~8x/sec) ----------
function spinner(label) {
  if (!process.stdout.isTTY) return () => {};
  const f = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  const t = setInterval(() => process.stdout.write(`\r${cyan(f[i++ % f.length])} ${dim(label)}`), 120);
  return () => { clearInterval(t); process.stdout.write('\r\x1b[K'); };
}

// ---------- API call display ----------
function showApi(e) {
  const ok = e.status >= 200 && e.status < 300;
  const host = e.url.replace(/^https?:\/\//, '');
  console.log(
    dim('  ⇄ ') + (ok ? green(e.status) : red(e.status || 'ERR')) + ' ' + dim(`POST ${host}`) +
    dim(` · ${(e.ms / 1000).toFixed(2)}s · ${e.inTok} in / ${e.outTok} out tokens`)
  );
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
const ask = (q) => new Promise((r) => rl.question(q, r));

async function approve(name, args) {
  if (cfg.autoApprove) return true;
  const preview = name === 'run_command' ? args.command
    : name === 'write_file' ? `${args.path} (${(args.content || '').length} chars)`
    : name === 'edit_file' ? args.path : JSON.stringify(args);
  const a = (await ask(yellow(`  ? allow ${name}: `) + preview + yellow(' [y/N/a=always] '))).trim().toLowerCase();
  if (a === 'a') { cfg.autoApprove = true; config.save(cfg); return true; }
  return a === 'y' || a === 'yes';
}

// ---------- agent loop ----------
async function turn(input) {
  history.push({ role: 'user', text: input });
  const p = config.resolve(cfg);
  for (let step = 0; step < 25; step++) {
    const stop = spinner(`thinking (${p.name}/${p.model})`);
    let r;
    try { r = await chat(p, SYSTEM(), history); }
    catch (e) { stop(); if (apiLog.length) showApi(apiLog[apiLog.length - 1]); console.log(red('  ✗ ' + e.message)); history.pop(); return; }
    stop();
    showApi(r.entry);
    history.push({ role: 'assistant', text: r.text, calls: r.calls });
    if (r.text) console.log('\n' + r.text.trim() + '\n');
    if (!r.calls.length) return;

    for (const call of r.calls) {
      const tool = byName[call.name];
      let out;
      console.log(magenta(`  ▸ ${call.name}`) + dim(' ' + JSON.stringify(call.args).slice(0, 120)));
      if (!tool) out = `Error: unknown tool ${call.name}`;
      else if (tool.risky && !(await approve(call.name, call.args))) out = 'User denied this action.';
      else {
        try { out = String(await tool.run(call.args)); } catch (e) { out = 'Error: ' + e.message; }
      }
      console.log(dim('    ' + out.split('\n').slice(0, 4).join('\n    ') + (out.split('\n').length > 4 ? '\n    …' : '')));
      history.push({ role: 'tool', id: call.id, name: call.name, text: out });
    }
  }
  console.log(yellow('  stopped after 25 steps'));
}

// ---------- slash commands ----------
function help() {
  console.log(`
${bold('commands')}
  /provider <name>   ${dim(Object.keys(config.PROVIDERS).join(' | '))}
  /model <name>      set model
  /key <api-key>     save API key for current provider
  /base <url>        custom base URL (any OpenAI-compatible API), "/base reset" to clear
  /api [n]           show API call log, or full request/response of call n
  /auto              toggle auto-approve for edits & commands
  /clear             clear conversation
  /status            show current setup
  /exit              quit
`);
}

function status() {
  const p = config.resolve(cfg);
  console.log(dim(`  provider ${p.name} · model ${p.model} · key ${p.key ? 'set' : red('missing')} · auto-approve ${cfg.autoApprove ? 'on' : 'off'}`));
}

function apiCmd(arg) {
  if (!apiLog.length) return console.log(dim('  no API calls yet'));
  if (arg) {
    const e = apiLog[Number(arg) - 1];
    if (!e) return console.log(red('  no such call'));
    const scrub = JSON.stringify(e.request, null, 2);
    console.log(bold('\n  request → ') + e.url + '\n' + dim(scrub.length > 6000 ? scrub.slice(0, 6000) + '\n…' : scrub));
    const resp = JSON.stringify(e.response, null, 2);
    console.log(bold('\n  response ← ') + e.status + '\n' + dim(resp.length > 6000 ? resp.slice(0, 6000) + '\n…' : resp) + '\n');
    return;
  }
  let tin = 0, tout = 0;
  apiLog.forEach((e, i) => { tin += e.inTok; tout += e.outTok; process.stdout.write(dim(`  #${i + 1}`)); showApi(e); });
  console.log(dim(`  total: ${tin} in / ${tout} out tokens · /api <n> for details`));
}

async function command(line) {
  const [cmd, ...rest] = line.slice(1).split(' ');
  const arg = rest.join(' ').trim();
  switch (cmd) {
    case 'help': case 'h': return help();
    case 'exit': case 'quit': case 'q': rl.close(); process.exit(0);
    case 'provider':
      if (!config.PROVIDERS[arg]) return console.log(red(`  options: ${Object.keys(config.PROVIDERS).join(', ')}`));
      cfg.provider = arg; cfg.model = null; cfg.baseUrl = null; config.save(cfg); return status();
    case 'model': if (!arg) return status(); cfg.model = arg; config.save(cfg); return status();
    case 'key': if (!arg) return console.log(red('  usage: /key <api-key>')); cfg.keys[cfg.provider] = arg; config.save(cfg); return console.log(green('  key saved to ' + config.CONFIG_PATH));
    case 'base': cfg.baseUrl = arg === 'reset' ? null : arg || null; config.save(cfg); return status();
    case 'api': return apiCmd(arg);
    case 'auto': cfg.autoApprove = !cfg.autoApprove; config.save(cfg); return status();
    case 'clear': history.length = 0; return console.log(dim('  cleared'));
    case 'status': return status();
    default: console.log(red('  unknown command, try /help'));
  }
}

// ---------- main ----------
async function main() {
  const oneShot = process.argv.slice(2).join(' ').trim();
  if (oneShot && oneShot !== '--help') { await turn(oneShot); process.exit(0); }
  if (oneShot === '--help') { help(); process.exit(0); }

  console.log(bold(cyan('\n  mocyo')) + dim('  · AI coding agent · /help for commands'));
  status();
  console.log();
  rl.on('close', () => process.exit(0));
  while (true) {
    const line = (await ask(cyan('› '))).trim();
    if (!line) continue;
    if (line.startsWith('/')) await command(line);
    else await turn(line);
  }
}

main();
