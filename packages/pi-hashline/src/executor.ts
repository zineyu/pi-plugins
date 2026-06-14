/**
 * Executor: converts a stream of tokens into structured Edit operations.
 *
 * The executor validates payload rules:
 * - `replace` and `insert` operations must have at least one payload line.
 * - `delete` operations must not have any payload lines.
 *
 * All line numbers in Edit objects are 1-based.
 */

import { tokenize, type Token } from "./tokenizer.js";
import { HashlineError } from "./error.js";

export type CursorKind = "bof" | "eof" | "before" | "after";

export interface Cursor {
	kind: CursorKind;
	line?: number;
}

export type EditKind = "replace" | "insert" | "delete";

export interface ReplaceEdit {
	kind: "replace";
	startLine: number;
	endLine: number;
	payload: string[];
	sourceLine: number;
}

export interface InsertEdit {
	kind: "insert";
	cursor: Cursor;
	payload: string[];
	sourceLine: number;
}

export interface DeleteEdit {
	kind: "delete";
	startLine: number;
	endLine: number;
	sourceLine: number;
}

export type Edit = ReplaceEdit | InsertEdit | DeleteEdit;

export interface Patch {
	path: string;
	expectedHash: string;
	edits: Edit[];
}

interface ParsedRange {
	start: number;
	end: number;
}

function parseRange(operand: string, sourceLine: number): ParsedRange {
	if (!operand.includes("..")) {
		const line = parseInt(operand, 10);
		if (Number.isNaN(line) || line < 1) {
			throw new HashlineError(
				"invalid_syntax",
				`line ${sourceLine}: invalid line number "${operand}".`,
				{ line: sourceLine },
			);
		}
		return { start: line, end: line };
	}

	const [startRaw, endRaw] = operand.split("..");
	if (!startRaw || !endRaw) {
		throw new HashlineError(
			"invalid_syntax",
			`line ${sourceLine}: invalid range "${operand}". Use "N..M".`,
			{ line: sourceLine },
		);
	}

	const start = parseInt(startRaw, 10);
	const end = parseInt(endRaw, 10);
	if (Number.isNaN(start) || Number.isNaN(end) || start < 1 || end < start) {
		throw new HashlineError(
			"invalid_syntax",
			`line ${sourceLine}: invalid range "${operand}". Start must be <= end.`,
			{ line: sourceLine },
		);
	}
	return { start, end };
}

function parseInsertOperand(operand: string, sourceLine: number): Cursor {
	if (operand === "head") return { kind: "bof" };
	if (operand === "tail") return { kind: "eof" };

	const beforeMatch = operand.match(/^before\s+(\d+)$/);
	if (beforeMatch) {
		const line = parseInt(beforeMatch[1], 10);
		if (line < 1) {
			throw new HashlineError(
				"invalid_syntax",
				`line ${sourceLine}: invalid insert target "${operand}".`,
				{ line: sourceLine },
			);
		}
		return { kind: "before", line };
	}

	const afterMatch = operand.match(/^after\s+(\d+)$/);
	if (afterMatch) {
		const line = parseInt(afterMatch[1], 10);
		if (line < 1) {
			throw new HashlineError(
				"invalid_syntax",
				`line ${sourceLine}: invalid insert target "${operand}".`,
				{ line: sourceLine },
			);
		}
		return { kind: "after", line };
	}

	throw new HashlineError(
		"invalid_syntax",
		`line ${sourceLine}: invalid insert operand "${operand}".`,
		{ line: sourceLine },
	);
}

function isPayloadLine(token: Token): boolean {
	return token.kind === "payload" || token.kind === "raw";
}

function collectPayload(
	tokens: Token[],
	startIndex: number,
	sourceLine: number,
	allowEmpty: boolean,
): { payload: string[]; nextIndex: number } {
	const payload: string[] = [];
	let i = startIndex;
	while (i < tokens.length && isPayloadLine(tokens[i])) {
		const token = tokens[i];
		if (token.kind === "payload") {
			payload.push(token.text);
		} else {
			// Raw lines: strip a leading "+" or "-" if present, otherwise keep verbatim.
			const text = token.text;
			payload.push(text.startsWith("+") || text.startsWith("-") ? text.slice(1) : text);
		}
		i++;
	}

	if (!allowEmpty && payload.length === 0) {
		throw new HashlineError(
			"missing_payload",
			`line ${sourceLine}: this operation requires at least one payload line starting with "+".`,
			{ line: sourceLine },
		);
	}

	return { payload, nextIndex: i };
}

