---
name: dsh-zai-mcp
description: >-
  Connect Z.AI's hosted MCP servers (ZRead, Vision, Web Reader, Web Search) to
  a DeepSeek Harness profile: the `@deepseek-ai/dsh-mcp-client` rows, the `ZAI_API_KEY`
  environment seam, and the auth/verification steps. Also carries the general
  row recipe for porting any other MCP server (stdio/streamable-http/sse).
whenToUse: >-
  The session works with Z.AI/GLM models (GLM Coding Plan) or the task needs a
  Z.AI-only capability — adding the Z.AI MCP servers (zread, vision, web reader,
  web search) to DSH, rotating ZAI_API_KEY for them, or porting/debugging any
  other MCP server row. These servers bill the Z.AI plan quota, so do not call
  them from sessions running another provider unless the task requires them.
metadata:
  skill-contract-revision: "1"
  verified-version: "0.2.1-rc.2"
  verified-date: "2026-10-17"
---

# Connect Z.AI MCP servers to DSH

Z.AI hosts four MCP servers for Coding Plan accounts that a plain DSH install
lacks: **ZRead** (repository reading), **Vision** (image/video understanding),
**Web Reader** (page reading) and **Web Search** (`web_search_prime`). Each is
one `insert` row with the plugin `@deepseek-ai/dsh-mcp-client`; DSH composes the
profile, starts the stdio server, and exposes their tools to the agent. The same
row shape connects any other MCP server — the worked Z.AI configuration is in
[`references/zai-mcp.md`](references/zai-mcp.md).

## Using them only from Z.AI sessions

