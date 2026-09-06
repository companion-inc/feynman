import type { ProviderAvailability } from "./gemini-search.ts";

function safeInlineJSON(data: unknown): string {
	return JSON.stringify(data)
		.replace(/</g, "\\u003c")
		.replace(/>/g, "\\u003e")
		.replace(/&/g, "\\u0026")
		.replace(/\u2028/g, "\\u2028")
		.replace(/\u2029/g, "\\u2029");
}

function buildProviderButtons(
	available: ProviderAvailability,
	selected: string,
	hasInitialQueries: boolean,
): string {
	const providers = [
		{ value: "all", label: "All", available: available.all },
		{ value: "openai", label: "OpenAI", available: available.openai },
		{ value: "exa", label: "Exa", available: available.exa },
		{ value: "brave", label: "Brave", available: available.brave },
		{ value: "parallel", label: "Parallel", available: available.parallel },
		{ value: "parallel-mcp", label: "Parallel MCP", available: available["parallel-mcp"] },
		{ value: "tinyfish", label: "TinyFish", available: available.tinyfish },
		{ value: "search1api", label: "Search1API", available: available.search1api },
		{ value: "searchinfinity", label: "Searchinfinity", available: available.searchinfinity },
		{ value: "querit", label: "Querit", available: available.querit },
		{ value: "tavily", label: "Tavily", available: available.tavily },
		{ value: "firecrawl", label: "Firecrawl", available: available.firecrawl },
		{ value: "jina", label: "Jina", available: available.jina },
		{ value: "serpdive", label: "SERPdive", available: available.serpdive },
		{ value: "kagi", label: "Kagi", available: available.kagi },
		{ value: "bocha", label: "Bocha", available: available.bocha },
		{ value: "ollama", label: "Ollama", available: available.ollama },
		{ value: "searxng", label: "SearXNG", available: available.searxng },
		{ value: "duckduckgo", label: "DuckDuckGo", available: available.duckduckgo },
		{ value: "perplexity", label: "Perplexity", available: available.perplexity },
		{ value: "gemini", label: "Gemini", available: available.gemini },
		{ value: "kimi", label: "Kimi", available: available.kimi },
		{ value: "anysearch", label: "AnySearch", available: available.anysearch },
		{ value: "xcrawl", label: "XCrawl", available: available.xcrawl },
		{ value: "xai", label: "xAI", available: available.xai },
		{ value: "mistral", label: "Mistral", available: available.mistral },
		{ value: "brightdata", label: "Bright Data", available: available.brightdata },
		{ value: "serpbase", label: "SerpBase", available: available.serpbase },
		{ value: "serper", label: "Serper", available: available.serper },
		{ value: "valyu", label: "Valyu", available: available.valyu },
	];

	return providers
		.filter(p => p.available)
		.map((p) => {
			const isDefault = p.value === selected;
			const state = isDefault && hasInitialQueries ? "loading" : "idle";
			const classes = ["provider-btn", state, isDefault ? "is-default" : ""].filter(Boolean).join(" ");
			const disabled = state === "loading" ? " disabled" : "";
			return `<button type="button" class="${classes}" data-provider="${p.value}" data-state="${state}"${disabled}>${p.label}</button>`;
		})
		.join("");
}

