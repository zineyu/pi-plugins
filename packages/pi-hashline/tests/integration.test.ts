import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryFilesystem } from "../src/filesystem.js";
import { SnapshotStore } from "../src/snapshot-store.js";
import { parsePatch } from "../src/executor.js";
import { applyEdits } from "../src/apply.js";
import { attemptRecovery } from "../src/recovery.js";
import { snapshotTag } from "../src/xxhash32.js";
import { HashlineError } from "../src/error.js";

function decorate(filePath: string, text: string, offset = 1): string {
	const normalized = text.replace(/\r\n/g, "\n");
	const hash = snapshotTag(normalized);
	const lines = normalized.split("\n");
	const decorated = lines.map((line, i) => `${offset + i}:${line}`).join("\n");
	return `[${filePath}#${hash}]\n${decorated}`;
}

function makePatch(filePath: string, hash: string, body: string): string {
	return `[${filePath}#${hash}]\n${body}`;
}

function execPatch(
	fs: InMemoryFilesystem,
	store: SnapshotStore,
	_patchInput: string,
): { text: string; recovered: boolean; warning?: string } {
	const patch = parsePatch(_patchInput);
	const absolutePath = fs.canonicalPath(patch.path);
	const raw = fs.get(absolutePath) ?? "";
	const content = raw.replace(/\r\n/g, "\n").replace(/^\uFEFF/, "");
	const actualHash = snapshotTag(content);

	if (actualHash === patch.expectedHash) {
		const result = applyEdits(content, patch.edits);
		fs.set(absolutePath, result.text);
		store.record(absolutePath, result.text);
		return { text: result.text, recovered: false };
	}

	const recovery = attemptRecovery(
		absolutePath,
		patch.expectedHash,
		content,
		actualHash,
		patch.edits,
		store,
	);
	fs.set(absolutePath, recovery.text);
	store.record(absolutePath, recovery.text);
	return { text: recovery.text, recovered: recovery.recovered, warning: recovery.warning };
}

