# 👾 qaagent

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)

> Claw through bugs before your users do.

qaagent is an autonomous QA agent that spawns AI-powered user personas and unleashes them on your product. Each persona navigates independently, makes real decisions, hits dead ends, and finds bugs — without you writing a single test script.

It can also **generate test cases automatically** from your active JIRA sprint and open GitHub PRs: pull the issue, read the PR diff, derive end-to-end goals, run them.

---

## How it works

qaagent spawns multiple AI agents simultaneously. Each one opens your app in a real browser, reads the UI, and navigates toward the goal as that type of user would behave — including their mistakes, impatience, and confusion. When they find something broken, confusing, or unexpected — they report it.

```
  👾 qaagent - Claw through bugs before your users do.

  target   → http://localhost:3000/
  goal     → Check the landing page is everything working fine
  agents   → First-Timer, Impatient, Power User, Adversarial, Non-Native Speaker, Slow Network

  ✓ First-Timer       2 critical · 3 warnings   18 steps · 12.3s
  ~ Impatient         1 warning                  6 steps  · 4.1s
  ✓ Power User        no findings                22 steps · 15.7s
  ✗ Adversarial       3 critical                 14 steps · 9.2s
  ~ Non-Native        106 warnings · 1 info      10 steps · 27.5s
  ~ Slow Network      no findings                4 steps  · 27.7s

  📋 report saved → ./qaagent-reports/report-...
```

---

## Install

Works on **macOS, Linux, and Windows**. Requires **Node.js ≥ 18**.

### 1. Prerequisites

Install **Node** and **pnpm** for your OS.

**macOS**

```bash
brew install node
npm install -g pnpm
```

**Linux (Ubuntu / Debian)**

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
npm install -g pnpm
```

**Windows (PowerShell)**

```powershell
winget install OpenJS.NodeJS.LTS
# Close and reopen PowerShell, then:
npm install -g pnpm
```

Verify on any OS:

```bash
node --version    # v18 or newer
pnpm --version
```

### 2. Clone and build qaagent

```bash
git clone <repo-url> qaagent
cd qaagent
pnpm install
pnpm exec playwright install chromium    # one-time, ~170 MB
pnpm build
```

### 3. Make `qaagent` available globally

**macOS / Linux**

```bash
pnpm link --global .       # the trailing dot is required on pnpm v10+
```

> If you see `[ERR_PNPM_LINK_BAD_PARAMS] You must provide a parameter`, you forgot the trailing `.` — that's pnpm v10+ expecting the source directory explicitly.
>
> Equivalent: `pnpm install -g .`

If you see *"The configured global bin directory is not in PATH"*:

```bash
pnpm setup          # writes PNPM_HOME into ~/.zshrc (or ~/.bashrc)
source ~/.zshrc     # or open a new terminal
pnpm link --global .
```

Alternative — use `npm link` (npm's bin dir is usually already on PATH):

```bash
npm link
```

**Windows (PowerShell)**

```powershell
pnpm link --global .
```

If you see the same PATH error:

```powershell
pnpm setup
# Close and reopen PowerShell so PNPM_HOME is picked up
pnpm link --global .
```

After linking, `qaagent` works in **cmd**, **PowerShell**, and **Git Bash** — pnpm auto-generates `.cmd` and `.ps1` shims from the `bin` field.

### 4. Verify

```bash
qaagent --version
```

### Alternative — run from source without installing globally

```bash
pnpm dev setup                                           # = tsx src/cli/index.ts setup
pnpm dev run --url https://example.com --goal "find pricing"
pnpm dev generate --sprint active
```

### Uninstall

```bash
pnpm uninstall --global qaagent      # or: npm unlink -g qaagent
```

```bash
# macOS / Linux
rm -rf ~/.qaagent
```

```powershell
# Windows
Remove-Item -Recurse $env:USERPROFILE\.qaagent
```

---

## Setup

Run once. qaagent will ask for your LLM provider(s), optional JIRA Cloud creds, and optional GitHub creds.

```bash
qaagent setup
```

The config is written to:
- macOS / Linux: `~/.qaagent/qaagent.config.json`
- Windows: `%USERPROFILE%\.qaagent\qaagent.config.json`

Supported LLM providers:

- Groq
- Gemini
- Cerebras
- Mistral
- OpenRouter
- Ollama
- OpenAI
- Anthropic
- **Azure AI Foundry**
- **AWS Bedrock**

Config is saved to `~/.qaagent/qaagent.config.json`.

### Config shape

```json
{
  "llm": {
    "primary":  { "provider": "bedrock", "region": "us-east-1", "awsAccessKeyId": "...", "awsSecretAccessKey": "...", "model": "anthropic.claude-haiku-4-5-20251001-v1:0" },
    "fallback": { "provider": "azure-foundry", "baseURL": "https://<resource>.services.ai.azure.com/openai/v1", "apiKey": "..." }
  },
  "jira": {
    "baseURL":    "https://yourco.atlassian.net",
    "email":      "you@yourco.com",
    "apiToken":   "...",
    "projectKey": "ENG",
    "boardId":    42
  },
  "git": {
    "host":          "github",
    "token":         "ghp_...",
    "repo":          "yourco/yourapp",
    "baseURL":       "https://staging.yourapp.com",
    "releaseBranch": "release/2026.07"
  }
}
```

---

## Usage

### `qaagent run` — one-shot, ad-hoc

```bash
# run all agents against your app
qaagent run --url https://myapp.com --goal "complete the signup flow"

