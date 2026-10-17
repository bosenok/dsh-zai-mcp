#!/usr/bin/env bash
# One-command setup for the Z.AI MCP servers in DeepSeek Harness.
#
# On a new machine, after installing DeepSeek Harness and cloning this repo:
#
#   git clone git@github.com:bosenok/dsh-zai-mcp.git ~/src/github.com/bosenok/dsh-zai-mcp
#   ~/src/github.com/bosenok/dsh-zai-mcp/bootstrap.sh
#
# What it does by itself:
#   1. pulls the latest commit (when this is a git checkout and the remote answers);
#   2. links the skill into ~/.dsh/skills/dsh-zai-mcp;
#   3. provisions ZAI_API_KEY in ~/.dsh/.env — from the credential store of an
#      already configured Z.AI provider, from --key, or from the environment;
#   4. writes the `preset-zai` agent preset into the profile patch (via
#      bin/install.mjs, idempotent managed block);
#   5. verifies the result (env, patch, composed profile dump).
#
# Flags: --global (mount the rows profile-wide instead of a preset), --dry-run,
# --key <token>, --no-key, --check, --restart (restart the app at the end),
# --dsh-home, --profile, --npx, --standard, --force, --prune-global.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
RESTART=0
ARGS=()
for arg in "$@"; do
  if [ "$arg" = "--restart" ]; then RESTART=1; else ARGS+=("$arg"); fi
done
# honor --dsh-home for the checks this script owns (skill link, preconditions)
for ((i = 0; i < ${#ARGS[@]}; i++)); do
  if [ "${ARGS[$i]}" = "--dsh-home" ] && [ $((i + 1)) -lt ${#ARGS[@]} ]; then
    DSH_HOME="${ARGS[$((i + 1))]}"
  fi
done

say() { printf '%s\n' "$*"; }
fail() { printf 'bootstrap: %s\n' "$*" >&2; exit 1; }

# ---- node: the system one, otherwise the runtime bundled with the app ----------
NODE="$(command -v node 2>/dev/null || true)"
if [ -z "$NODE" ]; then
  for candidate in \
    "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/bin/node" \
    "$HOME/.volta/bin/node"; do
    if [ -x "$candidate" ]; then NODE="$candidate"; break; fi
  done
fi
[ -n "$NODE" ] || fail "node not found: install Node.js or the DeepSeek Harness app"
say "node: $NODE"

# ---- DeepSeek Harness must have been launched at least once -------------------
[ -d "$DSH_HOME" ] || fail "$DSH_HOME does not exist: install and launch DeepSeek Harness once first"

# ---- refresh the checkout (best effort: offline/private remotes are fine) -----
if [ -d "$REPO_DIR/.git" ]; then
  if GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=/usr/bin/true git -C "$REPO_DIR" pull --ff-only --quiet 2>/dev/null; then
    say "repo: up to date"
  else
    say "repo: using the current checkout (could not pull; offline or private remote)"
  fi
fi

# ---- skill: link it into the user skill root ----------------------------------
mkdir -p "$DSH_HOME/skills"
SKILL_LINK="$DSH_HOME/skills/dsh-zai-mcp"
if [ -L "$SKILL_LINK" ]; then
  say "skill: already linked at $SKILL_LINK"
elif [ -e "$SKILL_LINK" ]; then
  say "skill: $SKILL_LINK already exists and is not a symlink; leaving it untouched"
else
  ln -s "$REPO_DIR" "$SKILL_LINK"
  say "skill: linked $SKILL_LINK -> $REPO_DIR"
fi

# ---- install the preset (bin/install.mjs provisions the key) ------------------
"$NODE" "$REPO_DIR/bin/install.mjs" "${ARGS[@]+"${ARGS[@]}"}"

# ---- verify -------------------------------------------------------------------
if [[ " ${ARGS[*]-} " != *" --dry-run "* ]]; then
  "$NODE" "$REPO_DIR/bin/install.mjs" --check "${ARGS[@]+"${ARGS[@]}"}"
fi

# ---- finish -------------------------------------------------------------------
say ""
if [ "$RESTART" = "1" ]; then
  say "restarting DeepSeek Harness…"
  osascript -e 'quit app "DeepSeek Harness"' >/dev/null 2>&1 || true
  sleep 2
  open -a "DeepSeek Harness" >/dev/null 2>&1 || fail "could not reopen the app; start it manually"
  say "restarted. create a new chat and pick the «Z.AI (GLM)» preset, then choose a GLM model."
else
  say "done. restart DeepSeek Harness (it loads ~/.dsh/.env at launch), then create a new chat,"
  say "pick the «Z.AI (GLM)» preset and choose a GLM model. Rerun with --restart to do it automatically."
fi
