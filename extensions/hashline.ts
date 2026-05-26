// @ts-nocheck
// Extension loaded by pi via jiti; types resolved at runtime from pi's node_modules.
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { readFile, writeFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";

// =============================================================================
// Hashline constants and helpers
// =============================================================================

const HL_OP_INSERT_BEFORE = "«";
const HL_OP_INSERT_AFTER = "»";
const HL_OP_REPLACE = "≔";
const HL_FILE_PREFIX = "§";
const HL_BODY_SEP = "|";
const RANGE_INTERIOR_HASH = "**";

// Generate aa..zz bigrams (676 combinations).
const HL_BIGRAMS: readonly string[] = Array.from({ length: 26 }, (_, i) =>
	Array.from(
		{ length: 26 },
		(_, j) => String.fromCharCode(97 + i) + String.fromCharCode(97 + j),
	),
).flat();
const HL_BIGRAM_COUNT = HL_BIGRAMS.length;

/**
 * Compute a 2-character hash of a single line via FNV-1a mod 676.
 * The hash depends only on the line's content (after stripping CR and trailing
 * whitespace). The `idx` parameter is accepted for call-site symmetry but is
 * intentionally unused so anchors remain stable across line shifts.
 */
function computeLineHash(_idx: number, line: string): string {
	void _idx;
	const normalized = line.replace(/\r/g, "").trimEnd();
	let h = 2166136261;
	for (let i = 0; i < normalized.length; i++) {
		h ^= normalized.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return HL_BIGRAMS[(h >>> 0) % HL_BIGRAM_COUNT];
}

function formatLineHash(lineNum: number, line: string): string {
	return `${lineNum}${computeLineHash(lineNum, line)}`;
}

function formatHashLine(lineNum: number, line: string): string {
	return `${formatLineHash(lineNum, line)}${HL_BODY_SEP}${line}`;
}

function formatHashLines(text: string, startLine = 1): string {
	const lines = text.split("\n");
	return lines.map((line, i) => formatHashLine(startLine + i, line)).join("\n");
}

// =============================================================================
// Parser
// =============================================================================

interface Anchor {
	line: number;
	hash: string;
}

type HashlineCursor =
	| { kind: "bof" }
	| { kind: "eof" }
	| { kind: "before_anchor"; anchor: Anchor }
	| { kind: "after_anchor"; anchor: Anchor };

type HashlineEdit =
	| {
			kind: "insert";
			cursor: HashlineCursor;
			text: string;
			lineNum: number;
			index: number;
	  }
	| { kind: "delete"; anchor: Anchor; lineNum: number; index: number };

function parseAnchor(raw: string, lineNum: number): Anchor {
	const match = raw.match(/^(\d+)([a-z]{2})$/i);
	if (!match) {
		throw new Error(
			`line ${lineNum}: invalid anchor "${raw}". Expected format like "42ab" (line number + 2-char hash).`,
		);
	}
	return { line: parseInt(match[1], 10), hash: match[2].toLowerCase() };
}

function parseRange(
	raw: string,
	lineNum: number,
): { start: Anchor; end: Anchor } {
	if (!raw.includes("..")) {
		const a = parseAnchor(raw, lineNum);
		return { start: a, end: { ...a } };
	}
	const [startRaw, endRaw] = raw.split("..");
	if (!startRaw || !endRaw) {
		throw new Error(
			`line ${lineNum}: invalid range "${raw}". Use "START..END" format.`,
		);
	}
	const start = parseAnchor(startRaw, lineNum);
	const end = parseAnchor(endRaw, lineNum);
	if (end.line < start.line) {
		throw new Error(`line ${lineNum}: range ends before it starts.`);
	}
	return { start, end };
}

function parseCursor(
	raw: string,
	lineNum: number,
	kind: "before" | "after",
): HashlineCursor {
	if (raw === "BOF") return { kind: "bof" };
	if (raw === "EOF") return { kind: "eof" };
	const cursorKind = kind === "before" ? "before_anchor" : "after_anchor";
	return { kind: cursorKind, anchor: parseAnchor(raw, lineNum) };
}

function isPayloadTerminator(line: string): boolean {
	if (line.length === 0) return false;
	const first = line[0];
	return (
		first === HL_FILE_PREFIX ||
		first === HL_OP_INSERT_BEFORE ||
		first === HL_OP_INSERT_AFTER ||
		first === HL_OP_REPLACE
	);
}

function cloneCursor(cursor: HashlineCursor): HashlineCursor {
	if (cursor.kind === "before_anchor")
		return { kind: "before_anchor", anchor: { ...cursor.anchor } };
	if (cursor.kind === "after_anchor")
		return { kind: "after_anchor", anchor: { ...cursor.anchor } };
	return cursor;
}

function parseHashline(diff: string): HashlineEdit[] {
	const edits: HashlineEdit[] = [];
	const lines = diff.split(/\r?\n/);
	if (diff.endsWith("\n") && lines[lines.length - 1] === "") lines.pop();

	let editIndex = 0;

	for (let i = 0; i < lines.length; ) {
		const lineNum = i + 1;
		const line = lines[i];

		if (line.trim().length === 0) {
			i++;
			continue;
		}

		if (line.startsWith(HL_FILE_PREFIX)) {
			i++;
			continue;
		}

		const insertBeforeMatch = line.match(/^«\s*(\S+)(?:\|(.*))?\s*$/);
		if (insertBeforeMatch) {
			const cursor = parseCursor(insertBeforeMatch[1], lineNum, "before");
			const payload: string[] = [];
			i++;
			while (i < lines.length && !isPayloadTerminator(lines[i])) {
				payload.push(lines[i]);
				i++;
			}
			if (payload.length === 0) {
				throw new Error(
					`line ${lineNum}: « requires at least one payload line.`,
				);
			}
			for (const text of payload) {
				edits.push({
					kind: "insert",
					cursor: cloneCursor(cursor),
					text,
					lineNum,
					index: editIndex++,
				});
			}
			continue;
		}

		const insertAfterMatch = line.match(/^»\s*(\S+)(?:\|(.*))?\s*$/);
		if (insertAfterMatch) {
			const cursor = parseCursor(insertAfterMatch[1], lineNum, "after");
			const payload: string[] = [];
			i++;
			while (i < lines.length && !isPayloadTerminator(lines[i])) {
				payload.push(lines[i]);
				i++;
			}
			if (payload.length === 0) {
				throw new Error(
					`line ${lineNum}: » requires at least one payload line.`,
				);
			}
			for (const text of payload) {
				edits.push({
					kind: "insert",
					cursor: cloneCursor(cursor),
					text,
					lineNum,
					index: editIndex++,
				});
			}
			continue;
		}

		const replaceMatch = line.match(/^≔\s*(\S+)\s*$/);
		if (replaceMatch) {
			const range = parseRange(replaceMatch[1], lineNum);
			const payload: string[] = [];
			i++;
			while (i < lines.length && !isPayloadTerminator(lines[i])) {
				payload.push(lines[i]);
				i++;
			}
			for (const text of payload) {
				edits.push({
					kind: "insert",
					cursor: { kind: "before_anchor", anchor: { ...range.start } },
					text,
					lineNum,
					index: editIndex++,
				});
			}
			for (let l = range.start.line; l <= range.end.line; l++) {
				const hash =
					l === range.start.line
						? range.start.hash
						: l === range.end.line
							? range.end.hash
							: RANGE_INTERIOR_HASH;
				edits.push({
					kind: "delete",
					anchor: { line: l, hash },
					lineNum,
					index: editIndex++,
				});
			}
			continue;
		}

		throw new Error(
			`line ${lineNum}: unrecognized op "${line}". Use ${HL_OP_INSERT_BEFORE}ANCHOR (insert before), ${HL_OP_INSERT_AFTER}ANCHOR (insert after), or ${HL_OP_REPLACE}RANGE (replace/delete).`,
		);
	}

	return edits;
}

// =============================================================================
// Apply
// =============================================================================

interface HashlineApplyResult {
	lines: string;
	firstChangedLine?: number;
}

class HashlineMismatchError extends Error {
	constructor(
		public readonly mismatches: Array<{
			line: number;
			expected: string;
			actual: string;
		}>,
		public readonly fileLines: string[],
	) {
		super(
			`Hash mismatch on line(s): ${mismatches.map((m) => m.line).join(", ")}`,
		);
		this.name = "HashlineMismatchError";
	}

	get displayMessage(): string {
		const out: string[] = [
			`Edit rejected: ${this.mismatches.length} anchor(s) do not match the current file (marked *).`,
			"The edit was NOT applied. Please re-read the file and issue another edit.",
			"",
		];
		const mismatchSet = new Set(this.mismatches.map((m) => m.line));
		for (let i = 0; i < this.fileLines.length; i++) {
			const lineNum = i + 1;
			if (
				mismatchSet.has(lineNum) ||
				this.mismatches.some((m) => Math.abs(m.line - lineNum) <= 2)
			) {
				const marker = mismatchSet.has(lineNum) ? "*" : " ";
				const hash = computeLineHash(lineNum, this.fileLines[i]);
				out.push(
					`${marker}${lineNum}${hash}${HL_BODY_SEP}${this.fileLines[i]}`,
				);
			}
		}
		return out.join("\n");
	}
}

function validateAnchors(edits: HashlineEdit[], fileLines: string[]): void {
	const mismatches: Array<{ line: number; expected: string; actual: string }> =
		[];
	for (const edit of edits) {
		const anchors: Anchor[] = [];
		if (edit.kind === "delete") anchors.push(edit.anchor);
		else if (
			edit.cursor.kind === "before_anchor" ||
			edit.cursor.kind === "after_anchor"
		)
			anchors.push(edit.cursor.anchor);

		for (const anchor of anchors) {
			if (anchor.line < 1 || anchor.line > fileLines.length) {
				throw new Error(
					`Line ${anchor.line} does not exist (file has ${fileLines.length} lines)`,
				);
			}
			if (anchor.hash === RANGE_INTERIOR_HASH) continue;
			const actual = computeLineHash(
				anchor.line,
				fileLines[anchor.line - 1] ?? "",
			);
			if (actual !== anchor.hash) {
				mismatches.push({ line: anchor.line, expected: anchor.hash, actual });
			}
		}
	}
	if (mismatches.length > 0) {
		throw new HashlineMismatchError(mismatches, fileLines);
	}
}

function applyHashlineEdits(
	text: string,
	edits: HashlineEdit[],
): HashlineApplyResult {
	if (edits.length === 0) return { lines: text };

	const fileLines = text.split("\n");
	validateAnchors(edits, fileLines);

	// Normalize after_anchor -> before_anchor of next line, or EOF.
	const normalizedEdits: HashlineEdit[] = edits.map((e) => {
		if (e.kind !== "insert" || e.cursor.kind !== "after_anchor") return e;
		const anchorLine = e.cursor.anchor.line;
		if (anchorLine >= fileLines.length) {
			return {
				kind: "insert",
				cursor: { kind: "eof" },
				text: e.text,
				lineNum: e.lineNum,
				index: e.index,
			};
		}
		const nextLineNum = anchorLine + 1;
		return {
			kind: "insert",
			cursor: {
				kind: "before_anchor",
				anchor: {
					line: nextLineNum,
					hash: computeLineHash(nextLineNum, fileLines[nextLineNum - 1]),
				},
			},
			text: e.text,
			lineNum: e.lineNum,
			index: e.index,
		};
	});

	const bofLines: string[] = [];
	const eofLines: string[] = [];
	const anchorEdits: Array<{ edit: HashlineEdit; idx: number }> = [];

	normalizedEdits.forEach((edit, idx) => {
		if (edit.kind === "insert" && edit.cursor.kind === "bof")
			bofLines.push(edit.text);
		else if (edit.kind === "insert" && edit.cursor.kind === "eof")
			eofLines.push(edit.text);
		else anchorEdits.push({ edit, idx });
	});

	// Bucket by target line.
	const byLine = new Map<number, Array<{ edit: HashlineEdit; idx: number }>>();
	for (const entry of anchorEdits) {
		const line =
			entry.edit.kind === "delete"
				? entry.edit.anchor.line
				: entry.edit.cursor.kind === "before_anchor"
					? entry.edit.cursor.anchor.line
					: 0;
		if (line === 0) continue;
		const bucket = byLine.get(line);
		if (bucket) bucket.push(entry);
		else byLine.set(line, [entry]);
	}

	let firstChangedLine: number | undefined;

	// Apply bottom-up so earlier indices stay valid.
	for (const line of [...byLine.keys()].sort((a, b) => b - a)) {
		const bucket = byLine.get(line);
		if (!bucket) continue;
		bucket.sort((a, b) => a.idx - b.idx);

		const idx = line - 1;
		const beforeLines: string[] = [];
		let deleteLine = false;

		for (const { edit } of bucket) {
			if (edit.kind === "insert") beforeLines.push(edit.text);
			else if (edit.kind === "delete") deleteLine = true;
		}

		const replacement = deleteLine
			? beforeLines
			: [...beforeLines, fileLines[idx]];
		fileLines.splice(idx, 1, ...replacement);
		if (firstChangedLine === undefined || line < firstChangedLine)
			firstChangedLine = line;
	}

	if (bofLines.length > 0) {
		if (fileLines.length === 1 && fileLines[0] === "") {
			fileLines.splice(0, 1, ...bofLines);
		} else {
			fileLines.splice(0, 0, ...bofLines);
		}
		if (firstChangedLine === undefined) firstChangedLine = 1;
	}

	if (eofLines.length > 0) {
		const hasTrailingNewline =
			fileLines.length > 0 && fileLines[fileLines.length - 1] === "";
		const insertIndex = hasTrailingNewline
			? fileLines.length - 1
			: fileLines.length;
		fileLines.splice(insertIndex, 0, ...eofLines);
		if (firstChangedLine === undefined || insertIndex + 1 < firstChangedLine)
			firstChangedLine = insertIndex + 1;
	}

	return { lines: fileLines.join("\n"), firstChangedLine };
}

// =============================================================================
// Read output patching
// =============================================================================

/**
 * Detect whether a read result text ends with a continuation hint produced by
 * the built-in read tool.  If so, split into file content + hint so we can
 * hashline-format only the actual file content.
 */
function splitReadText(text: string): { fileText: string; hint: string } {
	const hintRe =
		/\n\n\[(Showing lines|First line exceeds|Line \d+ is|\d+ more lines in file)/;
	const match = text.match(hintRe);
	if (!match || match.index === undefined) {
		return { fileText: text, hint: "" };
	}
	return {
		fileText: text.slice(0, match.index),
		hint: text.slice(match.index),
	};
}

function patchReadResult(text: string, offset: number): string {
	const { fileText, hint } = splitReadText(text);
	const hashed = formatHashLines(fileText, offset);
	return hashed + hint;
}

// =============================================================================
// Extension entry point
// =============================================================================

export default function (pi: ExtensionAPI) {
	// ---------------------------------------------------------------------------
	// Intercept read tool results and decorate text file content with hashline
	// anchors so the model can reference lines precisely without reproducing them.
	// ---------------------------------------------------------------------------
	pi.on("tool_result", async (event) => {
		if (event.toolName !== "read") return;

		// Skip image reads.
		const hasImage = event.content.some((c) => c.type === "image");
		if (hasImage) return;

		const textPart = event.content.find((c) => c.type === "text");
		if (!textPart || typeof textPart.text !== "string") return;

		const input = event.input as {
			path?: string;
			offset?: number;
			limit?: number;
		};
		const offset = input.offset ?? 1;

		textPart.text = patchReadResult(textPart.text, offset);

		return { content: event.content };
	});

	// ---------------------------------------------------------------------------
	// Register the hashline edit tool
	// ---------------------------------------------------------------------------
	pi.registerTool({
		name: "hashline_edit",
		label: "Hashline Edit",
		description:
			"Edit a single file using hashline anchors. When the model reads a file, every line comes back tagged with a 2-character content hash (e.g. 42ab|content). To edit, reference those anchors — no need to reproduce old text exactly.",
		promptSnippet:
			"Edit files by referencing line hash anchors instead of exact text replacement",
		promptGuidelines: [
			"Use hashline_edit when you want to change files by referencing line anchors (LINE+HASH) shown in read output.",
			`Format: start with ${HL_FILE_PREFIX}PATH, then operations: ${HL_OP_INSERT_AFTER}ANCHOR (insert after), ${HL_OP_INSERT_BEFORE}ANCHOR (insert before), or ${HL_OP_REPLACE}START..END (replace range).`,
			"Copy anchors exactly as shown in read output (e.g. 42ab, not just ab).",
			"Payload lines follow each operation and end at the next operation or EOF.",
			"Use BOF and EOF for insertions at the start or end of a file.",
			"Multiple operations on the same file are allowed in one call.",
		],
		parameters: Type.Object(
			{
				input: Type.String({
					description: `Hashline patch text. Starts with ${HL_FILE_PREFIX}PATH, followed by edit ops and payload lines.`,
				}),
				path: Type.Optional(
					Type.String({
						description:
							"Target file path if not specified in the patch header",
					}),
				),
			},
			{ additionalProperties: false },
		),
		async execute(
			_toolCallId,
			params,
			signal,
			_onUpdate,
			ctx: ExtensionContext,
		) {
			const { input, path: explicitPath } = params;

			// Extract file path from the first § header.
			const lines = input.split(/\r?\n/);
			let filePath: string | undefined;
			let opStart = 0;
			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				if (line.startsWith(HL_FILE_PREFIX)) {
					filePath = line.slice(1).trim();
					opStart = i + 1;
					break;
				}
			}
			if (!filePath && explicitPath) filePath = explicitPath;
			if (!filePath) {
				throw new Error(
					`No file path found. Start the patch with "${HL_FILE_PREFIX}PATH" or provide the path parameter.`,
				);
			}

			const absolutePath = resolve(ctx.cwd, filePath);

			return withFileMutationQueue(absolutePath, async () => {
				// Verify file exists and is accessible.
				try {
					await access(absolutePath, constants.R_OK | constants.W_OK);
				} catch {
					throw new Error(`Cannot access file: ${filePath}`);
				}

				if (signal?.aborted) {
					throw new Error("Operation aborted");
				}

				// Read file.
				const buffer = await readFile(absolutePath);
				const rawContent = buffer.toString("utf-8");
				const hasBom = rawContent.startsWith("\uFEFF");
				const content = hasBom ? rawContent.slice(1) : rawContent;

				// Preserve original line endings.
				const lineEnding = content.includes("\r\n") ? "\r\n" : "\n";
				const normalizedContent = content.replace(/\r\n/g, "\n");

				if (signal?.aborted) {
					throw new Error("Operation aborted");
				}

				// Parse and apply edits.
				const diffText = lines.slice(opStart).join("\n");
				const edits = parseHashline(diffText);
				const result = applyHashlineEdits(normalizedContent, edits);

				if (normalizedContent === result.lines) {
					return {
						content: [
							{ type: "text", text: `No changes made to ${filePath}.` },
						],
						details: {},
					};
				}

				if (signal?.aborted) {
					throw new Error("Operation aborted");
				}

				// Write back with original line endings and BOM preserved.
				const finalContent =
					(hasBom ? "\uFEFF" : "") + result.lines.replace(/\n/g, lineEnding);
				await writeFile(absolutePath, finalContent, "utf-8");

				return {
					content: [
						{
							type: "text",
							text: `Updated ${filePath} (${edits.length} edit ops applied).`,
						},
					],
					details: { firstChangedLine: result.firstChangedLine },
				};
			});
		},
	});
}
