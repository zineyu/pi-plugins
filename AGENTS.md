# pi-plugins Agent Guide

> This is the source mirror of all pi-coding-agent extensions loaded via local paths. Each subdirectory is an independent pi package.

## Repository Purpose

This repo contains **extracted upstream sources** of pi plugins, installed via local paths in `~/.pi/agent/settings.json` instead of npm. This allows:
- Modifying plugin source code directly
- Forking and customizing behavior
- Version-controlling plugin changes

## Adding a New Plugin

### Step 1: Locate Upstream Source

Determine the source type:

| Type | Action |
|------|--------|
| Standalone repo | `git clone --depth 1 <repo-url> /tmp/<name>` |
| Monorepo subpackage | `git clone --depth 1 <repo-url> /tmp/<mono>`, then copy `packages/<pkg>/` |
| npm package (no public repo) | Extract from `~/.npm-global/lib/node_modules/<pkg>/` as fallback |

**Verify the package is a valid pi package:** It must have either:
- A `pi` key in `package.json` (manifest mode)
- Conventional directories: `extensions/`, `skills/`, `prompts/`, or `themes/`

### Step 2: Copy Source into This Repo

```bash
cd ~/space/projects/pi-plugins
# For standalone repo
cp -r /tmp/<upstream-name> ./<pkg-name>

# For monorepo subpackage
cp -r /tmp/<mono>/packages/<subpackage> ./<pkg-name>
```

**Remove artifacts that should not be committed:**
```bash
rm -rf <pkg-name>/node_modules <pkg-name>/dist <pkg-name>/.git
```

**Add binary exclusions to repo `.gitignore`:**
```
*.mp4
*.png
node_modules/
dist/
```

### Step 3: Install Dependencies

```bash
cd <pkg-name>
# Use lockfile if present
[ -f pnpm-lock.yaml ] && pnpm install || npm install
```

**If the package depends on other plugins in this repo:**
- Check `package.json` for `peerDependencies` or `dependencies` on other local packages
- Ensure those packages are already in `settings.json` and installed

### Step 4: Handle Monorepo / Sibling References

Some packages (especially `rpiv-*`) have **sibling detection** via regex over `settings.json`. If a plugin checks for siblings using hardcoded npm package names (e.g., `/@tintinweb\/pi-subagents/`), **update the regex** to also match local paths:

```typescript
// Before: only matches npm install
matches: /@tintinweb\/pi-subagents/i,

// After: matches both npm and local paths
matches: /pi-subagents/i,
```

This typically lives in a file like `siblings.ts` or `package-checks.ts`.

### Step 5: Update settings.json

Add the new package to `~/.pi/agent/settings.json`:

```json
{
  "packages": [
    "~/space/projects/pi-plugins/<pkg-name>",
    "...existing packages..."
  ]
}
```

**Important:** Pi loads packages as independent module roots. Local paths **cannot be subdirectories inside another package** — each must have its own `package.json` at the root.

### Step 6: Verify

Restart pi and check for errors:
```bash
pi
```

Common issues:
| Error | Fix |
|-------|-----|
| `Cannot find module 'X'` | Run `npm install` / `pnpm install` in the package directory |
| `Missing sibling Y` | Update sibling regex or install the sibling package |
| `Failed to load extension` | Check `package.json` has valid `pi` manifest or conventional dirs |

## Directory Structure

```
pi-plugins/
├── AGENTS.md           # This file
├── README.md           # Package index
├── .gitignore          # Excludes node_modules/, dist/, *.mp4, *.png
├── <pkg-name>/         # One directory per plugin
│   ├── package.json    # Must exist; may contain `pi` manifest
│   ├── node_modules/   # Installed locally, gitignored
│   ├── src/            # TypeScript source
│   ├── extensions/     # Pi extensions (conventional)
│   ├── skills/         # Pi skills (conventional)
│   └── ...
└── ...
```

## Updating an Existing Plugin

To pull upstream changes:

```bash
# Re-clone upstream
git clone --depth 1 <repo-url> /tmp/<upstream>

# Copy over (preserving local modifications)
rsync -av --exclude=node_modules --exclude=dist --exclude=.git /tmp/<upstream>/ ./<pkg-name>/

# Re-install dependencies
cd <pkg-name> && [ -f pnpm-lock.yaml ] && pnpm install || npm install

# Verify and commit
cd ~/space/projects/pi-plugins
jj describe -m "chore: update <pkg-name> from upstream"
jj git export && git push origin main
```

## Modifying Plugin Code

Edit files directly under `~/space/projects/pi-plugins/<pkg-name>/`. Changes take effect **immediately on next pi restart** — no reinstall needed.

**Remember to commit your changes:**
```bash
cd ~/space/projects/pi-plugins
jj describe -m "feat: <change description>"
jj git export && git push origin main
```
