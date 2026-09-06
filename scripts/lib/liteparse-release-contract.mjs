export const FEYNMAN_LITEPARSE_GIT_HEAD =
	"b2e76ec5b0c1cb4eb11d67296e916792f4fb5858";
export const FEYNMAN_LITEPARSE_VERSION = "2.14.3";
export const FEYNMAN_LITEPARSE_INTEGRITY =
	"sha512-6gf70TDkNcu2lsYS5RAz+jl3lpwHKf8ppXyUb1PAFAF8BVW8Zg71ncvrkLMh3CYXF16kGO7p1Scymzpvmht0IQ==";
export const FEYNMAN_LITEPARSE_NATIVE_INTEGRITIES = Object.freeze({
	"@llamaindex/liteparse-darwin-arm64":
		"sha512-7ZQOXqw2l5PvzB+1fPQH7COLprYHLzqGm5i851Wy2ME2+mmnxJ3d+WKfNIavMOUWur7ZfibZXcHbgxDvWf3CLw==",
	"@llamaindex/liteparse-darwin-x64":
		"sha512-AUPTqFnXUX59hyQe1SaH3D6m9eYXt3v91UZR4VX9f3SFQ+VmBbqlAixCz9ROoSPH3SpQA9tQ2yUDdqEbJFNBlA==",
	"@llamaindex/liteparse-linux-arm64-gnu":
		"sha512-cH3disYDVroH0CMbt0PYDebZGh7RZbqteGd6wkuVbsLhAWesxpKLlW/L4cXHRDvxHN2mejW371Yn5EutP3fBOg==",
	"@llamaindex/liteparse-linux-x64-gnu":
		"sha512-DVJF6s8RP2Uiy/MuitQ4makPRKwG6QClvUIOssszkWsMVCoJi0DDTAhgCBElIzjZAQ02EcobtGyY3hRQzIckRQ==",
	"@llamaindex/liteparse-linux-x64-musl":
		"sha512-a8qH2DuTodTWJll0Frvb6KZcgc+fwoSbCTz/w/Djg/IzaZyGBuV+ixYNxMq4/jLy/FK5om8Yg+8QJcBEvVkJtA==",
	"@llamaindex/liteparse-win32-arm64-msvc":
		"sha512-Vw6pocE4Cn370F04C+wuxm7LJ+YR9YVi+GT0V6EzgsFGzuKIzHgT79Iika4j/8l6wW+gbJGlM7A3w9ZnAeH4vw==",
	"@llamaindex/liteparse-win32-x64-msvc":
		"sha512-rLlXkt/v1C8e9J3yWLhbuXFKPSa4t3yqZdUrbCSpqwG/tkpLdR+FkseWDmHN7UqSLWEJA26T50WFb/YLss/rBA==",
});
export const FEYNMAN_LITEPARSE_NATIVE_PACKAGES = Object.freeze(
	Object.keys(FEYNMAN_LITEPARSE_NATIVE_INTEGRITIES),
);
export const FEYNMAN_LITEPARSE_NATIVE_PLATFORMS = Object.freeze({
	"@llamaindex/liteparse-darwin-arm64": { cpu: ["arm64"], os: ["darwin"] },
	"@llamaindex/liteparse-darwin-x64": { cpu: ["x64"], os: ["darwin"] },
	"@llamaindex/liteparse-linux-arm64-gnu": {
		cpu: ["arm64"],
		os: ["linux"],
		libc: ["glibc"],
	},
	"@llamaindex/liteparse-linux-x64-gnu": {
		cpu: ["x64"],
		os: ["linux"],
		libc: ["glibc"],
	},
	"@llamaindex/liteparse-linux-x64-musl": {
		cpu: ["x64"],
		os: ["linux"],
		libc: ["musl"],
	},
	"@llamaindex/liteparse-win32-arm64-msvc": { cpu: ["arm64"], os: ["win32"] },
	"@llamaindex/liteparse-win32-x64-msvc": { cpu: ["x64"], os: ["win32"] },
});

const LITEPARSE_NATIVE_PACKAGE_PREFIX = "@llamaindex/liteparse-";
const LOCK_PACKAGE_PREFIX = "node_modules/";
const EXPECTED_NATIVE_PACKAGES = FEYNMAN_LITEPARSE_NATIVE_PACKAGES.toSorted();
const EXPECTED_LITEPARSE_URL =
	`https://registry.npmjs.org/@llamaindex/liteparse/-/liteparse-${FEYNMAN_LITEPARSE_VERSION}.tgz`;

