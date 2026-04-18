import {
	askPaper,
	annotatePaper,
	clearPaperAnnotation,
	getPaper,
	listPaperAnnotations,
	readPaperCode,
	searchPapers,
} from "@companion-ai/alpha-hub/lib";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

import { extractPaperSections } from "./alpha-sections.js";

function formatText(value: unknown): string {
	if (typeof value === "string") return value;
	return JSON.stringify(value, null, 2);
}

export function registerAlphaTools(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "alpha_search",
		label: "Alpha Search",
		description:
			"Search research papers through alphaXiv. Modes: semantic (default, use 2-3 sentence queries), keyword (exact terms), agentic (broad multi-turn retrieval), both, or all.",
		parameters: Type.Object({
			query: Type.String({ description: "Search query." }),
			mode: Type.Optional(
				Type.String({ description: "Search mode: semantic, keyword, both, agentic, or all." }),
			),
		}),
		async execute(_toolCallId, params) {
			const result = await searchPapers(params.query, params.mode?.trim() || "semantic");
			return { content: [{ type: "text", text: formatText(result) }], details: result };
		},
	});

	pi.registerTool({
		name: "alpha_get_paper",
		label: "Alpha Get Paper",
		description:
			"Fetch a paper's AI-generated report (or raw full text) plus any local annotation. Optional section filters return only requested sections when detectable.",
		parameters: Type.Object({
			paper: Type.String({ description: "arXiv ID, arXiv URL, or alphaXiv URL." }),
			fullText: Type.Optional(Type.Boolean({ description: "Return raw full text instead of AI report." })),
			section: Type.Optional(
				Type.String({
					description:
						"Single section to extract from content: abstract, introduction, methodology, experiments, results, discussion, limitations, or conclusion.",
				}),
			),
			sections: Type.Optional(
				Type.Array(
					Type.String({
						description:
							"Multiple sections to extract from content. Supported values: abstract, introduction, methodology, experiments, results, discussion, limitations, conclusion.",
					}),
				),
			),
		}),
		async execute(_toolCallId, params) {
			const result = await getPaper(params.paper, { fullText: params.fullText });
			const extracted = extractPaperSections(result.content, params.section, params.sections);
			const filteredResult = extracted.requested.length
				? {
						...result,
						content: Object.keys(extracted.selected).length > 0 ? extracted.selected : result.content,
						requestedSections: extracted.requested,
						missingSections: extracted.missing,
				  }
				: result;
			return { content: [{ type: "text", text: formatText(filteredResult) }], details: filteredResult };
		},
	});

	pi.registerTool({
		name: "alpha_ask_paper",
		label: "Alpha Ask Paper",
		description: "Ask a targeted question about a paper. Uses AI to analyze the PDF and answer.",
		parameters: Type.Object({
			paper: Type.String({ description: "arXiv ID, arXiv URL, or alphaXiv URL." }),
			question: Type.String({ description: "Question about the paper." }),
		}),
		async execute(_toolCallId, params) {
			const result = await askPaper(params.paper, params.question);
			return { content: [{ type: "text", text: formatText(result) }], details: result };
		},
	});

	pi.registerTool({
		name: "alpha_annotate_paper",
		label: "Alpha Annotate Paper",
		description: "Write or clear a persistent local annotation for a paper.",
		parameters: Type.Object({
			paper: Type.String({ description: "Paper ID (arXiv ID or URL)." }),
			note: Type.Optional(Type.String({ description: "Annotation text. Omit when clear=true." })),
			clear: Type.Optional(Type.Boolean({ description: "Clear the existing annotation." })),
		}),
		async execute(_toolCallId, params) {
			const result = params.clear
				? await clearPaperAnnotation(params.paper)
				: params.note
					? await annotatePaper(params.paper, params.note)
					: (() => { throw new Error("Provide either note or clear=true."); })();
			return { content: [{ type: "text", text: formatText(result) }], details: result };
		},
	});

	pi.registerTool({
		name: "alpha_list_annotations",
		label: "Alpha List Annotations",
		description: "List all persistent local paper annotations.",
		parameters: Type.Object({}),
		async execute() {
			const result = await listPaperAnnotations();
			return { content: [{ type: "text", text: formatText(result) }], details: result };
		},
	});

	pi.registerTool({
		name: "alpha_read_code",
		label: "Alpha Read Code",
		description: "Read files from a paper's GitHub repository. Use '/' for repo overview.",
		parameters: Type.Object({
			githubUrl: Type.String({ description: "GitHub repository URL." }),
			path: Type.Optional(Type.String({ description: "File or directory path. Default: '/'" })),
		}),
		async execute(_toolCallId, params) {
			const result = await readPaperCode(params.githubUrl, params.path?.trim() || "/");
			return { content: [{ type: "text", text: formatText(result) }], details: result };
		},
	});
}
