import { X509Certificate } from "node:crypto";

const SLSA_PROVENANCE_V1 = "https://slsa.dev/provenance/v1";
const GITHUB_WORKFLOW_BUILD_V1 =
	"https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1";
const GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
const GITHUB_CERTIFICATE_OIDS = {
	issuerV2: "1.3.6.1.4.1.57264.1.8",
	workflowRefV2: "1.3.6.1.4.1.57264.1.18",
	workflowShaV2: "1.3.6.1.4.1.57264.1.19",
	triggerV2: "1.3.6.1.4.1.57264.1.20",
	invocationV2: "1.3.6.1.4.1.57264.1.21",
	visibilityV2: "1.3.6.1.4.1.57264.1.22",
	subjectV2: "1.3.6.1.4.1.57264.1.24",
};

function fail(message) {
	throw new Error(`[feynman npm provenance] ${message}`);
}

function packagePurl(name, version) {
	const encodedName = name.startsWith("@") ? `%40${name.slice(1)}` : name;
	return `pkg:npm/${encodedName}@${version}`;
}

function sha512Hex(integrity) {
	const match = /^sha512-([A-Za-z0-9+/]+={0,2})$/.exec(integrity);
	if (!match) {
		fail(`unsupported package integrity: ${integrity}`);
	}
	const digest = Buffer.from(match[1], "base64");
	if (digest.length !== 64) {
		fail(`package integrity is not a SHA-512 digest: ${integrity}`);
	}
	return digest.toString("hex");
}

function decodePayload(bundle) {
	const encoded = bundle?.bundle?.dsseEnvelope?.payload;
	if (typeof encoded !== "string" || encoded.length === 0) {
		fail("verified SLSA bundle has no DSSE payload");
	}
	try {
		return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
	} catch (error) {
		fail(`verified SLSA payload is not valid JSON: ${error.message}`);
	}
}

function readDerNode(source, offset) {
	if (!Buffer.isBuffer(source) || offset < 0 || offset >= source.length) {
		fail("certificate contains an invalid DER node offset");
	}
	const start = offset;
	const tag = source[offset];
	offset += 1;
	if ((tag & 0x1f) === 0x1f) {
		fail("certificate uses an unsupported high-tag-number DER node");
	}
	if (offset >= source.length) {
		fail("certificate contains a truncated DER length");
	}
	let length = source[offset];
	offset += 1;
	if (length === 0x80) {
		fail("certificate uses an unsupported indefinite DER length");
	}
	if ((length & 0x80) !== 0) {
		const lengthBytes = length & 0x7f;
		if (lengthBytes === 0 || lengthBytes > 4 || offset + lengthBytes > source.length) {
			fail("certificate contains an invalid DER length");
		}
		length = 0;
		for (let index = 0; index < lengthBytes; index += 1) {
			length = length * 256 + source[offset + index];
		}
		offset += lengthBytes;
	}
	const contentEnd = offset + length;
	if (contentEnd > source.length) {
		fail("certificate contains a truncated DER value");
	}
	return {
		tag,
		start,
		contentStart: offset,
		contentEnd,
		end: contentEnd,
	};
}

function readDerChildren(source, parent) {
	if ((parent.tag & 0x20) === 0) {
		fail("certificate DER container is not constructed");
	}
	const children = [];
	let offset = parent.contentStart;
	while (offset < parent.contentEnd) {
		const child = readDerNode(source, offset);
		if (child.end > parent.contentEnd) {
			fail("certificate DER child escapes its parent");
		}
		children.push(child);
		offset = child.end;
	}
	if (offset !== parent.contentEnd) {
		fail("certificate DER children do not fill their parent");
	}
	return children;
}

function decodeDerOid(source) {
	if (!Buffer.isBuffer(source) || source.length === 0) {
		fail("certificate contains an empty extension OID");
	}
	const values = [];
	let value = 0;
	for (const byte of source) {
		if (value > Number.MAX_SAFE_INTEGER / 128) {
			fail("certificate extension OID is too large");
		}
		value = value * 128 + (byte & 0x7f);
		if ((byte & 0x80) === 0) {
			values.push(value);
			value = 0;
		}
	}
	if (value !== 0 || values.length === 0) {
		fail("certificate contains an invalid extension OID");
	}
	const first = Math.min(2, Math.floor(values[0] / 40));
	const second = values[0] - first * 40;
	return [first, second, ...values.slice(1)].join(".");
}

