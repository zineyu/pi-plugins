/**
 * Structured errors produced by pi-hashline.
 *
 * Each error carries a machine-readable code, a human-readable message, and
 * optional structured details that the caller (or model) can use to decide
 * whether to retry, re-read, or correct the patch.
 */

export type HashlineErrorCode =
	| "stale_snapshot"
	| "invalid_syntax"
	| "out_of_bounds"
	| "multiple_sections"
	| "missing_payload"
	| "unexpected_payload"
	| "unsupported_operation"
	| "file_not_found"
	| "file_access_denied";

export interface HashlineErrorDetails {
	code: HashlineErrorCode;
	line?: number;
	expectedHash?: string;
	actualHash?: string;
	mismatchedLines?: Array<{ line: number; expected?: string; actual?: string }>;
	source?: string;
	message: string;
}

export class HashlineError extends Error {
	public readonly code: HashlineErrorCode;
	public readonly line?: number;
	public readonly details: HashlineErrorDetails;

	constructor(
		code: HashlineErrorCode,
		message: string,
		extra: Partial<Omit<HashlineErrorDetails, "code" | "message">> = {},
	) {
		super(message);
		this.name = "HashlineError";
		this.code = code;
		this.line = extra.line;
		this.details = {
			code,
			message,
			...extra,
		};
	}
}
