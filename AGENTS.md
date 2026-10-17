# AGENTS.md — you were handed this repository's link

The installation target is always **DeepSeek Harness**. You may be running inside
DSH or inside another agent/environment (Claude Code, Codex, Cursor, a plain
shell): what matters is that you have shell access, because the setup is a
shell script plus the installed DSH.

The repository installs the four Z.AI hosted MCP servers — **ZRead**, **Vision**,
**Web Reader**, **Web Search** — and mounts them in the DSH profile as the
`preset-zai` agent preset, so only sessions created with that preset get them.

## What to do

1. **Check the target.** `~/.dsh` must exist (DSH was launched at least once).
   If DSH is not installed: install the desktop app from the official releases
   page (or run `npx @deepseek-ai/dsh web` for the web build), launch it once,
   then continue.
2. **Clone and run the bootstrap.**

   ```sh
   git clone git@github.com:bosenok/dsh-zai-mcp.git ~/src/github.com/bosenok/dsh-zai-mcp
   ~/src/github.com/bosenok/dsh-zai-mcp/bootstrap.sh
   ```

   It links the skill into `~/.dsh/skills/dsh-zai-mcp`, provisions `ZAI_API_KEY`
   in `~/.dsh/.env` (from the credential store of the already configured Z.AI
   provider, from `--key`, or from the environment), writes the preset through
   `bin/install.mjs` as an idempotent managed block, and verifies the result with
   a `--dump-config` of a throwaway profile copy.
3. **Handle the key.** If the bootstrap reports that no key was found, ask the
   user for a GLM Coding Plan key from
   [z.ai → API Keys → Personal Coding Plan](https://z.ai/manage-apikey/apikey-list)
   and rerun with `--key <token>`. Never print the key, never write it into a
   config file, never commit it.
4. **Restart only with consent.** `--restart` quits and reopens the app (it ends
   running sessions). Otherwise tell the user to restart DSH manually.
5. **Verify and report.** The bootstrap ends with `check: ok (composed profile
   verified)`. Report that line, the exact commands you ran, and the next step:
   *new chat → preset «Z.AI (GLM)» → choose a GLM model*.

## Useful flags

| Flag | When |
|---|---|
| `--dry-run` | show the managed block without writing anything |
| `--check` | verify the current state only |
| `--key <token>` | DSH has no configured Z.AI provider |
| `--global` | mount the rows profile-wide instead of a preset (DSH builds without agent presets) |
| `--profile NAME` | the profile the target DSH uses (default `desktop`) |
| `--force` / `--prune-global` | rewrite a managed block / remove an old profile-wide mount |
| `--standard FILE` | rebuild the preset after a DSH upgrade from that build's `presets/standard.patch.yml` |

## Rules

- Stay inside the requested scope: do not edit other profiles or other clients'
  configs; do not run `--restart` or `--force` without the user's consent.
- The servers bill the GLM Coding Plan quota. A `429` with `code:1310` means the
  plan is exhausted (the body names the reset time), not a broken setup.
- Verify before claiming success; paste the exact commands and their output.