function readCertificateExtensions(certificate) {
	const root = readDerNode(certificate, 0);
	if (root.tag !== 0x30 || root.end !== certificate.length) {
		fail("certificate is not one complete DER sequence");
	}
	const certificateParts = readDerChildren(certificate, root);
	const tbsCertificate = certificateParts[0];
	if (tbsCertificate?.tag !== 0x30) {
		fail("certificate has no TBSCertificate sequence");
	}
	const extensionsContainer = readDerChildren(certificate, tbsCertificate).find(
		(node) => node.tag === 0xa3,
	);
	if (!extensionsContainer) {
		fail("certificate has no X.509 extensions");
	}
	const extensionsContainerParts = readDerChildren(certificate, extensionsContainer);
	if (
		extensionsContainerParts.length !== 1 ||
		extensionsContainerParts[0].tag !== 0x30
	) {
		fail("certificate has an invalid X.509 extensions container");
	}

	const extensions = new Map();
	for (const extension of readDerChildren(
		certificate,
		extensionsContainerParts[0],
	)) {
		if (extension.tag !== 0x30) {
			fail("certificate contains an invalid X.509 extension");
		}
		const parts = readDerChildren(certificate, extension);
		if (parts.length < 2 || parts.length > 3 || parts[0].tag !== 0x06) {
			fail("certificate contains an invalid X.509 extension sequence");
		}
		const value = parts.at(-1);
		if (value.tag !== 0x04) {
			fail("certificate extension value is not an octet string");
		}
		const oid = decodeDerOid(
			certificate.subarray(parts[0].contentStart, parts[0].contentEnd),
		);
		if (extensions.has(oid)) {
			fail(`certificate repeats extension ${oid}`);
		}
		extensions.set(
			oid,
			certificate.subarray(value.contentStart, value.contentEnd),
		);
	}
	return extensions;
}

function decodeExtensionText(source, oid) {
	let textBytes = source;
	if (source[0] === 0x0c || source[0] === 0x13 || source[0] === 0x16) {
		const textNode = readDerNode(source, 0);
		if (textNode.end !== source.length) {
			fail(`certificate extension ${oid} has trailing DER data`);
		}
		textBytes = source.subarray(textNode.contentStart, textNode.contentEnd);
	}
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(textBytes);
	} catch (error) {
		fail(`certificate extension ${oid} is not valid UTF-8: ${error.message}`);
	}
}

function requireCertificateExtension(extensions, oid, expected) {
	const source = extensions.get(oid);
	if (!source) {
		fail(`certificate is missing required extension ${oid}`);
	}
	const actual = decodeExtensionText(source, oid);
	if (actual !== expected) {
		fail(`certificate extension ${oid} is ${actual}, not ${expected}`);
	}
}

function githubRepositorySlug(repository) {
	const match = /^https:\/\/github\.com\/([^/]+\/[^/]+)$/.exec(repository);
	if (!match) {
		fail(`unsupported GitHub repository URL: ${repository}`);
	}
	return match[1];
}

function githubOidcSubject(repository, ref, repositoryOwnerId, repositoryId) {
	const slug = githubRepositorySlug(repository);
	if (repositoryOwnerId === undefined && repositoryId === undefined) {
		return `repo:${slug}:ref:${ref}`;
	}
	for (const [key, value] of Object.entries({ repositoryOwnerId, repositoryId })) {
		if (
			typeof value !== "string" ||
			value !== value.trim() ||
			!/^[1-9][0-9]*$/.test(value)
		) {
			fail(`${key} must be a positive decimal string; supply both repository IDs or neither`);
		}
	}
	const [owner, name] = slug.split("/");
	// IDs come only from the caller's trusted expectations, never the attestation.
	// Explicit immutable expectations must not fall back to a name-only subject.
	return `repo:${owner}@${repositoryOwnerId}/${name}@${repositoryId}:ref:${ref}`;
}

