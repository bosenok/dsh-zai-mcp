# dsh-zai-mcp

A DeepSeek Harness **user skill** for connecting the Z.AI hosted MCP servers
(ZRead, Vision, Web Reader) to a DSH profile — and, more generally, for adding,
porting and debugging any MCP server:

- one `insert` row with `@deepseek-ai/dsh-mcp-client` in the profile's
  `cordis.patch.yml`, for `stdio`, `streamable-http` and `sse` transports;
- mapping from other clients (Claude Desktop, Codex, Cursor/VS Code, local
  Go/Python MCP servers, hosted vendors);
- the only correct secret seam: `!!js` environment expressions plus
  `$DSH_HOME/.env` (mode 600) — never a literal token in the config;
- verification (`--dump-config`, an MCP `initialize` probe, restart) and the
  pitfalls seen in practice.

The worked Z.AI example (ZRead, Vision, Web Reader) is in
[`references/zai-mcp.md`](references/zai-mcp.md).

## Repository layout

| Path | What it is |
|---|---|
| `SKILL.md` | the skill itself (frontmatter + procedure), symlinked into `~/.dsh/skills/` |
| `references/zai-mcp.md` | the worked configuration: key source, all four servers, the agent-preset gate, verification, troubleshooting |
| `templates/standard-0.2.1-rc.2.plugins.yml` | the standard agent preset's plugin list, copied verbatim from DSH 0.2.1-rc.2 |
| `templates/zai-mcp-rows.yml` | the four `mcp-client` rows appended to that list |
| `bin/install.mjs` | zero-dependency installer + verifier (`--dry-run`, `--check`, `--global`, `--force`, `--standard`) |
| `bootstrap.sh` | one-command end-to-end setup (skill link, key, preset, verify, optional `--restart`) |
| `AGENTS.md` / `CLAUDE.md` | agent entry points (installation target: DeepSeek Harness) |

## Handing the link to an agent

The repository is written to be driven by an AI agent, whichever harness it runs
in:

- [`AGENTS.md`](AGENTS.md) is the entry point: the target is always DeepSeek
  Harness, and the agent may run inside or outside DSH; the file carries the
  preconditions, the bootstrap command, the key/restart rules and the report
  format;
- [`CLAUDE.md`](CLAUDE.md) points Claude Code at the same file;
- every step is idempotent and self-verifying, so an agent can rerun it after a
  failure without corrupting the profile.

## One-command setup on a new machine

Install and launch DeepSeek Harness once, then paste the link:

```sh
git clone git@github.com:bosenok/dsh-zai-mcp.git ~/src/github.com/bosenok/dsh-zai-mcp \
  && ~/src/github.com/bosenok/dsh-zai-mcp/bootstrap.sh --restart
```

`bootstrap.sh` does everything by itself:

1. picks node (the system one or the runtime bundled with the app);
2. pulls the latest checkout (skipped when offline / the private remote refuses);
3. links the skill into `~/.dsh/skills/dsh-zai-mcp`;
4. provisions `ZAI_API_KEY` in `~/.dsh/.env` — from the credential store of the
   already configured Z.AI provider, `--key`, or the environment — and fails with
   the console link when no source exists;
5. writes the `preset-zai` agent preset through `bin/install.mjs` (idempotent
   managed block between markers);
6. verifies the result: env key, patch rows, and a `--dump-config` of a throwaway
   profile copy;
7. with `--restart`, quits and reopens the app so the new `.env` and preset load.

Afterwards create a new chat, pick the **Z.AI (GLM)** preset and choose a GLM
model in that session; Standard/Creator sessions never mount the servers.

If the Z.AI provider is not configured in DSH yet, either configure it there or
run `./bootstrap.sh --key <token>` with a key from
[z.ai → API Keys → Personal Coding Plan](https://z.ai/manage-apikey/apikey-list).

Manual equivalent (same steps, no bootstrap):

```sh
ln -s "$PWD" ~/.dsh/skills/dsh-zai-mcp
printf "ZAI_API_KEY='%s'\n" "$KEY" >> ~/.dsh/.env && chmod 600 ~/.dsh/.env
node bin/install.mjs
node bin/install.mjs --check
```

### Options

| Flag | Effect |
|---|---|
| `--dry-run` | print the managed block, write nothing |
| `--check` | verify the current state (env, patch, composed profile); write nothing and exit 1 on problems |
| `--global` | mount the four rows at profile level instead of inside the preset |
| `--prune-global` | when installing the preset, remove a profile-level mount left by an earlier setup |
| `--force` | rewrite the managed block even when it already exists |
| `--dsh-home PATH` / `--profile NAME` | target another Harness home or profile |
| `--npx PATH` | absolute npx used by the stdio vision row (default: volta/homebrew probe) |
| `--standard FILE` | build from another DSH version's `presets/standard.patch.yml` instead of the committed snapshot |

Updating the preset after a DSH upgrade:

```sh
# extract the new standard preset from the installed app (or copy it from a source checkout)
npx asar extract-file "/Applications/DeepSeek Harness.app/Contents/Resources/app.asar" \
  node_modules/@deepseek-ai/dsh-bundle-web-app/presets/standard.patch.yml > /tmp/standard.patch.yml
node bin/install.mjs --standard /tmp/standard.patch.yml --force
node bin/install.mjs --check
```

## Install

The skill is a plain directory bundle: `SKILL.md` with YAML frontmatter plus
optional `references/`. DSH's filesystem skill provider discovers it under the
user root (`~/.dsh/skills`), the project root (`<repo>/.dsh/skills`) or
`<repo>/.agents/skills`.

```sh
git clone git@github.com:bosenok/dsh-zai-mcp.git ~/src/github.com/bosenok/dsh-zai-mcp
ln -s ~/src/github.com/bosenok/dsh-zai-mcp ~/.dsh/skills/dsh-zai-mcp
```

A symlink keeps the checkout as the single source of truth: editing `SKILL.md`
here is picked up by the next skill catalog, no restart needed.

## Verify

```sh
ls -l ~/.dsh/skills/dsh-zai-mcp            # -> the checkout
sed -n '1,6p' ~/.dsh/skills/mcp-setup/SKILL.md
```

In a DSH session the skill appears in the catalog as `dsh-zai-mcp`.

## Versioning

This project follows [Semantic Versioning](https://semver.org/) (`MAJOR.MINOR.PATCH`).
Releases are tagged in git (`v0.1.0` and later `v0.1.x` tags), announced
as GitHub releases and documented in [CHANGELOG.md](./CHANGELOG.md).

Bump policy: **patch** — fixes; **minor** — new features without breaking the
configuration; **major** — breaking changes to the configuration, the session
format or the supported DSH range.

`CHANGELOG.md` is generated with [git-cliff](https://git-cliff.org/) from
[Conventional Commits](https://www.conventionalcommits.org/) (`cliff.toml`):

```sh
./scripts/changelog.sh                 # print unreleased notes
./scripts/changelog.sh v0.2.0          # add the next release section
git cliff -o CHANGELOG.md              # full regeneration (curated history is kept otherwise)
```

To install a specific release instead of a moving branch, pin the tag:

```sh
dsh plugin --profile desktop add "git+ssh://git@github.com/bosenok/dsh-zai-mcp.git#v0.1.0"
```

Tags are created on `master` by Git Flow; integration builds live on `develop`
(install with `#develop` if you want the latest unreleased code).
