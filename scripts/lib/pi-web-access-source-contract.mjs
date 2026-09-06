import { createHash } from "node:crypto";

const BASELINE_SHA256 = Object.freeze({
	"index.ts": "afa4d45481b0451ce85fadde6f89a112bc141d714cc164819dd835af320de8a9",
	"extract.ts": "abe0f451639199e7e0ebe83646ab0ed4f197cd2cb9c3634e10d77f90a029896b",
	"fetch-params.ts": "7a6f75acf5d9379c370da9dc0f438b04d783f2efe50e87beb7840a42137af7ac",
	"firecrawl.ts": "152de3a293ed233a61001f27934bd807b39088ab76a952bee3c6fdcfd2564411",
	"ssrf-protection.ts": "c8280208780f19a2d66a0c9a04d2feb674f8baa813e6b88a1b12cd53675f71aa",
	"chrome-cookies.ts": "d69f91df6ef0e1768fc487c49c1056c3601b798989143eda95b0eefa8e3e108b",
	"data-uri-sanitize.ts": "2f63c0b0b5009eb9b92ca27d041707c3f7d0d0042ea0ee8a921ad0813f332ec0",
	"credential-source.ts": "444c45e61a943aac5a8c3b03bb55e19066a96f0c162560041e3e35cdb464c05f",
	"curator-page.ts": "8db3148a9eb6b957a649fe5c3553a144e943340e8bdb4e0193d56c36617d16c2",
	"curator-server.ts": "7e125f3251c2b22abe2ad707411e6245073f9cc02ce5c62bce2ef1d6af619841",
	"feature-config.ts": "207dc9f392086474b7759a5fc9c36b0540096359d367f213f198bab39fd258bf",
	"page-query.ts": "aaa9591d9dd04df4ea303a0b21b4e0f063e524dc4765401423c2e5062b55cdca",
	"storage.ts": "89ee6ff204ceb108a7d619f4a207819f774bd829a7f80d6ccd1a780009ea012f",
	"summary-model-scope.ts": "f9700d39a7e4f6a128f05f78c7df2630c70f3362930f12df560c3d6c7bdd5adb",
	"summary-review.ts": "57a56bc0dd3ba1c785a64b1fb375a1c5ed8b4182a4aca739fb482d862c2189d9",
	"exa.ts": "350b058f92422a485dab7ab9adefbeb0cc79f2aa67f1e299d5c2cb71a586a0ee",
	"gemini-api.ts": "dd5b853d2bba02ced7284b74dac1bcf1f11bb0bf99067d7eaf5d970fc6f86599",
	"gemini-adc.ts": "bbd7b8dc6913265597af61246157eb80a5dc8605095d503859a8f13f87de33fc",
	"gemini-search.ts": "d18586fff284f0ef07f1af5fcfe3cc00a3280b5ccd0a9beab97e2bfcd5e739cc",
	"gemini-url-context.ts": "3f37b5480d964937b2228d95b61a3a95639e9ca5a1afbea4f2f0f2885ff512fa",
	"gemini-web-config.ts": "a1c408a3cef6127a3818d776d7b66240e17b2509475c1a9eaa29102340d476ef",
	"gemini-web.ts": "4664f38e8f344ac501db87aa89bbb1e9e208f775f000305d3ee48a7778fc78c8",
	"github-api.ts": "ae3aa01a7fc5b490a40477c9ed63edfb696ef9f467776051e8823d509cb36ceb",
	"github-extract.ts": "d9223b81821d8b314de7c7dd8d3a5d415d1123b2a871cca2ddccdd8e0d0c513c",
	"github-issue-pr.ts": "6c902662f16f36867bb36a56c451fd4a32920f8d1851392f19f3e88f60cf717d",
	"kimi-search.ts": "129868f4a983890511f9f95cc42ae9b63723cddbda696d72216db283a05de817",
	"openai-search.ts": "9eec8e91a8935d70bb9119dffe18e97b90dd14cae89df2ae1700cbe457a73640",
	"perplexity.ts": "bc62caec8ec97511cf8fe5b97a2c99f189ffdaac5199828921219d4c701b3963",
	"pdf-extract.ts": "e7dfd6dda9887373a40b815e2d60a7f0e96fd1a1950a7e4f0c9c9e1657fe3170",
	"video-extract.ts": "c5eea57652efe02c70a7ebaf9e32cce72ebe9a41c06573061cd94211ec73e843",
	"youtube-extract.ts": "7ac867dc1f343cf10929331e80a0d6c85df267ec2572685441e879797c4d762a",
	"utils.ts": "7907938efddc4b2cacf83734400f522749f484d8e26c053248ee40de6143853c",
	"xai-search.ts": "612c4bfa38ffe3a117614b5cd98ce8449400c60283fc5871d03cf962e4664683",
	"mistral-search.ts": "574a3286437c505ca80678f0c1ca7b9bac6035005c8c522f4dbbe30e09b778a8",
	"xcrawl.ts": "940fe187dad6e5dce9cc9318a1f32de54bf691988065a2d6d9e260e8097933de"
});

