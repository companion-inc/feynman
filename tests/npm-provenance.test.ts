import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { resolveVerifiedNpmSourceCommit } from "../scripts/lib/npm-provenance.mjs";
import type { NpmProvenanceExpectation } from "../scripts/lib/npm-provenance.mjs";

const name = "@companion-ai/feynman";
const version = "0.3.6";
const commit = "ccc8030c1090efb6afab8c4f907115309d1eb788";
// This real certificate belongs to a pre-transfer release. Never rewrite its identity.
const repository = "https://github.com/companion-inc/feynman";
const workflowPath = ".github/workflows/publish.yml";
const ref = "refs/heads/main";
const digest = Buffer.alloc(64, 7);
const integrity = `sha512-${digest.toString("base64")}`;
const invocationId =
	`${repository}/actions/runs/30367434326/attempts/1`;
const certificate = readFileSync(
	new URL("./fixtures/npm-provenance-0.3.6.der", import.meta.url),
).toString("base64");

function auditFixture(overrides: {
	name?: string;
	version?: string;
	commit?: string;
	repository?: string;
	workflowPath?: string;
	ref?: string;
	digest?: string;
	invocationId?: string;
	certificate?: string | null;
	verified?: boolean;
} = {}) {
	// Synthetic npm-trusted envelope for identity unit tests only. This helper
	// does NOT verify signatures or turn a raw registry attestation into proof.
	const packageName = overrides.name ?? name;
	const packageVersion = overrides.version ?? version;
	const sourceRepository = overrides.repository ?? repository;
	const sourceRef = overrides.ref ?? ref;
	const statement = {
		_type: "https://in-toto.io/Statement/v1",
		subject: [
			{
				name: `pkg:npm/${packageName.replace(/^@/, "%40")}@${packageVersion}`,
				digest: { sha512: overrides.digest ?? digest.toString("hex") },
			},
		],
		predicateType: "https://slsa.dev/provenance/v1",
		predicate: {
			buildDefinition: {
				buildType:
					"https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1",
				externalParameters: {
					workflow: {
						ref: sourceRef,
						repository: sourceRepository,
						path: overrides.workflowPath ?? workflowPath,
					},
				},
				resolvedDependencies: [
					{
						uri: `git+${sourceRepository}@${sourceRef}`,
						digest: { gitCommit: overrides.commit ?? commit },
					},
				],
			},
			runDetails: {
				metadata: {
					invocationId: overrides.invocationId ?? invocationId,
				},
			},
		},
	};
	const entry = {
		name: packageName,
		version: packageVersion,
		registry: "https://registry.npmjs.org/",
		attestationBundles: [
			{
				predicateType: "https://slsa.dev/provenance/v1",
				bundle: {
					verificationMaterial: {
						certificate:
							overrides.certificate === null
								? undefined
								: { rawBytes: overrides.certificate ?? certificate },
					},
					dsseEnvelope: {
						payload: Buffer.from(JSON.stringify(statement)).toString("base64"),
					},
				},
			},
		],
	};
	return {
		invalid: overrides.verified === false ? [entry] : [],
		missing: [],
		verified: overrides.verified === false ? [] : [entry],
	};
}

const expected = {
	name,
	version,
	integrity,
	repository,
	workflowPath,
	ref,
};

const immutableCommit = "2288a6bcc89bca2a6278d19caba9f13e9a3c66bb";
const immutableRepository = "https://github.com/advaitpaliwal/feynman";
// Extracted unchanged from the public 0.3.48 SLSA attestation certificate.
// This DER fixture is identity evidence, NOT an npm audit signatures result.
// Raw input SHA-256: b1395ab580243a63b4cfb60c9d41dec9e3596ff9f8558ea202b672caab962668
const immutableCertificate = readFileSync(
	new URL("./fixtures/npm-provenance-0.3.48.der", import.meta.url),
);
const immutableExpected = {
	...expected,
	name: "@advaitpaliwal/feynman",
	version: "0.3.48",
	repository: immutableRepository,
	repositoryOwnerId: "66044327",
	repositoryId: "1186559664",
};
const immutableSubject =
	"repo:advaitpaliwal@66044327/feynman@1186559664:ref:refs/heads/main";

function immutableAudit(overrides: Parameters<typeof auditFixture>[0] = {}) {
	return auditFixture({
		name: immutableExpected.name,
		version: immutableExpected.version,
		repository: immutableRepository,
		commit: immutableCommit,
		invocationId: `${immutableRepository}/actions/runs/34014649826/attempts/1`,
		certificate: immutableCertificate.toString("base64"),
		...overrides,
	});
}

