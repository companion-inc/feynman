import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

// Replaces inline RFC 2397 data: URIs in extracted text with explicit bounded
// omission markers so base64 payloads never reach model-visible tool results,
// the fetch cache, or session persistence. Carved out of the original
// persistence-safety layer; only the text-sanitization path is retained.

const MAX_DATA_URI_HEADER_CHARS = 1024;
const MAX_MIME_CHARS = 127;
const MAX_MARKER_SOURCE_CHARS = 180;

export type DataUriEncoding = "base64" | "percent-encoded";
export type DigestBasis = "decoded" | "encoded";

export interface DataUriOmission {
	ordinal: number;
	sourcePath: string;
	mimeType: string;
	encoding: DataUriEncoding;
	encodedBytes: number;
	decodedBytes: number | null;
	decodeError?: string;
	sha256: string;
	digestBasis: DigestBasis;
	retrieval: "not-retained";
}


interface InternalDataUriOmission extends DataUriOmission {
	markerStart: number;
	markerEnd: number;
}

interface SanitizationState {
	nextOrdinal: number;
	omissions: InternalDataUriOmission[];
}


function sha256Bytes(value: string | Uint8Array): string {
	return createHash("sha256").update(value).digest("hex");
}


function asciiLowerCode(code: number): number {
	return code >= 65 && code <= 90 ? code + 32 : code;
}

function matchesDataScheme(text: string, index: number): boolean {
	return index + 5 <= text.length
		&& asciiLowerCode(text.charCodeAt(index)) === 100
		&& asciiLowerCode(text.charCodeAt(index + 1)) === 97
		&& asciiLowerCode(text.charCodeAt(index + 2)) === 116
		&& asciiLowerCode(text.charCodeAt(index + 3)) === 97
		&& text.charCodeAt(index + 4) === 58;
}

function isSchemeBoundary(text: string, index: number): boolean {
	if (index === 0) return true;
	const code = text.charCodeAt(index - 1);
	const alphaNumeric = (code >= 48 && code <= 57)
		|| (code >= 65 && code <= 90)
		|| (code >= 97 && code <= 122);
	return !alphaNumeric && code !== 43 && code !== 45 && code !== 46;
}

function findNextDataScheme(text: string, from: number): number {
	for (let i = from; i + 5 <= text.length; i++) {
		if (matchesDataScheme(text, i) && isSchemeBoundary(text, i)) return i;
	}
	return -1;
}

type DataUriEnclosure =
	| { kind: "quote"; close: "\"" | "'" | "`" }
	| { kind: "parentheses" }
	| { kind: "angle" }
	| null;

interface ScannedDataUriCandidate {
	end: number;
	comma: number;
	enclosure: DataUriEnclosure;
}

function dataUriEnclosure(text: string, start: number): DataUriEnclosure {
	if (start === 0) return null;
	const immediateIndex = start - 1;
	const immediate = text[immediateIndex];
	if (immediate === "\"" || immediate === "'" || immediate === "`") {
		const beforeQuote = immediateIndex > 0 ? text[immediateIndex - 1] : "";
		const likelyOpeningQuote = immediateIndex === 0
			|| beforeQuote === "="
			|| beforeQuote === "("
			|| beforeQuote === "["
			|| beforeQuote === "{"
			|| beforeQuote === ":"
			|| beforeQuote === ","
			|| /\s/.test(beforeQuote);
		if (likelyOpeningQuote) return { kind: "quote", close: immediate };
	}

	let openerIndex = immediateIndex;
	while (openerIndex >= 0 && (text[openerIndex] === " " || text[openerIndex] === "\t")) openerIndex--;
	const opener = text[openerIndex];
	if (opener === "(") return { kind: "parentheses" };
	if (opener === "<") return { kind: "angle" };
	return null;
}

function isBareDataUriTerminator(ch: string): boolean {
	const code = ch.charCodeAt(0);
	return code <= 32
		|| code === 127
		|| ch === "\""
		|| ch === "`"
		|| ch === "<"
		|| ch === ">";
}

/** Scan one candidate exactly once. Enclosures consume malformed whitespace and
 * balanced inner parentheses so invalid payload suffixes cannot escape. */
function scanDataUriCandidate(text: string, start: number): ScannedDataUriCandidate {
	const enclosure = dataUriEnclosure(text, start);
	let comma = -1;
	let depth = enclosure?.kind === "parentheses" ? 1 : 0;
	let index = start + 5;

	for (; index < text.length; index++) {
		const ch = text[index];
		if (enclosure?.kind === "quote") {
			if (ch === enclosure.close) break;
		} else if (enclosure?.kind === "parentheses") {
			if (ch === "(") {
				depth++;
			} else if (ch === ")") {
				depth--;
				if (depth === 0) break;
			}
		} else if (enclosure?.kind === "angle") {
			if (ch === ">") break;
		} else if (isBareDataUriTerminator(ch)) {
			break;
		}
		if (comma < 0 && ch === ",") comma = index;
	}

	return { end: index, comma, enclosure };
}

