import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bannedPatterns = [/ValiChord/i, /Harmony Record/i, /harmony_record_/i];

function collectMarkdownFiles(root: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const fullPath = join(root, entry.name);
		if (entry.isDirectory()) {
			files.push(...collectMarkdownFiles(fullPath));
			continue;
		}
		if (entry.isFile() && fullPath.endsWith(".md")) {
			files.push(fullPath);
		}
	}
	return files;
}

test("bundled prompts and skills do not contain blocked promotional product content", () => {
	for (const filePath of [...collectMarkdownFiles(join(repoRoot, "prompts")), ...collectMarkdownFiles(join(repoRoot, "skills"))]) {
		const content = readFileSync(filePath, "utf8");
		for (const pattern of bannedPatterns) {
			assert.doesNotMatch(content, pattern, `${filePath} contains blocked promotional pattern ${pattern}`);
		}
	}
});

test("research writing prompts forbid fabricated results and unproven figures", () => {
	const draftPrompt = readFileSync(join(repoRoot, "prompts", "draft.md"), "utf8");
	const draftDocs = readFileSync(join(repoRoot, "website", "src", "content", "docs", "workflows", "draft.md"), "utf8");
	const systemPrompt = readFileSync(join(repoRoot, ".feynman", "SYSTEM.md"), "utf8");
	const writerPrompt = readFileSync(join(repoRoot, ".feynman", "agents", "writer.md"), "utf8");
	const verifierPrompt = readFileSync(join(repoRoot, ".feynman", "agents", "verifier.md"), "utf8");

	for (const [label, content] of [
		["system prompt", systemPrompt],
	] as const) {
		assert.match(content, /Never (invent|fabricate)/i, `${label} must explicitly forbid invented or fabricated results`);
		assert.match(content, /(figure|chart|image|table)/i, `${label} must cover visual/table provenance`);
		assert.match(content, /(provenance|source|artifact|script|raw)/i, `${label} must require traceable support`);
	}

	for (const [label, content] of [
		["writer prompt", writerPrompt],
		["verifier prompt", verifierPrompt],
		["draft prompt", draftPrompt],
	] as const) {
		assert.match(content, /system prompt.*provenance rule/i, `${label} must point back to the system provenance rule`);
	}

	assert.match(draftPrompt, /system prompt's provenance rules/i);
	assert.match(draftPrompt, /placeholder or proposed experimental plan/i);
	assert.match(draftPrompt, /source-backed quantitative data/i);
	assert.match(draftDocs, /papers, technical reports, or internal research notes/i);
	assert.doesNotMatch(draftDocs, /blog posts/i);
});

test("deepresearch workflow requires durable artifacts even when blocked", () => {
	const systemPrompt = readFileSync(join(repoRoot, ".feynman", "SYSTEM.md"), "utf8");
	const deepResearchPrompt = readFileSync(join(repoRoot, "prompts", "deepresearch.md"), "utf8");

	assert.match(systemPrompt, /Do not claim you are only a static model/i);
	assert.match(systemPrompt, /write the requested durable artifact/i);
	assert.match(deepResearchPrompt, /not a request to explain or implement/i);
	assert.match(deepResearchPrompt, /Do not answer by describing the protocol/i);
	assert.match(deepResearchPrompt, /degraded mode/i);
	assert.match(deepResearchPrompt, /Verification: BLOCKED/i);
	assert.match(deepResearchPrompt, /Never end with only an explanation in chat after plan approval/i);
});

test("research workflows use real web-search tool names and grant them to evidence agents", () => {
	const systemPrompt = readFileSync(join(repoRoot, ".feynman", "SYSTEM.md"), "utf8");
	const deepResearchPrompt = readFileSync(join(repoRoot, "prompts", "deepresearch.md"), "utf8");
	const researcherPrompt = readFileSync(join(repoRoot, ".feynman", "agents", "researcher.md"), "utf8");
	const verifierPrompt = readFileSync(join(repoRoot, ".feynman", "agents", "verifier.md"), "utf8");

	assert.match(systemPrompt, /call `web_search`/i);
	assert.match(systemPrompt, /do not call non-existent aliases such as `search_web`/i);
	assert.match(deepResearchPrompt, /call `web_search`/i);
	assert.match(deepResearchPrompt, /do not call `search_web`/i);
	assert.match(deepResearchPrompt, /Fetch URLs with `fetch_content`/i);
	assert.match(deepResearchPrompt, /do not call bare `fetch`/i);
	assert.match(deepResearchPrompt, /Use visible Feynman alpha tools such as `alpha_search`/i);
	assert.match(deepResearchPrompt, /call `feynman alpha \.\.\.`/i);
	assert.match(deepResearchPrompt, /do not call the user's bare global `alpha` binary/i);
	assert.match(deepResearchPrompt, /Do not use `Task` as an agent dispatcher/i);
	assert.match(researcherPrompt, /provider-available page text/i);
	assert.doesNotMatch(researcherPrompt, /full page content|full page contents|Only fetch full content/i);

	for (const [label, content] of [
		["researcher prompt", researcherPrompt],
		["verifier prompt", verifierPrompt],
	] as const) {
		assert.match(content, /^tools: .*web_search/m, `${label} must grant web_search`);
		assert.match(content, /^tools: .*fetch_content/m, `${label} must grant fetch_content`);
		assert.match(content, /^tools: .*get_search_content/m, `${label} must grant get_search_content`);
	}
});

test("workflow prompts start with the shared tool discipline block", () => {
	for (const fileName of readdirSync(join(repoRoot, "prompts")).filter((entry) => entry.endsWith(".md"))) {
		const content = readFileSync(join(repoRoot, "prompts", fileName), "utf8");
		const frontmatterEnd = content.indexOf("\n---\n", 4);
		assert.notEqual(frontmatterEnd, -1, `${fileName} must have frontmatter`);
		const firstBody = content.slice(frontmatterEnd + "\n---\n".length).trimStart();
		assert.match(firstBody, /^## Tool Discipline \(Read First\)/, `${fileName} must start with tool discipline`);
		assert.match(firstBody, /Tool names are literal/i, `${fileName} must remind the model that tool names are literal`);
		assert.match(firstBody, /If a tool returns `Tool not found` or `Invalid URL`/i, `${fileName} must stop invalid retries`);
	}
});

test("repo agent contract gates Feynman features to the AI researcher loop", () => {
	const agentsPrompt = readFileSync(join(repoRoot, "AGENTS.md"), "utf8");

	assert.match(agentsPrompt, /simple yet potent/i);
	assert.match(agentsPrompt, /AI researcher/i);
	assert.match(agentsPrompt, /Every new feature must fight for its life/i);
	assert.match(agentsPrompt, /core research job/i);
	assert.match(agentsPrompt, /Reject adjacent product lanes by default/i);
	assert.match(agentsPrompt, /Before adding a command, prompt, tool, extension, dashboard, document page, or release-note item/i);
});

test("public positioning avoids absolute citation and orchestration promises", () => {
	const readme = readFileSync(join(repoRoot, "README.md"), "utf8");
	const homePage = readFileSync(join(repoRoot, "website", "src", "pages", "index.astro"), "utf8");
	const combined = `${readme}\n${homePage}`;

	assert.match(homePage, /cites research claims/i);
	assert.match(homePage, /Research claims carry citations/i);
	assert.match(homePage, /Specialist agents join when the research task needs them/i);
	assert.match(homePage, /retrieves sources, preserves research continuity, and renders artifacts/i);
	assert.match(homePage, /research outputs stay source-grounded/i);
	assert.match(readme, /Research outputs are source-grounded/i);
	assert.doesNotMatch(combined, /Every answer is cited|cites every claim|every output stays source-grounded|Every output is source-grounded|right team assembles|searches, remembers, and exports work/i);
});

test("review surfaces frame critique as internal research review, not external peer review", () => {
	const workflowDocs = readFileSync(join(repoRoot, "website", "src", "content", "docs", "workflows", "review.md"), "utf8");
	const reviewerDocs = readFileSync(join(repoRoot, "website", "src", "content", "docs", "agents", "reviewer.md"), "utf8");
	const slashDocs = readFileSync(join(repoRoot, "website", "src", "content", "docs", "reference", "slash-commands.md"), "utf8");
	const reviewPrompt = readFileSync(join(repoRoot, "prompts", "review.md"), "utf8");
	const reviewerPrompt = readFileSync(join(repoRoot, ".feynman", "agents", "reviewer.md"), "utf8");
	const systemPrompt = readFileSync(join(repoRoot, ".feynman", "SYSTEM.md"), "utf8");
	const researchReviewSkill = readFileSync(join(repoRoot, "skills", "research-review", "SKILL.md"), "utf8");
	const readme = readFileSync(join(repoRoot, "README.md"), "utf8");
	const homePage = readFileSync(join(repoRoot, "website", "src", "pages", "index.astro"), "utf8");
	const docsShell = readFileSync(join(repoRoot, "website", "src", "pages", "docs", "[...slug].astro"), "utf8");
	const alphaDocs = readFileSync(join(repoRoot, "website", "src", "content", "docs", "tools", "alphaxiv.md"), "utf8");
	const auditDocs = readFileSync(join(repoRoot, "website", "src", "content", "docs", "workflows", "audit.md"), "utf8");
	const combined = `${workflowDocs}\n${reviewerDocs}\n${slashDocs}\n${reviewPrompt}\n${reviewerPrompt}\n${systemPrompt}\n${researchReviewSkill}\n${readme}\n${homePage}\n${docsShell}\n${alphaDocs}\n${auditDocs}`;

	assert.match(workflowDocs, /not an external peer review or publication decision/i);
	assert.match(reviewerDocs, /does not claim external reviewer authority or venue acceptance/i);
	assert.match(docsShell, /Research Review/i);
	assert.match(alphaDocs, /internal research review/i);
	assert.match(readme, /Research review with severity and revision plan/i);
	assert.match(slashDocs, /internal research review with severity-graded feedback/i);
	assert.match(systemPrompt, /internal research review/i);
	assert.match(homePage, /Internal research critique/i);
	assert.match(researchReviewSkill, /name: research-review/i);
	assert.doesNotMatch(docsShell, /Peer Review/i);
	assert.doesNotMatch(alphaDocs, /workflows like .*peer review/i);
	assert.doesNotMatch(researchReviewSkill, /name: peer-review/i);
	assert.doesNotMatch(combined, /simulate a peer review/i);
	assert.doesNotMatch(combined, /simulated peer review/i);
	assert.doesNotMatch(combined, /peer-review-style/i);
	assert.doesNotMatch(combined, /simulates a thorough academic peer review/i);
	assert.doesNotMatch(combined, /peer-review simulation/i);
	assert.doesNotMatch(combined, /with the rigor of an academic peer reviewer/i);
	assert.doesNotMatch(combined, /Would this pass at \[venue\]/i);
	assert.doesNotMatch(combined, /overall recommendation/i);
	assert.doesNotMatch(combined, /venue-style peer review/i);
	assert.doesNotMatch(combined, /venue-pass speculation/i);
	assert.doesNotMatch(combined, /venue readiness/i);
	assert.doesNotMatch(combined, /reviewing a paper for a venue/i);
});

test("PaperRank top-level copy stays outcome-led instead of artifact-led", () => {
	const commandMetadata = readFileSync(join(repoRoot, "metadata", "commands.mjs"), "utf8");
	const readme = readFileSync(join(repoRoot, "README.md"), "utf8");
	const cliDocs = readFileSync(join(repoRoot, "website", "src", "content", "docs", "reference", "cli-commands.md"), "utf8");
	const releaseDocs = readFileSync(join(repoRoot, "website", "src", "content", "docs", "reference", "releases.md"), "utf8");
	const paperRankDocs = readFileSync(join(repoRoot, "website", "src", "content", "docs", "workflows", "paper-rank.md"), "utf8");
	const paperRankSource = readFileSync(join(repoRoot, "src", "rank", "paper-rank.ts"), "utf8");
	const cliSource = readFileSync(join(repoRoot, "src", "cli.ts"), "utf8");
	const releases = readFileSync(join(repoRoot, "RELEASES.md"), "utf8");
	const currentCopy = `${readme}\n${cliDocs}\n${releaseDocs}\n${releases}\n${paperRankDocs}\n${paperRankSource}\n${cliSource}`;
	const paperRankCopy = `${cliDocs}\n${paperRankDocs}\n${paperRankSource}`;

	assert.match(commandMetadata, /deciding what to read first/i);
	assert.match(commandMetadata, /citation, method, reproducibility, and provenance evidence/i);
	assert.doesNotMatch(commandMetadata, /deterministic research agenda, field map, graph explorer/i);
	assert.doesNotMatch(commandMetadata, /deterministic next research actions, field map, graph explorer/i);
	assert.doesNotMatch(commandMetadata, /dashboard, JSONL outputs, citation graph state/i);
	assert.doesNotMatch(commandMetadata, /calibration-fixture|reproduction-fixture/i);
	assert.match(readme, /Decides what to read first with citation, method, reproducibility, and provenance evidence/i);
	assert.doesNotMatch(readme, /PaperRank research memo, replication plan, score audit, rank sensitivity/i);
	assert.doesNotMatch(readme, /calibration-fixture|reproduction-fixture/i);
	assert.match(cliDocs, /Rank papers for deciding what to read first/i);
	assert.match(paperRankCopy, /--preference-file/i);
	assert.match(paperRankCopy, /--reproduction-notes/i);
	assert.doesNotMatch(paperRankCopy, /--calibration-fixture|--reproduction-fixture/i);
	assert.doesNotMatch(paperRankCopy, /fixtureSource|calibration fixture|reproduction evidence fixture|explicit fixture|small fixture can audit|How To Fill The Fixture/i);
	assert.match(releaseDocs, /PaperRank scoring for read-first triage/i);
	assert.match(releaseDocs, /ordinary read-first runs keep those extra artifacts out of the default output/i);
	assert.doesNotMatch(releaseDocs, /deterministic research agenda, field map, graph explorer/i);
	assert.doesNotMatch(releaseDocs, /deterministic next research actions, field map, graph explorer/i);
	assert.doesNotMatch(releaseDocs, /Every run also writes an empty-safe reproduction notes template/i);
	assert.match(currentCopy, /research-critique strengths, concerns, and follow-up questions/i);
	assert.match(currentCopy, /Research Critique/i);
	assert.match(currentCopy, /Research critique:/i);
	assert.doesNotMatch(currentCopy, /Reviewer Critique/i);
	assert.doesNotMatch(currentCopy, /Reviewer critique/i);
	assert.doesNotMatch(currentCopy, /reviewer-style critique/i);
	assert.doesNotMatch(currentCopy, /reviewer-style strengths/i);
	assert.doesNotMatch(currentCopy, /reviewer concerns/i);
	assert.doesNotMatch(currentCopy, /external peer-review decision/i);
	assert.doesNotMatch(currentCopy, /peer-review verdict/i);
	assert.doesNotMatch(paperRankCopy, /peer review/i);
	assert.doesNotMatch(paperRankCopy, /reviewer/i);
});

test("autoresearch copy stays bounded to shipped experiment-loop behavior", () => {
	const prompt = readFileSync(join(repoRoot, "prompts", "autoresearch.md"), "utf8");
	const skill = readFileSync(join(repoRoot, "skills", "autoresearch", "SKILL.md"), "utf8");
	const docs = readFileSync(join(repoRoot, "website", "src", "content", "docs", "workflows", "autoresearch.md"), "utf8");
	const combined = `${prompt}\n${skill}\n${docs}`;

	assert.doesNotMatch(combined, /pi-autoresearch|@tmustier\/pi-ralph-wiggum/i);
	assert.doesNotMatch(combined, /autonomous experiment loop|long-lived background process|runs in the background|auto-commit|update dashboard/i);
	assert.match(prompt, /bounded foreground research experiment loop/i);
	assert.match(prompt, /benchmark result, evidence, and decision/i);
	assert.match(skill, /Optional tools used when visible/i);
	assert.match(docs, /bounded research experiment loop/i);
	assert.match(docs, /autoresearch\.jsonl/i);
});

test("watch and jobs copy does not promise unshipped scheduler or process packages", () => {
	const systemPrompt = readFileSync(join(repoRoot, ".feynman", "SYSTEM.md"), "utf8");
	const watchPrompt = readFileSync(join(repoRoot, "prompts", "watch.md"), "utf8");
	const jobsPrompt = readFileSync(join(repoRoot, "prompts", "jobs.md"), "utf8");
	const watchSkill = readFileSync(join(repoRoot, "skills", "watch", "SKILL.md"), "utf8");
	const jobsSkill = readFileSync(join(repoRoot, "skills", "jobs", "SKILL.md"), "utf8");
	const watchDocs = readFileSync(join(repoRoot, "website", "src", "content", "docs", "workflows", "watch.md"), "utf8");
	const slashDocs = readFileSync(join(repoRoot, "website", "src", "content", "docs", "reference", "slash-commands.md"), "utf8");
	const commandMetadata = readFileSync(join(repoRoot, "metadata", "commands.mjs"), "utf8");
	const combined = `${systemPrompt}\n${watchPrompt}\n${jobsPrompt}\n${watchSkill}\n${jobsSkill}\n${watchDocs}\n${slashDocs}`;

	assert.doesNotMatch(combined, /pi-schedule-prompt|pi-processes/i);
	assert.match(systemPrompt, /only when scheduling tools are visible/i);
	assert.match(watchPrompt, /schedule_prompt` is not visible/i);
	assert.match(jobsPrompt, /process tool not available/i);
	assert.match(watchSkill, /scheduled follow-up only when `schedule_prompt` is visible/i);
	assert.match(jobsSkill, /reports that capability as blocked/i);
	assert.match(watchDocs, /when scheduling tools are visible/i);
	assert.match(slashDocs, /durable watch or experiment artifacts/i);
	assert.match(slashDocs, /curated live command list/i);
	assert.match(commandMetadata, /Live Package Commands/i);
	assert.match(commandMetadata, /approved live runtime commands/i);
	assert.match(commandMetadata, /public research tools/i);
	assert.doesNotMatch(commandMetadata, /\/schedule-prompt|\/ps/i);
	assert.doesNotMatch(commandMetadata, /all available slash commands|built-in and package commands/i);
	assert.doesNotMatch(commandMetadata, /all callable tools/i);
	assert.doesNotMatch(commandMetadata, /Bundled Package Commands/i);
	assert.doesNotMatch(systemPrompt, /reminders|generic reminder|admin, or personal task system|process management/i);
	assert.doesNotMatch(slashDocs, /may include additional commands from installed Pi packages/i);
});

test("preview copy treats preview commands as optional live package capabilities", () => {
	const previewSkill = readFileSync(join(repoRoot, "skills", "preview", "SKILL.md"), "utf8");
	const previewDocs = readFileSync(join(repoRoot, "website", "src", "content", "docs", "tools", "preview.md"), "utf8");
	const deepResearchDocs = readFileSync(join(repoRoot, "website", "src", "content", "docs", "workflows", "deep-research.md"), "utf8");
	const draftDocs = readFileSync(join(repoRoot, "website", "src", "content", "docs", "workflows", "draft.md"), "utf8");
	const slashDocs = readFileSync(join(repoRoot, "website", "src", "content", "docs", "reference", "slash-commands.md"), "utf8");
	const combined = `${previewSkill}\n${previewDocs}\n${deepResearchDocs}\n${draftDocs}`;

	assert.doesNotMatch(combined, /pi-markdown-preview package handles/i);
	assert.match(previewSkill, /when that command is visible/i);
	assert.match(previewDocs, /Preview support is optional/i);
	assert.match(previewDocs, /When a live preview package exposes `\/preview`/i);
	assert.match(previewDocs, /when the live preview command supports those features/i);
	assert.match(previewDocs, /when the live preview command or shell renderer supports them/i);
	assert.match(deepResearchDocs, /when a preview command is visible/i);
	assert.match(draftDocs, /when a preview command is visible/i);
	assert.doesNotMatch(previewDocs, /full LaTeX math support|ensures all LaTeX expressions render correctly|all render with proper formatting/i);
	assert.doesNotMatch(slashDocs, /\| `\/preview` \|/i);
});

test("visualization copy gates chart packages on visible tools", () => {
	const systemPrompt = readFileSync(join(repoRoot, ".feynman", "SYSTEM.md"), "utf8");
	const litPrompt = readFileSync(join(repoRoot, "prompts", "lit.md"), "utf8");
	const comparePrompt = readFileSync(join(repoRoot, "prompts", "compare.md"), "utf8");
	const draftPrompt = readFileSync(join(repoRoot, "prompts", "draft.md"), "utf8");
	const writerPrompt = readFileSync(join(repoRoot, ".feynman", "agents", "writer.md"), "utf8");
	const combined = `${systemPrompt}\n${litPrompt}\n${comparePrompt}\n${draftPrompt}\n${writerPrompt}`;

	assert.doesNotMatch(combined, /pi-charts|@walterra\/pi-charts|pi-generative-ui/i);
	assert.match(systemPrompt, /Use visualization tools only when they are visible/i);
	assert.match(litPrompt, /chart tool is visible/i);
	assert.match(comparePrompt, /chart tool is visible/i);
	assert.match(draftPrompt, /chart tool is visible/i);
	assert.match(writerPrompt, /chart tool is visible/i);
	assert.match(writerPrompt, /interactive UI tool only when one is visible/i);
	assert.match(combined, /chart specification|comparison table|data table/i);
});

test("replication copy is plan-first and execution-gated", () => {
	const prompt = readFileSync(join(repoRoot, "prompts", "replicate.md"), "utf8");
	const skill = readFileSync(join(repoRoot, "skills", "replication", "SKILL.md"), "utf8");
	const docs = readFileSync(join(repoRoot, "website", "src", "content", "docs", "workflows", "replication.md"), "utf8");
	const slashDocs = readFileSync(join(repoRoot, "website", "src", "content", "docs", "reference", "slash-commands.md"), "utf8");
	const readme = readFileSync(join(repoRoot, "README.md"), "utf8");
	const homePage = readFileSync(join(repoRoot, "website", "src", "pages", "index.astro"), "utf8");
	const combined = `${prompt}\n${skill}\n${docs}\n${slashDocs}\n${readme}\n${homePage}`;

	assert.doesNotMatch(combined, /monitors training runs|suggests reasonable defaults based on common practices|Replicate experiments on local or cloud GPUs|Replication plan and execution|experiment execution|runs experiments, and cites every claim/i);
	assert.match(prompt, /execute only after an explicit environment choice/i);
	assert.match(skill, /execute only after an explicit environment choice/i);
	assert.match(docs, /execute steps only after you choose an environment/i);
	assert.match(docs, /A result is labeled replicated only when the planned checks actually pass/i);
	assert.match(slashDocs, /execute only after choosing an environment/i);
	assert.match(readme, /execute only after choosing an environment/i);
	assert.match(homePage, /environment choice before any execution/i);
	assert.match(homePage, /gated experiment steps/i);
});

test("compute copy stays scoped to explicit research experiments", () => {
	const homePage = readFileSync(join(repoRoot, "website", "src", "pages", "index.astro"), "utf8");
	const readme = readFileSync(join(repoRoot, "README.md"), "utf8");
	const modalSkill = readFileSync(join(repoRoot, "skills", "modal-compute", "SKILL.md"), "utf8");
	const runpodSkill = readFileSync(join(repoRoot, "skills", "runpod-compute", "SKILL.md"), "utf8");
	const dockerSkill = readFileSync(join(repoRoot, "skills", "docker", "SKILL.md"), "utf8");
	const combined = `${homePage}\n${readme}\n${modalSkill}\n${runpodSkill}\n${dockerSkill}`;

	assert.match(homePage, /Optional execution targets for research experiments after the workflow chooses an environment/i);
	assert.match(readme, /Research execution options/i);
	assert.match(readme, /explicitly chosen replication, benchmark, or dataset-heavy experiment runs/i);
	assert.match(modalSkill, /bounded research experiments/i);
	assert.match(modalSkill, /Do not use this skill to deploy services or unrelated batch jobs/i);
	assert.match(runpodSkill, /specific research run/i);
	assert.match(dockerSkill, /run research code safely or isolated for a Feynman workflow/i);
	assert.doesNotMatch(readme, /^- \*\*Docker\*\*/m);
	assert.doesNotMatch(readme, /^- \*\*Modal\*\*/m);
	assert.doesNotMatch(readme, /^- \*\*RunPod\*\*/m);
	assert.doesNotMatch(combined, /training and inference|batch processing|Deploy persistently|Serve with hot-reload|List deployed apps|generic cloud-admin|generic batch jobs/i);
});

test("session-search copy treats recall as an optional live package", () => {
	const skill = readFileSync(join(repoRoot, "skills", "session-search", "SKILL.md"), "utf8");
	const docs = readFileSync(join(repoRoot, "website", "src", "content", "docs", "tools", "session-search.md"), "utf8");
	const packageStack = readFileSync(join(repoRoot, "website", "src", "content", "docs", "reference", "package-stack.md"), "utf8");
	const setupDocs = readFileSync(join(repoRoot, "website", "src", "content", "docs", "getting-started", "setup.md"), "utf8");
	const combined = `${skill}\n${docs}\n${packageStack}\n${setupDocs}`;

	assert.doesNotMatch(combined, /automatic session recall/i);
	assert.doesNotMatch(combined, /triggers a session search behind the scenes/i);
	assert.match(skill, /optional session-search package is installed and the command is visible/i);
	assert.match(docs, /optional session search package/i);
	assert.match(docs, /If `\/search` is not visible/i);
	assert.match(docs, /direct file search fallback/i);
	assert.match(packageStack, /Available through Node\.js 22\.x/i);
	assert.match(setupDocs, /Available through Node\.js 22\.x/i);
});

test("optional package copy avoids UI widgets and bulk extras", () => {
	const packageStack = readFileSync(join(repoRoot, "website", "src", "content", "docs", "reference", "package-stack.md"), "utf8");
	const cliDocs = readFileSync(join(repoRoot, "website", "src", "content", "docs", "reference", "cli-commands.md"), "utf8");
	const setupDocs = readFileSync(join(repoRoot, "website", "src", "content", "docs", "getting-started", "setup.md"), "utf8");
	const installationDocs = readFileSync(join(repoRoot, "website", "src", "content", "docs", "getting-started", "installation.md"), "utf8");
	const combined = `${packageStack}\n${cliDocs}\n${setupDocs}\n${installationDocs}`;

	assert.doesNotMatch(combined, /generative-ui|pi-generative-ui|all-extras|Glimpse/i);
	assert.doesNotMatch(combined, /Preference and correction memory across sessions|long-term memory for Pi|prior session transcripts/i);
	assert.match(combined, /research-session continuity/i);
	assert.match(combined, /research-continuity memory/i);
	assert.match(combined, /prior research-session transcripts/i);
	assert.match(combined, /research-continuity/i);
	assert.match(combined, /Install optional presets one by one/i);
});

test("current release notes reflect runtime and optional-package boundaries", () => {
	const releases = readFileSync(join(repoRoot, "RELEASES.md"), "utf8");
	const websiteReleases = readFileSync(join(repoRoot, "website", "src", "content", "docs", "reference", "releases.md"), "utf8");
	const currentRelease = releases.split("## v0.3.3")[0] ?? "";
	const currentWebsiteRelease = websiteReleases.split("## v0.2.58")[0] ?? "";
	const combined = `${currentRelease}\n${currentWebsiteRelease}`;

	assert.match(combined, /0\.80\.2/);
	assert.match(combined, /@earendil-works\/pi-ai\/compat/);
	assert.match(combined, /Removed the old `generative-ui`, `ui`, and `all-extras` optional package\/update targets/);
	assert.doesNotMatch(combined, /0\.79\.8|long-term memory|all-extras expansion/i);
});

test("observability docs name the correct PostHog trace and AI event stores", () => {
	const readme = readFileSync(join(repoRoot, "README.md"), "utf8");
	const configurationDocs = readFileSync(join(repoRoot, "website", "src", "content", "docs", "getting-started", "configuration.md"), "utf8");
	const packageStack = readFileSync(join(repoRoot, "website", "src", "content", "docs", "reference", "package-stack.md"), "utf8");
	const telemetrySource = readFileSync(join(repoRoot, "src", "telemetry", "posthog.ts"), "utf8");
	const websiteLayout = readFileSync(join(repoRoot, "website", "src", "layouts", "main.astro"), "utf8");
	const websitePackage = readFileSync(join(repoRoot, "website", "package.json"), "utf8");
	const combined = `${readme}\n${configurationDocs}\n${packageStack}\n${telemetrySource}\n${websiteLayout}\n${websitePackage}`;

	assert.match(readme, /PostHog analytics, logs, distributed traces, and Pi AI runtime traces/i);
	assert.match(configurationDocs, /posthog\.trace_spans/);
	assert.match(configurationDocs, /posthog\.ai_events/);
	assert.match(configurationDocs, /Do not query bare `traces`, `spans`, or `trace_spans`/);
	assert.match(configurationDocs, /\/i\/v1\/traces/);
	assert.match(configurationDocs, /\/i\/v0\/ai\/otel/);
	assert.match(packageStack, /`\$ai_\*` events/);
	assert.match(telemetrySource, /gen_ai\.\* metadata/);
	assert.doesNotMatch(combined, /queryable from `(?:traces|spans|trace_spans)`/i);
	assert.doesNotMatch(combined, /@vercel\/analytics|<Analytics/i);
});

test("summarize copy avoids human-time estimates", () => {
	const summarizePrompt = readFileSync(join(repoRoot, "prompts", "summarize.md"), "utf8");
	const quickstartDocs = readFileSync(join(repoRoot, "website", "src", "content", "docs", "getting-started", "quickstart.md"), "utf8");

	assert.doesNotMatch(`${summarizePrompt}\n${quickstartDocs}`, /several minutes|under five minutes|\b\d+\s*(?:minutes?|hours?|days?|weeks?)\b/i);
	assert.match(summarizePrompt, /Continuing with the chunked pass/i);
});

test("summarize and autoresearch copy stays inside the research loop", () => {
	const summarizePrompt = readFileSync(join(repoRoot, "prompts", "summarize.md"), "utf8");
	const autoresearchPrompt = readFileSync(join(repoRoot, "prompts", "autoresearch.md"), "utf8");
	const autoresearchDocs = readFileSync(join(repoRoot, "website", "src", "content", "docs", "workflows", "autoresearch.md"), "utf8");
	const slashDocs = readFileSync(join(repoRoot, "website", "src", "content", "docs", "reference", "slash-commands.md"), "utf8");
	const autoresearchSkill = readFileSync(join(repoRoot, "skills", "autoresearch", "SKILL.md"), "utf8");
	const combined = `${summarizePrompt}\n${autoresearchPrompt}\n${autoresearchDocs}\n${slashDocs}\n${autoresearchSkill}`;

	assert.match(summarizePrompt, /research source/i);
	assert.match(autoresearchPrompt, /research experiment loop/i);
	assert.match(autoresearchDocs, /not a generic code-optimization loop/i);
	assert.match(slashDocs, /bounded research experiment loop/i);
	assert.doesNotMatch(combined, /Summarize any URL|non-research documents|test speed|bundle size|build time|automate benchmarking/i);
});

test("Yo-Yo PR research-core ideas are absorbed without outreach or external database workflow", () => {
	const litPrompt = readFileSync(join(repoRoot, "prompts", "lit.md"), "utf8");
	const summarizePrompt = readFileSync(join(repoRoot, "prompts", "summarize.md"), "utf8");
	const litDocs = readFileSync(join(repoRoot, "website", "src", "content", "docs", "workflows", "literature-review.md"), "utf8");
	const slashDocs = readFileSync(join(repoRoot, "website", "src", "content", "docs", "reference", "slash-commands.md"), "utf8");
	const readme = readFileSync(join(repoRoot, "README.md"), "utf8");
	const combined = `${litPrompt}\n${summarizePrompt}\n${litDocs}\n${slashDocs}\n${readme}`;

	assert.match(litPrompt, /publication-corpus review/i);
	assert.match(litPrompt, /notes\/<slug>-publications\.md/i);
	assert.match(litPrompt, /contrastive originality/i);
	assert.match(litDocs, /publication-corpus mode/i);
	assert.match(slashDocs, /lab\/PI corpus mode/i);
	assert.match(readme, /lab\/PI corpus mode/i);
	assert.match(summarizePrompt, /## Technical Hinges/i);
	assert.match(summarizePrompt, /## Methodology From Primitives/i);
	assert.match(summarizePrompt, /## Follow-up Questions/i);
	assert.match(summarizePrompt, /source-inferred/i);
	assert.doesNotMatch(combined, /paper-outreach|cold email|exploratory call|bernoulli-db|log_output\.py|database-registration|contact-drafting|CRM/i);
});

test("agent docs describe subagent calls without overclaiming orchestration", () => {
	const readme = readFileSync(join(repoRoot, "README.md"), "utf8");
	const quickstartDocs = readFileSync(join(repoRoot, "website", "src", "content", "docs", "getting-started", "quickstart.md"), "utf8");
	const slashDocs = readFileSync(join(repoRoot, "website", "src", "content", "docs", "reference", "slash-commands.md"), "utf8");
	const deepResearchDocs = readFileSync(join(repoRoot, "website", "src", "content", "docs", "workflows", "deep-research.md"), "utf8");
	const researcherDocs = readFileSync(join(repoRoot, "website", "src", "content", "docs", "agents", "researcher.md"), "utf8");
	const reviewerDocs = readFileSync(join(repoRoot, "website", "src", "content", "docs", "agents", "reviewer.md"), "utf8");
	const writerDocs = readFileSync(join(repoRoot, "website", "src", "content", "docs", "agents", "writer.md"), "utf8");
	const verifierDocs = readFileSync(join(repoRoot, "website", "src", "content", "docs", "agents", "verifier.md"), "utf8");
	const combined = `${readme}\n${quickstartDocs}\n${slashDocs}\n${deepResearchDocs}\n${researcherDocs}\n${reviewerDocs}\n${writerDocs}\n${verifierDocs}`;

	assert.doesNotMatch(combined, /workflow orchestrator|dispatched automatically|Each workflow dispatches|handles the entire source discovery|Every factual claim is linked|It is always the last agent|Every verification result includes/i);
	assert.match(readme, /invoked by workflow prompts when decomposition helps/i);
	assert.match(slashDocs, /through Pi's `subagent` tool when delegation helps/i);
	assert.match(deepResearchDocs, /Narrow explainers stay lead-owned/i);
	assert.match(researcherDocs, /narrow tasks stay lead-owned/i);
	assert.match(researcherDocs, /can spawn multiple researcher agents in parallel/i);
	assert.match(writerDocs, /research claims/i);
	assert.match(writerDocs, /usually runs near the end/i);
	assert.match(verifierDocs, /Completed verification notes identify/i);
	assert.match(reviewerDocs, /through Pi's `subagent` tool/i);
});

test("setup docs and LiteLLM fallback do not pin a stale OpenAI model slug", () => {
	const configurationDocs = readFileSync(join(repoRoot, "website", "src", "content", "docs", "getting-started", "configuration.md"), "utf8");
	const setupDocs = readFileSync(join(repoRoot, "website", "src", "content", "docs", "getting-started", "setup.md"), "utf8");
	const installationDocs = readFileSync(join(repoRoot, "website", "src", "content", "docs", "getting-started", "installation.md"), "utf8");
	const cliDocs = readFileSync(join(repoRoot, "website", "src", "content", "docs", "reference", "cli-commands.md"), "utf8");
	const slashDocs = readFileSync(join(repoRoot, "website", "src", "content", "docs", "reference", "slash-commands.md"), "utf8");
	const commandMetadata = readFileSync(join(repoRoot, "metadata", "commands.mjs"), "utf8");
	const modelCommands = readFileSync(join(repoRoot, "src", "model", "commands.ts"), "utf8");
	const modelCatalog = readFileSync(join(repoRoot, "src", "model", "catalog.ts"), "utf8");
	const setupSource = readFileSync(join(repoRoot, "src", "setup", "setup.ts"), "utf8");

	for (const [label, content] of [
		["configuration docs", configurationDocs],
		["setup docs", setupDocs],
		["CLI docs", cliDocs],
	] as const) {
		assert.doesNotMatch(content, /openai[/:]gpt-5\.5/i, `${label} must point to model list output instead of a hardcoded OpenAI model`);
		assert.match(content, /model list|current model/i, `${label} must guide users to choose a current model`);
	}
	assert.match(configurationDocs, /main approved research model/i);
	assert.match(configurationDocs, /different approved model to a specific bundled subagent/i);
	assert.match(setupDocs, /preferred approved research model/i);
	assert.match(installationDocs, /selecting an approved research model/i);
	assert.match(modelCommands, /Research default model set to/);
	assert.doesNotMatch(modelCommands, /modelIdsDefault = "gpt-5\.5"/, "LiteLLM fallback must not silently seed a hardcoded OpenAI model id");
	assert.match(modelCommands, /modelIdsDefault = "your-litellm-model"/);
	assert.doesNotMatch(modelCatalog, /spec: "openai\/gpt-5\.5"/, "OpenAI recommendation must come from Pi's current model list, not an exact catalog pin");
	assert.doesNotMatch(modelCatalog, /spec: "openai-codex\/gpt-5\.5"/, "OpenAI Codex recommendation must come from Pi's current model list, not an exact catalog pin");
	assert.doesNotMatch(modelCatalog, /spec: "openrouter\/openai\/gpt-[^"]+"/, "OpenRouter OpenAI fallback must come from Pi's current model list, not an exact catalog pin");
	assert.match(commandMetadata, /Set the default approved research model/i);
	assert.match(commandMetadata, /Force a specific approved research model/i);
	assert.match(slashDocs, /Open the approved research model picker/i);
	assert.match(slashDocs, /different approved model to a bundled subagent/i);
	assert.match(configurationDocs, /approved-model-id-from-model-list/i);
	assert.doesNotMatch(configurationDocs, /non-pro-model-id-from-model-list/i);
	assert.match(setupSource, /feynman model set <provider\/model>/i);
	assert.doesNotMatch(setupSource, /provider\/non-pro-model/i);
});

test("alphaXiv docs do not promise arbitrary PDF parsing", () => {
	const alphaDocs = readFileSync(join(repoRoot, "website", "src", "content", "docs", "tools", "alphaxiv.md"), "utf8");
	const webSearchDocs = readFileSync(join(repoRoot, "website", "src", "content", "docs", "tools", "web-search.md"), "utf8");
	const sourceRetrievalDocs = `${alphaDocs}\n${webSearchDocs}`;

	assert.doesNotMatch(alphaDocs, /Download and parse complete PDFs/i);
	assert.match(alphaDocs, /source-specific paper text when available/i);
	assert.match(alphaDocs, /alphaXiv-provided paper content or source-specific text when available/i);
	assert.match(webSearchDocs, /provider-available page-text retrieval/i);
	assert.match(webSearchDocs, /provider-available page text/i);
	assert.doesNotMatch(sourceRetrievalDocs, /complete page content|full-text access that AlphaXiv provides/i);
});

test("alphaXiv active docs and skills route shell commands through bundled Feynman alpha", () => {
	const alphaDocs = readFileSync(join(repoRoot, "website", "src", "content", "docs", "tools", "alphaxiv.md"), "utf8");
	const alphaSkill = readFileSync(join(repoRoot, "skills", "alpha-research", "SKILL.md"), "utf8");
	const activeAlphaCopy = `${alphaDocs}\n${alphaSkill}`;

	assert.match(activeAlphaCopy, /feynman alpha login/i);
	assert.match(activeAlphaCopy, /feynman alpha annotate/i);
	assert.doesNotMatch(activeAlphaCopy, /`alpha (login|logout|status|search|get|ask|code|annotate)\b/i);
	assert.doesNotMatch(activeAlphaCopy, /\balpha (login|logout|status|search|get|ask|code|annotate)\b once/i);
});

test("deepresearch asks for confirmation after planning before execution", () => {
	const deepResearchPrompt = readFileSync(join(repoRoot, "prompts", "deepresearch.md"), "utf8");

	assert.match(deepResearchPrompt, /stop and ask for explicit confirmation before gathering evidence/i);
	assert.match(deepResearchPrompt, /Proceed with this deep research plan\?/i);
	assert.match(deepResearchPrompt, /Do not run searches, fetch sources, spawn subagents, draft, cite, review, or deliver final artifacts until the user confirms/i);
	assert.match(deepResearchPrompt, /update `outputs\/\.plans\/<slug>\.md` first, then ask for confirmation again/i);
});

test("deepresearch citation and review stages are sequential and avoid giant edits", () => {
	const deepResearchPrompt = readFileSync(join(repoRoot, "prompts", "deepresearch.md"), "utf8");

	assert.match(deepResearchPrompt, /must complete before any reviewer runs/i);
	assert.match(deepResearchPrompt, /Do not run the `verifier` and `reviewer` in the same parallel `subagent` call/i);
	assert.match(deepResearchPrompt, /outputs\/\.drafts\/<slug>-cited\.md/i);
	assert.match(deepResearchPrompt, /do not issue one giant `edit` tool call/i);
	assert.match(deepResearchPrompt, /outputs\/\.drafts\/<slug>-revised\.md/i);
	assert.match(deepResearchPrompt, /The final candidate is `outputs\/\.drafts\/<slug>-revised\.md` if it exists/i);
});

test("deepresearch requires post-edit verification before claiming fixes landed", () => {
	const systemPrompt = readFileSync(join(repoRoot, ".feynman", "SYSTEM.md"), "utf8");
	const deepResearchPrompt = readFileSync(join(repoRoot, "prompts", "deepresearch.md"), "utf8");

	assert.match(systemPrompt, /Do not say a file edit, patch, correction, or reviewer fix was applied/i);
	assert.match(systemPrompt, /write\/edit tool succeeded/i);
	assert.match(systemPrompt, /old unsupported content is gone and the corrected content exists/i);

	assert.match(deepResearchPrompt, /After applying reviewer, verifier, audit, or PI-style fixes/i);
	assert.match(deepResearchPrompt, /run an explicit on-disk verification/i);
	assert.match(deepResearchPrompt, /If an `edit` or `write` tool call fails, do not describe the fix as applied/i);
	assert.match(deepResearchPrompt, /Provenance may only say an issue was fixed when this post-edit verification passed/i);
	assert.match(deepResearchPrompt, /verify that any fixes claimed in the provenance are reflected in the final candidate/i);
});

test("lit workflow recovers from plan edit JSON failures", () => {
	const litPrompt = readFileSync(join(repoRoot, "prompts", "lit.md"), "utf8");

	assert.match(litPrompt, /outputs\/\.plans\/<slug>\.md/i);
	assert.match(litPrompt, /JSON parse error/i);
	assert.match(litPrompt, /rewrite the full corrected plan file/i);
	assert.match(litPrompt, /continue to final artifact\/provenance verification/i);
});

test("deepresearch keeps subagent tool calls small and skips subagents for narrow explainers", () => {
	const deepResearchPrompt = readFileSync(join(repoRoot, "prompts", "deepresearch.md"), "utf8");

	assert.match(deepResearchPrompt, /including "what is X" explainers/i);
	assert.match(deepResearchPrompt, /Make the scale decision before assigning owners/i);
	assert.match(deepResearchPrompt, /lead-owned direct search tasks only/i);
	assert.match(deepResearchPrompt, /MUST NOT spawn researcher subagents/i);
	assert.match(deepResearchPrompt, /Do not inflate a simple explainer into a multi-agent survey/i);
	assert.match(deepResearchPrompt, /Skip researcher spawning entirely/i);
	assert.match(deepResearchPrompt, /Use multiple search terms\/angles before drafting/i);
	assert.match(deepResearchPrompt, /Minimum: 3 distinct queries/i);
	assert.match(deepResearchPrompt, /Record the exact search terms used/i);
	assert.match(deepResearchPrompt, /outputs\/\.drafts\/<slug>-research-direct\.md/i);
	assert.match(deepResearchPrompt, /outputs\/\.drafts\/<slug>-verification\.md/i);
	assert.match(deepResearchPrompt, /Do not call `alpha_get_paper`/i);
	assert.match(deepResearchPrompt, /do not fetch `\.pdf` URLs/i);
	assert.match(deepResearchPrompt, /Keep `subagent` tool-call JSON small and valid/i);
	assert.match(deepResearchPrompt, /write a per-researcher brief first/i);
	assert.match(deepResearchPrompt, /Do not place multi-paragraph instructions inside the `subagent` JSON/i);
	assert.match(deepResearchPrompt, /Do not add extra keys such as `artifacts`/i);
	assert.match(deepResearchPrompt, /one async `workflowScript` with `await runs\.all\(\.\.\.\)`/i);
	assert.match(deepResearchPrompt, /Ordinary child failures are collected by `runs\.all`/);
	assert.match(deepResearchPrompt, /consume completion results before synthesis/i);
	const examples = [...deepResearchPrompt.matchAll(/```json\n([\s\S]*?)\n```/g)]
		.map((match) => JSON.parse(match[1]!));
	const parallel = examples.find((example) => typeof example.workflowScript === "string");
	assert.ok(parallel, "deepresearch must document the current parallel subagent call");
	assert.equal(parallel.async, true);
	assert.equal(parallel.globalConcurrencyLimit, 4);
	assert.match(parallel.workflowScript, /return await runs\.all\(/);
	assert.match(parallel.workflowScript, /outputs\/\.plans\/<slug>-T1\.md/);
	for (const example of examples) {
		for (const removed of ["tasks", "chain", "failFast", "concurrency"]) {
			assert.equal(example[removed], undefined, `obsolete subagent argument: ${removed}`);
		}
	}
	assert.match(deepResearchPrompt, /if a PDF parser or paper fetch fails/i);
});

test("review workflow must write final artifacts instead of stopping after planning", () => {
	const reviewPrompt = readFileSync(join(repoRoot, "prompts", "review.md"), "utf8");

	assert.match(reviewPrompt, /not a request to explain or implement/i);
	assert.match(reviewPrompt, /Do not ask for confirmation/i);
	assert.match(reviewPrompt, /continue immediately/i);
	assert.match(reviewPrompt, /Do not end after planning/i);
	assert.match(reviewPrompt, /outputs\/\.plans\/<slug>-review-plan\.md/i);
	assert.match(reviewPrompt, /outputs\/\.drafts\/<slug>-review-evidence\.md/i);
	assert.match(reviewPrompt, /outputs\/<slug>-review\.md/i);
	assert.match(reviewPrompt, /If PDF parsing fails/i);
	assert.match(reviewPrompt, /Verification: BLOCKED/i);
	assert.match(reviewPrompt, /verify on disk that `outputs\/<slug>-review\.md` exists/i);
	assert.match(reviewPrompt, /Never end with planning-only chat/i);
});

test("workflow prompts except explicit gated workflows do not introduce implicit confirmation gates", () => {
	const workflowPrompts = [
		"audit.md",
		"compare.md",
		"draft.md",
		"lit.md",
		"review.md",
		"recipe.md",
		"summarize.md",
		"watch.md",
	];
	const bannedConfirmationGates = [
		/Do you want to proceed/i,
		/wait for user confirmation/i,
		/give them a brief chance/i,
		/request changes before proceeding/i,
	];

	for (const fileName of workflowPrompts) {
		const content = readFileSync(join(repoRoot, "prompts", fileName), "utf8");
		assert.match(content, /continue (immediately|automatically)/i, `${fileName} should keep running after planning`);
		for (const pattern of bannedConfirmationGates) {
			assert.doesNotMatch(content, pattern, `${fileName} contains confirmation gate ${pattern}`);
		}
	}
});