const PATCHED_SHA256 = Object.freeze({
	"index.ts": "c1559209a47a7dbf61acd6bb2f0b014f33a02b740f292f1bacfbe2d99272b5a4",
	"extract.ts": "abe0f451639199e7e0ebe83646ab0ed4f197cd2cb9c3634e10d77f90a029896b",
	"fetch-params.ts": "7a6f75acf5d9379c370da9dc0f438b04d783f2efe50e87beb7840a42137af7ac",
	"firecrawl.ts": "79409f4fe09e23ed17d27a4254b753e758fe5d80855ad8c451367a10ef798bb8",
	"ssrf-protection.ts": "0fc6169c9e52c26049d2dc3972614249018c6199cbc1f111db7096e7df64b82e",
	"chrome-cookies.ts": "eed7b4488bee4fcedaa7007edfc387ce01491500566e54140273de958d65f9da",
	"data-uri-sanitize.ts": "2f63c0b0b5009eb9b92ca27d041707c3f7d0d0042ea0ee8a921ad0813f332ec0",
	"credential-source.ts": "444c45e61a943aac5a8c3b03bb55e19066a96f0c162560041e3e35cdb464c05f",
	"curator-page.ts": "8db3148a9eb6b957a649fe5c3553a144e943340e8bdb4e0193d56c36617d16c2",
	"curator-server.ts": "7e125f3251c2b22abe2ad707411e6245073f9cc02ce5c62bce2ef1d6af619841",
	"feature-config.ts": "207dc9f392086474b7759a5fc9c36b0540096359d367f213f198bab39fd258bf",
	"page-query.ts": "bc6bfc85c3224417828c0668b32faf8085c2c8e48acd4270a5e7c4577d29204e",
	"storage.ts": "471c9bf444b48775e9571c53f447e222f1b19b0185efdacab6058d6be7e77a2b",
	"summary-model-scope.ts": "2d4bfbfc4c13236706ed363f58a947d9dc3c57f95f103b5e3bd918bdd54e87e9",
	"summary-review.ts": "e98d088d33f97103a15b87107a8a84682678e03815755a7423c5f468c869e4b4",
	"exa.ts": "350b058f92422a485dab7ab9adefbeb0cc79f2aa67f1e299d5c2cb71a586a0ee",
	"gemini-api.ts": "dd5b853d2bba02ced7284b74dac1bcf1f11bb0bf99067d7eaf5d970fc6f86599",
	"gemini-adc.ts": "67cc59b11ad48bc6ad518354c02d2d02fd5dd05054acb13741589c90f4abac51",
	"gemini-search.ts": "6dcdba9122fb9e2442ddc33abb6b88cd7203654dd4b2b9f4fa69519079773e9b",
	"gemini-url-context.ts": "3f37b5480d964937b2228d95b61a3a95639e9ca5a1afbea4f2f0f2885ff512fa",
	"gemini-web-config.ts": "4349ab62928c62b64e1ae4c928dede30e752b3b22216c78d0e0445949956cf46",
	"gemini-web.ts": "4664f38e8f344ac501db87aa89bbb1e9e208f775f000305d3ee48a7778fc78c8",
	"github-api.ts": "49f032ba2266fe6bacd9bcabb897266dd32f12db3ec703eae1c3822f52282dd5",
	"github-extract.ts": "f63451cb3b169b56ebae4416ed3889a412949735baefed4553dd2153060fdf92",
	"github-issue-pr.ts": "62564a9f591c4d41b1be926963a2333f4f417a669f015c8c76e902adaed583ec",
	"kimi-search.ts": "129868f4a983890511f9f95cc42ae9b63723cddbda696d72216db283a05de817",
	"openai-search.ts": "9eec8e91a8935d70bb9119dffe18e97b90dd14cae89df2ae1700cbe457a73640",
	"perplexity.ts": "bc62caec8ec97511cf8fe5b97a2c99f189ffdaac5199828921219d4c701b3963",
	"pdf-extract.ts": "3e58267784031daaf4ed0bf3eaa99a668235d9bdffd754991a451083e2754f30",
	"video-extract.ts": "c5eea57652efe02c70a7ebaf9e32cce72ebe9a41c06573061cd94211ec73e843",
	"youtube-extract.ts": "7ac867dc1f343cf10929331e80a0d6c85df267ec2572685441e879797c4d762a",
	"utils.ts": "9f0238ba4c35e79fcf05d9b89a21df58a7494f9139ff724def33eb677d3b3857",
	"xai-search.ts": "612c4bfa38ffe3a117614b5cd98ce8449400c60283fc5871d03cf962e4664683",
	"mistral-search.ts": "574a3286437c505ca80678f0c1ca7b9bac6035005c8c522f4dbbe30e09b778a8",
	"xcrawl.ts": "940fe187dad6e5dce9cc9318a1f32de54bf691988065a2d6d9e260e8097933de"
});
// No historical partial states are authorized for the newly reviewed release.
const KNOWN_PARTIAL_SHA256 = Object.freeze({});

