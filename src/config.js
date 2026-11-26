import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DIR = path.join(os.homedir(), '.mocyo');
const FILE = path.join(DIR, 'config.json');

export const PROVIDERS = {
  openai:     { kind: 'openai',    base: 'https://api.openai.com/v1',        env: 'OPENAI_API_KEY',     model: 'gpt-4o-mini' },
  anthropic:  { kind: 'anthropic', base: 'https://api.anthropic.com/v1',     env: 'ANTHROPIC_API_KEY',  model: 'claude-sonnet-5-5' },
  openrouter: { kind: 'openai',    base: 'https://openrouter.ai/api/v1',     env: 'OPENROUTER_API_KEY', model: 'openai/gpt-4o-mini' },
  groq:       { kind: 'openai',    base: 'https://api.groq.com/openai/v1',   env: 'GROQ_API_KEY',       model: 'llama-3.3-70b-versatile' },
  deepseek:   { kind: 'openai',    base: 'https://api.deepseek.com/v1',      env: 'DEEPSEEK_API_KEY',   model: 'deepseek-chat' },
  nvidia:     { kind: 'openai',    base: 'https://integrate.api.nvidia.com/v1', env: 'NVIDIA_API_KEY', model: 'moonshotai/kimi-k3.1-pro' },
  gemini:     { kind: 'openai',    base: 'https://generativelanguage.googleapis.com/v1beta/openai', env: 'GEMINI_API_KEY', model: 'gemini-2.0-flash' },
};

export function load() {
  let cfg = { provider: 'openai', model: null, keys: {}, autoApprove: false };
  try { cfg = { ...cfg, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch {}
  return cfg;
}

export function save(cfg) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

export function resolve(cfg) {
  const p = PROVIDERS[cfg.provider];
  if (!p) throw new Error(`Unknown provider "${cfg.provider}". Options: ${Object.keys(PROVIDERS).join(', ')}`);
  return {
    name: cfg.provider,
    ...p,
    base: cfg.baseUrl || p.base,
    model: cfg.model || p.model,
    key: cfg.keys[cfg.provider] || process.env[p.env] || '',
    noTools: !!cfg.noTools,
    noUsage: !!cfg.noUsage,
  };
}

export const CONFIG_PATH = FILE;
