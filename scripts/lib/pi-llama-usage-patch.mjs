export const PI_LLAMA_USAGE_REQUIRED_VERSION = "0.85.1";
export const PI_LLAMA_USAGE_PATCH_MARKER =
	"Feynman Pi 0.84.2 llama.cpp cached usage migration";

const STATIC_USAGE_REQUIRED = "            supportsUsageInStreaming: true,";
const MODEL_FACTORY_ANCHOR = "function toPiModel(model, serverUrl) {";
const REPAIR_HELPER = `// ${PI_LLAMA_USAGE_PATCH_MARKER}
// Pi PR #7258 fixes new catalogs, while this repair also upgrades cached
// models-store.json entries created before the upstream change.
function repairFeynmanLlamaUsage(model) {
    return model.provider === LLAMA_PROVIDER_ID &&
        model.api === "openai-completions" &&
        model.compat?.supportsUsageInStreaming !== true
        ? { ...model, compat: { ...model.compat, supportsUsageInStreaming: true } }
        : model;
}
`;
const STORED_MODELS_ORIGINAL = `            if (context.stored) {
                const restored = context.stored.models.filter((model) => model.provider === LLAMA_PROVIDER_ID && model.api === "openai-completions");
                if (!(await context.publish({
                    update: () => {
                        models = restored;
                    },
                }))) {
                    return;
                }
            }`;
const STORED_MODELS_PATCHED = `            if (context.stored) {
                const repairedStoredModels = context.stored.models.map(repairFeynmanLlamaUsage);
                const restored = repairedStoredModels.filter((model) => model.provider === LLAMA_PROVIDER_ID && model.api === "openai-completions");
                const repaired = repairedStoredModels.some((model, index) => model !== context.stored.models[index]);
                if (!(await context.publish({
                    ...(repaired ? { persist: { ...context.stored, models: repairedStoredModels } } : {}),
                    update: () => {
                        models = restored;
                    },
                }))) {
                    return;
                }
            }`;

export const PI_LLAMA_USAGE_REQUIRED_FRAGMENTS = Object.freeze([
	PI_LLAMA_USAGE_PATCH_MARKER,
	REPAIR_HELPER.trimEnd(),
	STATIC_USAGE_REQUIRED,
	STORED_MODELS_PATCHED,
]);

const ORDERED_FRAGMENTS = Object.freeze([
	REPAIR_HELPER.trimEnd(),
	MODEL_FACTORY_ANCHOR,
	STATIC_USAGE_REQUIRED,
	STORED_MODELS_PATCHED,
]);

function replaceRequired(source, original, replacement, label) {
	const first = source.indexOf(original);
	if (first === -1 || source.indexOf(original, first + original.length) !== -1) {
		throw new Error(`Unsupported Pi ${PI_LLAMA_USAGE_REQUIRED_VERSION} llama.cpp layout: ${label}`);
	}
	return source.slice(0, first) + replacement + source.slice(first + original.length);
}

export function assertPiLlamaUsageVersion(version, surface) {
	if (version !== PI_LLAMA_USAGE_REQUIRED_VERSION) {
		throw new Error(
			`Pi llama.cpp usage patch ${surface} expected ${PI_LLAMA_USAGE_REQUIRED_VERSION}, found ${version ?? "unknown"}`,
		);
	}
}

export function assertPiLlamaUsagePatchSource(source, surface = "llama.cpp provider") {
	for (const fragment of PI_LLAMA_USAGE_REQUIRED_FRAGMENTS) {
		if (!source.includes(fragment)) {
			throw new Error(`Incomplete Pi llama.cpp usage patch ${surface}: missing ${fragment}`);
		}
	}
	let previousIndex = -1;
	for (const fragment of ORDERED_FRAGMENTS) {
		const index = source.indexOf(fragment);
		if (index <= previousIndex) {
			throw new Error(`Incomplete Pi llama.cpp usage patch ${surface}: out of order ${fragment}`);
		}
		previousIndex = index;
	}
	const staticUsageIndex = source.indexOf(STATIC_USAGE_REQUIRED);
	if (
		staticUsageIndex === -1 ||
		source.indexOf(STATIC_USAGE_REQUIRED, staticUsageIndex + STATIC_USAGE_REQUIRED.length) !== -1
	) {
		throw new Error(
			`Incomplete Pi llama.cpp usage patch ${surface}: expected exactly one upstream streaming usage capability`,
		);
	}
}

/**
 * Pi 0.84.2 includes PR #7258 for newly discovered llama.cpp models, but
 * existing models-store.json entries preserve the old false capability.
 * Remove this patch after a supported Pi release repairs or invalidates stale
 * llama.cpp model metadata.
 */
export function patchPiLlamaUsageSource(source) {
	if (source.includes(PI_LLAMA_USAGE_PATCH_MARKER)) {
		assertPiLlamaUsagePatchSource(source);
		return source;
	}
	const staticUsageIndex = source.indexOf(STATIC_USAGE_REQUIRED);
	if (
		staticUsageIndex === -1 ||
		source.indexOf(STATIC_USAGE_REQUIRED, staticUsageIndex + STATIC_USAGE_REQUIRED.length) !== -1
	) {
		throw new Error(
			`Unsupported Pi ${PI_LLAMA_USAGE_REQUIRED_VERSION} llama.cpp layout: upstream streaming usage capability was not found exactly once`,
		);
	}
	let patched = replaceRequired(
		source,
		MODEL_FACTORY_ANCHOR,
		`${REPAIR_HELPER}${MODEL_FACTORY_ANCHOR}`,
		"model factory anchor was not found",
	);
	patched = replaceRequired(
		patched,
		STORED_MODELS_ORIGINAL,
		STORED_MODELS_PATCHED,
		"stored model repair anchor was not found",
	);
	assertPiLlamaUsagePatchSource(patched);
	return patched;
}