function digest(source) {
	return createHash("sha256")
		.update(source.replace(/\r\n/g, "\n"))
		.digest("hex");
}

function assertKnownTargets(targets) {
	const expected = Object.keys(BASELINE_SHA256);
	if (
		targets.length !== expected.length ||
		targets.some((target, index) => target !== expected[index])
	) {
		throw new Error("pi-web-access 0.28.0 source contract target order drifted");
	}
}

export function assertPiWebAccessReviewedSources(
	sources,
	targets,
	surface = "source tree",
) {
	assertKnownTargets(targets);
	for (const relativePath of targets) {
		const source = sources.get(relativePath);
		if (typeof source !== "string") {
			throw new Error(`Unsupported pi-web-access 0.28.0 ${surface}: missing ${relativePath}`);
		}
		const sourceDigest = digest(source);
		if (
			sourceDigest !== BASELINE_SHA256[relativePath] &&
			sourceDigest !== PATCHED_SHA256[relativePath] &&
			!(KNOWN_PARTIAL_SHA256[relativePath] ?? []).includes(sourceDigest)
		) {
			throw new Error(
				`Unsupported pi-web-access 0.28.0 ${surface} ${relativePath}: unreviewed digest ${sourceDigest}`,
			);
		}
	}
}

export function assertPiWebAccessPatchedDigests(
	sources,
	targets,
	surface = "patched source tree",
) {
	assertKnownTargets(targets);
	for (const relativePath of targets) {
		const sourceDigest = digest(sources.get(relativePath) ?? "");
		if (sourceDigest !== PATCHED_SHA256[relativePath]) {
			throw new Error(
				`Incomplete pi-web-access 0.28.0 ${surface} ${relativePath}: expected ${PATCHED_SHA256[relativePath]}, found ${sourceDigest}`,
			);
		}
	}
}