function assertGitHubCertificateIdentity(bundle, expected) {
	const encodedCertificate =
		bundle?.bundle?.verificationMaterial?.certificate?.rawBytes;
	if (typeof encodedCertificate !== "string" || encodedCertificate.length === 0) {
		fail("verified SLSA bundle has no signing certificate");
	}
	const certificateBytes = Buffer.from(encodedCertificate, "base64");
	let certificate;
	try {
		certificate = new X509Certificate(certificateBytes);
	} catch (error) {
		fail(`verified SLSA signing certificate is invalid: ${error.message}`);
	}

	const workflowIdentity =
		`${expected.repository}/${expected.workflowPath}@${expected.ref}`;
	const expectedSubjectAltName = `URI:${workflowIdentity}`;
	if (certificate.subjectAltName !== expectedSubjectAltName) {
		fail(
			`certificate subject alternative name is ${certificate.subjectAltName}, not ${expectedSubjectAltName}`,
		);
	}

	const extensions = readCertificateExtensions(certificateBytes);
	requireCertificateExtension(
		extensions,
		GITHUB_CERTIFICATE_OIDS.issuerV2,
		GITHUB_OIDC_ISSUER,
	);
	requireCertificateExtension(
		extensions,
		GITHUB_CERTIFICATE_OIDS.workflowRefV2,
		workflowIdentity,
	);
	requireCertificateExtension(
		extensions,
		GITHUB_CERTIFICATE_OIDS.workflowShaV2,
		expected.commit,
	);
	requireCertificateExtension(
		extensions,
		GITHUB_CERTIFICATE_OIDS.triggerV2,
		"push",
	);
	requireCertificateExtension(
		extensions,
		GITHUB_CERTIFICATE_OIDS.invocationV2,
		expected.invocationId,
	);
	requireCertificateExtension(
		extensions,
		GITHUB_CERTIFICATE_OIDS.visibilityV2,
		"public",
	);
	requireCertificateExtension(
		extensions,
		GITHUB_CERTIFICATE_OIDS.subjectV2,
		expected.oidcSubject,
	);
}

export function resolveVerifiedNpmSourceCommit(audit, expected) {
	const {
		name,
		version,
		integrity,
		repository,
		workflowPath,
		ref = "refs/heads/main",
		registry = "https://registry.npmjs.org/",
		repositoryOwnerId,
		repositoryId,
	} = expected;
	if (!name || !version || !integrity || !repository || !workflowPath) {
		fail("name, version, integrity, repository, and workflowPath are required");
	}
	const oidcSubject = githubOidcSubject(repository, ref, repositoryOwnerId, repositoryId);

	const invalid = Array.isArray(audit?.invalid) ? audit.invalid : [];
	const missing = Array.isArray(audit?.missing) ? audit.missing : [];
	for (const entry of [...invalid, ...missing]) {
		if (entry?.name === name && entry?.version === version) {
			fail(`${name}@${version} did not pass npm signature verification`);
		}
	}

	const verified = Array.isArray(audit?.verified) ? audit.verified : [];
	const packageEntry = verified.find(
		(entry) =>
			entry?.name === name &&
			entry?.version === version &&
			entry?.registry === registry,
	);
	if (!packageEntry) {
		fail(`${name}@${version} is absent from npm's verified signature results`);
	}

	const expectedSubject = packagePurl(name, version);
	const expectedDigest = sha512Hex(integrity);
	const expectedDependencyUri = `git+${repository}@${ref}`;
	const expectedInvocationPrefix = `${repository}/actions/runs/`;
	const commits = new Set();

	for (const bundle of packageEntry.attestationBundles ?? []) {
		if (bundle?.predicateType !== SLSA_PROVENANCE_V1) continue;
		const statement = decodePayload(bundle);
		if (
			statement?._type !== "https://in-toto.io/Statement/v1" ||
			statement?.predicateType !== SLSA_PROVENANCE_V1
		) {
			continue;
		}
		const subject = statement.subject?.find(
			(candidate) =>
				candidate?.name === expectedSubject &&
				candidate?.digest?.sha512 === expectedDigest,
		);
		if (!subject) continue;

		const buildDefinition = statement.predicate?.buildDefinition;
		const workflow = buildDefinition?.externalParameters?.workflow;
		if (
			buildDefinition?.buildType !== GITHUB_WORKFLOW_BUILD_V1 ||
			workflow?.repository !== repository ||
			workflow?.path !== workflowPath ||
			workflow?.ref !== ref
		) {
			continue;
		}
		const source = buildDefinition?.resolvedDependencies?.find(
			(dependency) => dependency?.uri === expectedDependencyUri,
		);
		const commit = source?.digest?.gitCommit;
		const invocationId = statement.predicate?.runDetails?.metadata?.invocationId;
		if (
			typeof commit !== "string" ||
			!/^[a-f0-9]{40}$/.test(commit) ||
			typeof invocationId !== "string" ||
			!invocationId.startsWith(expectedInvocationPrefix)
		) {
			continue;
		}
		assertGitHubCertificateIdentity(bundle, {
			repository,
			workflowPath,
			ref,
			commit,
			invocationId,
			oidcSubject,
		});
		commits.add(commit);
	}

	if (commits.size !== 1) {
		fail(
			`${name}@${version} has ${commits.size} verified matching source commits`,
		);
	}
	return [...commits][0];
}
