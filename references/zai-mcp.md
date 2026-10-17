# Worked example: Z.AI MCP servers in DSH

Z.AI ships four hosted MCP servers for GLM Coding Plan accounts:

| Server | Transport | Tools |
|---|---|---|
| **Vision** (`@z_ai/mcp-server` 0.1.x) | stdio (npx) | 8 image/video tools |
| **Web Search** | streamable-http | `web_search_prime` |
| **Web Reader** | streamable-http | `webReader` |
| **Zread** | streamable-http | `search_doc`, `read_file`, `get_repo_structure` |

All four declare the MCP **tools** capability only (no `prompts`, no
`resources`), so wiring them is one `mcp-client` row each. Together they give
DSH the same official tool surface an MCP client of Z.AI has.

Official pages: [Vision](https://docs.z.ai/devpack/mcp/vision-mcp-server) ·
[Web Search](https://docs.z.ai/devpack/mcp/search-mcp-server) ·
[Web Reader](https://docs.z.ai/devpack/mcp/reader-mcp-server) ·
[Zread](https://docs.z.ai/devpack/mcp/zread-mcp-server).

## Where the key comes from

`ZAI_API_KEY` is a **GLM Coding Plan API key** — these MCP servers are
Coding-Plan-only, and calls consume plan quota.

0. **Start from the provider DSH already has.** The key exists in DSH only
   because the `z.ai` provider is configured. Check it first: the profile
   patch has `llm-pi-ai.config.providers.zai.apiKeyEnv: ZAI_API_KEY` and
   `agent-default-model.provider` names the model actually in use (DSH Settings
   → Providers shows the same). When `zai` is among the providers, the value is
   already in `~/.dsh/.credentials.yaml` → `refs` (fly to step 2); there is
   nothing to fetch from the console. When `zai` is **not** configured, this
   profile does not need these MCP servers at all — see *When to use*.

1. **Z.AI console (the source of truth).** Sign in at
   [z.ai/manage-apikey/apikey-list](https://z.ai/manage-apikey/apikey-list):
   Individual Plan → **Personal Coding Plan** tab → *Plan Overview*; Team Plan →
   [Team Coding Plan → My Plan](https://z.ai/manage-apikey/coding-plan/team/my-plan).
   Create/reveal the key there.
2. **An already-configured DSH install.** Signing in to the Z.AI provider in
   DSH writes the key into the credential store, `~/.dsh/.credentials.yaml`
   under `refs:`. Copy it into the environment file without printing it:

   ```sh
   KEY=$(sed -n 's/^[[:space:]]*ZAI_API_KEY:[[:space:]]*//p' ~/.dsh/.credentials.yaml | head -1 | tr -d '"'\''')
   test -n "$KEY" && printf "ZAI_API_KEY='%s'\n" "$KEY" >> ~/.dsh/.env && chmod 600 ~/.dsh/.env
   ```
3. **Not in ZCode.** ZCode keeps its own session authentication and its config
   files (`~/.zcode/**`) hold no `ZAI_API_KEY` (verified on a live install);
   do not go hunting there.

Key **type matters**: a Coding Plan key bills the plan quota; a Standard API key
bills pay-as-you-go and does not consume the plan. Mixing them up is the
difference between a plan-limited call and a balance charge — see
[API Key Management Guide](https://docs.z.ai/devpack/notice/api-key-management).

## When to use these servers (provider + quota policy)

These are **GLM Coding Plan resources**, not a free-for-all tool set:

- every call is billed to the Coding Plan behind `ZAI_API_KEY`, **even when the
  session's model runs on another provider** (the plan quota is shared with
  model usage — a `429`/`1310` means the plan is exhausted for the period);
- use them when the session works with Z.AI/GLM models
  (`agent-default-model.provider: zai`, or a Z.AI model chosen for the turn), or
  when the task genuinely needs a Z.AI-only capability (ZRead repository
  reading, Z.AI vision, web reader/search on the Z.AI plan);
- in sessions on other providers (e.g. `deepseek-official`), leave them unused.

### The recommended gate: an agent preset

Mount the servers **inside an agent preset** instead of at profile level. A
preset is a per-agent plugin list, and a session stores the preset it was
created with (`agentPreset` in the session header): sessions created with the
Z.AI preset get the servers, every other session does not.

```yaml
# profile patch: the Z.AI preset = the standard composition + four MCP rows
- insert:
    - id: preset-zai
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: zai
        order: 50
        name: Z.AI (GLM)
        description: GLM Coding Plan tools — ZRead, Vision, Web Reader, Web Search
        plugins:
          # … the standard preset's plugins verbatim (copy them from
          # packages/bundle/web-app/presets/standard.patch.yml) …
          - id: mcp-zai-zread
            name: '@deepseek-ai/dsh-mcp-client'
            config:
              transport: streamable-http
              serverName: zai-zread
              url: https://api.z.ai/api/mcp/zread/mcp
              headers:
                Authorization: !!js '`Bearer ${process.env.ZAI_API_KEY}`'
          # … the same three rows for web_reader, web_search_prime and the
          # stdio vision server …
```

Creating it:

1. copy the standard preset's `config.plugins` list (from
   `packages/bundle/web-app/presets/standard.patch.yml` of the installed DSH,
   or from **Settings → agent presets → View configuration** in the app);
2. append the four `mcp-client` rows at the end;
3. insert the whole declaration as one `- insert:` entry in the profile patch;
4. keep the `mcp-client` rows **out** of the profile-level layer, so no session
   mounts them implicitly.

Select it: the new-session picker (and the Settings roster) lists the custom
preset by its `name`; existing agents keep the composition they were created
with, and edits affect only subsequently created agents. The preset does not
bind a model — choose the GLM model in that session explicitly.

## Tool inventory (verified with `initialize` + `tools/list`)

| `serverName` | Raw tools | DSH public name |
|---|---|---|
| `zai-zread` | `search_doc`, `read_file`, `get_repo_structure` | `mcp__zai-zread__*` |
| `zai-reader` | `webReader` | `mcp__zai-reader__webReader` |
| `zai-search` | `web_search_prime` | `mcp__zai-search__web_search_prime` |
| `zai-vision` | `ui_to_artifact`, `extract_text_from_screenshot`, `diagnose_error_screenshot`, `understand_technical_diagram`, `analyze_data_visualization`, `ui_diff_check`, `analyze_image`, `analyze_video` | `mcp__zai-vision__*` |

DSH renames every MCP tool for the model as `mcp__<serverName>__<rawName>`.

## 1. Key into the environment (never into the config)

There is no way to point an MCP `headers` entry at the credential store: the
`dsh-mcp-client` header map is `Record<string, string>`, and the credentials
service resolves asynchronously while `!!js` expressions evaluate synchronously
at composition time. So the value must be present in `process.env`, and DSH
already has the native layer for that — `$DSH_HOME/.env`.

```sh
# plain KEY='value' lines, mode 600, no shell rc needed
printf "ZAI_API_KEY='%s'\n" "$KEY" >> ~/.dsh/.env && chmod 600 ~/.dsh/.env
```

The launcher's `loadLayeredEnv` parses the invoking directory's `.env`
(`project-env`) and the Harness home's `.env` (`user-env`), then materializes
accepted values into `process.env` **without replacing inherited ones** — so the
real environment outranks the file, and a stale export in `~/.zprofile` would
shadow `.env`. No login-shell sourcing, no extra env file, and the file never
travels with the profile.

Restart the app after changing `.env`: the environment snapshot is frozen at
launch, and profile recomposition does not re-read it.

## 2. Rows in the desktop profile patch (`~/.dsh/profiles/desktop/cordis.patch.yml`)

```yaml
# ── Z.AI MCP servers (ZRead, Vision, Web Reader, Web Search) ──
- insert:
    - id: mcp-zai-zread
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        transport: streamable-http
        serverName: zai-zread
        url: https://api.z.ai/api/mcp/zread/mcp
        headers:
          Authorization: !!js '`Bearer ${process.env.ZAI_API_KEY}`'
    - id: mcp-zai-reader
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        transport: streamable-http
        serverName: zai-reader
        url: https://api.z.ai/api/mcp/web_reader/mcp
        headers:
          Authorization: !!js '`Bearer ${process.env.ZAI_API_KEY}`'
    - id: mcp-zai-search
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        transport: streamable-http
        serverName: zai-search
        url: https://api.z.ai/api/mcp/web_search_prime/mcp
        headers:
          Authorization: !!js '`Bearer ${process.env.ZAI_API_KEY}`'
    - id: mcp-zai-vision
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        transport: stdio
        serverName: zai-vision
        command: /Users/<you>/.volta/bin/npx    # absolute: the app has no interactive PATH
        args: ['-y', '@z_ai/mcp-server@latest'] # pin @0.1.5 if reproducibility matters
        env:
          Z_AI_API_KEY: !!js process.env.ZAI_API_KEY
          Z_AI_MODE: ZAI
```

HMR recomposes the profile as soon as the file is saved; the servers start in the
running app without a restart. The stdio row needs network only on its first
start (npx fetch).

## 3. Verify

```sh
# a) the composed profile (the CLI refuses the reserved name `desktop`; verify on a copy)
TMP=$(mktemp -d); mkdir -p "$TMP/profiles"
cp -R ~/.dsh/profiles/desktop "$TMP/profiles/desktop-verify"
DSH_HOME="$TMP" dsh --profile desktop-verify --dump-config | grep -c 'id: mcp-zai-'   # 4
rm -rf "$TMP"

# b) a hosted row answers an MCP initialize with the key (200; no key -> 401)
curl -s -o /dev/null -w '%{http_code}\n' \
  -H "Authorization: Bearer $ZAI_API_KEY" -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -X POST https://api.z.ai/api/mcp/zread/mcp \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}'

# c) the stdio server: it writes a log under $HOME/.zai, so a sandboxed probe needs a writable HOME
HOME=/tmp/zai-home npx -y @z_ai/mcp-server@latest   # then JSON-RPC initialize + tools/list on stdin
```

The profile copy check is the only reliable one for the reserved `desktop`
profile; the CLI reports "managed exclusively by the Electron application"
when asked to dump it directly.

## 4. Troubleshooting the connection vs the account

| Symptom | Meaning |
|---|---|
| `server is disconnected` (before restart) | the key was added to `~/.dsh/mcp.env` after the app launched; restart to capture it |
| MCP tool answers `401` / `disconnected` after a restart | the header expression resolved to an empty string — `ZAI_API_KEY` is missing from the app's environment |
| MCP tool answers `429`, body `{"code":1310, "message":"Weekly/Monthly Limit Exhausted…"}` | wiring is correct and authenticated; the Coding Plan quota is exhausted (the same account limit applies to ZCode). Nothing to reconfigure — it works when the limit resets |
| stdio vision row exits immediately | `npx` is not on an absolute path, or the first-run package fetch failed; the server also writes `$HOME/.zai/*.log`, so a sandboxed probe needs a writable HOME |

The quota body often names the reset time, e.g. `"limit will reset at
2026-10-30 14:10:07"`.
