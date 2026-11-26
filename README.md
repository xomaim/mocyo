# mocyo

A lightweight AI coding agent for your terminal, like opencode.

- **API-only.** Nothing runs on your machine except one small program. The model runs at the provider.
- **Shows every API call.** After each request you see the status, host, time and token counts. `/api` lists all calls, and `/api 3` shows the full request and response JSON for call 3.
- **Live replies.** Text appears word by word as the AI writes it. Ctrl+C cancels a slow reply, and a call that gets no response for 90 seconds stops on its own.
- **Light on your PC.** No dependencies, a single small .exe, no background processes. It sits idle while it waits for you.

```
› add a dark mode toggle to index.html
  ⇄ 200 POST api.openai.com/v1/chat/completions · 1.31s · 812 in / 64 out tokens
  ▸ read_file {"path":"index.html"}
  ⇄ 200 POST api.openai.com/v1/chat/completions · 2.04s · 1530 in / 410 out tokens
  ▸ edit_file {"path":"index.html", ...}
  ? allow edit_file: index.html [y/N/a=always] y
```

## Install

**Windows:** download **[mocyo.exe](https://github.com/xomaim/mocyo/releases/latest/download/mocyo.exe)**, then run it from a terminal in your project folder:

```
mocyo.exe
```

No Node.js or anything else needed. GitHub builds the .exe automatically every time the code changes (see the Actions tab).

Mac and Linux builds are on the [releases page](https://github.com/xomaim/mocyo/releases/latest) too.

## Setup

```
mocyo.exe
› /provider openai          # or anthropic, openrouter, groq, deepseek, gemini, nvidia
› /key sk-...               # saved to ~/.mocyo/config.json
› /model gpt-4o             # optional
```

You can also set environment variables instead: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `DEEPSEEK_API_KEY`, `GEMINI_API_KEY`, `NVIDIA_API_KEY`.

For any other OpenAI-compatible API, use `/base https://your-api/v1`.

## Usage

Run `mocyo.exe` inside your project folder and type what you want done. For a single question, pass it as an argument: `mocyo.exe "explain this repo"`.

| Command | What it does |
|---|---|
| `/provider <name>` | switch provider |
| `/model <name>` | switch model |
| `/key <key>` | save API key |
| `/base <url>` | custom OpenAI-compatible endpoint |
| `/api [n]` | API call log / full call details |
| `/auto` | toggle auto-approve for edits and commands |
| `/clear` | new conversation |
| `/status` | current setup |
| `/exit` | quit |

### Tools the AI can use

`read_file`, `list_dir` run without asking. `write_file`, `edit_file` and `run_command` ask first (y / N / a = always).