function headerEndsWithBase64(text: string, headerStart: number, comma: number): boolean {
	let end = comma;
	while (end > headerStart && (text[end - 1] === " " || text[end - 1] === "\t")) end--;
	const token = "base64";
	if (end - headerStart < token.length + 1) return false;
	const tokenStart = end - token.length;
	for (let i = 0; i < token.length; i++) {
		if (asciiLowerCode(text.charCodeAt(tokenStart + i)) !== token.charCodeAt(i)) return false;
	}
	return tokenStart > headerStart && text[tokenStart - 1] === ";";
}

function isMimeTokenChar(code: number): boolean {
	if (code < 33 || code > 126) return false;
	// RFC 2045 token = printable ASCII excluding tspecials. Slash is handled
	// separately as the single type/subtype separator.
	switch (code) {
		case 34: // "
		case 40: // (
		case 41: // )
		case 44: // ,
		case 47: // /
		case 58: // :
		case 59: // ;
		case 60: // <
		case 61: // =
		case 62: // >
		case 63: // ?
		case 64: // @
		case 91: // [
		case 92: // backslash
		case 93: // ]
			return false;
		default:
			return true;
	}
}

function normalizeMimeType(text: string, headerStart: number, comma: number): string {
	let end = headerStart;
	while (end < comma && text[end] !== ";") end++;
	if (end === headerStart) return "text/plain";
	if (end - headerStart > MAX_MIME_CHARS) return "application/octet-stream";

	let slashCount = 0;
	for (let i = headerStart; i < end; i++) {
		const code = text.charCodeAt(i);
		if (code === 47) {
			slashCount++;
			if (i === headerStart || i === end - 1) return "application/octet-stream";
			continue;
		}
		if (!isMimeTokenChar(code)) return "application/octet-stream";
	}
	if (slashCount !== 1) return "application/octet-stream";
	return text.slice(headerStart, end).toLowerCase();
}

function hexValue(code: number): number {
	if (code >= 48 && code <= 57) return code - 48;
	if (code >= 65 && code <= 70) return code - 55;
	if (code >= 97 && code <= 102) return code - 87;
	return -1;
}

function decodePercentEncoded(payload: string): { bytes: Buffer } | { error: string } {
	const output = Buffer.allocUnsafe(Buffer.byteLength(payload, "utf8"));
	let outputOffset = 0;
	let cursor = 0;

	while (cursor < payload.length) {
		const percent = payload.indexOf("%", cursor);
		const runEnd = percent < 0 ? payload.length : percent;
		if (runEnd > cursor) {
			const run = Buffer.from(payload.slice(cursor, runEnd), "utf8");
			run.copy(output, outputOffset);
			outputOffset += run.length;
		}
		if (percent < 0) break;
		if (percent + 2 >= payload.length) return { error: "invalid-percent-escape" };
		const high = hexValue(payload.charCodeAt(percent + 1));
		const low = hexValue(payload.charCodeAt(percent + 2));
		if (high < 0 || low < 0) return { error: "invalid-percent-escape" };
		output[outputOffset++] = (high << 4) | low;
		cursor = percent + 3;
	}

	return { bytes: output.subarray(0, outputOffset) };
}

function isBase64AlphabetByte(byte: number): boolean {
	return (byte >= 65 && byte <= 90)
		|| (byte >= 97 && byte <= 122)
		|| (byte >= 48 && byte <= 57)
		|| byte === 43
		|| byte === 47;
}

function decodeBase64Payload(payload: string): { bytes: Buffer } | { error: string } {
	const percentDecoded = decodePercentEncoded(payload);
	if ("error" in percentDecoded) return percentDecoded;
	const encoded = percentDecoded.bytes;
	let paddingStart = encoded.length;
	let paddingCount = 0;

	for (let i = 0; i < encoded.length; i++) {
		const byte = encoded[i];
		if (byte > 127) return { error: "non-ascii-base64" };
		if (byte === 61) {
			if (paddingStart === encoded.length) paddingStart = i;
			paddingCount++;
			continue;
		}
		if (paddingStart !== encoded.length) return { error: "invalid-base64-padding" };
		if (!isBase64AlphabetByte(byte)) return { error: "invalid-base64-character" };
	}

	if (paddingCount > 2) return { error: "invalid-base64-padding" };
	if (paddingCount > 0 && encoded.length % 4 !== 0) return { error: "invalid-base64-padding" };
	if (paddingCount === 0 && encoded.length % 4 === 1) return { error: "invalid-base64-length" };
	if (paddingCount === 1 && paddingStart % 4 !== 3) return { error: "invalid-base64-padding" };
	if (paddingCount === 2 && paddingStart % 4 !== 2) return { error: "invalid-base64-padding" };

	return { bytes: Buffer.from(encoded.toString("ascii"), "base64") };
}

