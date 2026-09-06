export const PI_SUBAGENTS_NATIVE_VERSION: string;
export const PI_SUBAGENTS_NATIVE_MARKER: string;
export const PI_SUBAGENTS_NATIVE_EXTRA_TARGETS: string[];
export function patchPiSubagentsNativeSource(relativePath: string, source: string): string | undefined;
export function isPiSubagentsNativeSource(readSource: (relativePath: string) => string): boolean;
export function assertPiSubagentsNativeSources(readSource: (relativePath: string) => string, label?: string): void;
