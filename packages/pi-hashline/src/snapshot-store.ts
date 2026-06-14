/**
 * In-memory snapshot store for file versions.
 *
 * - Keeps up to MAX_VERSIONS_PER_PATH recent versions per path.
 * - Tracks up to MAX_PATHS distinct paths globally.
 * - Allows lookup of a historical version by its snapshot hash.
 *
 * A "version" is the LF-normalized text of the file (without BOM). Snapshot
 * tags are computed from this text. The store does not persist across process
 * restarts.
 */

import { snapshotTag } from "./xxhash32.js";

const MAX_VERSIONS_PER_PATH = 4;
const MAX_PATHS = 30;

export interface FileVersion {
	hash: string;
	text: string;
	timestamp: number;
}

export class SnapshotStore {
	private versions: Map<string, FileVersion[]> = new Map();
	private pathOrder: string[] = [];

	/**
	 * Record a new version for a path, typically after a successful read or edit.
	 */
	record(path: string, text: string): FileVersion {
		const normalizedPath = this.normalizePath(path);
		const hash = snapshotTag(text);
		const version: FileVersion = {
			hash,
			text,
			timestamp: Date.now(),
		};

		this.touchPath(normalizedPath);
		const list = this.versions.get(normalizedPath) ?? [];

		// Avoid duplicating the exact same head.
		if (list.length > 0 && list[list.length - 1].hash === hash) {
			list[list.length - 1] = version;
		} else {
			list.push(version);
		}

		while (list.length > MAX_VERSIONS_PER_PATH) {
			list.shift();
		}

		this.versions.set(normalizedPath, list);
		return version;
	}

	/**
	 * Return the most recently recorded version for a path, if any.
	 */
	head(path: string): FileVersion | undefined {
		const list = this.versions.get(this.normalizePath(path));
		if (!list || list.length === 0) return undefined;
		return list[list.length - 1];
	}

	/**
	 * Find a historical version by snapshot hash.
	 */
	byHash(path: string, hash: string): FileVersion | undefined {
		const list = this.versions.get(this.normalizePath(path));
		if (!list) return undefined;
		return list.find((v) => v.hash === hash.toUpperCase());
	}

	/**
	 * Return all recorded versions for a path, oldest first.
	 */
	all(path: string): FileVersion[] {
		return [...(this.versions.get(this.normalizePath(path)) ?? [])];
	}

	/**
	 * Remove all versions for a path.
	 */
	forget(path: string): void {
		const normalizedPath = this.normalizePath(path);
		this.versions.delete(normalizedPath);
		this.pathOrder = this.pathOrder.filter((p) => p !== normalizedPath);
	}

	/**
	 * Compute the snapshot tag for arbitrary text without storing it.
	 */
	tag(text: string): string {
		return snapshotTag(text);
	}

	private touchPath(path: string): void {
		this.pathOrder = this.pathOrder.filter((p) => p !== path);
		this.pathOrder.push(path);
		while (this.pathOrder.length > MAX_PATHS) {
			const oldest = this.pathOrder.shift();
			if (oldest) this.versions.delete(oldest);
		}
	}

	private normalizePath(path: string): string {
		return path.replace(/\\/g, "/");
	}
}