function lockPackageNames(packagePath) {
	const normalizedPath = packagePath.startsWith(LOCK_PACKAGE_PREFIX)
		? packagePath.slice(LOCK_PACKAGE_PREFIX.length)
		: packagePath;
	return normalizedPath === "" ? [] : normalizedPath.split(`/${LOCK_PACKAGE_PREFIX}`);
}

function verifyLiteparseNativeOptionalDependencies(manifest, fail, label) {
	const nativePackages = Object.keys(manifest?.optionalDependencies ?? {})
		.filter((packageName) => packageName.startsWith(LITEPARSE_NATIVE_PACKAGE_PREFIX))
		.sort();
	if (JSON.stringify(nativePackages) !== JSON.stringify(EXPECTED_NATIVE_PACKAGES)) {
		fail(`${label} LiteParse does not declare exactly the reviewed seven native packages`);
	}
	for (const packageName of FEYNMAN_LITEPARSE_NATIVE_PACKAGES) {
		if (manifest?.optionalDependencies?.[packageName] !== FEYNMAN_LITEPARSE_VERSION) {
			fail(`${label} LiteParse optional package ${packageName} is not ${FEYNMAN_LITEPARSE_VERSION}`);
		}
	}
}

function verifyLiteparseNativeLockEntries(lock, fail, label) {
	const nativePackages = Object.keys(lock.packages ?? {})
		.flatMap(lockPackageNames)
		.filter((packageName) => packageName.startsWith(LITEPARSE_NATIVE_PACKAGE_PREFIX))
		.sort();
	if (JSON.stringify(nativePackages) !== JSON.stringify(EXPECTED_NATIVE_PACKAGES)) {
		fail(`${label} does not lock exactly the reviewed seven native LiteParse packages`);
	}
	for (const packageName of FEYNMAN_LITEPARSE_NATIVE_PACKAGES) {
		const entry = lock.packages?.[`node_modules/${packageName}`];
		const platform = FEYNMAN_LITEPARSE_NATIVE_PLATFORMS[packageName];
		if (
			entry?.version !== FEYNMAN_LITEPARSE_VERSION ||
			entry?.resolved !==
				`https://registry.npmjs.org/${packageName}/-/${packageName.slice("@llamaindex/".length)}-${FEYNMAN_LITEPARSE_VERSION}.tgz` ||
			entry?.integrity !== FEYNMAN_LITEPARSE_NATIVE_INTEGRITIES[packageName] ||
			entry?.optional !== true ||
			JSON.stringify(entry.cpu) !== JSON.stringify(platform.cpu) ||
			JSON.stringify(entry.os) !== JSON.stringify(platform.os) ||
			JSON.stringify(entry.libc) !== JSON.stringify(platform.libc)
		) {
			fail(`${label} does not resolve exact ${packageName}@${FEYNMAN_LITEPARSE_VERSION}`);
		}
	}
}

function verifyLiteparseLockEntry(lock, fail, label) {
	const entry = lock.packages?.["node_modules/@llamaindex/liteparse"];
	if (
		entry?.version !== FEYNMAN_LITEPARSE_VERSION ||
		entry?.resolved !== EXPECTED_LITEPARSE_URL ||
		entry?.integrity !== FEYNMAN_LITEPARSE_INTEGRITY
	) {
		fail(`${label} does not resolve exact LiteParse ${FEYNMAN_LITEPARSE_VERSION}`);
	}
	verifyLiteparseManifestContract(entry, fail, label);
}

export function verifyLiteparseManifestContract(manifest, fail, label) {
	if (manifest.version !== FEYNMAN_LITEPARSE_VERSION) {
		fail(`${label} LiteParse is not ${FEYNMAN_LITEPARSE_VERSION}`);
	}
	verifyLiteparseNativeOptionalDependencies(manifest, fail, label);
}

export function verifyLiteparseRootManifestContract(rootManifest, fail) {
	verifyLiteparseNativeOptionalDependencies(rootManifest, fail, "package.json");
}

export function verifyLiteparseRootLockContract(rootLock, fail) {
	verifyLiteparseNativeOptionalDependencies(
		rootLock.packages?.[""],
		fail,
		"package-lock.json",
	);
	verifyLiteparseNativeLockEntries(rootLock, fail, "package-lock.json");
}

export function verifyLiteparseRuntimeLockContract(runtimeLock, fail) {
	verifyLiteparseLockEntry(runtimeLock, fail, "committed runtime lock");
	verifyLiteparseNativeLockEntries(runtimeLock, fail, "committed runtime lock");
}
