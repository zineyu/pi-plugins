# pi-plugins

Monorepo for pi extensions, managed with pnpm workspaces.

## Extensions

| Package                                                       | Description                                                             |
| ------------------------------------------------------------- | ----------------------------------------------------------------------- |
| [`@zineyu/pi-hashline`](./packages/pi-hashline)               | Hashline edit tool — line-anchored file edits via content hashes        |
| [`@zineyu/pi-context-compact`](./packages/pi-context-compact) | Context compaction trigger tool for agents and `/compact-context` users |

## Install

```bash
pi install git:github.com/zineyu/pi-plugins
```

This loads every extension listed in the root `package.json` `pi.extensions` field.

## Development

```bash
# Install workspace dependencies
pnpm install

# Format all packages
pnpm format

# Check formatting
pnpm format:check
```

## License

MIT