/**
 * Parse a patch input string into a structured Patch object.
 *
 * Enforces a single section: exactly one [PATH#HASH] header, followed by one
 * or more operations. Blank lines are ignored. Raw lines are accepted as
 * payload text with a leading prefix stripped, but the canonical payload format
 * requires a leading "+".
 */
export function parsePatch(input: string): Patch {
	const tokens = tokenize(input);

	let headerIndex = -1;
	for (let i = 0; i < tokens.length; i++) {
		if (tokens[i].kind === "header") {
			if (headerIndex !== -1) {
				throw new HashlineError(
					"multiple_sections",
					`line ${tokens[i].line}: multiple file sections are not allowed in one patch.`,
					{ line: tokens[i].line },
				);
			}
			headerIndex = i;
		}
	}

	if (headerIndex === -1) {
		throw new HashlineError(
			"invalid_syntax",
			"Missing file header. Start the patch with [PATH#HASH].",
		);
	}

	const header = tokens[headerIndex];
	if (!header.path || !header.hash) {
		throw new HashlineError(
			"invalid_syntax",
			`line ${header.line}: invalid header "${header.text}".`,
			{ line: header.line },
		);
	}

	const edits: Edit[] = [];
	let i = headerIndex + 1;
	while (i < tokens.length) {
		const token = tokens[i];
		if (token.kind === "blank") {
			i++;
			continue;
		}
		if (token.kind === "header") {
			throw new HashlineError(
				"multiple_sections",
				`line ${token.line}: multiple file sections are not allowed in one patch.`,
				{ line: token.line },
			);
		}
		if (token.kind === "envelope") {
			throw new HashlineError(
				"unsupported_operation",
				`line ${token.line}: envelope markers are not supported in single-file patches.`,
				{ line: token.line },
			);
		}
		if (token.kind === "raw" || token.kind === "payload") {
			throw new HashlineError(
				"invalid_syntax",
				`line ${token.line}: payload lines must follow an operation header.`,
				{ line: token.line },
			);
		}

		if (token.kind === "op_replace") {
			if (!token.operand) {
				throw new HashlineError(
					"invalid_syntax",
					`line ${token.line}: replace operation is missing a range.`,
					{ line: token.line },
				);
			}
			const range = parseRange(token.operand, token.line);
			const { payload, nextIndex } = collectPayload(tokens, i + 1, token.line, false);
			edits.push({
				kind: "replace",
				startLine: range.start,
				endLine: range.end,
				payload,
				sourceLine: token.line,
			});
			i = nextIndex;
			continue;
		}

		if (token.kind === "op_insert") {
			if (!token.operand) {
				throw new HashlineError(
					"invalid_syntax",
					`line ${token.line}: insert operation is missing a target.`,
					{ line: token.line },
				);
			}
			const cursor = parseInsertOperand(token.operand, token.line);
			const { payload, nextIndex } = collectPayload(tokens, i + 1, token.line, false);
			edits.push({
				kind: "insert",
				cursor,
				payload,
				sourceLine: token.line,
			});
			i = nextIndex;
			continue;
		}

		if (token.kind === "op_delete") {
			if (!token.operand) {
				throw new HashlineError(
					"invalid_syntax",
					`line ${token.line}: delete operation is missing a range.`,
					{ line: token.line },
				);
			}
			const range = parseRange(token.operand, token.line);
			const { payload, nextIndex } = collectPayload(tokens, i + 1, token.line, true);
			if (payload.length > 0) {
				throw new HashlineError(
					"unexpected_payload",
					`line ${token.line}: delete operation cannot have payload lines.`,
					{ line: token.line },
				);
			}
			edits.push({
				kind: "delete",
				startLine: range.start,
				endLine: range.end,
				sourceLine: token.line,
			});
			i = nextIndex;
			continue;
		}

		// Exhaustive kind check; this branch should be unreachable.
		throw new HashlineError(
			"invalid_syntax",
			`line ${token.line}: unrecognized patch syntax "${token.text}".`,
			{ line: token.line },
		);
	}

	if (edits.length === 0) {
		throw new HashlineError("invalid_syntax", "Patch contains no operations.");
	}

	return {
		path: header.path,
		expectedHash: header.hash,
		edits,
	};
}