test("resolves the source commit from npm-verified SLSA provenance", () => {
	assert.equal(resolveVerifiedNpmSourceCommit(auditFixture(), expected), commit);
});

test("historical and immutable certificate fixtures retain their exact signed bytes", () => {
	assert.equal(createHash("sha256").update(Buffer.from(certificate, "base64")).digest("hex"),
		"f2f0dcbe8b42ea4df7e1696d98898a9f90e0fc05bc7894e1ad0f23dd47f2728f");
	assert.equal(createHash("sha256").update(immutableCertificate).digest("hex"),
		"182846c9b658f87e716de561fdec094d21e9c7957d111a41e88e5fb2222c6ae0");
	assert.ok(immutableCertificate.includes(Buffer.from(immutableSubject)));
});

test("real immutable certificate identity resolves only with both explicit exact IDs", () => {
	assert.equal(resolveVerifiedNpmSourceCommit(immutableAudit(), immutableExpected), immutableCommit);
	for (const ids of [
		{ repositoryOwnerId: undefined, repositoryId: undefined },
		{ repositoryOwnerId: undefined },
		{ repositoryId: undefined },
		{ repositoryOwnerId: "66044328" },
		{ repositoryId: "1186559665" },
		{ repositoryOwnerId: "1186559664", repositoryId: "66044327" },
	]) {
		assert.throws(() => resolveVerifiedNpmSourceCommit(immutableAudit(), {
			...immutableExpected, ...ids,
		}), /feynman npm provenance/, JSON.stringify(ids));
	}
	// Supplying IDs tightens the policy: no fallback to a legacy name-only cert.
	assert.throws(() => resolveVerifiedNpmSourceCommit(auditFixture(), {
		...expected,
		repositoryOwnerId: immutableExpected.repositoryOwnerId,
		repositoryId: immutableExpected.repositoryId,
	}), /certificate extension 1\.3\.6\.1\.4\.1\.57264\.1\.24/);
	assert.equal(resolveVerifiedNpmSourceCommit(auditFixture(), expected), commit);
});

test("repository ID expectations are paired positive decimal strings, never coerced or wildcarded", () => {
	for (const key of ["repositoryOwnerId", "repositoryId"] as const) {
		for (const value of [
			"", "0", "00", "01", "-1", "+1", "1.0", "1e3", "1_000",
			" 66044327", "66044327 ", "66044327\n", "66044327\r\n",
			"*", "[0-9]+", "１２３", null, 66044327, true,
		]) {
			assert.throws(() => resolveVerifiedNpmSourceCommit(immutableAudit(), {
				...immutableExpected, [key]: value,
			} as unknown as NpmProvenanceExpectation), /must be a positive decimal string/,
			`${key}=${JSON.stringify(value)}`);
		}
	}
});

test("immutable subject still binds exact owner/name/IDs/ref, not just an arbitrary numeric suffix", () => {
	for (const subject of [
		immutableSubject.replace("advaitpaliwal", "xdvaitpaliwal"),
		immutableSubject.replace("feynman", "feynmam"),
		immutableSubject.replace("66044327", "66044328"),
		immutableSubject.replace("1186559664", "1186559665"),
		immutableSubject.replace("main", "maim"),
	]) {
		// Equal-length DER mutation isolates the subject extension while keeping
		// SAN/issuer/workflow/SHA unchanged. Its signature is intentionally invalid;
		// this synthetic trusted-audit test exercises identity rejection only.
		const mutated = Buffer.from(immutableCertificate);
		const offset = mutated.indexOf(Buffer.from(immutableSubject));
		assert.ok(offset >= 0);
		assert.equal(Buffer.byteLength(subject), Buffer.byteLength(immutableSubject));
		mutated.write(subject, offset, "utf8");
		assert.throws(() => resolveVerifiedNpmSourceCommit(immutableAudit({
			certificate: mutated.toString("base64"),
		}), immutableExpected), /certificate extension 1\.3\.6\.1\.4\.1\.57264\.1\.24/);
	}
});

