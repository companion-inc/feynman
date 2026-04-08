/**
 * Type declarations for pi-web-access-patch.mjs
 */

/**
 * List of files in pi-web-access that need to be patched.
 */
export const PI_WEB_ACCESS_PATCH_TARGETS: string[];

/**
 * Patch pi-web-access source code to use Feynman's config paths.
 *
 * @param relativePath - The file path relative to pi-web-access root
 * @param source - The source code content
 * @returns The patched source code
 */
export function patchPiWebAccessSource(relativePath: string, source: string): string;
