import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

const MAX = 20000; // cap tool output sent back to the API

const cut = (s) => (s.length > MAX ? s.slice(0, MAX) + `\n…[truncated ${s.length - MAX} chars]` : s);

export const TOOLS = [
  {
    name: 'read_file',
    description: 'Read a text file from the project.',
    params: { path: { type: 'string', description: 'File path' } },
    required: ['path'],
    risky: false,
    run: ({ path: p }) => cut(fs.readFileSync(p, 'utf8')),
  },
  {
    name: 'write_file',
    description: 'Create or overwrite a file with the given content.',
    params: { path: { type: 'string' }, content: { type: 'string' } },
    required: ['path', 'content'],
    risky: true,
    run: ({ path: p, content }) => {
      fs.mkdirSync(path.dirname(path.resolve(p)), { recursive: true });
      fs.writeFileSync(p, content);
      return `Wrote ${content.length} chars to ${p}`;
    },
  },
  {
    name: 'edit_file',
    description: 'Replace an exact unique string in a file with a new string.',
    params: { path: { type: 'string' }, old: { type: 'string' }, new: { type: 'string' } },
    required: ['path', 'old', 'new'],
    risky: true,
    run: ({ path: p, old, new: neu }) => {
      const src = fs.readFileSync(p, 'utf8');
      const n = src.split(old).length - 1;
      if (n !== 1) return `Error: "old" found ${n} times, must be exactly 1.`;
      fs.writeFileSync(p, src.replace(old, () => neu));
      return `Edited ${p}`;
    },
  },
  {
    name: 'list_dir',
    description: 'List files in a directory (skips node_modules and .git).',
    params: { path: { type: 'string', description: 'Directory, default "."' } },
    required: [],
    risky: false,
    run: ({ path: p = '.' }) =>
      fs.readdirSync(p, { withFileTypes: true })
        .filter((d) => d.name !== 'node_modules' && d.name !== '.git')
        .map((d) => (d.isDirectory() ? d.name + '/' : d.name))
        .join('\n') || '(empty)',
  },
  {
    name: 'run_command',
    description: 'Run a shell command in the project directory and return its output.',
    params: { command: { type: 'string' } },
    required: ['command'],
    risky: true,
    run: ({ command }) =>
      new Promise((res) => {
        const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
        const args = process.platform === 'win32' ? ['/c', command] : ['-c', command];
        execFile(shell, args, { timeout: 60000, maxBuffer: 4 * 1024 * 1024 }, (err, out, errOut) => {
          res(cut(`${out}${errOut}${err ? `\n[exit ${err.code ?? err.signal}]` : ''}`.trim() || '(no output)'));
        });
      }),
  },
];

export const byName = Object.fromEntries(TOOLS.map((t) => [t.name, t]));

export const schema = (t) => ({
  type: 'object',
  properties: t.params,
  required: t.required,
});
