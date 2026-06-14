/**
 * Tokenizer for the pi-hashline v2 patch syntax.
 *
 * The patch grammar is intentionally line-based. Each non-empty line is
 * classified into one of the following token kinds:
 *
 * - header:        [PATH#HASH]
 * - op_replace:    replace N..M:
 * - op_replace:    replace N:
 * - op_insert:     insert before N:
 * - op_insert:     insert after N:
 * - op_insert:     insert head:
 * - op_insert:     insert tail:
 * - op_delete:     delete N..M
 * - op_delete:     delete N
 * - payload:       +<literal text> (a single "+" denotes an empty line payload)
 * - blank:         empty line outside a payload body
 * - raw:           any other line (treated as payload text with leading prefix stripped)
 * - envelope:      optional start/end markers for future multi-file patches
 *
 * Tokens carry their original source line number for error reporting.
 */

export type TokenKind =
	| "header"
	| "op_replace"
	| "op_insert"
	| "op_delete"
	| "payload"
	| "blank"
	| "raw"
	| "envelope";

export interface Token {
	kind: TokenKind;
	line: number;
	text: string;
	/**
	 * For header tokens, the matched path and hash.
	 */
	path?: string;
	hash?: string;
	/**
	 * For operation tokens, the raw operand string (e.g. "5..7", "head", "3").
	 */
	operand?: string;
}

const HEADER_RE = /^\[([^#\]]+)#([0-9A-Fa-f]{4})\]\s*$/;
const REPLACE_RE = /^replace\s+(.+):\s*$/i;
const INSERT_RE = /^insert\s+(before\s+\d+|after\s+\d+|head|tail):\s*$/i;
const DELETE_RE = /^delete\s+(\d+(?:\.\.\d+)?)\s*$/i;

/**
 * Classify a single patch line into a Token.
 */
export function tokenizeLine(text: string, line: number): Token {
	const trimmed = text.trim();

	if (trimmed.length === 0) {
		return { kind: "blank", line, text };
	}

	const headerMatch = trimmed.match(HEADER_RE);
	if (headerMatch) {
		return {
			kind: "header",
			line,
			text,
			path: headerMatch[1],
			hash: headerMatch[2].toUpperCase(),
		};
	}

	const replaceMatch = trimmed.match(REPLACE_RE);
	if (replaceMatch) {
		return { kind: "op_replace", line, text, operand: replaceMatch[1] };
	}

	const insertMatch = trimmed.match(INSERT_RE);
	if (insertMatch) {
		return { kind: "op_insert", line, text, operand: insertMatch[1].toLowerCase() };
	}

	const deleteMatch = trimmed.match(DELETE_RE);
	if (deleteMatch) {
		return { kind: "op_delete", line, text, operand: deleteMatch[1] };
	}

	if (trimmed.startsWith("+")) {
		return { kind: "payload", line, text: text.slice(text.indexOf("+") + 1) };
	}

	// Future envelope markers are reserved for multi-file patches.
	if (trimmed === "---" || trimmed === "===") {
		return { kind: "envelope", line, text };
	}

	return { kind: "raw", line, text };
}

/**
 * Tokenize a full patch input. The input is split on LF lines; CRLF is handled
 * by ignoring trailing \r characters during line processing.
 */
export function tokenize(input: string): Token[] {
	const lines = input.split("\n");
	const tokens: Token[] = [];
	for (let i = 0; i < lines.length; i++) {
		const raw = lines[i];
		// Drop trailing \r so CRLF inputs behave the same as LF inputs.
		const text = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
		tokens.push(tokenizeLine(text, i + 1));
	}
	return tokens;
}
