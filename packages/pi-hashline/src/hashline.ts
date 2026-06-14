// @ts-nocheck
// Extension loaded by pi via jiti; types resolved at runtime from pi's node_modules.
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { readFileSync } from "node:fs";
import { resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

import { type Filesystem, NodeFilesystem } from "./filesystem.js";
import { SnapshotStore } from "./snapshot-store.js";
import { parsePatch } from "./executor.js";
import { applyEdits } from "./apply.js";
import { attemptRecovery } from "./recovery.js";
import { HashlineError } from "./error.js";
import { snapshotTag } from "./xxhash32.js";
import { formatDiff } from "./diff-display.js";

// =============================================================================
// Helpers
// =============================================================================

const snapshotStore = new SnapshotStore();

function normalizeEol(text: string): { content: string; lineEnding: string; hasBom: boolean } {
	const hasBom = text.startsWith("\uFEFF");
	const content = hasBom ? text.slice(1) : text;
	const lineEnding = content.includes("\r\n") ? "\r\n" : "\n";
	return { content: content.replace(/\r\n/g, "\n"), lineEnding, hasBom };
}

function restoreEol(text: string, lineEnding: string, hasBom: boolean): string {
	return (hasBom ? "\uFEFF" : "") + text.replace(/\n/g, lineEnding);
}

function splitReadText(text: string): { fileText: string; hint: string } {
	const hintRe = /\n\n\[(Showing lines|First line exceeds|Line \d+ is|\d+ more lines in file)/;
	const match = text.match(hintRe);
	if (!match || match.index === undefined) {
		return { fileText: text, hint: "" };
	}
	return {
		fileText: text.slice(0, match.index),
		hint: text.slice(match.index),
	};
}

function decorateReadResult(filePath: string, fileText: string, offset: number): string {
	const normalizedText = fileText.replace(/\r\n/g, "\n");
	const hash = snapshotTag(normalizedText);
	snapshotStore.record(filePath, normalizedText);

	const lines = normalizedText.split("\n");
	const decorated = lines.map((line, i) => `${offset + i}:${line}`).join("\n");
	return `[${filePath}#${hash}]\n${decorated}`;
}

function resolvePath(filePath: string, cwd: string): string {
	return isAbsolute(filePath) ? filePath : resolve(cwd, filePath);
}

function loadPromptText(): string {
	try {
		const __filename = fileURLToPath(import.meta.url);
		const promptPath = resolve(__filename, "../prompt.md");
		return readFileSync(promptPath, "utf-8");
	} catch {
		return "Edit a single file using the hashline patch syntax: [PATH#HASH] header, replace/insert/delete operations, and payload lines prefixed with '+'.";
	}
}

// =============================================================================
// Extension entry point
// =============================================================================

export default function (pi: ExtensionAPI) {
	const fs: Filesystem = new NodeFilesystem(pi.cwd ?? process.cwd());

	// ---------------------------------------------------------------------------
	// Suppress the native edit tool so only hashline_edit is available for edits.
	// ---------------------------------------------------------------------------
	pi.on("session_start", async () => {
		const allTools = pi.getAllTools();
		const withoutEdit = allTools.map((t) => t.name).filter((n) => n !== "edit");
		pi.setActiveTools(withoutEdit);
	});

	// ---------------------------------------------------------------------------
	// Contribute syntax documentation via resources_discover.
	// ---------------------------------------------------------------------------
	pi.on("resources_discover", async () => {
		return {
			resources: [
				{
					uri: "hashline://syntax",
					name: "Hashline Edit Syntax",
					mimeType: "text/markdown",
					text: loadPromptText(),
				},
			],
		};
	});

	// ---------------------------------------------------------------------------
	// Intercept read tool results and decorate text file content.
	// ---------------------------------------------------------------------------
	pi.on("tool_result", async (event) => {
		if (event.toolName !== "read") return;

		const hasImage = event.content.some((c) => c.type === "image");
		if (hasImage) return;

		const textPart = event.content.find((c) => c.type === "text");
		if (!textPart || typeof textPart.text !== "string") return;

		const input = event.input as {
			path?: string;
			offset?: number;
			limit?: number;
		};
		const filePath = input.path;
		if (!filePath) return;

		const absolutePath = resolvePath(filePath, pi.cwd ?? process.cwd());

		// If the read was truncated, we need the full file to compute a reliable
		// snapshot. Otherwise we can decorate the returned text directly.
		const isTruncated =
			textPart.text.includes("\n\n[Showing lines") ||
			textPart.text.includes("\n\n[First line exceeds") ||
			textPart.text.includes("\n\n[Line ") ||
			/\n\n\d+ more lines in file/.test(textPart.text);

		let fileText: string;
		let hint = "";
		if (isTruncated) {
			fileText = await fs.readText(absolutePath);
			const split = splitReadText(textPart.text);
			hint = split.hint;
		} else {
			const split = splitReadText(textPart.text);
			fileText = split.fileText;
			hint = split.hint;
		}

		const offset = input.offset ?? 1;
		textPart.text = decorateReadResult(absolutePath, fileText, offset) + hint;

		return { content: event.content };
	});

	// ---------------------------------------------------------------------------
	// Register the hashline edit tool
	// ---------------------------------------------------------------------------
	pi.registerTool({
		name: "hashline_edit",
		label: "Hashline Edit",
		description:
			"Edit a single text file using a line-anchored patch. Reads return a [PATH#HASH] header and LINE: prefixes; edits reference that header and line numbers.",
		promptSnippet:
			"Edit files using [PATH#HASH] snapshot headers and replace/insert/delete operations.",
		promptGuidelines: [
			"Use hashline_edit to change a single text file per call.",
			"Start the patch with [PATH#HASH], copying the header shown in read output.",
			"Operations: replace N..M:, replace N:, insert before N:, insert after N:, insert head:, insert tail:, delete N, delete N..M.",
			"Payload lines must start with '+'. A single '+' inserts an empty line.",
			"replace and insert require at least one payload line; delete must not have payload lines.",
			"Do not use the old §, » («), ≔ operators; they are no longer supported.",
			"If you get a stale_snapshot error, re-read the file and try again.",
		],
		parameters: Type.Object(
			{
				input: Type.String({
					description:
						'Hashline patch text. Starts with [PATH#HASH], followed by operations and payload lines prefixed with "+".',
				}),
				path: Type.Optional(
					Type.String({
						description: "Target file path if not specified in the patch header",
					}),
				),
			},
			{ additionalProperties: false },
		),
		async execute(_toolCallId, params, signal, _onUpdate, ctx: ExtensionContext) {
			const { input, path: explicitPath } = params;

			const patch = parsePatch(input);
			const filePath = patch.path;
			const absolutePath = explicitPath
				? resolvePath(explicitPath, ctx.cwd)
				: resolvePath(filePath, ctx.cwd);

			return withFileMutationQueue(absolutePath, async () => {
				let rawContent: string;
				try {
					rawContent = await fs.readText(absolutePath);
				} catch (err) {
					const code = (err as NodeJS.ErrnoException).code;
					if (code === "ENOENT" || (err as Error).message?.includes("ENOENT")) {
						throw new HashlineError("file_not_found", `File not found: ${filePath}`, {
							source: filePath,
						});
					}
					throw new HashlineError("file_access_denied", `Cannot access file: ${filePath}`, {
						source: filePath,
					});
				}

				if (signal?.aborted) {
					throw new Error("Operation aborted");
				}

				const { content, lineEnding, hasBom } = normalizeEol(rawContent);
				const actualHash = snapshotTag(content);

				let resultText: string;
				let recovered = false;
				let warning: string | undefined;

				if (actualHash === patch.expectedHash) {
					const result = applyEdits(content, patch.edits);
					resultText = result.text;
				} else {
					const recovery = attemptRecovery(
						absolutePath,
						patch.expectedHash,
						content,
						actualHash,
						patch.edits,
						snapshotStore,
					);
					resultText = recovery.text;
					recovered = recovery.recovered;
					warning = recovery.warning;
				}

				if (resultText === content) {
					return {
						content: [{ type: "text", text: `No changes made to ${filePath}.` }],
						details: {},
					};
				}

				if (signal?.aborted) {
					throw new Error("Operation aborted");
				}

				const finalContent = restoreEol(resultText, lineEnding, hasBom);
				await fs.writeText(absolutePath, finalContent);

				// Record the new version so subsequent edits can use its snapshot.
				const newText = normalizeEol(finalContent).content;
				snapshotStore.record(absolutePath, newText);
				const diffDisplay = formatDiff(content, resultText);
				const text = warning ? `${warning}\nUpdated ${filePath}.` : `Updated ${filePath}.`;

				return {
					content: [{ type: "text", text }],
					details: {
						recovered,
						diff: diffDisplay.diff,
						firstChangedLine: diffDisplay.firstChangedLine,
					},
				};
			});
		},
	});
}
