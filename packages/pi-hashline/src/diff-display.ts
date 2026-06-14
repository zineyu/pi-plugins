/**
 * Display-oriented line diff — mirrors the behaviour of the native edit tool.
 * Uses the `diff` library (available in pi's node_modules) to compute a
 * line-level diff, then formats it with line numbers and + / - / context prefixes.
 */
import { diffLines } from "diff";

export interface DiffDisplayResult {
	diff: string;
	firstChangedLine?: number;
}

/**
 * Produce a human-readable diff string showing added (+), removed (-), and
 * unchanged context lines ( ) with line numbers.
 *
 * @param oldContent  Original LF-normalised file content.
 * @param newContent  Modified LF-normalised file content.
 * @param contextLines  Max unchanged lines to show around each changed block (default 4).
 */
export function formatDiff(
	oldContent: string,
	newContent: string,
	contextLines = 4,
): DiffDisplayResult {
	const changes = diffLines(oldContent, newContent);
	const output: string[] = [];

	const oldLines = oldContent.split("\n");
	const newLines = newContent.split("\n");
	const maxLine = Math.max(oldLines.length, newLines.length);
	const width = String(maxLine).length;

	let oldLineNum = 1;
	let newLineNum = 1;
	let firstChanged: number | undefined;
	let lastWasChange = false;

	for (let i = 0; i < changes.length; i++) {
		const change = changes[i];
		// `value` contains \n when newlineIsToken is true (default for diffLines).
		// Split and discard the trailing empty element.
		const raw = change.value.split("\n");
		if (raw[raw.length - 1] === "") raw.pop();

		if (change.added || change.removed) {
			if (firstChanged === undefined) firstChanged = newLineNum;

			for (const line of raw) {
				if (change.added) {
					output.push(`+${String(newLineNum).padStart(width)} ${line}`);
					newLineNum++;
				} else {
					output.push(`-${String(oldLineNum).padStart(width)} ${line}`);
					oldLineNum++;
				}
			}
			lastWasChange = true;
		} else {
			// Unchanged context lines
			const nextIsChange =
				i < changes.length - 1 &&
				(changes[i + 1].added === true || changes[i + 1].removed === true);
			const hasLeading = lastWasChange;
			const hasTrailing = nextIsChange;

			if (hasLeading && hasTrailing) {
				// Between two changed blocks: show lead + trail, skip middle if large
				if (raw.length <= contextLines * 2) {
					for (const line of raw) {
						output.push(` ${String(oldLineNum).padStart(width)} ${line}`);
						oldLineNum++;
						newLineNum++;
					}
				} else {
					for (let j = 0; j < contextLines; j++) {
						output.push(` ${String(oldLineNum).padStart(width)} ${raw[j]}`);
						oldLineNum++;
						newLineNum++;
					}
					output.push(` ${"".padStart(width)} ...`);
					oldLineNum += raw.length - 2 * contextLines;
					newLineNum += raw.length - 2 * contextLines;
					for (let j = raw.length - contextLines; j < raw.length; j++) {
						output.push(` ${String(oldLineNum).padStart(width)} ${raw[j]}`);
						oldLineNum++;
						newLineNum++;
					}
				}
			} else if (hasLeading) {
				const show = Math.min(contextLines, raw.length);
				for (let j = 0; j < show; j++) {
					output.push(` ${String(oldLineNum).padStart(width)} ${raw[j]}`);
					oldLineNum++;
					newLineNum++;
				}
				if (raw.length > contextLines) {
					output.push(` ${"".padStart(width)} ...`);
					oldLineNum += raw.length - contextLines;
					newLineNum += raw.length - contextLines;
				}
			} else if (hasTrailing) {
				const skip = Math.max(0, raw.length - contextLines);
				if (skip > 0) {
					output.push(` ${"".padStart(width)} ...`);
					oldLineNum += skip;
					newLineNum += skip;
				}
				for (let j = skip; j < raw.length; j++) {
					output.push(` ${String(oldLineNum).padStart(width)} ${raw[j]}`);
					oldLineNum++;
					newLineNum++;
				}
			} else {
				// Far from any change — skip entirely
				oldLineNum += raw.length;
				newLineNum += raw.length;
			}
			lastWasChange = false;
		}
	}

	return { diff: output.join("\n"), firstChangedLine: firstChanged };
}