test("immutable IDs cannot authorize renamed owners/repos or changed workflow/ref/source metadata", () => {
	for (const changedRepository of [
		"https://github.com/companion-inc/feynman",
		"https://github.com/advaitpaliwal/renamed",
		"https://github.com/AdvaitPaliwal/feynman",
	]) {
		assert.throws(() => resolveVerifiedNpmSourceCommit(immutableAudit({
			repository: changedRepository,
			invocationId: `${changedRepository}/actions/runs/34014649826/attempts/1`,
		}), { ...immutableExpected, repository: changedRepository }), /subject alternative name/);
	}
	for (const [field, value] of [
		["workflowPath", ".github/workflows/other.yml"],
		["ref", "refs/heads/release"],
	] as const) {
		assert.throws(() => resolveVerifiedNpmSourceCommit(immutableAudit({
			[field]: value,
		}), { ...immutableExpected, [field]: value }), /subject alternative name/);
	}
	for (const audit of [
		immutableAudit({ verified: false }),
		immutableAudit({ commit: "a".repeat(40) }),
		immutableAudit({ invocationId: `${immutableRepository}/actions/runs/34014649826/attempts/2` }),
		immutableAudit({ digest: "0".repeat(128) }),
		immutableAudit({ certificate: null }),
		immutableAudit({ name: "@companion-ai/feynman" }),
	]) {
		assert.throws(() => resolveVerifiedNpmSourceCommit(audit, immutableExpected), /feynman npm provenance/);
	}
});

test("raw attestation bundles never substitute for npm's verified signature results", () => {
	const synthetic = immutableAudit();
	const bundles = synthetic.verified[0].attestationBundles;
	for (const audit of [
		{ attestations: bundles },
		{ verified: [], missing: [], invalid: [], attestations: bundles },
		{ ...synthetic, missing: synthetic.verified },
		{ ...synthetic, invalid: synthetic.verified },
	]) {
		assert.throws(() => resolveVerifiedNpmSourceCommit(audit, immutableExpected), /feynman npm provenance/);
	}
});

test("CLI passes optional exact IDs after ref and keeps legacy argument compatibility", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-immutable-oidc-"));
	try {
		const path = join(root, "synthetic-audit.json");
		const args = (expectation: NpmProvenanceExpectation) => [
			"scripts/verify-npm-provenance.mjs", path, expectation.name, expectation.version,
			expectation.integrity, expectation.repository, expectation.workflowPath, ref,
		];
		writeFileSync(path, JSON.stringify(immutableAudit()));
		const base = args(immutableExpected);
		const invoke = (parameters: string[]) => spawnSync(process.execPath, parameters, { encoding: "utf8" });
		const valid = invoke([...base, immutableExpected.repositoryOwnerId, immutableExpected.repositoryId]);
		assert.equal(valid.status, 0, valid.stderr);
		assert.equal(valid.stdout, `${immutableCommit}\n`);
		for (const suffix of [
			[], ["66044327"], ["66044328", "1186559664"],
			["66044327", "1186559665"], ["", "1186559664"],
			["66044327", "1186559664", "unexpected"],
		]) {
			const result = invoke([...base, ...suffix]);
			assert.notEqual(result.status, 0);
			assert.equal(result.stdout, "");
		}
		writeFileSync(path, JSON.stringify(auditFixture()));
		for (const parameters of [args(expected), args(expected).slice(0, -1)]) {
			const legacy = invoke(parameters);
			assert.equal(legacy.status, 0, legacy.stderr);
			assert.equal(legacy.stdout, `${commit}\n`);
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a repository transfer does not authorize old-owner provenance for new releases", () => {
	const transferredRepository = "https://github.com/advaitpaliwal/feynman";
	assert.throws(
		() => resolveVerifiedNpmSourceCommit(auditFixture(), {
			...expected,
			repository: transferredRepository,
		}),
		/feynman npm provenance/,
	);
	assert.throws(
		() => resolveVerifiedNpmSourceCommit(auditFixture({
			repository: transferredRepository,
			invocationId: invocationId.replace(repository, transferredRepository),
		}), { ...expected, repository: transferredRepository }),
		/feynman npm provenance/,
	);
});

test("a package scope migration does not authorize old-package provenance", () => {
	assert.throws(
		() => resolveVerifiedNpmSourceCommit(auditFixture(), {
			...expected,
			name: "@advaitpaliwal/feynman",
		}),
		/feynman npm provenance/,
	);
});

test("rejects unverified, wrong-package, and wrong-source provenance", () => {
	for (const audit of [
		auditFixture({ verified: false }),
		auditFixture({ digest: "0".repeat(128) }),
		auditFixture({ repository: "https://github.com/example/feynman" }),
		auditFixture({ workflowPath: ".github/workflows/other.yml" }),
		auditFixture({ ref: "refs/heads/release" }),
		auditFixture({ commit: "not-a-git-commit" }),
		auditFixture({ commit: "a".repeat(40) }),
		auditFixture({
			invocationId: `${repository}/actions/runs/30367434326/attempts/2`,
		}),
		auditFixture({ certificate: null }),
	]) {
		assert.throws(
			() => resolveVerifiedNpmSourceCommit(audit, expected),
			/feynman npm provenance/,
		);
	}
});
