/**
 * Pure function that applies a list of Edit operations to LF-normalized text.
 *
 * The text is expected to use "\n" as its line separator (no trailing "\r").
 * Callers are responsible for converting CRLF/BOM before calling and restoring
 * them afterward.
 *
 * Edits are applied in patch order when they target the same line. The function
 * returns the new text and the first line number that changed, if any.
 */

import type { Edit } from "./executor.js";
import { HashlineError } from "./error.js";

export type { Edit } from "./executor.js";

export interface ApplyResult {
	text: string;
	firstChangedLine?: number;
}

function splitLines(text: string): string[] {
	if (text === "") {
		return [];
	}
	const lines = text.split("\n");
	// A trailing newline produces an empty final element; keep it so that
	// append-at-EOF semantics are preserved.
	return lines;
}

function joinLines(lines: string[]): string {
	return lines.join("\n");
}

interface NormalizedEdit {
	kind: "replace" | "insert" | "delete";
	startLine: number;
	endLine: number;
	payload: string[];
	sourceLine: number;
	index: number;
}

function normalizeEdits(edits: Edit[]): NormalizedEdit[] {
	const out: NormalizedEdit[] = [];
	for (let i = 0; i < edits.length; i++) {
		const edit = edits[i];
		if (edit.kind === "replace") {
			out.push({
				kind: "replace",
				startLine: edit.startLine,
				endLine: edit.endLine,
				payload: edit.payload,
				sourceLine: edit.sourceLine,
				index: i,
			});
		} else if (edit.kind === "delete") {
			out.push({
				kind: "delete",
				startLine: edit.startLine,
				endLine: edit.endLine,
				payload: [],
				sourceLine: edit.sourceLine,
				index: i,
			});
		} else {
			// Insert: convert cursor into a normalized line range.
			const cursor = edit.cursor;
			if (cursor.kind === "bof") {
				out.push({
					kind: "insert",
					startLine: 0,
					endLine: 0,
					payload: edit.payload,
					sourceLine: edit.sourceLine,
					index: i,
				});
			} else if (cursor.kind === "eof") {
				out.push({
					kind: "insert",
					startLine: -1,
					endLine: -1,
					payload: edit.payload,
					sourceLine: edit.sourceLine,
					index: i,
				});
			} else if (cursor.kind === "before") {
				out.push({
					kind: "insert",
					startLine: cursor.line ?? 0,
					endLine: cursor.line ?? 0,
					payload: edit.payload,
					sourceLine: edit.sourceLine,
					index: i,
				});
			} else {
				// after N -> before N+1; special case N at EOF -> EOF.
				const line = cursor.line ?? 0;
				out.push({
					kind: "insert",
					startLine: line,
					endLine: line,
					payload: edit.payload,
					sourceLine: edit.sourceLine,
					index: i,
				});
			}
		}
	}
	return out;
}

function validateBounds(edits: NormalizedEdit[], lineCount: number): void {
	for (const edit of edits) {
		if (edit.kind === "insert" && edit.startLine === -1) {
			// EOF insert is always valid.
			continue;
		}
		if (edit.kind === "insert" && edit.startLine === 0) {
			// BOF insert is always valid.
			continue;
		}
		if (edit.startLine < 1 || edit.startLine > lineCount) {
			throw new HashlineError(
				"out_of_bounds",
				`line ${edit.sourceLine}: line ${edit.startLine} does not exist (file has ${lineCount} lines).`,
				{ line: edit.sourceLine },
			);
		}
		if (edit.endLine < 1 || edit.endLine > lineCount || edit.endLine < edit.startLine) {
			throw new HashlineError(
				"out_of_bounds",
				`line ${edit.sourceLine}: line range ${edit.startLine}..${edit.endLine} is out of bounds (file has ${lineCount} lines).`,
				{ line: edit.sourceLine },
			);
		}
	}
}

/**
 * Apply edits to the given LF-normalized text.
 */