These tools bill the GLM Coding Plan quota. To keep them out of sessions that
run another provider, mount the four rows **inside an agent preset** instead of
at profile level: a preset is a per-agent plugin list, and each session records
the preset it was created with. The preset building steps, the YAML shape and
the selection flow are in
[`references/zai-mcp.md`](references/zai-mcp.md#the-recommended-gate-an-agent-preset).

**Reproducible setup:** this repository ships the standard plugin list and the
four MCP rows under `templates/`, and `bin/install.mjs` assembles `preset-zai`
from them idempotently. Run `node bin/install.mjs` to install,
`node bin/install.mjs --check` to verify (env key, patch rows, composed profile),
`--global` for a profile-wide mount, and `--standard FILE` to rebuild from
another DSH version's `presets/standard.patch.yml`.

## 1. Where the row goes

A profile is a managed directory under `$DSH_HOME/profiles/<name>/`:

- `package.json` — bundles and dependencies;
- `cordis.patch.yml` — **this is where the row belongs** (your user layer).

The row shape:

```yaml
- insert:
    - id: mcp-<name>                      # unique row id in the profile
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        transport: stdio                  # stdio | streamable-http | sse
        serverName: <name>                # the name tools are exposed under
        command: /absolute/path/to/npx    # stdio only
        args: ['-y', 'some-mcp-package']  # stdio only
        env:                              # stdio only; never put a literal secret here
          SOME_API_KEY: !!js process.env.SOME_API_KEY
        url: https://host/path/mcp        # http/sse only
        headers:                          # http/sse only; values must be strings
          Authorization: !!js '`Bearer ${process.env.SOME_API_KEY}`'
```

The profile patch is watched (HMR): while the app runs, saving the row
recomposes the configuration. A plain `dsh --profile <name>` CLI run picks it up
on start.

## 2. Map the source config

| Source | How to read it | Mapping |
|---|---|---|
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` → `mcpServers` | `command`/`args`/`env` → stdio; `url` → streamable-http |
| Codex / OpenAI-style TOML | `~/.codex/config.toml` → `[mcp_servers.*]` | same keys; `env` table → `env` map |
| Cursor / VS Code | `.cursor/mcp.json`, `.vscode/mcp.json` | `mcpServers` → rows; `type`/`transport` tells the transport |
| ZCode / custom Go or Python servers | the server's own README or `--help` | usually a local URL (`http://127.0.0.1:<port>/mcp`) → streamable-http |
| Remote hosted MCP | vendor docs | streamable-http + Authorization header |
| npx / uvx package | npm/PyPI docs | stdio: `command` **absolute** path, `args: ['-y', '<pkg>']` |

Rules for the mapping:

- absolute `command` paths: the desktop app does not inherit your interactive
  `PATH`; `/opt/homebrew/bin/npx`, `~/.volta/bin/npx`, `/usr/bin/uvx` are safe;
- one row per server, unique `id` and `serverName`; the tool prefix follows
  `serverName`;
- servers that need a key go through `env`/`headers` expressions, never literals
  (see the next section).

## 3. Secrets: the only correct seam

- The config file is **not** a secret store. A literal token in
  `cordis.patch.yml` ends up in backups and screenshots.
- The MCP client's `headers`/`env` accept strings only, and DSH's credential
  service resolves **asynchronously**, so a credential reference cannot be
  interpolated into a header. The supported synchronous seam is a loader
  `!!js` expression: it is evaluated at boot in the host process, where the
  environment is already captured from your login shell.
- Put the value in `$DSH_HOME/.env` (mode 600), the launcher's native env layer:
  it materializes accepted values into `process.env` before composition, while
  inherited variables outrank the file (so do not also export the variable from
  a shell rc). Restart the app after editing it. Where the Z.AI key itself comes
  from (console page, credential store, Coding-Plan vs Standard key type) is
  spelled out in
  [`references/zai-mcp.md`](references/zai-mcp.md#where-the-key-comes-from);
- reference it as `!!js process.env.NAME` (or a template string for the bearer
  case above);
- `!!js` is accepted **only** in plugin `config` values (and in `disabled` via
  include), never in `name`/`id`;
- verify no literal leaked: `dsh --profile <name> --dump-config | grep -c '<token>'`
  must print `0`; the dump shows the expression, not its value.

```bash
# rotate a token later without touching the config
printf "export NAME='%s'\n" "$NEW" > ~/.dsh/mcp.env && chmod 600 ~/.dsh/mcp.env
```

## 4. Verify before declaring victory

```bash
# 1. the composed profile parses and the row is present
dsh --profile <name> --dump-config | grep -A6 'dsh-mcp-client'

# 2. a local HTTP server answers (401 without a token proves auth is enforced)
curl -s -o /dev/null -w '%{http_code}\n' \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -X POST http://127.0.0.1:<port>/mcp \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}'

# 3. restart the app (it captures the login-shell environment at launch)
```

A row that fails to load is reported in the app log and the profile still boots;
a broken MCP server only loses its own tools. After a restart the tools appear
under the `serverName` prefix.

## 5. Pitfalls seen in practice

- **Missing auth ≠ failed row**: a 401 from the MCP endpoint usually means the
  header expression resolved to an empty string — the variable is not in the
  app's environment; check `dsh --version`/launch method, not the row;
- **stale tokens**: rotating a server-side token does not rewrite the
  environment; restart the app after editing `$DSH_HOME/.env`;
- **stdio server exits immediately**: missing absolute `command`, wrong `-y`
  argument, or a package that needs a key it did not get through `env`;
- **`!!js` in the wrong place**: only `config` values are evaluated; an
  expression inside `headers` is fine, inside `id`/`name` it is a literal;
- **duplicate ids**: a second row with the same `id` is an override, not an
  addition — use distinct ids and names;
- **HTTP servers**: `transport: streamable-http` (MCP 2025-06-18) vs legacy
  `sse`; when the vendor gives a `/sse` URL, use `sse`.

The complete Z.AI configuration (all three servers, the key handoff, and the
verified tool inventory) is in [`references/zai-mcp.md`](references/zai-mcp.md):
- zread: `search_doc`, `read_file`, `get_repo_structure`;
- web reader: `webReader`;
- vision: `ui_to_artifact`, `extract_text_from_screenshot`,
  `diagnose_error_screenshot`, `understand_technical_diagram`,
  `analyze_data_visualization`, `ui_diff_check`, `analyze_image`, `analyze_video`.

There is also a fourth server, **Web Search** (`zai-search`,
`web_search_prime`), and every server declares the tools capability only, so no
separate prompt/resource surface is involved. DSH renames every MCP tool for the
model as `mcp__<serverName>__<rawName>`.