describe("hashline v2", () => {
	let fs: InMemoryFilesystem;
	let store: SnapshotStore;

	beforeEach(() => {
		fs = new InMemoryFilesystem();
		store = new SnapshotStore();
	});

	it("decorates read output with [PATH#HASH] and LINE: prefixes", () => {
		fs.set("/workspace/file.txt", "alpha\nbeta\ngamma");
		const decorated = decorate(fs.canonicalPath("file.txt"), "alpha\nbeta\ngamma");
		expect(decorated).toMatch(/^\[.*#\w{4}\]\n/);
		expect(decorated).toContain("1:alpha");
		expect(decorated).toContain("2:beta");
		expect(decorated).toContain("3:gamma");
	});

	it("replaces a single line", () => {
		fs.set("/workspace/file.txt", "alpha\nbeta\ngamma");
		const decorated = decorate(fs.canonicalPath("file.txt"), "alpha\nbeta\ngamma");
		const hash = (decorated.match(/^\[.*#(\w{4})\]/) ?? [])[1];
		const patch = makePatch(fs.canonicalPath("file.txt"), hash!, "replace 2:\n+DELTA");
		const result = execPatch(fs, store, patch);
		expect(result.text).toBe("alpha\nDELTA\ngamma");
	});

	it("replaces a range of lines", () => {
		fs.set("/workspace/file.txt", "one\ntwo\nthree\nfour");
		const decorated = decorate(fs.canonicalPath("file.txt"), "one\ntwo\nthree\nfour");
		const hash = (decorated.match(/^\[.*#(\w{4})\]/) ?? [])[1];
		const patch = makePatch(fs.canonicalPath("file.txt"), hash!, "replace 2..3:\n+TWO\n+THREE");
		const result = execPatch(fs, store, patch);
		expect(result.text).toBe("one\nTWO\nTHREE\nfour");
	});

	it("inserts before a line", () => {
		fs.set("/workspace/file.txt", "alpha\nbeta");
		const decorated = decorate(fs.canonicalPath("file.txt"), "alpha\nbeta");
		const hash = (decorated.match(/^\[.*#(\w{4})\]/) ?? [])[1];
		const patch = makePatch(fs.canonicalPath("file.txt"), hash!, "insert before 2:\n+middle");
		const result = execPatch(fs, store, patch);
		expect(result.text).toBe("alpha\nmiddle\nbeta");
	});

	it("inserts after a line", () => {
		fs.set("/workspace/file.txt", "alpha\nbeta");
		const decorated = decorate(fs.canonicalPath("file.txt"), "alpha\nbeta");
		const hash = (decorated.match(/^\[.*#(\w{4})\]/) ?? [])[1];
		const patch = makePatch(fs.canonicalPath("file.txt"), hash!, "insert after 1:\n+middle");
		const result = execPatch(fs, store, patch);
		expect(result.text).toBe("alpha\nmiddle\nbeta");
	});

	it("inserts at head", () => {
		fs.set("/workspace/file.txt", "alpha\nbeta");
		const decorated = decorate(fs.canonicalPath("file.txt"), "alpha\nbeta");
		const hash = (decorated.match(/^\[.*#(\w{4})\]/) ?? [])[1];
		const patch = makePatch(fs.canonicalPath("file.txt"), hash!, "insert head:\n+first");
		const result = execPatch(fs, store, patch);
		expect(result.text).toBe("first\nalpha\nbeta");
	});

	it("inserts at tail", () => {
		fs.set("/workspace/file.txt", "alpha\nbeta");
		const decorated = decorate(fs.canonicalPath("file.txt"), "alpha\nbeta");
		const hash = (decorated.match(/^\[.*#(\w{4})\]/) ?? [])[1];
		const patch = makePatch(fs.canonicalPath("file.txt"), hash!, "insert tail:\n+last");
		const result = execPatch(fs, store, patch);
		expect(result.text).toBe("alpha\nbeta\nlast");
	});

	it("deletes a single line", () => {
		fs.set("/workspace/file.txt", "alpha\nbeta\ngamma");
		const decorated = decorate(fs.canonicalPath("file.txt"), "alpha\nbeta\ngamma");
		const hash = (decorated.match(/^\[.*#(\w{4})\]/) ?? [])[1];
		const patch = makePatch(fs.canonicalPath("file.txt"), hash!, "delete 2");
		const result = execPatch(fs, store, patch);
		expect(result.text).toBe("alpha\ngamma");
	});

	it("deletes a range of lines", () => {
		fs.set("/workspace/file.txt", "one\ntwo\nthree\nfour\nfive");
		const decorated = decorate(fs.canonicalPath("file.txt"), "one\ntwo\nthree\nfour\nfive");
		const hash = (decorated.match(/^\[.*#(\w{4})\]/) ?? [])[1];
		const patch = makePatch(fs.canonicalPath("file.txt"), hash!, "delete 2..4");
		const result = execPatch(fs, store, patch);
		expect(result.text).toBe("one\nfive");
	});

	it("inserts an empty line with a single '+'", () => {
		fs.set("/workspace/file.txt", "alpha");
		const decorated = decorate(fs.canonicalPath("file.txt"), "alpha");
		const hash = (decorated.match(/^\[.*#(\w{4})\]/) ?? [])[1];
		const patch = makePatch(fs.canonicalPath("file.txt"), hash!, "insert after 1:\n+");
		const result = execPatch(fs, store, patch);
		expect(result.text).toBe("alpha\n");
	});

	it("errors when replace has no payload", () => {
		const patch = makePatch("file.txt", "0000", "replace 1:");
		expect(() => parsePatch(patch)).toThrow(HashlineError);
	});

	it("errors when insert has no payload", () => {
		const patch = makePatch("file.txt", "0000", "insert before 1:");
		expect(() => parsePatch(patch)).toThrow(HashlineError);
	});

	it("errors when delete has payload", () => {
		const patch = makePatch("file.txt", "0000", "delete 1\n+oops");
		expect(() => parsePatch(patch)).toThrow(HashlineError);
	});

	it("errors on multiple sections", () => {
		const patch = "[a.txt#0000]\nreplace 1:\n+x\n[b.txt#0000]\nreplace 1:\n+y";
		expect(() => parsePatch(patch)).toThrow(HashlineError);
	});

	it("normalizes CRLF and strips BOM before applying", () => {
		fs.set("/workspace/file.txt", "\uFEFFalpha\r\nbeta");
		const content = fs.get(fs.canonicalPath("file.txt"))!;
		const normalized = content.replace(/\r\n/g, "\n").replace(/^\uFEFF/, "");
		const hash = snapshotTag(normalized);
		const patch = makePatch(fs.canonicalPath("file.txt"), hash, "replace 2:\n+BETA");
		execPatch(fs, store, patch);
		// InMemoryFilesystem stores the LF-normalized result; CRLF/BOM restoration
		// is the responsibility of the extension layer (hashline.ts).
		expect(fs.get(fs.canonicalPath("file.txt"))).toBe("alpha\nBETA");
	});

	it("preserves trailing newline", () => {
		fs.set("/workspace/file.txt", "alpha\nbeta\n");
		const content = fs.get(fs.canonicalPath("file.txt"))!;
		const normalized = content.replace(/\r\n/g, "\n").replace(/^\uFEFF/, "");
		const hash = snapshotTag(normalized);
		const patch = makePatch(fs.canonicalPath("file.txt"), hash, "insert tail:\n+gamma");
		const result = execPatch(fs, store, patch);
		expect(result.text).toBe("alpha\nbeta\ngamma\n");
	});

	it("succeeds when snapshot matches", () => {
		fs.set("/workspace/file.txt", "alpha\nbeta\ngamma");
		const decorated = decorate(fs.canonicalPath("file.txt"), "alpha\nbeta\ngamma");
		const hash = (decorated.match(/^\[.*#(\w{4})\]/) ?? [])[1];
		const patch = makePatch(fs.canonicalPath("file.txt"), hash!, "replace 2:\n+BETA");
		const result = execPatch(fs, store, patch);
		expect(result.recovered).toBe(false);
		expect(result.text).toBe("alpha\nBETA\ngamma");
	});

	it("recovers from non-conflicting external drift", () => {
		const original = "alpha\nbeta\ngamma";
		fs.set("/workspace/file.txt", original);
		const decorated = decorate(fs.canonicalPath("file.txt"), original);
		const hash = (decorated.match(/^\[.*#(\w{4})\]/) ?? [])[1];
		store.record(fs.canonicalPath("file.txt"), original);

		// External non-conflicting change: add a line at the end.
		fs.set(fs.canonicalPath("file.txt"), "alpha\nbeta\ngamma\ndelta");

		const patch = makePatch(fs.canonicalPath("file.txt"), hash!, "replace 2:\n+BETA");
		const result = execPatch(fs, store, patch);
		expect(result.recovered).toBe(true);
		expect(result.text).toBe("alpha\nBETA\ngamma\ndelta");
	});

	it("fails with stale_snapshot on conflicting drift", () => {
		const original = "alpha\nbeta\ngamma";
		fs.set("/workspace/file.txt", original);
		const decorated = decorate(fs.canonicalPath("file.txt"), original);
		const hash = (decorated.match(/^\[.*#(\w{4})\]/) ?? [])[1];
		store.record(fs.canonicalPath("file.txt"), original);

		// External conflicting change: target line is gone.
		fs.set(fs.canonicalPath("file.txt"), "alpha\nGAMMA");

		const patch = makePatch(fs.canonicalPath("file.txt"), hash!, "replace 2:\n+BETA");
		expect(() => execPatch(fs, store, patch)).toThrow(HashlineError);
	});

	it("fails with stale_snapshot when historical version is missing", () => {
		fs.set("/workspace/file.txt", "alpha\nbeta");
		const patch = makePatch(fs.canonicalPath("file.txt"), "DEAD", "replace 1:\n+x");
		expect(() => execPatch(fs, store, patch)).toThrow(HashlineError);
	});

	it("supports consecutive edits on the same file", () => {
		fs.set("/workspace/file.txt", "alpha\nbeta\ngamma");
		let decorated = decorate(fs.canonicalPath("file.txt"), "alpha\nbeta\ngamma");
		let hash = (decorated.match(/^\[.*#(\w{4})\]/) ?? [])[1];
		store.record(fs.canonicalPath("file.txt"), "alpha\nbeta\ngamma");

		const firstPatch = makePatch(fs.canonicalPath("file.txt"), hash!, "replace 2:\n+BETA");
		execPatch(fs, store, firstPatch);

		const newText = fs.get(fs.canonicalPath("file.txt"))!;
		decorated = decorate(fs.canonicalPath("file.txt"), newText);
		hash = (decorated.match(/^\[.*#(\w{4})\]/) ?? [])[1];

		const secondPatch = makePatch(fs.canonicalPath("file.txt"), hash!, "replace 3:\n+GAMMA2");
		const result = execPatch(fs, store, secondPatch);
		expect(result.text).toBe("alpha\nBETA\nGAMMA2");
	});
});