function safeMarkerSource(sourcePath: string): string {
	const source = sourcePath || "value";
	let safe = "";
	for (const ch of source) {
		const code = ch.charCodeAt(0);
		const allowed = (code >= 48 && code <= 57)
			|| (code >= 65 && code <= 90)
			|| (code >= 97 && code <= 122)
			|| ch === "."
			|| ch === "_"
			|| ch === "-"
			|| ch === "["
			|| ch === "]"
			|| ch === "*"
			|| ch === "$";
		safe += allowed ? ch : "_";
	}
	if (safe.length <= MAX_MARKER_SOURCE_CHARS) return safe;
	const suffix = sha256Bytes(source).slice(0, 12);
	return `${safe.slice(0, MAX_MARKER_SOURCE_CHARS - suffix.length - 1)}~${suffix}`;
}

function buildDataUriMarker(omission: DataUriOmission): string {
	const decoded = omission.decodedBytes === null ? "unknown" : String(omission.decodedBytes);
	const decodeError = omission.decodeError ? `; decodeError=${omission.decodeError}` : "";
	return `[pi-web-access inline data URI omitted; ordinal=${omission.ordinal}; source=${omission.sourcePath}; mime=${omission.mimeType}; encoding=${omission.encoding}; encodedBytes=${omission.encodedBytes}; decodedBytes=${decoded}${decodeError}; sha256=${omission.sha256}; digestBasis=${omission.digestBasis}; retrieval=not-retained]`;
}

function sanitizeTextInternal(text: string, sourcePath: string, state: SanitizationState): string {
	let scanFrom = 0;
	let retainedFrom = 0;
	let outputLength = 0;
	const pieces: string[] = [];

	while (scanFrom < text.length) {
		const start = findNextDataScheme(text, scanFrom);
		if (start < 0) break;
		const candidate = scanDataUriCandidate(text, start);
		const end = candidate.end;
		const headerStart = start + 5;
		const missingComma = candidate.comma < 0;
		// A bare prose label such as "data: value" is not an inline URI. Enclosed
		// or non-empty comma-less candidates are malformed URIs and are removed.
		if (missingComma && end === headerStart && candidate.enclosure === null) {
			scanFrom = end;
			continue;
		}
		const headerEnd = missingComma ? end : candidate.comma;
		const headerLength = headerEnd - headerStart;
		const encoding: DataUriEncoding = headerEndsWithBase64(text, headerStart, headerEnd)
			? "base64"
			: "percent-encoded";
		const mimeType = normalizeMimeType(text, headerStart, headerEnd);
		// Without the required comma, the post-scheme bytes are ambiguous. Count
		// and digest the whole omitted segment on the encoded basis rather than
		// retaining any header/payload-looking suffix.
		const payload = missingComma
			? text.slice(headerStart, end)
			: text.slice(candidate.comma + 1, end);
		const encodedBytes = Buffer.byteLength(payload, "utf8");

		let decodedBytes: number | null = null;
		let decodeError: string | undefined;
		let digestBasis: DigestBasis = "encoded";
		let digest = "";

		if (missingComma) {
			decodeError = "missing-comma";
			digest = sha256Bytes(payload);
		} else if (headerLength > MAX_DATA_URI_HEADER_CHARS) {
			decodeError = "header-too-long";
			digest = sha256Bytes(payload);
		} else {
			const decoded = encoding === "base64"
				? decodeBase64Payload(payload)
				: decodePercentEncoded(payload);
			if ("error" in decoded) {
				decodeError = decoded.error;
				digest = sha256Bytes(payload);
			} else {
				decodedBytes = decoded.bytes.length;
				digestBasis = "decoded";
				digest = sha256Bytes(decoded.bytes);
			}
		}

		const omission: DataUriOmission = {
			ordinal: state.nextOrdinal++,
			sourcePath: safeMarkerSource(sourcePath),
			mimeType,
			encoding,
			encodedBytes,
			decodedBytes,
			...(decodeError ? { decodeError } : {}),
			sha256: digest,
			digestBasis,
			retrieval: "not-retained",
		};
		const marker = buildDataUriMarker(omission);
		const prefix = text.slice(retainedFrom, start);
		pieces.push(prefix, marker);
		outputLength += prefix.length;
		const markerStart = outputLength;
		outputLength += marker.length;
		state.omissions.push({ ...omission, markerStart, markerEnd: outputLength });
		retainedFrom = end;
		scanFrom = end;
	}

	if (state.omissions.length === 0 && retainedFrom === 0) return text;
	pieces.push(text.slice(retainedFrom));
	return pieces.join("");
}


/** Replace every recognized RFC 2397-style inline data URI in one string. */
export function sanitizeInlineDataUris(
	text: string,
	sourcePath: string,
): { text: string; omissions: DataUriOmission[] } {
	const state: SanitizationState = { nextOrdinal: 1, omissions: [] };
	const sanitized = sanitizeTextInternal(text, sourcePath, state);
	return {
		text: sanitized,
		omissions: state.omissions.map(({ markerStart: _start, markerEnd: _end, ...omission }) => omission),
	};
}

/** Sanitize every string leaf in a JSON-compatible value with one ordinal sequence. */
