/**
 * Filesystem abstraction for pi-hashline.
 *
 * The default NodeFilesystem delegates to node:fs/promises. InMemoryFilesystem is
 * used by tests to avoid disk I/O and to make assertions deterministic.
 */

import { readFile, writeFile, access, mkdir, constants } from "node:fs/promises";
import { resolve, dirname } from "node:path";

export interface WriteResult {
	path: string;
}

export abstract class Filesystem {
	abstract readText(path: string): Promise<string>;
	abstract writeText(path: string, text: string): Promise<WriteResult>;
	abstract canonicalPath(path: string): string;
	abstract preflightWrite(path: string): Promise<void>;
}

export class NodeFilesystem extends Filesystem {
	private cwd: string;

	constructor(cwd: string) {
		super();
		this.cwd = cwd;
	}

	canonicalPath(path: string): string {
		return resolve(this.cwd, path);
	}

	async preflightWrite(path: string): Promise<void> {
		const absolutePath = this.canonicalPath(path);
		try {
			await access(absolutePath, constants.R_OK | constants.W_OK);
		} catch {
			// File may not exist yet; ensure parent directory exists.
			await mkdir(dirname(absolutePath), { recursive: true });
		}
	}

	async readText(path: string): Promise<string> {
		const absolutePath = this.canonicalPath(path);
		const buffer = await readFile(absolutePath);
		return buffer.toString("utf-8");
	}

	async writeText(path: string, text: string): Promise<WriteResult> {
		const absolutePath = this.canonicalPath(path);
		await this.preflightWrite(path);
		await writeFile(absolutePath, text, "utf-8");
		return { path: absolutePath };
	}
}

export class InMemoryFilesystem extends Filesystem {
	private files: Map<string, string> = new Map();
	private cwd: string;

	constructor(cwd = "/workspace") {
		super();
		this.cwd = cwd;
	}

	canonicalPath(path: string): string {
		return resolve(this.cwd, path);
	}

	async preflightWrite(path: string): Promise<void> {
		// In-memory filesystem always allows writes.
		void path;
	}

	async readText(path: string): Promise<string> {
		const absolutePath = this.canonicalPath(path);
		if (!this.files.has(absolutePath)) {
			const err = new Error(`ENOENT: ${absolutePath}`);
			(err as NodeJS.ErrnoException).code = "ENOENT";
			throw err;
		}
		return this.files.get(absolutePath) as string;
	}

	async writeText(path: string, text: string): Promise<WriteResult> {
		const absolutePath = this.canonicalPath(path);
		this.files.set(absolutePath, text);
		return { path: absolutePath };
	}

	set(path: string, text: string): void {
		this.files.set(this.canonicalPath(path), text);
	}

	get(path: string): string | undefined {
		return this.files.get(this.canonicalPath(path));
	}

	delete(path: string): boolean {
		return this.files.delete(this.canonicalPath(path));
	}

	list(): string[] {
		return [...this.files.keys()];
	}
}
