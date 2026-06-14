/**
 * Drift recovery: attempt to apply an edit intended for an older snapshot onto
 * the current file by three-way merge.
 *
 * When the current file no longer matches the snapshot in a patch header, the
 * SnapshotStore may still hold the historical version. If so, we:
 *
 * 1. Apply the patch to the historical version to produce the "intended" text.
 * 2. Compute a unified diff from historical version -> intended text.
 * 3. Apply that diff to the current file with fuzzFactor = 0.
 *
 * If the patch applies cleanly, the edit succeeded despite drift. If not, we
 * report a stale_snapshot error so the model can re-read.
 */

import * as Diff from "diff";
import { applyEdits, type Edit } from "./apply.js";
import { HashlineError } from "./error.js";
import type { SnapshotStore } from "./snapshot-store.js";

export interface RecoveryResult {
	text: string;
	recovered: boolean;
	warning?: string;
}

/**
 * Attempt to recover from snapshot drift.
 *
 * @param path            Logical file path (for error messages).
 * @param expectedHash    Snapshot hash from the patch header.
 * @param currentText     Current LF-normalized file content.
 * @param currentHash     Snapshot hash of currentText.
 * @param edits           Parsed edit operations.
 * @param store           Snapshot store that may hold the historical version.
 */
export function attemptRecovery(
	path: string,
	expectedHash: string,
	currentText: string,
	currentHash: string,
	edits: Edit[],
	store: SnapshotStore,
): RecoveryResult {
	const historical = store.byHash(path, expectedHash);
	if (!historical) {
		throw new HashlineError(
			"stale_snapshot",
			`Snapshot ${expectedHash} for ${path} is stale and no historical version is available. Please re-read the file and try again.`,
			{
				expectedHash,
				actualHash: currentHash,
			},
		);
	}

	const intendedResult = applyEdits(historical.text, edits);
	if (intendedResult.text === historical.text) {
		// The edits produced no net change relative to the historical version.
		return { text: currentText, recovered: false };
	}

	const patch = Diff.structuredPatch(path, path, historical.text, intendedResult.text, "", "", {
		context: Number.MAX_SAFE_INTEGER,
	});

	if (patch.hunks.length === 0) {
		return { text: currentText, recovered: false };
	}

	const applied = Diff.applyPatch(currentText, patch, { fuzzFactor: 0 });
	if (applied === false) {
		throw new HashlineError(
			"stale_snapshot",
			`Snapshot ${expectedHash} for ${path} is stale and the edit conflicts with the current file. Please re-read the file and try again.`,
			{
				expectedHash,
				actualHash: currentHash,
			},
		);
	}

	return {
		text: applied,
		recovered: true,
		warning: `File ${path} had drifted from the expected snapshot; the edit was recovered by three-way merge.`,
	};
}
