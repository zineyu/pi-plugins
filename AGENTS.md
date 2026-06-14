# AGENTS.md

> pi-plugins — monorepo for pi extensions.

## Repository structure

```
packages/
  pi-hashline/    pi extension: hashline edit tool
package.json      workspace root (private)
pnpm-workspace.yaml
.prettierrc
```

## Build & Test

- Extensions are loaded by pi via `jiti` at runtime. No build step is required.
- Run `pnpm install` to install workspace dependencies and generate `pnpm-lock.yaml`.
- Run `pnpm format` / `pnpm format:check` to format or verify formatting across the workspace.

## Code Style

- Source comments and log messages are in English.
- Formatter: Prettier (see `.prettierrc`)
  - Tabs, double quotes, all trailing commas, print width 100.

## pi Extension Conventions

- Each extension lives in `packages/<name>`.
- The package name should start with `pi-` (e.g. `@zineyu/pi-hashline`).
- Extension source files are loaded by pi via `jiti`; no compile step is needed.
- Types are resolved at runtime from `@earendil-works/pi-coding-agent`.
- If type declarations are incomplete, `// @ts-nocheck` may be used at the top of a file.
- The `pi.extensions` field in each package points to the extension entry file(s).
- The root `package.json` `pi.extensions` field lists all extension entries for repository-wide installs.

## Adding a new extension

1. Create `packages/pi-<name>`.
2. Add a `package.json` with the appropriate `name`, `repository.directory`, `files`, and `pi.extensions`.
3. Add the new entry file path to the root `package.json` `pi.extensions` array.
4. Update the root `README.md` extension table.

## Security & Safety

- Extensions may read and write user files through pi tool APIs. Validate inputs and avoid destructive defaults.
- Hashline specifically verifies anchor hashes before applying edits to prevent concurrent modification corruption.

## References

- `README.md` — project overview
- `packages/pi-hashline/AGENTS.md` — hashline-specific rules
- `packages/pi-hashline/src/hashline.ts` — hashline extension implementation
