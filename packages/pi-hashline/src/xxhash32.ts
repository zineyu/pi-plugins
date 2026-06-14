/**
 * Pure JavaScript implementation of xxHash32.
 *
 * Computes a 32-bit hash compatible with the reference xxHash32 algorithm,
 * seeded with 0. The result is returned as an unsigned 32-bit integer.
 *
 * The extension uses the lower 16 bits of this hash as a 4-character uppercase
 * hexadecimal snapshot tag for files.
 */

const PRIME1 = 0x9e3779b1;
const PRIME2 = 0x85ebca77;
const PRIME3 = 0xc2b2ae3d;
const PRIME4 = 0x27d4eb2f;
const PRIME5 = 0x165667b1;

function rotl32(x: number, r: number): number {
	return (x << r) | (x >>> (32 - r));
}

function round(acc: number, input: number): number {
	acc = (acc + input * PRIME2) >>> 0;
	acc = rotl32(acc, 13);
	acc = (acc * PRIME1) >>> 0;
	return acc;
}

function avalanche(h: number): number {
	h ^= h >>> 15;
	h = (h * PRIME2) >>> 0;
	h ^= h >>> 13;
	h = (h * PRIME3) >>> 0;
	h ^= h >>> 16;
	return h >>> 0;
}

function readUInt32LE(data: Uint8Array, offset: number): number {
	return (
		data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)
	);
}

function encodeText(text: string): Uint8Array {
	if (typeof TextEncoder !== "undefined") {
		return new TextEncoder().encode(text);
	}
	// Node fallback when TextEncoder is not available.
	const bytes = new Uint8Array(text.length);
	for (let i = 0; i < text.length; i++) {
		const code = text.charCodeAt(i);
		bytes[i] = code < 256 ? code : 0x3f; // '?' for non-ASCII
	}
	return bytes;
}

/**
 * Compute the xxHash32 (seed 0) digest of a UTF-8 string.
 */
export function xxhash32(text: string): number {
	const data = encodeText(text);
	const len = data.length;
	let h: number;
	let i = 0;

	if (len >= 16) {
		let v1 = (PRIME1 + PRIME2) >>> 0;
		let v2 = PRIME2 >>> 0;
		let v3 = 0 >>> 0;
		let v4 = (0 - PRIME1) >>> 0;

		const limit = len - 16;
		while (i <= limit) {
			v1 = round(v1, readUInt32LE(data, i));
			v2 = round(v2, readUInt32LE(data, i + 4));
			v3 = round(v3, readUInt32LE(data, i + 8));
			v4 = round(v4, readUInt32LE(data, i + 12));
			i += 16;
		}

		h = rotl32(v1, 1) + rotl32(v2, 7) + rotl32(v3, 12) + rotl32(v4, 18);
		h = h >>> 0;
	} else {
		h = PRIME5 + len;
	}

	while (i + 4 <= len) {
		h = (h + readUInt32LE(data, i) * PRIME3) >>> 0;
		h = rotl32(h, 17) * PRIME4;
		h = h >>> 0;
		i += 4;
	}

	while (i < len) {
		h = (h + data[i] * PRIME5) >>> 0;
		h = rotl32(h, 11) * PRIME1;
		h = h >>> 0;
		i++;
	}

	return avalanche(h);
}

/**
 * Return a 4-character uppercase hexadecimal snapshot tag for the given text.
 */
export function snapshotTag(text: string): string {
	const hash = xxhash32(text);
	return (hash & 0xffff).toString(16).toUpperCase().padStart(4, "0");
}