export function generateCuratorPage(
	queries: string[],
	sessionToken: string,
	timeout: number,
	availableProviders: ProviderAvailability,
	defaultProvider: string,
	searchProvider: string,
	summaryModels: Array<{ value: string; label: string }>,
	defaultSummaryModel: string | null,
): string {
	const providerButtonsHtml = buildProviderButtons(availableProviders, defaultProvider, queries.length > 0);
	const inlineData = safeInlineJSON({ queries, sessionToken, timeout, defaultProvider, searchProvider, summaryModels, defaultSummaryModel, availableProviders });

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Curate Search Results</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif&family=Outfit:wght@400;500;600;700&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/marked@15/marked.min.js"><\/script>
<style>
${CSS}
</style>
</head>
<body>

<div class="timer-badge" id="timer" title="Click to adjust">--:--</div>
<div class="timer-adjust" id="timer-adjust">
<input type="text" id="timer-input" value="${timeout}">
<span class="timer-adjust-label">sec</span>
<button class="timer-adjust-btn" id="timer-set">Set</button>
</div>

<main>
<div class="hero" id="hero">
<div class="hero-kicker">Web Search</div>
<h1 class="hero-title">Searching\u2026</h1>
<p class="hero-desc">Results will appear below as they complete.</p>
<div class="hero-meta">
<span id="hero-status">Searching\u2026</span>
<span class="hero-meta-sep"></span>
<div class="provider-buttons" id="provider-buttons">${providerButtonsHtml}</div>
</div>
</div>
<div id="result-cards"></div>
<div class="send-raw-row hidden" id="send-raw-row">
<button class="btn btn-secondary" id="btn-send-raw" disabled>Send selected results without summary</button>
</div>
<div class="add-search" id="add-search">
<span class="add-search-icon">+</span>
<input type="text" placeholder="Add a search\u2026" id="add-search-input">
<button type="button" class="add-search-wand" id="add-search-wand" disabled title="Rewrite query with AI">\u2728</button>
</div>

<section class="summary-panel hidden" id="summary-panel" aria-label="Summary review">
<div class="summary-header">
<div class="summary-header-top">
<div>
<h2 class="summary-title">Review summary draft</h2>
<p class="summary-subtitle" id="summary-subtitle">Edit the summary before approving.</p>
</div>
<div class="summary-model-controls">
<select id="summary-provider-select" class="summary-model-dropdown" aria-label="Summary provider"></select>
<select id="summary-model-select" class="summary-model-dropdown" aria-label="Summary model"></select>
</div>
</div>
</div>
<div class="summary-generating hidden" id="summary-generating" aria-live="polite">
<div class="summary-generating-head">
<span class="summary-generating-orb" aria-hidden="true"></span>
<span id="summary-generating-copy">Generating summary draft…</span>
</div>
<div class="summary-generating-bars" aria-hidden="true">
<span class="summary-generating-bar b1"></span>
<span class="summary-generating-bar b2"></span>
<span class="summary-generating-bar b3"></span>
</div>
</div>
<textarea id="summary-input" class="summary-input" placeholder="Summary draft will appear here\u2026"></textarea>
<div class="summary-feedback-row">
<input type="text" id="summary-feedback" class="summary-feedback" placeholder="Optional feedback for regeneration\u2026" />
</div>
<div class="summary-actions">
<button class="btn btn-secondary" id="btn-summary-back">Back</button>
<button class="btn btn-secondary" id="btn-summary-regenerate">Regenerate</button>
<button class="btn btn-secondary" id="btn-summary-preview" title="Preview rendered summary">Preview</button>
<button class="btn btn-submit" id="btn-summary-approve">Approve</button>
</div>
</section>
</main>

<footer class="action-bar">
<div class="action-shortcuts">
<span class="shortcut"><kbd>A</kbd> <span>Toggle all</span></span>
<span class="shortcut"><kbd>Enter</kbd> <span>Generate</span></span>
<span class="shortcut"><kbd>Esc</kbd> <span>Cancel</span></span>
</div>
<div class="action-buttons">
<button class="btn btn-submit" id="btn-send" disabled>Waiting for results\u2026</button>
</div>
</footer>

<div id="success-overlay" class="success-overlay hidden" aria-live="polite">
<div class="success-icon">OK</div>
<p id="success-text">Results sent</p>
</div>

<div id="expired-overlay" class="expired-overlay hidden" aria-live="polite">
<div class="expired-content">
<div class="expired-icon">!</div>
<h2>Session Ended</h2>
<p id="expired-text">Time\u2019s up \u2014 sending all results to your agent.</p>
<div class="expired-countdown">Closing in <span id="close-countdown">5</span>s</div>
</div>
</div>

<div id="preview-modal" class="preview-modal hidden">
<div class="preview-modal-inner">
<div class="preview-modal-header">
<h2 class="preview-modal-title">Summary Preview</h2>
<button class="preview-modal-close" id="preview-modal-close" title="Close">\u00d7</button>
</div>
<div class="preview-modal-body" id="preview-modal-body"></div>
<div class="preview-popover hidden" id="preview-popover">
<div class="preview-popover-quote" id="preview-popover-quote"></div>
<textarea class="preview-popover-input" id="preview-popover-input" placeholder="Feedback\u2026" rows="3"></textarea>
<button class="btn btn-submit preview-popover-btn" id="preview-popover-regen">Regenerate</button>
</div>
<div class="preview-modal-footer">
<select id="preview-modal-model" class="preview-modal-model" aria-label="Summary model"></select>
<button class="btn btn-secondary" id="preview-modal-regenerate">Regenerate</button>
<button class="btn btn-submit" id="preview-modal-approve">Approve</button>
</div>
</div>
</div>

<div id="error-banner" class="error-banner" hidden></div>

<script>
${SCRIPT.replace("__INLINE_DATA__", () => inlineData)}
</script>
</body>
</html>`;
}

const CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}

:root {
  --bg: #18181e;
  --bg-card: #1e1e24;
  --bg-elevated: #252530;
  --bg-hover: #2b2b37;
  --fg: #e0e0e0;
  --fg-muted: #909098;
  --fg-dim: #606068;
  --accent: #8abeb7;
  --accent-hover: #9dcec7;
  --accent-muted: rgba(138, 190, 183, 0.15);
  --accent-subtle: rgba(138, 190, 183, 0.08);
  --border: #2a2a34;
  --border-muted: #353540;
  --border-checked: #8abeb7;
  --check-bg: #8abeb7;
  --btn-primary: #8abeb7;
  --btn-primary-hover: #9dcec7;
  --btn-primary-fg: #18181e;
  --btn-secondary: #252530;
  --btn-secondary-hover: #2b2b37;
  --timer-bg: #252530;
  --timer-fg: #909098;
  --timer-warn-bg: rgba(240, 198, 116, 0.15);
  --timer-warn-fg: #f0c674;
  --timer-urgent-bg: rgba(204, 102, 102, 0.15);
  --timer-urgent-fg: #cc6666;
  --overlay-bg: rgba(24, 24, 30, 0.92);
  --success: #b5bd68;
  --warning: #f0c674;
  --font: 'Outfit', system-ui, -apple-system, sans-serif;
  --font-display: 'Instrument Serif', Georgia, 'Times New Roman', serif;
  --font-mono: 'SF Mono', Consolas, monospace;
  --radius: 10px;
  --radius-sm: 6px;
}

@media (prefers-color-scheme: light) {
  :root {
    --bg: #f5f5f7;
    --bg-card: #ffffff;
    --bg-elevated: #eeeef0;
    --bg-hover: #e4e4e8;
    --fg: #1a1a1e;
    --fg-muted: #6c6c74;
    --fg-dim: #9a9aa2;
    --accent: #5f8787;
    --accent-hover: #4a7272;
    --accent-muted: rgba(95, 135, 135, 0.12);
    --accent-subtle: rgba(95, 135, 135, 0.06);
    --border: #dcdce0;
    --border-muted: #c8c8d0;
    --border-checked: #5f8787;
    --check-bg: #5f8787;
    --btn-primary: #5f8787;
    --btn-primary-hover: #4a7272;
    --btn-primary-fg: #ffffff;
    --btn-secondary: #e4e4e8;
    --btn-secondary-hover: #d4d4d8;
    --timer-bg: #e4e4e8;
    --timer-fg: #6c6c74;
    --timer-warn-bg: rgba(217, 119, 6, 0.10);
    --timer-warn-fg: #92400e;
    --timer-urgent-bg: rgba(175, 95, 95, 0.10);
    --timer-urgent-fg: #991b1b;
    --overlay-bg: rgba(255, 255, 255, 0.92);
    --success: #4d7c0f;
    --warning: #b45309;
  }
}

body {
  font-family: var(--font);
  background: var(--bg);
  background-image: radial-gradient(ellipse at 50% 0%, var(--accent-muted) 0%, transparent 60%);
  color: var(--fg);
  line-height: 1.5;
  min-height: 100dvh;
  padding-bottom: 72px;
}

.timer-badge {
  position: fixed;
  top: 20px;
  right: 24px;
  z-index: 50;
  font-family: var(--font);
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  padding: 5px 14px;
  border-radius: 999px;
  background: var(--bg-elevated);
  color: var(--timer-fg);
  border: 1px solid var(--border);
  transition: background 0.3s, color 0.3s, border-color 0.3s, opacity 0.3s;
  box-shadow: 0 2px 8px rgba(0,0,0,0.2);
  cursor: pointer;
  user-select: none;
  opacity: 0.5;
}
.timer-badge:hover { opacity: 1; }
.timer-badge.active { opacity: 1; }
.timer-badge.warn {
  opacity: 1;
  background: var(--timer-warn-bg);
  color: var(--timer-warn-fg);
  border-color: color-mix(in srgb, var(--timer-warn-fg) 30%, transparent);
}
.timer-badge.urgent {
  opacity: 1;
  background: var(--timer-urgent-bg);
  color: var(--timer-urgent-fg);
  border-color: color-mix(in srgb, var(--timer-urgent-fg) 30%, transparent);
}
.timer-adjust {
  position: fixed;
  top: 20px;
  right: 24px;
  z-index: 51;
  display: none;
  align-items: center;
  gap: 6px;
  padding: 4px 6px 4px 12px;
  background: var(--bg-elevated);
  border: 1px solid var(--accent);
  border-radius: 999px;
  box-shadow: 0 2px 12px rgba(0,0,0,0.3);
}
.timer-adjust.visible { display: flex; }
.timer-adjust input {
  width: 48px;
  background: transparent;
  border: none;
  outline: none;
  color: var(--fg);
  font-family: var(--font);
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  text-align: center;
}
.timer-adjust-label { font-size: 11px; color: var(--fg-dim); }
.timer-adjust-btn {
  font-family: var(--font);
  font-size: 11px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 999px;
  border: none;
  background: var(--accent);
  color: var(--btn-primary-fg);
  cursor: pointer;
}
.timer-adjust-btn:hover { background: var(--accent-hover); }

main {
  max-width: 640px;
  margin: 0 auto;
  padding: 56px 24px 16px;
}

.hero { margin-bottom: 28px; }
.hero-kicker {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--accent);
  margin-bottom: 8px;
}
.hero-title {
  font-family: var(--font-display);
  font-size: 40px;
  font-weight: 400;
  font-style: italic;
  letter-spacing: -0.01em;
  line-height: 1.1;
  color: var(--fg);
  margin-bottom: 10px;
  text-wrap: balance;
}
.hero-desc {
  font-size: 14px;
  color: var(--fg-muted);
  line-height: 1.5;
  margin-bottom: 12px;
  max-width: 480px;
}
.hero-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: var(--fg-dim);
}
.hero-meta-sep {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--fg-dim);
  flex-shrink: 0;
}
#hero-status:empty + .hero-meta-sep { display: none; }
.provider-buttons {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
.summary-model-controls {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex-shrink: 0;
}
.summary-model-dropdown {
  font-family: var(--font);
  font-size: 12px;
  font-weight: 600;
  color: var(--fg);
  background: var(--bg-elevated);
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-sm);
  padding: 4px 8px;
  max-width: 220px;
}
.summary-model-dropdown:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 18%, transparent);
}
.summary-model-dropdown:disabled {
  opacity: 0.65;
  cursor: default;
}
.provider-btn {
  font-family: var(--font);
  font-size: 12px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid var(--border-muted);
  background: transparent;
  color: var(--fg-muted);
  cursor: pointer;
  transition: border-color 0.12s, background 0.12s, color 0.12s, opacity 0.12s;
}
.provider-btn.idle:hover {
  color: var(--fg);
  border-color: var(--accent);
}
.provider-btn.loading {
  background: var(--accent-subtle);
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 35%, var(--border-muted));
  cursor: default;
  pointer-events: none;
  opacity: 0.85;
}
.provider-btn.loading::after {
  content: " …";
  animation: provider-pulse 1.2s ease-in-out infinite;
}
.provider-btn.searched {
  background: var(--btn-secondary);
  color: var(--fg);
  border-color: var(--border-muted);
}
.provider-btn.searched::after {
  content: " ✓";
  color: var(--success);
}
.provider-btn.is-default {
  box-shadow: inset 0 -2px 0 0 var(--accent);
  border-color: var(--accent);
}
.provider-btn:disabled {
  cursor: default;
  opacity: 0.5;
}

@keyframes provider-pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
}

#result-cards { display: flex; flex-direction: column; gap: 8px; }

.send-raw-row {
  display: flex;
  justify-content: flex-end;
  padding: 4px 0;
}
.send-raw-row.hidden { display: none; }

.result-loading {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: color-mix(in srgb, var(--bg-card) 86%, var(--accent-subtle));
  overflow: hidden;
  box-shadow: 0 1px 2px rgba(0,0,0,0.06);
}
.result-loading-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 14px 10px;
  border-bottom: 1px solid var(--border);
}
.result-loading-title {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--accent);
}
.result-loading-sub {
  font-size: 12px;
  color: var(--fg-dim);
  font-variant-numeric: tabular-nums;
}
.result-loading-grid {
  display: grid;
  gap: 10px;
  padding: 12px 14px 14px;
}
.loading-card {
  border: 1px solid color-mix(in srgb, var(--border-muted) 80%, var(--accent-subtle));
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  overflow: hidden;
  position: relative;
}
.loading-card::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(105deg, transparent 10%, color-mix(in srgb, var(--accent) 18%, transparent) 45%, transparent 75%);
  transform: translateX(-130%);
  animation: loading-sweep 2s ease-in-out infinite;
  pointer-events: none;
}
.loading-card-row {
  height: 10px;
  border-radius: 999px;
  margin: 10px 12px;
  background: color-mix(in srgb, var(--fg-dim) 35%, transparent);
}
.loading-card-row.short { width: 35%; }
.loading-card-row.mid { width: 58%; }
.loading-card-row.long { width: 78%; }

.result-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  transition: border-color 0.12s;
  box-shadow: 0 1px 2px rgba(0,0,0,0.06);
}
.result-card.checked { border-color: var(--border-checked); }
.result-card.searching {
  opacity: 1;
  border-color: color-mix(in srgb, var(--accent) 40%, var(--border));
  background: linear-gradient(180deg, color-mix(in srgb, var(--accent-subtle) 70%, var(--bg-card)) 0%, var(--bg-card) 100%);
  position: relative;
}
.result-card.searching::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(110deg, transparent 20%, color-mix(in srgb, var(--accent) 14%, transparent) 50%, transparent 80%);
  transform: translateX(-130%);
  animation: loading-sweep 2.2s ease-in-out infinite;
  pointer-events: none;
}
.result-card.searching .result-card-header { cursor: default; }
.result-card.searching .result-card-header:hover { background: transparent; }
.result-card.error { border-color: var(--timer-urgent-fg); }

.result-card-header {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px;
  cursor: pointer;
  user-select: none;
  transition: background 0.12s;
}
.result-card-header:hover { background: var(--bg-hover); }

.result-card-header input[type="checkbox"] {
  appearance: none;
  width: 16px;
  height: 16px;
  min-width: 16px;
  border: 1.5px solid var(--border-muted);
  border-radius: 4px;
  margin-top: 2px;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s;
  display: grid;
  place-content: center;
}
.result-card-header input[type="checkbox"]:checked {
  background: var(--check-bg);
  border-color: var(--check-bg);
}
.result-card-header input[type="checkbox"]:checked::after {
  content: "";
  width: 9px;
  height: 6px;
  border-left: 2px solid var(--btn-primary-fg);
  border-bottom: 2px solid var(--btn-primary-fg);
  transform: rotate(-45deg);
  margin-top: -1px;
}

.result-card-info { flex: 1; min-width: 0; }

.result-card-query-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 2px;
}
.result-card-query {
  font-size: 14px;
  font-weight: 600;
  color: var(--fg);
}
.provider-tag {
  display: inline-flex;
  align-items: center;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  border: 1px solid transparent;
}
.provider-tag.provider-all {
  color: #f5e0a6;
  background: rgba(245, 224, 166, 0.14);
  border-color: rgba(245, 224, 166, 0.3);
}
.provider-tag.provider-exa {
  color: #8dd3ff;
  background: rgba(141, 211, 255, 0.14);
  border-color: rgba(141, 211, 255, 0.3);
}
.provider-tag.provider-perplexity {
  color: #cba6f7;
  background: rgba(203, 166, 247, 0.14);
  border-color: rgba(203, 166, 247, 0.3);
}
.provider-tag.provider-gemini {
  color: #f5c27b;
  background: rgba(245, 194, 123, 0.14);
  border-color: rgba(245, 194, 123, 0.3);
}
.provider-tag.provider-anysearch {
  color: #f9c74f;
  background: rgba(249, 199, 79, 0.14);
  border-color: rgba(249, 199, 79, 0.3);
}
.provider-tag.provider-xcrawl {
  color: #7dd3ae;
  background: rgba(125, 211, 174, 0.14);
  border-color: rgba(125, 211, 174, 0.3);
}
.provider-tag.provider-xai {
  color: #c4b5fd;
  background: rgba(196, 181, 253, 0.14);
  border-color: rgba(196, 181, 253, 0.3);
}
.provider-tag.provider-openai {
  color: #a6e3a1;
  background: rgba(166, 227, 161, 0.14);
  border-color: rgba(166, 227, 161, 0.3);
}
.provider-tag.provider-brave {
  color: #f38ba8;
  background: rgba(243, 139, 168, 0.14);
  border-color: rgba(243, 139, 168, 0.3);
}
.provider-tag.provider-parallel {
  color: #89dceb;
  background: rgba(137, 220, 235, 0.14);
  border-color: rgba(137, 220, 235, 0.3);
}
.provider-tag.provider-tinyfish {
  color: #74c7ec;
  background: rgba(116, 199, 236, 0.14);
  border-color: rgba(116, 199, 236, 0.3);
}
.provider-tag.provider-search1api {
  color: #89b4fa;
  background: rgba(137, 180, 250, 0.14);
  border-color: rgba(137, 180, 250, 0.3);
}
.provider-tag.provider-searchinfinity {
  color: #f9e2af;
  background: rgba(249, 226, 175, 0.14);
  border-color: rgba(249, 226, 175, 0.3);
}
.provider-tag.provider-querit {
  color: #a6e3a1;
  background: rgba(166, 227, 161, 0.14);
  border-color: rgba(166, 227, 161, 0.3);
}
.provider-tag.provider-tavily {
  color: #a6e3a1;
  background: rgba(166, 227, 161, 0.14);
  border-color: rgba(166, 227, 161, 0.3);
}
.provider-tag.provider-jina {
  color: #f9e2af;
  background: rgba(249, 226, 175, 0.14);
  border-color: rgba(249, 226, 175, 0.3);
}
.provider-tag.provider-serpdive {
  color: #94e2d5;
  background: rgba(148, 226, 213, 0.14);
  border-color: rgba(148, 226, 213, 0.3);
}
.provider-tag.provider-brightdata {
  color: #b4befe;
  background: rgba(180, 190, 254, 0.14);
  border-color: rgba(180, 190, 254, 0.3);
}
.provider-tag.provider-unknown {
  color: var(--fg-muted);
  background: var(--bg-elevated);
  border-color: var(--border-muted);
}
.result-card-meta {
  font-size: 12px;
  color: var(--fg-dim);
}
.result-card-preview {
  font-size: 12.5px;
  color: var(--fg-muted);
  margin-top: 6px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  line-height: 1.45;
}

.result-card-expand {
  color: var(--fg-dim);
  font-size: 11px;
  margin-top: 2px;
  flex-shrink: 0;
  padding-top: 3px;
  transition: color 0.12s;
}
.result-card-header:hover .result-card-expand { color: var(--fg-muted); }

.result-card-body {
  display: none;
  border-top: 1px solid var(--border);
}
.result-card-body.open { display: block; }

.result-card-answer {
  padding: 14px 16px;
  font-size: 13.5px;
  color: var(--fg-muted);
  line-height: 1.6;
  max-height: 400px;
  overflow-y: auto;
}
.result-card-answer h1,
.result-card-answer h2,
.result-card-answer h3,
.result-card-answer h4 {
  color: var(--fg);
  font-family: var(--font);
  font-weight: 600;
  margin: 16px 0 6px;
  line-height: 1.3;
}
.result-card-answer h1 { font-size: 16px; }
.result-card-answer h2 { font-size: 14.5px; }
.result-card-answer h3 { font-size: 13.5px; }
.result-card-answer h4 { font-size: 13px; color: var(--fg-muted); }
.result-card-answer p { margin: 0 0 10px; }
.result-card-answer p:last-child { margin-bottom: 0; }
.result-card-answer strong { color: var(--fg); font-weight: 600; }
.result-card-answer a { color: var(--accent); text-decoration: none; }
.result-card-answer a:hover { text-decoration: underline; }
.result-card-answer ul, .result-card-answer ol {
  margin: 6px 0 10px;
  padding-left: 20px;
}
.result-card-answer li { margin-bottom: 4px; }
.result-card-answer li::marker { color: var(--fg-dim); }
.result-card-answer code {
  font-family: var(--font-mono);
  font-size: 12px;
  padding: 1px 5px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 3px;
  color: var(--fg);
}
.result-card-answer pre {
  margin: 8px 0 12px;
  padding: 12px 14px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  overflow-x: auto;
  line-height: 1.45;
}
.result-card-answer pre code {
  padding: 0;
  background: none;
  border: none;
  font-size: 12px;
  color: var(--fg-muted);
}
.result-card-answer blockquote {
  margin: 8px 0;
  padding: 8px 14px;
  border-left: 3px solid var(--accent);
  color: var(--fg-dim);
  background: var(--accent-subtle);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
}
.result-card-answer table {
  width: 100%;
  border-collapse: collapse;
  margin: 8px 0 12px;
  font-size: 12.5px;
}
.result-card-answer th, .result-card-answer td {
  padding: 6px 10px;
  border: 1px solid var(--border);
  text-align: left;
}
.result-card-answer th {
  background: var(--bg-elevated);
  color: var(--fg);
  font-weight: 600;
  font-size: 11.5px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.result-card-answer hr {
  border: none;
  border-top: 1px solid var(--border);
  margin: 14px 0;
}

.result-card-sources {
  padding: 10px 16px 14px;
  border-top: 1px solid var(--border);
}
.result-card-sources-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--fg-dim);
  margin-bottom: 6px;
}
.source-link {
  display: block;
  padding: 4px 0;
  font-size: 12.5px;
  color: var(--fg-muted);
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color 0.12s;
}
.source-link:hover { color: var(--accent); }
.source-domain {
  color: var(--fg-dim);
  margin-left: 6px;
}

.result-card-error-msg {
  padding: 12px 16px;
  font-size: 13px;
  color: var(--timer-urgent-fg);
}

.card-alt-providers {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 16px 8px 42px;
  font-size: 11px;
  color: var(--fg-dim);
}
.card-alt-chip {
  font-family: var(--font);
  font-size: 10px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--border-muted);
  background: transparent;
  color: var(--fg-muted);
  cursor: pointer;
  transition: border-color 0.12s, color 0.12s, background 0.12s;
}
.card-alt-chip:hover:not(:disabled) {
  color: var(--accent);
  border-color: var(--accent);
}
.card-alt-chip:disabled {
  opacity: 0.4;
  cursor: default;
}
.card-alt-chip.loading {
  opacity: 0.6;
  pointer-events: none;
}
.card-alt-chip.loading::after {
  content: " …";
}

.searching-dots::after {
  content: "";
  animation: dots 1.5s steps(4, end) infinite;
}
@keyframes dots {
  0% { content: ""; }
  25% { content: "."; }
  50% { content: ".."; }
  75% { content: "..."; }
}

@keyframes loading-sweep {
  0% { transform: translateX(-130%); }
  100% { transform: translateX(130%); }
}

@keyframes summary-pulse {
  0%, 100% {
    transform: scale(0.9);
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 35%, transparent);
  }
  50% {
    transform: scale(1.15);
    box-shadow: 0 0 0 6px color-mix(in srgb, var(--accent) 0%, transparent);
  }
}

@keyframes summary-sweep {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(120%); }
}

@keyframes summary-panel-sweep {
  0% { transform: translateX(-115%); }
  100% { transform: translateX(115%); }
}

.add-search {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
  padding: 11px 14px;
  border: 1px dashed var(--border);
  border-radius: var(--radius);
  cursor: text;
  transition: border-color 0.15s, background 0.15s;
}
.add-search:hover {
  border-color: var(--border-muted);
  background: var(--accent-subtle);
}
.add-search:focus-within {
  border-color: var(--accent);
  border-style: solid;
  background: var(--accent-subtle);
}
.add-search-icon {
  color: var(--fg-dim);
  font-size: 16px;
  font-weight: 300;
  line-height: 1;
  flex-shrink: 0;
  transition: color 0.15s;
}
.add-search:focus-within .add-search-icon { color: var(--accent); }
.add-search input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: var(--fg);
  font-family: var(--font);
  font-size: 13.5px;
  font-weight: 500;
}
.add-search input::placeholder {
  color: var(--fg-dim);
  font-weight: 400;
}
.add-search-wand {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-muted);
  border-radius: 6px;
  background: transparent;
  color: var(--fg-dim);
  font-size: 14px;
  cursor: pointer;
  transition: color 0.12s, border-color 0.12s, background 0.12s;
}
.add-search-wand:hover:not(:disabled) {
  color: var(--accent);
  border-color: var(--accent);
  background: var(--accent-subtle);
}
.add-search-wand:disabled {
  opacity: 0.3;
  cursor: default;
}
.add-search-wand.rewriting {
  pointer-events: none;
  animation: wand-spin 0.8s linear infinite;
}
@keyframes wand-spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.summary-panel {
  margin-top: 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-card);
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.summary-panel.hidden { display: none; }
.summary-header { display: flex; flex-direction: column; gap: 2px; }
.summary-header-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.summary-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--fg);
}
.summary-subtitle {
  font-size: 12px;
  color: var(--fg-dim);
}
.summary-generating {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--accent) 28%, var(--border));
  border-radius: var(--radius-sm);
  background: linear-gradient(130deg, color-mix(in srgb, var(--accent-subtle) 78%, transparent) 0%, var(--bg-elevated) 70%);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.summary-generating::before {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(110deg, transparent 0%, color-mix(in srgb, var(--accent) 16%, transparent) 50%, transparent 100%);
  transform: translateX(-115%);
  animation: summary-panel-sweep 2.4s ease-in-out infinite;
  pointer-events: none;
}
.summary-generating > * {
  position: relative;
  z-index: 1;
}
.summary-generating.hidden { display: none; }
.summary-generating-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--accent-hover);
}
.summary-generating-orb {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: var(--accent);
  box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 35%, transparent);
  animation: summary-pulse 1.1s ease-in-out infinite;
}
.summary-generating-bars {
  display: grid;
  gap: 6px;
}
.summary-generating-bar {
  position: relative;
  display: block;
  height: 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--bg) 65%, var(--bg-elevated));
  overflow: hidden;
  transition: width 220ms ease;
}
.summary-generating-bar::after {
  content: "";
  position: absolute;
  inset: 0;
  transform: translateX(-100%);
  background: linear-gradient(90deg, transparent 0%, color-mix(in srgb, var(--accent) 45%, transparent) 50%, transparent 100%);
  animation: summary-sweep 1.6s ease-in-out infinite;
}
.summary-generating-bar.b1 { width: 86%; }
.summary-generating-bar.b2 { width: 68%; }
.summary-generating-bar.b3 { width: 74%; }
.summary-generating[data-phase="1"] .summary-generating-bar.b1 { width: 72%; }
.summary-generating[data-phase="1"] .summary-generating-bar.b2 { width: 82%; }
.summary-generating[data-phase="1"] .summary-generating-bar.b3 { width: 60%; }
.summary-generating[data-phase="2"] .summary-generating-bar.b1 { width: 64%; }
.summary-generating[data-phase="2"] .summary-generating-bar.b2 { width: 71%; }
.summary-generating[data-phase="2"] .summary-generating-bar.b3 { width: 90%; }
.summary-generating-bar.b2::after { animation-delay: 0.15s; }
.summary-generating-bar.b3::after { animation-delay: 0.3s; }
.summary-input {
  width: 100%;
  min-height: 180px;
  resize: vertical;
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
  font-family: var(--font);
  font-size: 13px;
  line-height: 1.5;
  color: var(--fg);
  background: var(--bg-elevated);
  outline: none;
}
.summary-input.hidden { display: none; }
.summary-input:focus {
  border-color: var(--accent);
}
.summary-feedback-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
}
.summary-feedback {
  flex: 1;
  height: 32px;
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-sm);
  padding: 4px 10px;
  font-family: var(--font);
  font-size: 12px;
  color: var(--fg);
  background: var(--bg-elevated);
  outline: none;
}
.summary-feedback:focus {
  border-color: var(--accent);
}
.summary-feedback::placeholder {
  color: var(--fg-muted);
}
.summary-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.action-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 24px;
  background: color-mix(in srgb, var(--bg) 90%, transparent);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-top: 1px solid var(--border);
}
.action-shortcuts { display: flex; align-items: center; gap: 16px; }
.shortcut { display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--fg-dim); }
.shortcut kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 500;
  background: var(--bg-elevated);
  border: 1px solid var(--border-muted);
  border-radius: 3px;
  color: var(--fg-muted);
}
.action-buttons { display: flex; gap: 8px; }

.btn {
  font-family: var(--font);
  font-size: 13px;
  font-weight: 500;
  padding: 7px 16px;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background 0.12s, opacity 0.12s;
}
.btn:disabled { opacity: 0.35; cursor: default; }
.btn-submit { background: var(--btn-primary); color: var(--btn-primary-fg); }
.btn-submit:hover:not(:disabled) { background: var(--btn-primary-hover); }
.btn-secondary { background: var(--btn-secondary); color: var(--fg-muted); border: 1px solid var(--border); }
.btn-secondary:hover:not(:disabled) { background: var(--btn-secondary-hover); color: var(--fg); }

.success-overlay {
  position: fixed; inset: 0; z-index: 200;
  background: var(--overlay-bg);
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px;
  transition: opacity 200ms;
}
.success-overlay.hidden { display: flex !important; opacity: 0; pointer-events: none; }
.success-icon {
  width: 56px; height: 56px; border-radius: 50%;
  border: 2px solid var(--success);
  display: flex; align-items: center; justify-content: center;
  font-size: 18px; font-weight: 700; color: var(--success);
}
.success-overlay p { margin: 0; font-size: 13px; font-weight: 600; color: var(--success); letter-spacing: 0.06em; text-transform: uppercase; }

.expired-overlay {
  position: fixed; inset: 0;
  background: var(--overlay-bg);
  display: flex; align-items: center; justify-content: center;
  opacity: 0; transition: opacity 400ms; pointer-events: none; z-index: 200;
}
.expired-overlay.visible { opacity: 1; pointer-events: auto; }
.expired-overlay.hidden { display: flex !important; opacity: 0; pointer-events: none; }
.expired-content {
  text-align: center; max-width: 480px; padding: 48px 56px;
  background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px;
}
.expired-overlay.visible .expired-content { animation: slide-up 400ms ease-out; }
@keyframes slide-up { from { transform: translateY(20px); } to { transform: translateY(0); } }
.expired-icon {
  width: 72px; height: 72px; border-radius: 50%; border: 2px solid var(--warning);
  display: flex; align-items: center; justify-content: center;
  font-size: 32px; font-weight: bold; color: var(--warning); margin: 0 auto 24px;
}
.expired-content h2 { color: var(--fg); margin: 0 0 16px; font-size: 22px; font-weight: 600; }
.expired-content p { color: var(--fg-muted); margin: 0 0 24px; font-size: 14px; line-height: 1.6; }
.expired-countdown { font-size: 13px; color: var(--fg-dim); font-variant-numeric: tabular-nums; }
.expired-countdown span { color: var(--warning); font-weight: 600; }

.preview-modal {
  position: fixed; inset: 0; z-index: 250;
  background: var(--overlay-bg);
  display: flex; align-items: center; justify-content: center;
  animation: fade-in 150ms ease-out;
}
.preview-modal.hidden { display: none; }
@keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
.preview-modal-inner {
  width: min(720px, calc(100% - 48px));
  max-height: calc(100vh - 80px);
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 12px;
  display: flex; flex-direction: column;
  animation: slide-up 200ms ease-out;
}
.preview-modal-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.preview-modal-title { font-size: 14px; font-weight: 600; color: var(--fg); margin: 0; }
.preview-modal-close {
  background: none; border: none; cursor: pointer;
  font-size: 22px; line-height: 1; color: var(--fg-muted); padding: 0 4px;
  transition: color 0.12s;
}
.preview-modal-close:hover { color: var(--fg); }
.preview-modal-body {
  position: relative;
  padding: 24px 28px;
  overflow-y: auto;
  font-size: 14px; line-height: 1.7; color: var(--fg);
}
.preview-modal-body h1 { font-size: 20px; font-weight: 600; margin: 1.2em 0 0.5em; color: var(--fg); }
.preview-modal-body h2 { font-size: 16px; font-weight: 600; margin: 1.2em 0 0.4em; color: var(--fg); }
.preview-modal-body h3 { font-size: 14px; font-weight: 600; margin: 1em 0 0.3em; color: var(--fg); }
.preview-modal-body p { margin: 0.6em 0; }
.preview-modal-body a { color: var(--accent); }
.preview-modal-body pre { background: var(--bg-elevated); padding: 14px; border-radius: var(--radius-sm); overflow-x: auto; }
.preview-modal-body code { font-size: 0.9em; }
.preview-modal-body blockquote { border-left: 3px solid var(--border); padding-left: 14px; color: var(--fg-muted); margin: 0.6em 0; }
.preview-modal-body hr { border: none; border-top: 1px solid var(--border); margin: 1.5em 0; }
.preview-modal-body ul, .preview-modal-body ol { padding-left: 1.4em; }
.preview-modal-body li + li { margin-top: 0.25em; }
.preview-modal-body strong { color: var(--fg); }
.preview-modal-footer {
  padding: 12px 20px;
  border-top: 1px solid var(--border);
  display: flex; align-items: center; gap: 8px;
  flex-shrink: 0;
}
.preview-modal-model {
  margin-right: auto;
  font-family: var(--font);
  font-size: 11px;
  color: var(--fg-muted);
  background: var(--bg-elevated);
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-sm);
  padding: 4px 8px;
  max-width: 220px;
  outline: none;
}
.preview-modal-model:focus { border-color: var(--accent); }

.preview-popover {
  position: absolute;
  z-index: 260;
  width: min(340px, calc(100% - 40px));
  background: var(--bg-elevated);
  border: 1px solid var(--accent);
  border-radius: var(--radius);
  padding: 10px 12px;
  display: flex; flex-direction: column; gap: 8px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.35);
  animation: fade-in 100ms ease-out;
}
.preview-popover.hidden { display: none; }
.preview-popover-quote {
  font-size: 12px;
  color: var(--fg-muted);
  font-style: italic;
  border-left: 2px solid var(--accent);
  padding-left: 8px;
  max-height: 48px;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.preview-popover-input {
  font-family: var(--font);
  font-size: 13px;
  line-height: 1.4;
  color: var(--fg);
  background: var(--bg-card);
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-sm);
  padding: 6px 10px;
  outline: none;
  width: 100%;
  resize: vertical;
}
.preview-popover-input:focus { border-color: var(--accent); }
.preview-popover-btn { align-self: flex-end; font-size: 12px; padding: 5px 14px; }

.error-banner {
  position: fixed; bottom: 64px; left: 50%; transform: translateX(-50%); z-index: 50;
  padding: 10px 20px; background: var(--timer-urgent-bg); color: var(--timer-urgent-fg);
  border-radius: var(--radius); font-size: 13px; font-weight: 500;
}

.summary-panel.updating {
  border-color: color-mix(in srgb, var(--accent) 35%, var(--border));
  position: relative;
  overflow: hidden;
}
.summary-panel.updating::after {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  width: 30%;
  height: 2px;
  border-radius: var(--radius) var(--radius) 0 0;
  background: linear-gradient(90deg, transparent, var(--accent), transparent);
  animation: updating-bar 1.8s ease-in-out infinite;
  pointer-events: none;
}
.summary-panel.updating .summary-input,
.summary-panel.updating .summary-feedback-row {
  opacity: 0.45;
  pointer-events: none;
}
.summary-panel.updating .summary-actions {
  opacity: 0.72;
}
@keyframes updating-bar {
  0% { transform: translateX(-50%); }
  100% { transform: translateX(430%); }
}

@media (prefers-reduced-motion: reduce) {
  .loading-card::after,
  .result-card.searching::after,
  .provider-btn.loading::after,
  .searching-dots::after,
  .summary-generating::before,
  .summary-generating-orb,
  .summary-generating-bar::after,
  .summary-panel.updating::after {
    animation: none !important;
  }
}

@media (max-width: 500px) {
  main { padding: 32px 16px 16px; }
  .hero-title { font-size: 28px; }
  .hero-desc { font-size: 13px; }
  .summary-header-top { flex-direction: column; }
  .summary-model-controls { flex-wrap: wrap; }
  .summary-model-dropdown { max-width: 100%; }
  .action-bar { padding: 10px 14px; }
  .action-shortcuts { display: none; }
  .result-card-header { padding: 12px 14px; }
  .expired-content { padding: 32px 24px; }
  .timer-badge { top: 12px; right: 16px; }
}
`;

const SCRIPT = `(function() {
  var DATA = __INLINE_DATA__;
  var token = DATA.sessionToken;
  var timeoutSec = DATA.timeout;
  var queries = Array.isArray(DATA.queries) ? DATA.queries : [];
  var providers = ["all", "openai", "exa", "brave", "parallel", "parallel-mcp", "tinyfish", "search1api", "searchinfinity", "querit", "tavily", "firecrawl", "jina", "serpdive", "kagi", "bocha", "ollama", "searxng", "duckduckgo", "perplexity", "gemini", "kimi", "anysearch", "xcrawl", "xai", "mistral", "brightdata", "serpbase", "serper", "valyu"];
  var availProviders = DATA.availableProviders && typeof DATA.availableProviders === "object" ? DATA.availableProviders : {};
  var workflow = "summary-review";
  var initialDefaultProvider = typeof DATA.defaultProvider === "string" ? DATA.defaultProvider : "exa";
  if (providers.indexOf(initialDefaultProvider) === -1) initialDefaultProvider = "exa";
  var initialSearchProvider = typeof DATA.searchProvider === "string" ? DATA.searchProvider.toLowerCase() : initialDefaultProvider;
  if (initialSearchProvider !== "auto" && providers.indexOf(initialSearchProvider) === -1) initialSearchProvider = initialDefaultProvider;

  var summaryModels = Array.isArray(DATA.summaryModels)
    ? DATA.summaryModels.filter(function(model) {
      return model && typeof model === "object" && typeof model.value === "string";
    })
    : [];
  var defaultSummaryModel = typeof DATA.defaultSummaryModel === "string"
    ? DATA.defaultSummaryModel.trim()
    : "";

  var submitted = false;
  var timerExpired = false;
  var submitInFlight = false;
  var searchesDone = false;
  var stage = "results";
  var summaryMeta = null;
  var summaryRequestSeq = 0;
  var lastAutoSummarySignature = "";
  var lastInteraction = Date.now();
  var completedCount = 0;
  var es = null;
  var lastLiveEventAt = Date.now();
  var stateSyncInFlight = false;
  var liveUpdateWarning = false;

  var allQueries = queries.map(function(query, slotId) { return { slotId: slotId, query: query }; });
  var nextSlotId = queries.length;
  var queryIndexToSlot = new Map();
  var providerCoverage = new Map();

  var currentProvider = initialDefaultProvider;
  var currentSearchProvider = initialSearchProvider;
  var initialStreamDone = queries.length === 0;
  var providerBatchInFlight = false;
  var batchLoadingProvider = null;
  var addSearchInFlight = 0;
  var isRegenerating = false;

  var timerEl = document.getElementById("timer");
  var timerAdjustEl = document.getElementById("timer-adjust");
  var timerInput = document.getElementById("timer-input");
  var timerSetBtn = document.getElementById("timer-set");
  var heroTitle = document.querySelector(".hero-title");
  var heroDesc = document.querySelector(".hero-desc");
  var resultCardsEl = document.getElementById("result-cards");
  var btnSend = document.getElementById("btn-send");
  var btnSendRaw = document.getElementById("btn-send-raw");
  var sendRawRow = document.getElementById("send-raw-row");
  var summaryPanel = document.getElementById("summary-panel");
  var summarySubtitle = document.getElementById("summary-subtitle");
  var summaryGeneratingEl = document.getElementById("summary-generating");
  var summaryGeneratingCopy = document.getElementById("summary-generating-copy");
  var summaryInput = document.getElementById("summary-input");
  var summaryFeedback = document.getElementById("summary-feedback");
  var btnSummaryBack = document.getElementById("btn-summary-back");
  var btnSummaryRegenerate = document.getElementById("btn-summary-regenerate");
  var btnSummaryPreview = document.getElementById("btn-summary-preview");
  var btnSummaryApprove = document.getElementById("btn-summary-approve");
  var successOverlay = document.getElementById("success-overlay");
  var successText = document.getElementById("success-text");
  var expiredOverlay = document.getElementById("expired-overlay");
  var expiredText = document.getElementById("expired-text");
  var closeCountdown = document.getElementById("close-countdown");
  var errorBanner = document.getElementById("error-banner");
  var addSearchInput = document.getElementById("add-search-input");
  var addSearchEl = document.getElementById("add-search");
  var addSearchWand = document.getElementById("add-search-wand");
  var heroStatus = document.getElementById("hero-status");
  var summaryProviderSelect = document.getElementById("summary-provider-select");
  var summaryModelSelect = document.getElementById("summary-model-select");
  var previewModal = document.getElementById("preview-modal");
  var previewModalBody = document.getElementById("preview-modal-body");
  var previewModalClose = document.getElementById("preview-modal-close");
  var previewModalModel = document.getElementById("preview-modal-model");
  var previewModalRegenerate = document.getElementById("preview-modal-regenerate");
  var previewModalApprove = document.getElementById("preview-modal-approve");
  var previewPopover = document.getElementById("preview-popover");
  var previewPopoverQuote = document.getElementById("preview-popover-quote");
  var previewPopoverInput = document.getElementById("preview-popover-input");
  var previewPopoverRegen = document.getElementById("preview-popover-regen");
  var providerButtons = Array.prototype.slice.call(document.querySelectorAll(".provider-btn"));
  var loadingPanelEl = null;

  var summaryModelsByProvider = Object.create(null);
  var summaryProviders = [];
  var currentSummaryProvider = "";
  var currentSummaryModel = "";
  var summaryPendingModel = "";
  var summaryGeneratingStartedAt = 0;
  var summaryGeneratingPhase = -1;
  var rewriteInFlight = false;

  function escHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;");
  }

  function sanitizeHref(url) {
    var value = typeof url === "string" ? url.trim() : "";
    return /^https?:\/\//i.test(value) ? value : "#";
  }

  function sanitizeMarkdownHtml(html) {
    var container = document.createElement("div");
    container.innerHTML = html;

    container.querySelectorAll("script, iframe, object, embed, form, style, link, meta, base")
      .forEach(function(el) { el.remove(); });

    var nodes = container.querySelectorAll("*");
    nodes.forEach(function(node) {
      for (var i = node.attributes.length - 1; i >= 0; i--) {
        var attr = node.attributes[i];
        if (/^on/i.test(attr.name)) node.removeAttribute(attr.name);
      }
    });

    var anchors = container.querySelectorAll("a[href]");
    anchors.forEach(function(anchor) {
      var safe = sanitizeHref(anchor.getAttribute("href") || "");
      anchor.setAttribute("href", safe);
      anchor.setAttribute("rel", "noopener noreferrer");
      anchor.setAttribute("target", "_blank");
    });

    var images = container.querySelectorAll("img[src]");
    images.forEach(function(img) {
      var safe = sanitizeHref(img.getAttribute("src") || "");
      if (safe === "#") {
        img.remove();
      } else {
        img.setAttribute("src", safe);
      }
    });

    return container.innerHTML;
  }

  function post(path, body) {
    return fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ token: token }, body)),
    });
  }

  function extractServerError(data) {
    if (!data || typeof data !== "object") return "";
    if (typeof data.error === "string" && data.error.trim()) return data.error.trim();
    return "";
  }

  function postJson(path, body) {
    return post(path, body).then(function(res) {
      return res.text().then(function(raw) {
        var data = null;
        if (raw) {
          try {
            data = JSON.parse(raw);
          } catch (err) {
            var parseMessage = err instanceof Error ? err.message : String(err);
            throw new Error("Invalid JSON response from " + path + ": " + parseMessage);
          }
        }

        if (!res.ok) {
          throw new Error(extractServerError(data) || ("HTTP " + res.status));
        }

        return data;
      });
    });
  }

  function formatTime(sec) {
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  function normalizeProvider(provider, fallback) {
    if (typeof provider === "string") {
      var normalized = provider.toLowerCase();
      if (providers.indexOf(normalized) !== -1) return normalized;
    }
    if (typeof fallback === "string") {
      var fallbackNormalized = fallback.toLowerCase();
      if (providers.indexOf(fallbackNormalized) !== -1) return fallbackNormalized;
    }
    return "";
  }

  function providerLabel(provider) {
    if (provider === "all") return "All";
    if (provider === "openai") return "OpenAI";
    if (provider === "brave") return "Brave";
    if (provider === "parallel") return "Parallel";
    if (provider === "tinyfish") return "TinyFish";
    if (provider === "search1api") return "Search1API";
    if (provider === "searchinfinity") return "Searchinfinity";
    if (provider === "querit") return "Querit";
    if (provider === "tavily") return "Tavily";
    if (provider === "firecrawl") return "Firecrawl";
    if (provider === "jina") return "Jina";
    if (provider === "serpdive") return "SERPdive";
    if (provider === "kagi") return "Kagi";
    if (provider === "bocha") return "Bocha";
    if (provider === "ollama") return "Ollama";
    if (provider === "searxng") return "SearXNG";
    if (provider === "duckduckgo") return "DuckDuckGo";
    if (provider === "perplexity") return "Perplexity";
    if (provider === "exa") return "Exa";
    if (provider === "gemini") return "Gemini";
    if (provider === "kimi") return "Kimi";
    if (provider === "anysearch") return "AnySearch";
    if (provider === "xcrawl") return "XCrawl";
    if (provider === "xai") return "xAI";
    if (provider === "mistral") return "Mistral";
    if (provider === "brightdata") return "Bright Data";
    if (provider === "serpbase") return "SerpBase";
    return "Unknown";
  }

  function providerTagHtml(provider) {
    var normalized = normalizeProvider(provider, "");
    if (!normalized) return "";
    return '<span class="provider-tag provider-' + normalized + '">' + escHtml(providerLabel(normalized)) + "</span>";
  }

  function buildAltChipsHtml(provider, queryText) {
    var normalizedProv = normalizeProvider(provider, "");
    if (!normalizedProv) return "";
    var altProviders = providers.filter(function(p) { return p !== normalizedProv && availProviders[p] === true; });
    if (altProviders.length === 0) return "";
    var html = '<div class="card-alt-providers"><span>Also try</span>';
    for (var ap = 0; ap < altProviders.length; ap++) {
      html += '<button type="button" class="card-alt-chip" data-alt-provider="' + altProviders[ap] + '" data-alt-query="' + escHtml(queryText) + '">' + escHtml(providerLabel(altProviders[ap])) + '</button>';
    }
    html += "</div>";
    return html;
  }

  function getSummaryProvider(modelValue) {
    if (typeof modelValue !== "string") return "";
    var trimmed = modelValue.trim();
    var slash = trimmed.indexOf("/");
    if (slash <= 0) return "";
    return trimmed.slice(0, slash);
  }

  function summaryProviderLabel(provider) {
    if (!provider) return "";
    if (provider === "openai") return "OpenAI";
    if (provider === "google") return "Google";
    if (provider === "anthropic") return "Anthropic";
    return provider.charAt(0).toUpperCase() + provider.slice(1);
  }

  function buildSummaryModelState() {
    summaryModelsByProvider = Object.create(null);
    summaryProviders = [];
    var seenValues = {};

    for (var i = 0; i < summaryModels.length; i++) {
      var model = summaryModels[i];
      if (!model || typeof model.value !== "string") continue;
      var value = model.value.trim();
      if (!value || seenValues[value]) continue;
      var provider = getSummaryProvider(value);
      if (!provider) continue;
      seenValues[value] = true;

      if (!summaryModelsByProvider[provider]) {
        summaryModelsByProvider[provider] = [];
        summaryProviders.push(provider);
      }

      var label = typeof model.label === "string" && model.label.trim().length > 0
        ? model.label.trim()
        : value;
      summaryModelsByProvider[provider].push({ value: value, label: label });
    }
  }

  function renderSummaryProviderSelect() {
    if (!summaryProviderSelect) return;

    summaryProviderSelect.innerHTML = "";
    for (var i = 0; i < summaryProviders.length; i++) {
      var provider = summaryProviders[i];
      var option = document.createElement("option");
      option.value = provider;
      option.textContent = summaryProviderLabel(provider);
      summaryProviderSelect.appendChild(option);
    }
  }

  function populateSummaryModelSelect(provider, preferredModel) {
    if (!summaryModelSelect) return;

    summaryModelSelect.innerHTML = "";

    var autoOption = document.createElement("option");
    autoOption.value = "";
    autoOption.textContent = "Auto";
    summaryModelSelect.appendChild(autoOption);

    var models = summaryModelsByProvider[provider] || [];
    for (var i = 0; i < models.length; i++) {
      var option = document.createElement("option");
      option.value = models[i].value;
      var shortLabel = models[i].value;
      var labelSlash = shortLabel.indexOf("/");
      if (labelSlash > 0) shortLabel = shortLabel.slice(labelSlash + 1);
      option.textContent = shortLabel;
      summaryModelSelect.appendChild(option);
    }

    var hasPreferred = false;
    if (preferredModel) {
      for (var j = 0; j < models.length; j++) {
        if (models[j].value === preferredModel) {
          hasPreferred = true;
          break;
        }
      }
    }

    if (hasPreferred) {
      summaryModelSelect.value = preferredModel;
    } else if (models.length > 0) {
      summaryModelSelect.value = models[0].value;
    } else {
      summaryModelSelect.value = "";
    }

    currentSummaryModel = typeof summaryModelSelect.value === "string"
      ? summaryModelSelect.value.trim()
      : "";
  }

  function setSummaryProvider(provider, preferredModel) {
    if (summaryProviders.indexOf(provider) === -1) return;
    currentSummaryProvider = provider;

    if (summaryProviderSelect) {
      summaryProviderSelect.value = provider;
    }

    populateSummaryModelSelect(provider, preferredModel);
  }

  function initializeSummaryModelControls() {
    buildSummaryModelState();
    renderSummaryProviderSelect();

    if (summaryProviders.length === 0) {
      currentSummaryProvider = "";
      currentSummaryModel = "";
      if (summaryProviderSelect) summaryProviderSelect.innerHTML = "";
      if (summaryModelSelect) {
        summaryModelSelect.innerHTML = '<option value="">Auto</option>';
        summaryModelSelect.value = "";
      }
      return;
    }

    var defaultProvider = getSummaryProvider(defaultSummaryModel);
    if (defaultProvider && summaryProviders.indexOf(defaultProvider) !== -1) {
      setSummaryProvider(defaultProvider, defaultSummaryModel);
      return;
    }

    setSummaryProvider(summaryProviders[0], "");
  }

  function getSelectedSummaryModel() {
    if (!summaryModelSelect) return currentSummaryModel;
    if (typeof summaryModelSelect.value !== "string") return currentSummaryModel;
    currentSummaryModel = summaryModelSelect.value.trim();
    return currentSummaryModel;
  }

  function getFeedbackText() {
    if (!summaryFeedback || typeof summaryFeedback.value !== "string") return "";
    return summaryFeedback.value;
  }

  function getCoverageSet(provider) {
    var set = providerCoverage.get(provider);
    if (set) return set;
    set = new Set();
    providerCoverage.set(provider, set);
    return set;
  }

  function markCoverage(provider, slotId) {
    if (typeof slotId !== "number") return;
    var normalized = normalizeProvider(provider, "");
    if (!normalized) return;
    getCoverageSet(normalized).add(slotId);
  }

  function removeSlot(slotId) {
    allQueries = allQueries.filter(function(slot) { return slot.slotId !== slotId; });

    providerCoverage.forEach(function(coveredSlots) {
      coveredSlots.delete(slotId);
    });

    queryIndexToSlot.forEach(function(mappedSlotId, qi) {
      if (mappedSlotId === slotId) queryIndexToSlot.delete(qi);
    });

    syncLoadingPanel();
  }

  function isResultMutationLocked() {
    return submitted || timerExpired || submitInFlight;
  }

  function applyProviderInterlocks() {
    var disableProviders = isResultMutationLocked() || providerBatchInFlight || addSearchInFlight;
    for (var i = 0; i < providerButtons.length; i++) {
      var btn = providerButtons[i];
      var state = btn.dataset.state || "idle";
      btn.disabled = disableProviders || state === "loading";
    }

    var disableAddSearch = isResultMutationLocked();
    if (addSearchInput) {
      addSearchInput.disabled = disableAddSearch;
    }

    if (addSearchEl) {
      addSearchEl.style.opacity = disableAddSearch ? "0.6" : "";
      addSearchEl.style.pointerEvents = disableAddSearch ? "none" : "";
    }

    var cards = resultCardsEl ? resultCardsEl.querySelectorAll(".result-card") : [];
    cards.forEach(function(card) {
      var cb = card.querySelector("input[type=checkbox]");
      if (!cb) return;
      var searching = card.classList.contains("searching");
      var error = card.classList.contains("error");
      cb.disabled = searching || error || isResultMutationLocked();
    });
  }

  function recomputeProviderStates() {
    for (var i = 0; i < providerButtons.length; i++) {
      var btn = providerButtons[i];
      var provider = normalizeProvider(btn.dataset.provider, "");
      if (!provider) continue;

      var state = "idle";
      if (providerBatchInFlight && batchLoadingProvider === provider) {
        state = "loading";
      } else if (!initialStreamDone && queries.length > 0 && provider === initialDefaultProvider) {
        state = "loading";
      } else if (allQueries.length > 0) {
        var coveredSlots = providerCoverage.get(provider);
        if (coveredSlots && coveredSlots.size >= allQueries.length) {
          state = "searched";
        }
      }

      btn.dataset.state = state;
      btn.classList.remove("idle", "loading", "searched");
      btn.classList.add(state);
      btn.classList.toggle("is-default", provider === currentProvider);
    }

    applyProviderInterlocks();
  }

  function updateSummaryText() {
    if (completedCount <= 0) return;
    var totalCards = resultCardsEl.querySelectorAll(".result-card").length;
    var searchingCount = totalCards - completedCount;
    if (searchingCount > 0) {
      heroTitle.textContent = completedCount + " of " + totalCards + " Searches Complete";
    } else {
      heroTitle.textContent = completedCount + " Search" + (completedCount !== 1 ? "es" : "") + " Complete";
    }
    heroDesc.textContent = "Check the results to include, then generate and approve a summary.";
    if (heroStatus) heroStatus.textContent = completedCount + " completed" + (searchingCount > 0 ? ", " + searchingCount + " searching" : "");
  }

  function getSummaryDraftText() {
    if (!summaryInput || typeof summaryInput.value !== "string") return "";
    return summaryInput.value.trim();
  }

  function clearError() {
    liveUpdateWarning = false;
    if (!errorBanner) return;
    errorBanner.hidden = true;
    errorBanner.textContent = "";
  }

  function setError(text) {
    liveUpdateWarning = false;
    if (!errorBanner) return;
    errorBanner.textContent = text;
    errorBanner.hidden = false;
  }

  function setLiveUpdateWarning(text) {
    liveUpdateWarning = true;
    if (!errorBanner) return;
    errorBanner.textContent = text;
    errorBanner.hidden = false;
  }

  function clearLiveUpdateWarning() {
    if (liveUpdateWarning) clearError();
  }

  function updateSummaryGeneratingIndicator() {
    if (!summaryGeneratingCopy) return;

    if (stage !== "generating-summary") {
      summaryGeneratingCopy.textContent = "Generating summary draft…";
      summaryGeneratingPhase = -1;
      if (summaryGeneratingEl) {
        summaryGeneratingEl.removeAttribute("data-phase");
      }
      return;
    }

    if (summaryGeneratingStartedAt <= 0) {
      summaryGeneratingStartedAt = Date.now();
    }

    var elapsedMs = Date.now() - summaryGeneratingStartedAt;
    var nextPhase = Math.min(2, Math.floor(elapsedMs / 1800));
    if (nextPhase === summaryGeneratingPhase) return;

    summaryGeneratingPhase = nextPhase;

    var phaseLabel = "Planning summary";
    if (nextPhase === 1) phaseLabel = "Drafting summary";
    if (nextPhase === 2) phaseLabel = "Polishing summary";

    summaryGeneratingCopy.textContent = summaryPendingModel
      ? phaseLabel + " with " + summaryPendingModel + "…"
      : phaseLabel + "…";

    if (summaryGeneratingEl) {
      summaryGeneratingEl.dataset.phase = String(nextPhase);
    }
  }

  function updateStageUI() {
    var showSummary = stage === "summary-review" || stage === "generating-summary" || isRegenerating;
    if (summaryPanel) {
      summaryPanel.classList.toggle("hidden", !showSummary);
      summaryPanel.classList.toggle("updating", isRegenerating);
    }
    if (summarySubtitle) {
      var selCount = getSelectedIndices().length;
      var selLabel = selCount + " selected result" + (selCount !== 1 ? "s" : "");
      if (isRegenerating && stage === "generating-summary") {
        summarySubtitle.textContent = "Selection changed — regenerating summary…";
      } else if (isRegenerating) {
        summarySubtitle.textContent = "Selection changed — summary will regenerate shortly…";
      } else if (stage === "generating-summary") {
        summarySubtitle.textContent = summaryPendingModel
          ? "Summarizing " + selLabel + " with " + summaryPendingModel + "…"
          : "Summarizing " + selLabel + "…";
      } else if (summaryMeta && summaryMeta.fallbackUsed) {
        var fallbackLabel = summaryMeta.phase === "deterministic-fallback" ? "Deterministic fallback summary" : "Fallback summary";
        var fallbackReason = summaryMeta.fallbackReason ? " Reason: " + summaryMeta.fallbackReason + "." : "";
        summarySubtitle.textContent = fallbackLabel + " of " + selLabel + "." + fallbackReason;
      } else {
        summarySubtitle.textContent = "Summary of " + selLabel + ". Edit directly, regenerate with feedback, or approve.";
      }
    }

    if (summaryGeneratingEl) {
      var showGenerating = stage === "generating-summary" && !isRegenerating;
      summaryGeneratingEl.classList.toggle("hidden", !showGenerating);
    }
    updateSummaryGeneratingIndicator();

    if (summaryInput) {
      summaryInput.classList.toggle("hidden", stage === "generating-summary" && !isRegenerating);
      summaryInput.disabled = submitted || timerExpired || stage === "generating-summary" || submitInFlight || isRegenerating;
    }
    if (summaryFeedback) {
      summaryFeedback.disabled = submitted || timerExpired || submitInFlight || stage === "generating-summary" || isRegenerating;
    }
    var disableSummaryModelControls = submitted || timerExpired || stage === "generating-summary" || submitInFlight || summaryProviders.length === 0;
    if (summaryProviderSelect) {
      summaryProviderSelect.disabled = disableSummaryModelControls;
    }
    if (summaryModelSelect) {
      summaryModelSelect.disabled = disableSummaryModelControls;
    }

    var inResults = stage === "results";
    var hasSelection = getSelectedIndices().length > 0;
    var hasCompleted = getCompletedSelectableIndices().length > 0;
    var canGenerate = inResults && !submitted && !timerExpired && !submitInFlight && hasCompleted;

    if (btnSend) {
      if (stage === "generating-summary") {
        btnSend.textContent = "Generating summary…";
        btnSend.disabled = true;
      } else if (!inResults) {
        btnSend.textContent = "Summary ready";
        btnSend.disabled = true;
      } else if (!hasCompleted) {
        btnSend.textContent = searchesDone ? "No results yet" : "Waiting for results…";
        btnSend.disabled = true;
      } else {
        btnSend.textContent = hasSelection ? "Generate summary" : "Select results to summarize";
        btnSend.disabled = !canGenerate || !hasSelection;
      }
    }
    if (sendRawRow) {
      sendRawRow.classList.toggle("hidden", !hasSelection || submitted || timerExpired);
    }
    if (btnSendRaw) {
      btnSendRaw.disabled = !hasSelection || submitted || timerExpired || submitInFlight;
    }

    if (btnSummaryBack) btnSummaryBack.disabled = submitted || timerExpired || submitInFlight || (stage === "generating-summary" && !isRegenerating);
    if (btnSummaryRegenerate) btnSummaryRegenerate.disabled = submitted || timerExpired || submitInFlight || stage === "generating-summary" || isRegenerating;
    var hasDraft = getSummaryDraftText().length > 0;
    if (btnSummaryPreview) btnSummaryPreview.disabled = !hasDraft || stage === "generating-summary";
    if (btnSummaryApprove) {
      btnSummaryApprove.disabled = submitted || timerExpired || submitInFlight || stage === "generating-summary" || isRegenerating || !hasSelection || !hasDraft;
    }

    applyProviderInterlocks();
  }

  function shouldShowLoadingPanel() {
    if (submitted || timerExpired || searchesDone) return false;
    if (completedCount > 0) return false;
    return allQueries.length > 0;
  }

  function ensureLoadingPanel() {
    if (loadingPanelEl) return loadingPanelEl;
    if (!resultCardsEl) return null;

    var panel = document.createElement("div");
    panel.className = "result-loading";
    panel.innerHTML =
      '<div class="result-loading-header">' +
        '<div class="result-loading-title">Searching sources</div>' +
        '<div class="result-loading-sub">Searching\u2026</div>' +
      '</div>' +
      '<div class="result-loading-grid">' +
        '<div class="loading-card"><div class="loading-card-row long"></div><div class="loading-card-row mid"></div><div class="loading-card-row short"></div></div>' +
        '<div class="loading-card"><div class="loading-card-row long"></div><div class="loading-card-row mid"></div><div class="loading-card-row short"></div></div>' +
      '</div>';

    resultCardsEl.prepend(panel);
    loadingPanelEl = panel;
    return panel;
  }

  function updateLoadingPanelSummary() {
    if (!loadingPanelEl) return;
    var sub = loadingPanelEl.querySelector(".result-loading-sub");
    if (!sub) return;

    var total = allQueries.length;
    if (total <= 0) {
      sub.textContent = "Searching\u2026";
      return;
    }

    var done = Math.min(completedCount, total);
    var noun = total === 1 ? "query" : "queries";
    sub.textContent = "Searching " + done + "/" + total + " " + noun + "\u2026";
  }

  function syncLoadingPanel() {
    if (shouldShowLoadingPanel()) {
      if (!ensureLoadingPanel()) return;
      updateLoadingPanelSummary();
      return;
    }

    if (loadingPanelEl) {
      loadingPanelEl.remove();
      loadingPanelEl = null;
    }
  }

  function renderErrorCard(card, queryText, errorText, provider) {
    var tag = providerTagHtml(provider);
    card.innerHTML =
      '<div class="result-card-header">' +
        '<input type="checkbox" disabled>' +
        '<div class="result-card-info">' +
          '<div class="result-card-query-row">' +
            '<div class="result-card-query">' + escHtml(queryText) + "</div>" +
            tag +
          "</div>" +
          '<div class="result-card-meta" style="color:var(--timer-urgent-fg)">Failed</div>' +
        "</div>" +
      "</div>" +
      '<div class="result-card-error-msg">' + escHtml(errorText || "Search failed") + "</div>";
  }

  function populateResultCard(card, data, queryText, provider) {
    var sourceCount = data.results ? data.results.length : 0;
    var domains = [];
    if (data.results) {
      for (var i = 0; i < Math.min(data.results.length, 3); i++) {
        domains.push(data.results[i].domain);
      }
    }
    var metaText = sourceCount + " source" + (sourceCount !== 1 ? "s" : "");
    if (domains.length > 0) metaText += " \u00B7 " + domains.join(", ");
    if (sourceCount > 3) metaText += ", +" + (sourceCount - 3);

    var preview = "";
    if (data.answer) {
      preview = data.answer.substring(0, 200).replace(/\\n+/g, " ").replace(/[#*_\\[\\]]/g, "");
    }

    var bodyHtml = "";
    if (data.answer) {
      var rendered = typeof marked !== "undefined" && marked.parse
        ? marked.parse(data.answer, { breaks: true })
        : "<p>" + escHtml(data.answer) + "</p>";
      bodyHtml += '<div class="result-card-answer">' + sanitizeMarkdownHtml(rendered) + "</div>";
    }
    if (data.results && data.results.length > 0) {
      bodyHtml += '<div class="result-card-sources"><div class="result-card-sources-title">Sources</div>';
      for (var k = 0; k < data.results.length; k++) {
        var r = data.results[k];
        var label = r.title && r.title.indexOf("Source ") !== 0 ? r.title : r.url;
        var href = sanitizeHref(r.url);
        bodyHtml += '<a class="source-link" href="' + escHtml(href) + '" target="_blank" rel="noopener noreferrer">' + escHtml(label) + '<span class="source-domain">' + escHtml(r.domain) + "</span></a>";
      }
      bodyHtml += "</div>";
    }

    var altChipsHtml = buildAltChipsHtml(provider, queryText);

    card.innerHTML =
      '<div class="result-card-header">' +
        '<input type="checkbox" checked>' +
        '<div class="result-card-info">' +
          '<div class="result-card-query-row">' +
            '<div class="result-card-query">' + escHtml(queryText) + "</div>" +
            providerTagHtml(provider) +
          "</div>" +
          '<div class="result-card-meta">' + escHtml(metaText) + "</div>" +
          (preview ? '<div class="result-card-preview">' + escHtml(preview) + "</div>" : "") +
        "</div>" +
        '<div class="result-card-expand">\u25BC</div>' +
      "</div>" +
      altChipsHtml +
      '<div class="result-card-body">' + bodyHtml + "</div>";
  }

  function createSearchingCard(queryText, provider) {
    var card = document.createElement("div");
    card.className = "result-card searching";
    card.innerHTML =
      '<div class="result-card-header">' +
        '<input type="checkbox" checked disabled>' +
        '<div class="result-card-info">' +
          '<div class="result-card-query-row">' +
            '<div class="result-card-query">' + escHtml(queryText) + "</div>" +
            providerTagHtml(provider) +
          "</div>" +
          '<div class="result-card-meta"><span class="searching-dots">Searching</span></div>' +
        "</div>" +
      "</div>" +
      buildAltChipsHtml(provider, queryText);
    return card;
  }

  function insertResultCard(card, slotId, afterCard) {
    card.dataset.slot = String(slotId);
    if (afterCard && afterCard.parentNode === resultCardsEl) {
      resultCardsEl.insertBefore(card, afterCard.nextSibling);
      return;
    }
    var slotCards = resultCardsEl.querySelectorAll('.result-card[data-slot="' + slotId + '"]');
    var lastCard = slotCards.length > 0 ? slotCards[slotCards.length - 1] : null;
    if (lastCard) resultCardsEl.insertBefore(card, lastCard.nextSibling);
    else resultCardsEl.appendChild(card);
  }

  function applySearchResponseEntries(primaryCard, data, queryText, providerHint, slotId) {
    var entries = Array.isArray(data && data.entries) && data.entries.length > 0 ? data.entries : [data];
    var previousCard = primaryCard;
    for (var entryIndex = 0; entryIndex < entries.length; entryIndex++) {
      var entry = entries[entryIndex];
      var entryProvider = normalizeProvider(entry && entry.provider, providerHint);
      var targetCard = entryIndex === 0 ? primaryCard : createSearchingCard(queryText, entryProvider);
      if (entryIndex > 0) insertResultCard(targetCard, slotId, previousCard);
      applyResponseToCard(targetCard, entry, queryText, entryProvider, slotId);
      previousCard = targetCard;
    }
  }

  function applyResponseToCard(card, data, queryText, providerHint, slotHint) {
    if (!card || !data) return;
    if (submitted || timerExpired) return;

    var queryIndex = typeof data.queryIndex === "number" ? data.queryIndex : null;
    if (queryIndex !== null) {
      card.dataset.qi = String(queryIndex);
    }

    var slotId = typeof slotHint === "number" ? slotHint : (queryIndex !== null ? queryIndexToSlot.get(queryIndex) : undefined);
    if (typeof slotId !== "number" && queryIndex !== null) {
      slotId = queryIndex;
    }
    if (queryIndex !== null && typeof slotId === "number") {
      queryIndexToSlot.set(queryIndex, slotId);
    }
    if (typeof slotId === "number") {
      card.dataset.slot = String(slotId);
    }

    var provider = normalizeProvider(data.provider, providerHint);

    card.classList.remove("searching", "checked", "error");

    if (data.error) {
      card.classList.add("error");
      renderErrorCard(card, queryText, data.error, provider);
    } else {
      card.classList.add("checked");
      populateResultCard(card, data, queryText, provider);
      setupCardInteraction(card);
    }

    if (card.dataset.completed !== "true") {
      completedCount++;
      card.dataset.completed = "true";
    }
    markCoverage(provider, slotId);
    updateSummaryText();
    syncLoadingPanel();
    recomputeProviderStates();
    updateStageUI();
    maybeAutoGenerateSummary();
    resetTimer();
  }

  function resetTimer() { lastInteraction = Date.now(); }

  function updateTimer() {
    var idleSec = searchesDone ? Math.floor((Date.now() - lastInteraction) / 1000) : 0;
    var remaining = Math.max(0, timeoutSec - idleSec);
    timerEl.textContent = formatTime(remaining);

    timerEl.classList.remove("warn", "urgent", "active");
    if (remaining <= 15) timerEl.classList.add("urgent");
    else if (remaining <= 30) timerEl.classList.add("warn");
    else if (remaining < timeoutSec) timerEl.classList.add("active");

    updateSummaryGeneratingIndicator();

    if (remaining <= 0 && !submitted && !timerExpired) onTimeout();
  }

  setInterval(updateTimer, 1000);
  updateTimer();

  ["click", "keydown", "input", "change"].forEach(function(evt) {
    document.addEventListener(evt, resetTimer, { passive: true });
  });
  document.addEventListener("scroll", resetTimer, { passive: true });
  document.addEventListener("mousemove", resetTimer, { passive: true });

  timerEl.addEventListener("click", function(e) {
    e.stopPropagation();
    timerInput.value = timeoutSec;
    timerAdjustEl.classList.add("visible");
    timerEl.style.display = "none";
    timerInput.focus();
    timerInput.select();
  });

  function applyTimerAdjust() {
    var val = parseInt(timerInput.value, 10);
    if (val && val > 0) timeoutSec = Math.min(val, 600);
    timerAdjustEl.classList.remove("visible");
    timerEl.style.display = "";
    resetTimer();
  }

  timerSetBtn.addEventListener("click", function(e) { e.stopPropagation(); applyTimerAdjust(); });
  timerInput.addEventListener("keydown", function(e) {
    if (e.key === "Enter") { e.preventDefault(); applyTimerAdjust(); }
    if (e.key === "Escape") { timerAdjustEl.classList.remove("visible"); timerEl.style.display = ""; }
    e.stopPropagation();
  });
  document.addEventListener("click", function() {
    if (timerAdjustEl.classList.contains("visible")) {
      timerAdjustEl.classList.remove("visible");
      timerEl.style.display = "";
    }
  });

  function setDefaultProvider(provider, persist) {
    var normalized = normalizeProvider(provider, currentProvider);
    if (!normalized) return;
    currentProvider = normalized;
    currentSearchProvider = normalized;
    recomputeProviderStates();
    if (persist) {
      postJson("/provider", { provider: normalized }).then(function(data) {
        if (data && data.ok === false) {
          throw new Error(extractServerError(data) || "request rejected");
        }
      }).catch(function(err) {
        var message = err instanceof Error ? err.message : String(err);
        setError("Failed to save provider preference: " + (message || "unknown error"));
      });
    }
  }

  providerButtons.forEach(function(btn) {
    btn.addEventListener("click", function() {
      if (isResultMutationLocked()) return;
      if (providerBatchInFlight || addSearchInFlight) return;

      var provider = normalizeProvider(btn.dataset.provider, "");
      if (!provider) return;

      var state = btn.dataset.state || "idle";
      if (state === "loading") return;

      if (state === "searched") {
        if (provider === currentProvider) return;
        setDefaultProvider(provider, true);
        resetTimer();
        return;
      }

      setDefaultProvider(provider, true);
      if (allQueries.length === 0) {
        resetTimer();
        return;
      }

      interruptSummaryIfNeeded();
      providerBatchInFlight = true;
      batchLoadingProvider = provider;
      recomputeProviderStates();

      var batchQueries = allQueries.slice();
      var inflight = batchQueries.length;
      if (inflight === 0) {
        providerBatchInFlight = false;
        batchLoadingProvider = null;
        recomputeProviderStates();
        return;
      }

      var batchCards = [];
      for (var bi = 0; bi < batchQueries.length; bi++) {
        var bq = batchQueries[bi];
        var card = createSearchingCard(bq.query, provider);
        insertResultCard(card, bq.slotId, null);
        batchCards.push(card);
      }
      updateSummaryText();

      batchQueries.forEach(function(slot, si) {
        var searchingCard = batchCards[si];
        postJson("/search", { query: slot.query, provider: provider })
          .then(function(data) {
            if (submitted || timerExpired) return;
            if (!data || data.ok === false) {
              applyResponseToCard(searchingCard, {
                answer: "",
                results: [],
                error: extractServerError(data) || "Search failed",
                provider: provider,
              }, slot.query, provider, slot.slotId);
              return;
            }
            applySearchResponseEntries(searchingCard, data, slot.query, provider, slot.slotId);
          })
          .catch(function(err) {
            if (submitted || timerExpired) return;
            var message = err instanceof Error ? err.message : String(err);
            applyResponseToCard(searchingCard, {
              answer: "",
              results: [],
              error: message || "Search failed",
              provider: provider,
            }, slot.query, provider, slot.slotId);
          })
          .finally(function() {
            inflight -= 1;
            if (inflight <= 0) {
              providerBatchInFlight = false;
              batchLoadingProvider = null;
              recomputeProviderStates();
              updateStageUI();
              maybeAutoGenerateSummary();
            }
          });
      });

      resetTimer();
    });
  });

  if (resultCardsEl) {
    resultCardsEl.addEventListener("click", function(e) {
      if (!(e.target instanceof Element)) return;
      var chip = e.target.closest(".card-alt-chip");
      if (!chip) return;
      if (isResultMutationLocked()) return;

      var altProvider = chip.dataset.altProvider;
      var altQuery = chip.dataset.altQuery;
      if (!altProvider || !altQuery) return;

      interruptSummaryIfNeeded();

      chip.classList.add("loading");
      chip.disabled = true;
      resetTimer();

      var slotId = nextSlotId++;
      allQueries.push({ slotId: slotId, query: altQuery });

      var parentCard = chip.closest(".result-card");
      var newCard = createSearchingCard(altQuery, altProvider);
      insertResultCard(newCard, slotId, parentCard);
      updateSummaryText();

      postJson("/search", { query: altQuery, provider: altProvider })
        .then(function(data) {
          if (submitted || timerExpired) return;
          if (!data || data.ok === false) {
            applyResponseToCard(newCard, {
              answer: "", results: [],
              error: extractServerError(data) || "Search failed",
              provider: altProvider,
            }, altQuery, altProvider, slotId);
            return;
          }
          applySearchResponseEntries(newCard, data, altQuery, altProvider, slotId);
        })
        .catch(function(err) {
          removeSlot(slotId);
          newCard.remove();
          var message = err instanceof Error ? err.message : String(err);
          setError("Re-search failed: " + (message || "Search failed"));
          updateSummaryText();
        })
        .finally(function() {
          chip.classList.remove("loading");
          chip.disabled = false;
          recomputeProviderStates();
          updateStageUI();
          maybeAutoGenerateSummary();
        });
    });
  }

  if (addSearchInput && addSearchWand) {
    addSearchInput.addEventListener("input", function() {
      addSearchWand.disabled = rewriteInFlight || !addSearchInput.value.trim() || isResultMutationLocked();
    });

    addSearchWand.addEventListener("click", function() {
      var text = addSearchInput.value.trim();
      if (!text || rewriteInFlight || isResultMutationLocked()) return;
      rewriteInFlight = true;
      addSearchWand.disabled = true;
      addSearchWand.classList.add("rewriting");
      resetTimer();

      postJson("/rewrite", { query: text })
        .then(function(data) {
          if (!data || data.ok === false) {
            throw new Error(extractServerError(data) || "Rewrite failed");
          }
          var rewritten = typeof data.query === "string" ? data.query.trim() : "";
          if (rewritten) {
            addSearchInput.value = rewritten;
            addSearchInput.focus();
          }
        })
        .catch(function(err) {
          var message = err instanceof Error ? err.message : String(err);
          setError("Rewrite failed: " + (message || "unknown error"));
        })
        .finally(function() {
          rewriteInFlight = false;
          addSearchWand.classList.remove("rewriting");
          addSearchWand.disabled = !addSearchInput.value.trim() || isResultMutationLocked();
        });
    });
  }

  addSearchInput.addEventListener("keydown", function(e) {
    if (e.key !== "Enter") return;
    var text = addSearchInput.value.trim();
    if (!text || isResultMutationLocked()) return;
    interruptSummaryIfNeeded();
    e.preventDefault();
    e.stopPropagation();

    addSearchInFlight++;
    applyProviderInterlocks();
    addSearchInput.value = "";

    var slotId = nextSlotId++;
    allQueries.push({ slotId: slotId, query: text });
    syncLoadingPanel();
    recomputeProviderStates();

    var requestedProvider = currentSearchProvider;
    var displayProvider = currentProvider;

    var card = createSearchingCard(text, displayProvider);
    insertResultCard(card, slotId, null);
    updateSummaryText();
    resetTimer();

    var searchPayload = { query: text };
    if (requestedProvider !== "auto") searchPayload.provider = requestedProvider;

    postJson("/search", searchPayload)
      .then(function(data) {
        if (!data || data.ok === false) {
          removeSlot(slotId);
          card.remove();
          setError("Failed to add search: " + (extractServerError(data) || "Search failed"));
          recomputeProviderStates();
          updateSummaryText();
          return;
        }

        if (submitted || timerExpired) return;

        applySearchResponseEntries(card, data, text, displayProvider, slotId);
      })
      .catch(function(err) {
        removeSlot(slotId);
        card.remove();
        var message = err instanceof Error ? err.message : String(err);
        setError("Failed to add search: " + (message || "Search failed"));
        recomputeProviderStates();
        updateSummaryText();
      })
      .finally(function() {
        addSearchInFlight--;
        recomputeProviderStates();
        updateStageUI();
        maybeAutoGenerateSummary();
      });
  });

  function showSuccess(text) {
    if (es) { es.close(); es = null; }
    closePreviewModal();
    successText.textContent = text;
    successOverlay.classList.remove("hidden");
    setTimeout(function() { window.close(); }, 800);
  }

  function showExpired(text) {
    if (es) { es.close(); es = null; }
    closePreviewModal();
    expiredText.textContent = text;
    expiredOverlay.classList.remove("hidden");
    requestAnimationFrame(function() { expiredOverlay.classList.add("visible"); });
  }

  function startOverlayCloseCountdown(seconds) {
    var count = seconds;
    closeCountdown.textContent = count;
    var iv = setInterval(function() {
      count--;
      closeCountdown.textContent = count;
      if (count <= 0) {
        clearInterval(iv);
        window.close();
      }
    }, 1000);
  }

  function submitPayload(payload, successText) {
    if (submitInFlight) return Promise.reject(new Error("Submit already in progress"));
    submitInFlight = true;
    submitted = true;
    syncLoadingPanel();
    updateStageUI();
    clearError();

    return postJson("/submit", payload)
      .then(function(data) {
        if (data && data.ok === false) {
          throw new Error(extractServerError(data) || "submit rejected");
        }
        showSuccess(successText);
      })
      .catch(function(err) {
        submitInFlight = false;
        submitted = false;
        syncLoadingPanel();
        updateStageUI();
        throw err;
      });
  }

  function submitWithTimeoutFallback(payload) {
    if (submitInFlight) return;
    submitInFlight = true;
    submitted = true;
    timerExpired = true;
    syncLoadingPanel();
    updateStageUI();
    clearError();
    showExpired("Time\u2019s up \u2014 submitting current summary state.");

    function finalizeClose() {
      submitInFlight = false;
      startOverlayCloseCountdown(5);
    }

    function toErrorMessage(err) {
      return err instanceof Error ? err.message : String(err);
    }

    function attemptCancelFallback(submitErrorMessage) {
      return postJson("/cancel", { reason: "timeout" })
        .catch(function(cancelErr) {
          console.error("Timeout finalize failed after submit errors:", submitErrorMessage, "| cancel:", toErrorMessage(cancelErr));
        })
        .finally(finalizeClose);
    }

    postJson("/submit", payload)
      .then(function(data) {
        if (data && data.ok === false) {
          throw new Error(extractServerError(data) || "submit rejected");
        }
        finalizeClose();
      })
      .catch(function(firstErr) {
        var firstMessage = toErrorMessage(firstErr);
        setTimeout(function() {
          postJson("/submit", payload)
            .then(function(data) {
              if (data && data.ok === false) {
                throw new Error(extractServerError(data) || "submit rejected");
              }
              finalizeClose();
            })
            .catch(function(secondErr) {
              var secondMessage = toErrorMessage(secondErr);
              attemptCancelFallback(firstMessage + " | " + secondMessage);
            });
        }, 250);
      });
  }

  function onTimeout() {
    if (submitted || timerExpired) return;
    var timeoutSelected = getTimeoutSelectedIndices();
    var payload = { selected: timeoutSelected };
    var draft = getSummaryDraftText();
    if (stage === "summary-review" && draft.length > 0) {
      payload.summary = draft;
      if (summaryMeta) payload.summaryMeta = summaryMeta;
    }
    submitWithTimeoutFallback(payload);
  }

  if (queries.length === 0) {
    heroTitle.textContent = "What do you need?";
    heroDesc.textContent = "Search for anything below, then generate and approve a summary.";
    if (heroStatus) heroStatus.textContent = "";
    btnSend.textContent = "No results yet";
  } else {
    for (var i = 0; i < queries.length; i++) {
      queryIndexToSlot.set(i, i);
      var card = createSearchingCard(queries[i], initialDefaultProvider);
      card.dataset.qi = i;
      insertResultCard(card, i, null);
    }
  }

  initializeSummaryModelControls();
  syncLoadingPanel();
  recomputeProviderStates();
  updateStageUI();

  es = new EventSource("/events?session=" + encodeURIComponent(token));

  function parseSseEventData(eventName, e) {
    try {
      return JSON.parse(e.data);
    } catch (err) {
      var message = err instanceof Error ? err.message : String(err);
      setError("Invalid " + eventName + " event payload: " + (message || "unknown parse error"));
      return null;
    }
  }

  function applyResultEvent(data) {
    if (!data) return;
    lastLiveEventAt = Date.now();
    clearLiveUpdateWarning();

    var queryText = data.query || queries[data.queryIndex] || "";
    var slotId = typeof data.slotIndex === "number" ? data.slotIndex : queryIndexToSlot.get(data.queryIndex);
    if (typeof slotId !== "number") slotId = data.queryIndex;
    var card = resultCardsEl.querySelector('.result-card[data-qi="' + data.queryIndex + '"]');
    if (!card) {
      card = createSearchingCard(queryText, data.provider);
      card.dataset.qi = data.queryIndex;
      insertResultCard(card, slotId, null);
    } else if (card.dataset.completed === "true") {
      return;
    }
    applyResponseToCard(card, data, queryText, data.provider, slotId);
  }

  function applySearchErrorEvent(data) {
    if (!data) return;
    lastLiveEventAt = Date.now();
    clearLiveUpdateWarning();

    var queryText = data.query || queries[data.queryIndex] || "";
    var slotId = typeof data.slotIndex === "number" ? data.slotIndex : queryIndexToSlot.get(data.queryIndex);
    if (typeof slotId !== "number") slotId = data.queryIndex;
    var card = resultCardsEl.querySelector('.result-card[data-qi="' + data.queryIndex + '"]');
    if (!card) {
      card = createSearchingCard(queryText, data.provider);
      card.dataset.qi = data.queryIndex;
      insertResultCard(card, slotId, null);
    } else if (card.dataset.completed === "true") {
      return;
    }
    applyResponseToCard(card, {
      queryIndex: data.queryIndex,
      answer: "",
      results: [],
      error: data.error || "Search failed",
      provider: data.provider,
    }, queryText, data.provider, slotId);
  }

  function applyDoneEvent() {
    var wasSearchesDone = searchesDone;
    lastLiveEventAt = Date.now();
    clearLiveUpdateWarning();
    searchesDone = true;
    initialStreamDone = true;
    if (completedCount > 0) {
      updateSummaryText();
    }
    syncLoadingPanel();
    recomputeProviderStates();
    updateStageUI();
    maybeAutoGenerateSummary();
    if (!wasSearchesDone) resetTimer();
  }

  function applyStoredLiveEvent(item) {
    if (!item || typeof item !== "object") return;
    if (item.event === "result") applyResultEvent(item.data);
    if (item.event === "search-error") applySearchErrorEvent(item.data);
  }

  function syncStateFromServer(showWarning) {
    if (stateSyncInFlight || submitted || timerExpired || searchesDone) return;
    stateSyncInFlight = true;
    fetch("/state?session=" + encodeURIComponent(token), { cache: "no-store" })
      .then(function(res) {
        return res.text().then(function(raw) {
          var data = raw ? JSON.parse(raw) : null;
          if (!res.ok || !data || data.ok === false) {
            throw new Error(extractServerError(data) || ("HTTP " + res.status));
          }
          return data;
        });
      })
      .then(function(data) {
        if (Array.isArray(data.events)) {
          data.events.forEach(applyStoredLiveEvent);
        }
        if (data.done) applyDoneEvent();
        if (showWarning && !searchesDone) {
          setLiveUpdateWarning("Live search updates disconnected. Reconnecting and polling for results.");
        }
      })
      .catch(function(err) {
        if (!showWarning || submitted || timerExpired) return;
        var message = err instanceof Error ? err.message : String(err);
        setLiveUpdateWarning("Live search updates disconnected. Retrying: " + (message || "unknown error"));
      })
      .finally(function() {
        stateSyncInFlight = false;
      });
  }

  es.addEventListener("open", function() {
    lastLiveEventAt = Date.now();
    clearLiveUpdateWarning();
    syncStateFromServer(false);
  });

  es.addEventListener("result", function(e) {
    var data = parseSseEventData("result", e);
    applyResultEvent(data);
  });

  es.addEventListener("search-error", function(e) {
    var data = parseSseEventData("search-error", e);
    applySearchErrorEvent(data);
  });

  es.addEventListener("done", function() {
    applyDoneEvent();
  });

  es.onerror = function() {
    if (submitted || timerExpired || searchesDone) return;
    syncStateFromServer(true);
  };

  setInterval(function() {
    if (submitted || timerExpired || searchesDone || initialStreamDone) return;
    if (Date.now() - lastLiveEventAt <= 5000) return;
    syncStateFromServer(false);
  }, 5000);

  function setupCardInteraction(card) {
    var header = card.querySelector(".result-card-header");
    var body = card.querySelector(".result-card-body");
    var cb = card.querySelector("input[type=checkbox]");
    var expandEl = card.querySelector(".result-card-expand");

    if (!header || !cb) return;

    header.addEventListener("click", function(e) {
      if (e.target.tagName === "A") return;
      if (e.target === cb) {
        if (isResultMutationLocked()) {
          e.preventDefault();
          return;
        }
        card.classList.toggle("checked", cb.checked);
        if (stage === "summary-review" || stage === "generating-summary") {
          interruptSummaryIfNeeded();
        }
        updateStageUI();
        maybeAutoGenerateSummary();
        return;
      }
      var isExpanded = body && body.classList.contains("open");
      if (body) body.classList.toggle("open");
      if (expandEl) expandEl.textContent = isExpanded ? "\u25BC" : "\u25B2";
    });

    if (body) {
      body.addEventListener("click", function(e) {
        e.stopPropagation();
      });
    }
  }

  function getSelectedIndices() {
    var indices = [];
    var cards = resultCardsEl.querySelectorAll(".result-card");
    cards.forEach(function(card) {
      if (card.dataset.completed !== "true") return;
      if (card.classList.contains("error")) return;
      var cb = card.querySelector("input[type=checkbox]");
      if (!cb || !cb.checked) return;
      var qi = parseInt(card.dataset.qi, 10);
      if (!Number.isNaN(qi)) indices.push(qi);
    });
    return indices;
  }

  function getCompletedSelectableIndices() {
    var indices = [];
    var cards = resultCardsEl.querySelectorAll(".result-card");
    cards.forEach(function(card) {
      if (card.dataset.completed !== "true") return;
      if (card.classList.contains("error")) return;
      var qi = parseInt(card.dataset.qi, 10);
      if (!Number.isNaN(qi)) indices.push(qi);
    });
    return indices;
  }

  function hasPendingSearchCards() {
    var cards = resultCardsEl.querySelectorAll(".result-card");
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      if (card.dataset.completed !== "true") return true;
    }
    return addSearchInFlight || providerBatchInFlight;
  }

  function getTimeoutSelectedIndices() {
    var selected = getSelectedIndices();
    if (selected.length > 0) return selected;
    return getCompletedSelectableIndices();
  }

  function normalizeSummaryMeta(meta, edited) {
    if (!meta || typeof meta !== "object") {
      return {
        model: null,
        durationMs: 0,
        tokenEstimate: 0,
        fallbackUsed: false,
        edited: !!edited,
      };
    }

    return {
      model: typeof meta.model === "string" || meta.model === null ? meta.model : null,
      durationMs: typeof meta.durationMs === "number" && Number.isFinite(meta.durationMs) && meta.durationMs >= 0 ? meta.durationMs : 0,
      tokenEstimate: typeof meta.tokenEstimate === "number" && Number.isFinite(meta.tokenEstimate) && meta.tokenEstimate >= 0 ? meta.tokenEstimate : 0,
      fallbackUsed: meta.fallbackUsed === true,
      fallbackReason: typeof meta.fallbackReason === "string" ? meta.fallbackReason : undefined,
      phase: meta.phase === "summary-model" || meta.phase === "deterministic-fallback" ? meta.phase : undefined,
      edited: !!edited,
    };
  }

  function isSummaryModelSelectionError(message) {
    if (typeof message !== "string") return false;
    return message.indexOf("Invalid summary model") !== -1
      || message.indexOf("Summary model not found") !== -1
      || message.indexOf("No API key available for summary model") !== -1
      || message.indexOf("Invalid provider") !== -1;
  }

  function resetSummaryGeneratingState() {
    summaryPendingModel = "";
    summaryGeneratingStartedAt = 0;
    summaryGeneratingPhase = -1;
  }

  function cancelInFlightSummaryRequest() {
    summaryRequestSeq += 1;
    resetSummaryGeneratingState();
  }

  function interruptSummaryIfNeeded() {
    if (stage !== "generating-summary" && stage !== "summary-review") return;
    if (stage === "generating-summary") {
      cancelInFlightSummaryRequest();
    }
    clearError();
    isRegenerating = getSummaryDraftText().length > 0;
    stage = "results";
    updateStageUI();
  }

  function exitRegeneratingState() {
    if (!isRegenerating) return false;
    if (stage === "generating-summary") {
      cancelInFlightSummaryRequest();
    }
    isRegenerating = false;
    clearError();
    stage = "results";
    updateStageUI();
    return true;
  }

  function requestSummary(indices, feedback) {
    if (submitted || timerExpired || submitInFlight) return;

    if (!Array.isArray(indices) || indices.length === 0) {
      setError("Select at least one result to summarize");
      stage = "results";
      updateStageUI();
      return;
    }

    if (hasPendingSearchCards()) {
      setError("Wait for running searches to finish before generating summary");
      stage = "results";
      updateStageUI();
      return;
    }

    clearError();
    var previousStage = stage;
    var wasRegenerating = isRegenerating;
    var selectedSummaryModel = getSelectedSummaryModel();
    summaryPendingModel = selectedSummaryModel;
    summaryGeneratingStartedAt = Date.now();
    summaryGeneratingPhase = -1;
    stage = "generating-summary";
    updateStageUI();

    var requestId = ++summaryRequestSeq;
    var feedbackText = typeof feedback === "string" ? feedback.trim() : "";
    var summarizePayload = { selected: indices };
    if (selectedSummaryModel.length > 0) {
      summarizePayload.model = selectedSummaryModel;
    }
    if (feedbackText.length > 0) {
      summarizePayload.feedback = feedbackText;
    }

    postJson("/summarize", summarizePayload)
      .then(function(data) {
        if (requestId !== summaryRequestSeq) return data;
        if (!data || data.ok === false) {
          throw new Error(extractServerError(data) || "summary request rejected");
        }
        return data;
      })
      .catch(function(err) {
        if (requestId !== summaryRequestSeq) throw err;

        var firstMessage = err instanceof Error ? err.message : String(err);
        if (selectedSummaryModel.length === 0 || !isSummaryModelSelectionError(firstMessage)) {
          throw err;
        }

        summaryPendingModel = "";
        updateStageUI();

        var retryPayload = { selected: indices };
        if (feedbackText.length > 0) {
          retryPayload.feedback = feedbackText;
        }
        return postJson("/summarize", retryPayload).then(function(retryData) {
          if (!retryData || retryData.ok === false) {
            throw new Error(extractServerError(retryData) || "summary request rejected");
          }
          return retryData;
        }).catch(function(retryErr) {
          var retryMessage = retryErr instanceof Error ? retryErr.message : String(retryErr);
          throw new Error(firstMessage + " (auto retry failed: " + (retryMessage || "unknown error") + ")");
        });
      })
      .then(function(data) {
        if (requestId !== summaryRequestSeq) return;

        var summaryText = typeof data.summary === "string" ? data.summary.trim() : "";
        if (!summaryText) {
          throw new Error("Summary response was empty");
        }

        if (summaryInput) {
          summaryInput.value = summaryText;
        }
        if (summaryFeedback) {
          summaryFeedback.value = "";
        }
        summaryMeta = normalizeSummaryMeta(data.meta || null, false);
        lastAutoSummarySignature = selectionSignature(indices);
        resetSummaryGeneratingState();
        isRegenerating = false;
        stage = "summary-review";
        updateStageUI();
      })
      .catch(function(err) {
        if (requestId !== summaryRequestSeq) return;
        var message = err instanceof Error ? err.message : String(err);
        setError("Failed to generate summary — " + (message || "unknown error"));
        resetSummaryGeneratingState();
        isRegenerating = false;
        if (wasRegenerating && getSummaryDraftText().length > 0) {
          stage = "summary-review";
        } else {
          stage = previousStage === "summary-review" ? "summary-review" : "results";
        }
        updateStageUI();
      });
  }

  function selectionSignature(indices) {
    return indices.slice().sort(function(a, b) { return a - b; }).join(",");
  }

  function maybeAutoGenerateSummary() {
    if (workflow !== "summary-review") return;
    if (!searchesDone) return;
    if (stage !== "results") return;
    if (submitted || timerExpired || submitInFlight) return;
    if (hasPendingSearchCards()) return;

    var selected = getSelectedIndices();
    if (selected.length === 0) {
      if (isRegenerating) {
        isRegenerating = false;
        updateStageUI();
      }
      return;
    }

    var signature = selectionSignature(selected);
    if (signature === lastAutoSummarySignature) {
      if (isRegenerating) {
        isRegenerating = false;
        if (getSummaryDraftText().length > 0) {
          stage = "summary-review";
        }
        updateStageUI();
      }
      return;
    }

    lastAutoSummarySignature = signature;
    requestSummary(selected);
  }

  function doApprove() {
    if (submitted || timerExpired || submitInFlight || stage !== "summary-review") return;

    var selected = getSelectedIndices();
    if (selected.length === 0) {
      setError("Select at least one result before approving");
      updateStageUI();
      return;
    }

    var draft = getSummaryDraftText();
    var payload = { selected: selected };
    if (draft.length > 0) {
      payload.summary = draft;
      payload.summaryMeta = normalizeSummaryMeta(summaryMeta, summaryMeta && summaryMeta.edited === true);
    }

    submitPayload(payload, "Summary approved")
      .catch(function(err) {
        var message = err instanceof Error ? err.message : String(err);
        setError("Failed to approve summary — " + (message || "the agent may have moved on"));
      });
  }

  function doCancel() {
    if (submitted || timerExpired || submitInFlight) return;
    submitted = true;
    submitInFlight = true;
    syncLoadingPanel();
    updateStageUI();
    clearError();

    postJson("/cancel", { reason: "user" })
      .then(function(data) {
        if (data && data.ok === false) {
          throw new Error(extractServerError(data) || "cancel rejected");
        }
        showSuccess("Skipped");
      })
      .catch(function(err) {
        submitted = false;
        submitInFlight = false;
        syncLoadingPanel();
        updateStageUI();
        var message = err instanceof Error ? err.message : String(err);
        setError("Failed to cancel — " + (message || "the agent may have moved on"));
      });
  }

  btnSend.addEventListener("click", function() {
    if (stage !== "results") return;
    requestSummary(getSelectedIndices());
  });

  if (btnSendRaw) {
    btnSendRaw.addEventListener("click", function() {
      var selected = getSelectedIndices();
      if (selected.length === 0) return;
      submitPayload({ selected: selected, rawResults: true }, "Results sent")
        .catch(function(err) {
          var message = err instanceof Error ? err.message : String(err);
          setError("Failed to send results — " + (message || "the agent may have moved on"));
        });
    });
  }

  if (btnSummaryBack) {
    btnSummaryBack.addEventListener("click", function() {
      if (exitRegeneratingState()) {
        resetTimer();
        return;
      }
      if (stage !== "summary-review") return;
      clearError();
      stage = "results";
      updateStageUI();
      resetTimer();
    });
  }

  if (btnSummaryRegenerate) {
    btnSummaryRegenerate.addEventListener("click", function() {
      requestSummary(getSelectedIndices(), getFeedbackText());
      resetTimer();
    });
  }

  function openPreviewModal() {
    var draft = getSummaryDraftText();
    if (!draft || !previewModal || !previewModalBody) return;
    var rendered = typeof marked !== "undefined" && marked.parse
      ? marked.parse(draft, { breaks: true })
      : "<pre>" + escHtml(draft) + "</pre>";
    previewModalBody.innerHTML = sanitizeMarkdownHtml(rendered);
    if (previewModalModel) {
      previewModalModel.innerHTML = '<option value="">Auto</option>';
      for (var i = 0; i < summaryModels.length; i++) {
        var m = summaryModels[i];
        var opt = document.createElement("option");
        opt.value = m.value;
        opt.textContent = m.label;
        previewModalModel.appendChild(opt);
      }
      previewModalModel.value = getSelectedSummaryModel() || "";
    }
    previewModal.classList.remove("hidden");
    resetTimer();
  }

  function closePreviewModal() {
    if (previewModal) previewModal.classList.add("hidden");
    if (previewModalBody) previewModalBody.innerHTML = "";
    hidePreviewPopover();
  }

  var popoverSelectedText = "";

  function hidePreviewPopover() {
    if (previewPopover) previewPopover.classList.add("hidden");
    if (previewPopoverInput) previewPopoverInput.value = "";
    popoverSelectedText = "";
  }

  function showPreviewPopover(text, rect) {
    if (!previewPopover || !previewPopoverQuote || !previewModalBody) return;
    popoverSelectedText = text;
    var display = text.length > 120 ? text.slice(0, 117) + "\u2026" : text;
    previewPopoverQuote.textContent = "\u201c" + display + "\u201d";
    if (previewPopoverInput) previewPopoverInput.value = "";
    previewPopover.classList.remove("hidden");

    var bodyRect = previewModalBody.getBoundingClientRect();
    var popH = previewPopover.offsetHeight;
    var top = rect.bottom - bodyRect.top + previewModalBody.scrollTop + 6;
    if (rect.bottom + popH + 20 > bodyRect.bottom) {
      top = rect.top - bodyRect.top + previewModalBody.scrollTop - popH - 6;
    }
    var left = Math.max(8, Math.min(rect.left - bodyRect.left, bodyRect.width - previewPopover.offsetWidth - 8));
    previewPopover.style.top = top + "px";
    previewPopover.style.left = left + "px";

    if (previewPopoverInput) previewPopoverInput.focus();
  }

  if (btnSummaryPreview) {
    btnSummaryPreview.addEventListener("click", openPreviewModal);
  }
  if (previewModalClose) {
    previewModalClose.addEventListener("click", closePreviewModal);
  }
  if (previewModalRegenerate) {
    previewModalRegenerate.addEventListener("click", function() {
      var selectedModel = previewModalModel ? previewModalModel.value.trim() : "";
      closePreviewModal();
      var modelProvider = getSummaryProvider(selectedModel);
      if (modelProvider && modelProvider !== currentSummaryProvider) {
        setSummaryProvider(modelProvider, selectedModel);
      } else if (summaryModelSelect) {
        summaryModelSelect.value = selectedModel;
        currentSummaryModel = selectedModel;
      }
      requestSummary(getSelectedIndices(), getFeedbackText());
      resetTimer();
    });
  }
  if (previewModalApprove) {
    previewModalApprove.addEventListener("click", function() {
      closePreviewModal();
      doApprove();
    });
  }
  if (previewModalBody) {
    previewModalBody.addEventListener("mouseup", function() {
      var sel = window.getSelection();
      if (!sel || sel.isCollapsed) return;
      var text = sel.toString().trim();
      if (!text) return;
      var range = sel.getRangeAt(0);
      showPreviewPopover(text, range.getBoundingClientRect());
    });
    previewModalBody.addEventListener("mousedown", function(e) {
      if (previewPopover && !previewPopover.contains(e.target)) {
        hidePreviewPopover();
      }
    });
  }

  if (previewPopoverRegen) {
    previewPopoverRegen.addEventListener("click", function() {
      var note = previewPopoverInput ? previewPopoverInput.value.trim() : "";
      var quoted = popoverSelectedText;
      hidePreviewPopover();

      var feedback = 'Regarding: "' + quoted + '"';
      if (note) feedback += " \u2014 " + note;

      var selectedModel = previewModalModel ? previewModalModel.value.trim() : "";
      closePreviewModal();
      var modelProvider = getSummaryProvider(selectedModel);
      if (modelProvider && modelProvider !== currentSummaryProvider) {
        setSummaryProvider(modelProvider, selectedModel);
      } else if (summaryModelSelect) {
        summaryModelSelect.value = selectedModel;
        currentSummaryModel = selectedModel;
      }
      requestSummary(getSelectedIndices(), feedback);
      resetTimer();
    });
  }

  if (previewPopoverInput) {
    previewPopoverInput.addEventListener("keydown", function(e) {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (previewPopoverRegen) previewPopoverRegen.click();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        hidePreviewPopover();
      }
    });
  }

  if (previewModal) {
    previewModal.addEventListener("click", function(e) {
      if (e.target === previewModal) closePreviewModal();
    });
    document.addEventListener("keydown", function(e) {
      if (e.key === "Escape" && !previewModal.classList.contains("hidden")) {
        if (previewPopover && !previewPopover.classList.contains("hidden")) {
          e.preventDefault();
          e.stopImmediatePropagation();
          hidePreviewPopover();
          return;
        }
        e.preventDefault();
        e.stopImmediatePropagation();
        closePreviewModal();
      }
    });
  }

  if (btnSummaryApprove) {
    btnSummaryApprove.addEventListener("click", function() {
      doApprove();
      resetTimer();
    });
  }

  if (summaryInput) {
    summaryInput.addEventListener("input", function() {
      if (!summaryMeta || typeof summaryMeta !== "object") {
        summaryMeta = normalizeSummaryMeta(null, true);
      }
      summaryMeta.edited = true;
      clearError();
      updateStageUI();
      resetTimer();
    });
  }

  if (summaryProviderSelect) {
    summaryProviderSelect.addEventListener("change", function() {
      var provider = typeof summaryProviderSelect.value === "string" ? summaryProviderSelect.value : "";
      if (!provider || provider === currentSummaryProvider) return;
      setSummaryProvider(provider, "");
      clearError();
      updateStageUI();
      resetTimer();
    });
  }

  if (summaryModelSelect) {
    summaryModelSelect.addEventListener("change", function() {
      currentSummaryModel = typeof summaryModelSelect.value === "string"
        ? summaryModelSelect.value.trim()
        : "";
      clearError();
      resetTimer();
    });
  }

  function isInteractiveTarget(target) {
    if (!target || !target.tagName) return false;
    var tag = target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON" || tag === "A") return true;
    if (typeof target.isContentEditable === "boolean" && target.isContentEditable) return true;
    if (typeof target.closest === "function") {
      return !!target.closest('[contenteditable=""], [contenteditable="true"]');
    }
    return false;
  }

  document.addEventListener("keydown", function(e) {
    if (submitted || timerExpired || submitInFlight) return;

    var isSummaryInput = summaryInput && e.target === summaryInput;
    if (isSummaryInput && (e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      if (stage === "summary-review") doApprove();
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      if (exitRegeneratingState()) {
        return;
      }
      if (stage === "summary-review") {
        stage = "results";
        clearError();
        updateStageUI();
      } else if (stage === "results") {
        doCancel();
      }
      return;
    }

    if (isInteractiveTarget(e.target)) return;

    if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
      if (stage !== "results") return;
      e.preventDefault();
      requestSummary(getSelectedIndices());
      return;
    }

    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      if (stage !== "summary-review") return;
      e.preventDefault();
      doApprove();
      return;
    }

    if (e.key.toLowerCase() === "a" && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      if (stage !== "results") return;
      var boxes = resultCardsEl.querySelectorAll(".result-card input[type=checkbox]");
      var selectable = [];
      boxes.forEach(function(cb) {
        if (cb.disabled) return;
        selectable.push(cb);
      });
      if (selectable.length === 0) return;
      var allChecked = true;
      selectable.forEach(function(cb) { if (!cb.checked) allChecked = false; });
      selectable.forEach(function(cb) {
        cb.checked = !allChecked;
        var parentCard = typeof cb.closest === "function" ? cb.closest(".result-card") : null;
        if (parentCard) parentCard.classList.toggle("checked", cb.checked);
      });
      updateStageUI();
      maybeAutoGenerateSummary();
      resetTimer();
    }
  });

  setInterval(function() {
    if (submitted) return;
    postJson("/heartbeat", {
      idleMs: Math.max(0, Date.now() - lastInteraction),
      timeoutSec: timeoutSec,
    }).catch(function() {
      // Heartbeat is best-effort.
    });
  }, 10000);

  var lastResizeHeight = 0;
  function checkContentHeight() {
    if (!window.glimpse || typeof window.glimpse.send !== "function") return;
    var h = document.documentElement.scrollHeight || document.body.scrollHeight;
    if (h > 0 && Math.abs(h - lastResizeHeight) > 30) {
      lastResizeHeight = h;
      window.glimpse.send({ type: "resize", height: h });
    }
  }
  setInterval(checkContentHeight, 500);

  if (queries.length === 0 && addSearchInput) {
    addSearchInput.focus();
  }
})();`;