export function applyEdits(text: string, edits: Edit[]): ApplyResult {
	const fileLines = splitLines(text);
	const normalized = normalizeEdits(edits);
	validateBounds(normalized, fileLines.length);

	// Group edits by the line they affect. For "before" semantics we use the
	// target line itself; for "after" semantics we treat the insertion as
	// happening at the target line with a flag to append after it.
	const insertBefore = new Map<number, string[]>();
	const insertAfter = new Map<number, string[]>();
	const replacements = new Map<
		number,
		{ start: number; end: number; payload: string[]; index: number }
	>();
	const deletes = new Map<number, { start: number; end: number; index: number }>();
	let bofPayload: string[] = [];
	let eofPayload: string[] = [];

	for (const edit of normalized) {
		if (edit.kind === "insert" && edit.startLine === 0) {
			bofPayload = [...bofPayload, ...edit.payload];
			continue;
		}
		if (edit.kind === "insert" && edit.startLine === -1) {
			eofPayload = [...eofPayload, ...edit.payload];
			continue;
		}

		const original = edits[edit.index];
		const isAfter = original.kind === "insert" && original.cursor.kind === "after";

		if (edit.kind === "insert") {
			const target = edit.startLine;
			const bucket = isAfter ? insertAfter : insertBefore;
			const existing = bucket.get(target) ?? [];
			bucket.set(target, [...existing, ...edit.payload]);
		} else if (edit.kind === "replace") {
			// Replacements mark every line in the range; overlapping edits are rejected.
			for (let line = edit.startLine; line <= edit.endLine; line++) {
				if (deletes.has(line) || replacements.has(line)) {
					throw new HashlineError(
						"invalid_syntax",
						`line ${edit.sourceLine}: overlapping edit at line ${line}.`,
						{ line: edit.sourceLine },
					);
				}
				replacements.set(line, {
					start: edit.startLine,
					end: edit.endLine,
					payload: edit.payload,
					index: edit.index,
				});
			}
		} else if (edit.kind === "delete") {
			for (let line = edit.startLine; line <= edit.endLine; line++) {
				if (deletes.has(line) || replacements.has(line)) {
					throw new HashlineError(
						"invalid_syntax",
						`line ${edit.sourceLine}: overlapping edit at line ${line}.`,
						{ line: edit.sourceLine },
					);
				}
				deletes.set(line, { start: edit.startLine, end: edit.endLine, index: edit.index });
			}
		}
	}

	// Build the new line array top-down.
	const resultLines: string[] = [];
	let firstChangedLine: number | undefined;

	if (bofPayload.length > 0) {
		resultLines.push(...bofPayload);
		firstChangedLine = 1;
	}

	for (let i = 0; i < fileLines.length; i++) {
		const lineNum = i + 1;

		if (deletes.has(lineNum) && replacements.has(lineNum)) {
			throw new HashlineError(
				"invalid_syntax",
				`line ${lineNum}: conflicting delete and replace operations.`,
			);
		}

		const before = insertBefore.get(lineNum) ?? [];
		const after = insertAfter.get(lineNum) ?? [];

		if (before.length > 0) {
			resultLines.push(...before);
			if (firstChangedLine === undefined) firstChangedLine = lineNum;
		}

		if (deletes.has(lineNum)) {
			const del = deletes.get(lineNum)!;
			if (del.start === lineNum) {
				// Skip all lines in the delete range.
				if (firstChangedLine === undefined) firstChangedLine = lineNum;
			}
			continue;
		}

		if (replacements.has(lineNum)) {
			const rep = replacements.get(lineNum)!;
			if (rep.start === lineNum) {
				resultLines.push(...rep.payload);
				if (firstChangedLine === undefined) firstChangedLine = lineNum;
			}
			// Skip all lines in the replace range.
			continue;
		}

		resultLines.push(fileLines[i]);

		if (after.length > 0) {
			resultLines.push(...after);
			if (firstChangedLine === undefined) firstChangedLine = lineNum;
		}
	}

	if (eofPayload.length > 0) {
		// Preserve trailing newline semantics: if the original file ended with a
		// newline (last stored line is ""), insert before that final empty element.
		const hasTrailingNewline = resultLines.length > 0 && resultLines[resultLines.length - 1] === "";
		if (hasTrailingNewline) {
			resultLines.splice(resultLines.length - 1, 0, ...eofPayload);
		} else {
			resultLines.push(...eofPayload);
		}
		if (firstChangedLine === undefined)
			firstChangedLine = Math.max(1, resultLines.length - eofPayload.length);
	}

	return { text: joinLines(resultLines), firstChangedLine };
}
