# jsonspecs-cli

[![CI](https://github.com/catindev/jsonscpecs-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/catindev/jsonscpecs-cli/actions)
[![npm](https://img.shields.io/npm/v/jsonspecs-cli)](https://www.npmjs.com/package/jsonspecs-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node 20+](https://img.shields.io/badge/Node-20%2B-green)](https://nodejs.org/)

CLI and local studio for `jsonspecs` rules projects.

`jsonspecs-cli` is an authoring and build tool. It works with a standalone rules project that contains:

- source rules in `rules/`
- project metadata in `manifest.json`
- project-local Node operator packs in `operators/node`
- sample payloads in `samples/`

It is **not** a runtime validation service. Runtime consumers use the snapshot produced by `jsonspecs build`.

## Install

Global install:

```bash
npm i -g jsonspecs-cli
```

Local development install:

```bash
npm install
npm test
npm link
```

## Commands

- `jsonspecs init <project-name>`
- `jsonspecs studio`
- `jsonspecs validate`
- `jsonspecs build`

## Quick start

Create a new rules project:

```bash
jsonspecs init online_store
cd online_store
```

Validate the project:

```bash
jsonspecs validate
```

Build a deployable snapshot:

```bash
jsonspecs build
```

Start local studio:

```bash
jsonspecs studio
```

Then open `http://localhost:3100`.

## Rules project structure

```text
online_store/
  rules/
    library/
    entrypoints/
    internal/
    dictionaries/
  operators/
    node/
      index.js
  samples/
  docs/
  dist/
  manifest.json
  README.md
```

## manifest.json

`manifest.json` is the single project descriptor for the rules project.

Minimal shape:

```json
{
  "project": {
    "id": "online_store",
    "title": "Online store",
    "description": "Rules project on jsonspecs",
    "language": "ru"
  },
  "paths": {
    "rules": "./rules",
    "samples": "./samples",
    "docs": "./docs",
    "dist": "./dist"
  },
  "studio": {
    "port": 3100,
    "openBrowser": true
  },
  "build": {
    "snapshotFile": "snapshot.json",
    "buildInfoFile": "build-info.json"
  },
  "operatorPacks": {
    "node": ["./operators/node"]
  },
  "catalog": {
    "fields": {},
    "entrypoints": {},
    "artifacts": {},
    "operators": {}
  }
}
```

## Custom operators

Project-local custom operators are loaded from `manifest.json`:

```json
{
  "operatorPacks": {
    "node": ["./operators/node"]
  }
}
```

A local Node operator pack should export an object with `check`, `predicate`, and optional `meta` sections:

```js
module.exports = {
  check: {
    amount_gt_zero(rule, ctx) {
      const got = ctx.get(rule.field);
      if (!got.ok()) return { ok: false, actual: undefined };

      const n = Number(got.value);
      return { ok: Number.isFinite(n) && n > 0, actual: got.value };
    },
  },
  predicate: {},
  meta: {
    operators: {
      amount_gt_zero: {
        description: "must be greater than zero",
      },
    },
  },
};
```

### Stable operator context

Custom operators should use the runtime context passed by `jsonspecs`:

- `ctx.get(path)` reads a payload field in a stable way
- `ctx.has(path)` checks field presence
- `ctx.payload` raw payload map
- `ctx.getDictionary(id)` access a dictionary by id

Project-local operator packs should **not** import `deepGet` or `jsonspecs` directly.

## Build output

`jsonspecs build` produces:

```text
dist/
  snapshot.json
  build-info.json
```

The snapshot is intended for runtime consumers such as a Node validation service or a future Java runtime implementation.

## Studio

`jsonspecs studio` starts a local authoring environment for analysts. It is a local working tool, not a knowledge base and not a production service.

Studio provides:

- entrypoint list
- pipeline tree view
- artifact pages
- playground
- static analysis
- documentation-oriented views for copy/paste

## Test

```bash
npm test
```