# run specific agent(s) only
qaagent run --url https://myapp.com --goal "login" --agent first-timer,adversarial

# headed
qaagent run --url https://myapp.com --goal "checkout" --headed

# max steps + concurrency
qaagent run --url https://myapp.com --goal "find pricing" --steps 15 --concurrency 1

# round-robin across configured providers
qaagent run --url https://myapp.com --goal "test signup" --round-robin
```

### `qaagent generate` — derive tests from JIRA + PRs

```bash
# every active-sprint issue + its latest PR targeting the release branch
qaagent generate --sprint active --board 42

# board + release branch from config (jira.boardId, git.releaseBranch)
qaagent generate --sprint active

# override the release branch ad-hoc
qaagent generate --sprint active --release-branch release/2026.07

# specific PRs, regardless of sprint
qaagent generate --pr 1234,1235

# latest N open PRs targeting the release branch (defaults to 10)
qaagent generate --pr --limit 5

# preview generated goals without launching browsers
qaagent generate --sprint active --dry-run
```

Behind the scenes, `--sprint active`:
1. Resolves the active sprint(s) for the board (`/rest/agile/1.0/board/{boardId}/sprint?state=active`) and pulls the issues in those sprint(s).
2. For each issue key, searches GitHub for the latest PR that targets the release branch and references the key (`is:pr base:<releaseBranch> <KEY>`).
3. Fetches each matched PR's diff and metadata.
4. Sends `{issue, diff}` pairs to the LLM, which produces a list of `{goal, persona}` test cases.
5. Runs each goal through the `Orchestrator` and produces a single combined report.

### `qaagent agents` — list personas

```bash
qaagent agents --list
```

---

## Built-in agents

| Agent | Behavior |
|---|---|
| `first-timer` | Never seen this app. Reads nothing. Clicks whatever looks obvious. |
| `impatient` | Skips everything. Rage-clicks. Abandons if stuck for more than 2 steps. |
| `power-user` | Tries every edge case, advanced flow, and keyboard shortcut. |
| `adversarial` | SQL injection, XSS attempts, wrong inputs, broken sequences. |
| `non-native` | Misreads labels, confused by idioms. Tests copy clarity ruthlessly. |
| `slow-network` | Throttled connection. Finds missing loading states and timeouts. |

---

## Custom agents

Drop a JSON file into `.qaagent/agents/` in your project root:

```json
{
  "name": "doctor",
  "description": "Medical professional, time-pressured, technically literate",
  "systemPrompt": "You are a busy doctor with 2 minutes between patients...",
  "patience": 4,
  "aggression": 3,
  "readingBehavior": "skim"
}
```

qaagent picks it up automatically on the next run.

---

## Reports

After every run (both `run` and `generate`), qaagent produces a markdown report in `./qaagent-reports/` with an executive summary, critical issues with suggested fixes, warning patterns, agent performance, and prioritized recommendations.

---

## Findings

| Severity | Meaning |
|---|---|
| `critical` | Broken element, crash, security issue, complete blocker |
| `warning` | Confusing flow, missing feedback, slow response, unclear copy |
| `info` | Minor friction, accessibility gap, copy improvement |

---

## Contributing

```bash
git clone <repo>
cd qaagent
pnpm install
pnpm tsx src/cli/index.ts run --url https://example.com --goal "find the more information link"
```

### Before opening a PR

- Run `pnpm exec tsc --noEmit` — must be clean
- Test against a real URL
- Keep it focused — one thing per PR

---

## License

MIT — see [LICENSE](LICENSE)
