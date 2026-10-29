# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-10-29

### Added

- A user skill that connects the Z.AI MCP servers (ZRead, Vision, Web Reader,
  Web Search) to a DSH profile: `mcp-client` rows for stdio, streamable-http and
  sse, the `.env` secret seam, the agent-preset gate, verification and
  troubleshooting.
- `bin/install.mjs` (a zero-dependency installer/verifier) and `bootstrap.sh`
  (one-command end-to-end setup with an optional restart).
