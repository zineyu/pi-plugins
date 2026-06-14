# pi-hashline

Hashline edit tool for [pi](https://pi.dev) — line-anchored file edits via content hashes, inspired by [oh-my-pi](https://github.com/can1357/oh-my-pi).

## What is Hashline?

When a model reads a file, every line comes back tagged with a 2-character content hash:

```
11a3|function hello() {
22f1|  return "world";
330e|}
```

To edit, the model references those anchors instead of reproducing old text exactly:

- `»ANCHOR` — insert after the anchored line (or `EOF`)
- `«ANCHOR` — insert before the anchored line (or `BOF`)
- `≔START..END` — replace the inclusive range (delete if no payload follows)

If the file changed since the last read, the hashes won't match and the edit is rejected before anything gets corrupted.

## Install

```bash
pi install git:github.com/zineyu/pi-plugins
```

Or clone the monorepo into your pi extensions directory:

```bash
cd ~/.pi/agent/extensions
git clone https://github.com/zineyu/pi-plugins.git
```

## Usage

Once loaded, the extension does two things:

1. **Decorates `read` output** with `LINE+HASH|` prefixes so the model sees anchors automatically.
2. **Registers a `hashline_edit` tool** that accepts patch text in hashline format.

Example patch:

```
§src/main.ts
≔11a3..11a3
function hi() {
  return "universe";
}
»330e
console.log("done");
```

## Why?

Traditional `str_replace` requires the model to reproduce every character perfectly — including whitespace and indentation. Hashline eliminates that failure mode by giving the model stable, verifiable identifiers for the lines it wants to change.
