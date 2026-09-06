/**
 * RSC Content Extractor
 * 
 * Extracts readable content from Next.js React Server Components (RSC) flight payloads.
 * RSC pages embed content as JSON in <script>self.__next_f.push([...])</script> tags.
 */

export interface RSCExtractResult {
  title: string;
  content: string;
}

export function extractRSCContent(html: string): RSCExtractResult | null {
  if (!html.includes("self.__next_f.push")) {
    return null;
  }

  // Parse all RSC chunks into a map
  const chunkMap = new Map<string, string>();
  const scriptRegex = /<script>self\.__next_f\.push\(\[1,"([\s\S]*?)"\]\)<\/script>/g;

  for (const match of html.matchAll(scriptRegex)) {
    let content: string;
    try {
      content = JSON.parse('"' + match[1] + '"');
    } catch {
      continue;
    }

    // Parse each line as "id:payload"
    // Lines are separated by \n, each line is one chunk
    // Chunk IDs are hex strings, typically 1-4 chars (supports up to 65535 chunks)
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      
      const colonIdx = line.indexOf(":");
      if (colonIdx <= 0 || colonIdx > 4) continue;
      
      const id = line.slice(0, colonIdx);
      if (!/^[0-9a-f]+$/i.test(id)) continue;
      
      const payload = line.slice(colonIdx + 1);
      if (!payload) continue;
      
      const existing = chunkMap.get(id);
      if (!existing || payload.length > existing.length) {
        chunkMap.set(id, payload);
      }
    }
  }

  if (chunkMap.size === 0) return null;

  // Extract title
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/);
  const title = titleMatch?.[1]?.split("|")[0]?.trim() || "";

  // Parse and cache parsed chunks
  const parsedCache = new Map<string, unknown>();
  
  function getParsedChunk(id: string): unknown | null {
    if (parsedCache.has(id)) return parsedCache.get(id);
    
    const chunk = chunkMap.get(id);
    if (!chunk || !chunk.startsWith("[")) {
      parsedCache.set(id, null);
      return null;
    }
    
    try {
      const parsed = JSON.parse(chunk);
      parsedCache.set(id, parsed);
      return parsed;
    } catch {
      parsedCache.set(id, null);
      return null;
    }
  }

  // Extract markdown from nodes, resolving refs on the fly
  type Node = unknown;
  const visitedRefs = new Set<string>();

  function extractNode(node: Node, ctx = { inTable: false, inCode: false }): string {
    if (node === null || node === undefined) return "";
    
    if (typeof node === "string") {
      // Check if it's a reference like "$L30"
      const refMatch = node.match(/^\$L([0-9a-f]+)$/i);
      if (refMatch) {
        const refId = refMatch[1];
        if (visitedRefs.has(refId)) return ""; // Prevent cycles
        visitedRefs.add(refId);
        const refNode = getParsedChunk(refId);
        const result = refNode ? extractNode(refNode, ctx) : "";
        visitedRefs.delete(refId);
        return result;
      }
      // Filter out RSC-specific artifacts, but preserve content inside code blocks
      if (!ctx.inCode && (node === "$undefined" || node === "$" || /^\$[A-Z]/.test(node))) return "";
      return node.trim() ? node : "";
    }
    
    if (typeof node === "number") return String(node);
    if (typeof node === "boolean") return "";
    if (!Array.isArray(node)) return "";

    // RSC element: ["$", "tag", key, props]
    if (node[0] === "$" && typeof node[1] === "string") {
      const tag = node[1] as string;
      const props = (node[3] || {}) as Record<string, unknown>;

      // Skip non-content
      const skipTags = ["script", "style", "svg", "path", "circle", "link", "meta", 
                        "template", "button", "input", "nav", "footer", "aside"];
      if (skipTags.includes(tag)) return "";

      // Component ref like $L25
      if (tag.startsWith("$L")) {
        const refId = tag.slice(2);
        if (visitedRefs.has(refId)) return "";
        
        // Check for heading components with baseId
        if (props.baseId && props.children) {
          return `## ${String(props.children)}\n\n`;
        }
        
        visitedRefs.add(refId);
        const refNode = getParsedChunk(refId);
        let result = "";
        if (refNode) {
          result = extractNode(refNode, ctx);
        } else if (props.children) {
          result = extractNode(props.children as Node, ctx);
        }
        visitedRefs.delete(refId);
        return result;
      }

      const children = props.children;
      const content = children ? extractNode(children as Node, ctx) : "";

      switch (tag) {
        case "h1": return `# ${content.trim()}\n\n`;
        case "h2": return `## ${content.trim()}\n\n`;
        case "h3": return `### ${content.trim()}\n\n`;
        case "h4": return `#### ${content.trim()}\n\n`;
        case "h5": return `##### ${content.trim()}\n\n`;
        case "h6": return `###### ${content.trim()}\n\n`;
        case "p": return ctx.inTable ? content : `${content.trim()}\n\n`;
        case "code": {
          const codeContent = children ? extractNode(children as Node, { ...ctx, inCode: true }) : "";
          return ctx.inCode ? codeContent : `\`${codeContent}\``;
        }
        case "pre": {
          const preContent = children ? extractNode(children as Node, { ...ctx, inCode: true }) : "";
          return "```\n" + preContent + "\n```\n\n";
        }
        case "strong": case "b": return `**${content}**`;
        case "em": case "i": return `*${content}*`;
        case "li": return `- ${content.trim()}\n`;
        case "ul": case "ol": return content + "\n";
        case "blockquote": return `> ${content.trim()}\n\n`;
        case "table": return extractTable(node as unknown[]) + "\n";
        case "thead": case "tbody": case "tr": case "th": case "td":
          return content;
        case "div":
          if (props.role === "alert" || props["data-slot"] === "alert") {
            return `> ${content.trim()}\n\n`;
          }
          return content;
        case "a": {
          const href = props.href as string | undefined;
          return href && !href.startsWith("#") ? `[${content}](${href})` : content;
        }
        default: return content;
      }
    }

    // Array of child nodes
    return (node as Node[]).map(n => extractNode(n, ctx)).join("");
  }

  function extractTable(tableNode: unknown[]): string {
    const props = (tableNode[3] || {}) as Record<string, unknown>;
    const rows: string[][] = [];
    let headerRowCount = 0;

    function walkTable(node: unknown, isHeader = false): void {
      if (node === null || node === undefined) return;
      
      // Handle string refs
      if (typeof node === "string") {
        const refMatch = node.match(/^\$L([0-9a-f]+)$/i);
        if (refMatch && !visitedRefs.has(refMatch[1])) {
          visitedRefs.add(refMatch[1]);
          const refNode = getParsedChunk(refMatch[1]);
          if (refNode) walkTable(refNode, isHeader);
          visitedRefs.delete(refMatch[1]);
        }
        return;
      }
      
      if (!Array.isArray(node)) return;
      
      if (node[0] === "$") {
        const tag = node[1] as string;
        const nodeProps = (node[3] || {}) as Record<string, unknown>;
        
        // Handle component refs
        if (tag.startsWith("$L")) {
          const refId = tag.slice(2);
          if (!visitedRefs.has(refId)) {
            visitedRefs.add(refId);
            const refNode = getParsedChunk(refId);
            if (refNode) walkTable(refNode, isHeader);
            visitedRefs.delete(refId);
          }
          return;
        }
        
        if (tag === "thead") walkTable(nodeProps.children, true);
        else if (tag === "tbody") walkTable(nodeProps.children, false);
        else if (tag === "tr") {
          const cells: string[] = [];
          walkCells(nodeProps.children, cells);
          if (cells.length > 0) {
            rows.push(cells);
            if (isHeader) headerRowCount++;
          }
        } else walkTable(nodeProps.children, isHeader);
      } else {
        for (const child of node) walkTable(child, isHeader);
      }
    }

    function walkCells(node: unknown, cells: string[]): void {
      if (node === null || node === undefined) return;
      
      // Handle string refs
      if (typeof node === "string") {
        const refMatch = node.match(/^\$L([0-9a-f]+)$/i);
        if (refMatch && !visitedRefs.has(refMatch[1])) {
          visitedRefs.add(refMatch[1]);
          const refNode = getParsedChunk(refMatch[1]);
          if (refNode) walkCells(refNode, cells);
          visitedRefs.delete(refMatch[1]);
        }
        return;
      }
      
      if (!Array.isArray(node)) return;
      
      if (node[0] === "$" && (node[1] === "td" || node[1] === "th")) {
        const cellProps = (node[3] || {}) as Record<string, unknown>;
        const text = extractNode(cellProps.children, { inTable: true, inCode: false })
          .trim()
          .replace(/\n/g, " ")
          .replace(/\\/g, "\\\\")  // Escape backslashes first
          .replace(/\|/g, "\\|");  // Then escape pipes
        cells.push(text);
      } else if (node[0] === "$" && typeof node[1] === "string" && (node[1] as string).startsWith("$L")) {
        // Component ref for a cell
        const refId = (node[1] as string).slice(2);
        if (!visitedRefs.has(refId)) {
          visitedRefs.add(refId);
          const refNode = getParsedChunk(refId);
          if (refNode) walkCells(refNode, cells);
          visitedRefs.delete(refId);
        }
      } else {
        for (const child of node) walkCells(child, cells);
      }
    }

    walkTable(props.children);
    if (rows.length === 0) return "";

    const colCount = Math.max(...rows.map(r => r.length));
    let md = "";
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i].concat(Array(colCount - rows[i].length).fill(""));
      md += "| " + row.join(" | ") + " |\n";
      if (i === headerRowCount - 1 || (headerRowCount === 0 && i === 0)) {
        md += "| " + Array(colCount).fill("---").join(" | ") + " |\n";
      }
    }
    return md;
  }

  // Process main content chunk (usually "23")
  const mainChunk = getParsedChunk("23");
  
  if (mainChunk) {
    const content = extractNode(mainChunk);
    if (content.trim().length > 100) {
      const cleaned = content
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      return { title, content: cleaned };
    }
  }

  // Fallback: try other chunks
  const contentParts: { order: number; text: string }[] = [];

  for (const [id] of chunkMap) {
    if (id === "23") continue;
    const parsed = getParsedChunk(id);
    if (!parsed) continue;

    visitedRefs.clear();
    const text = extractNode(parsed);

    if (text.trim().length > 50 && 
        !text.includes("page was not found") && 
        !text.includes("404")) {
      contentParts.push({ order: parseInt(id, 16), text: text.trim() });
    }
  }

  if (contentParts.length === 0) return null;

  contentParts.sort((a, b) => a.order - b.order);
  
  const seen = new Set<string>();
  const uniqueParts: string[] = [];
  for (const part of contentParts) {
    const key = part.text.slice(0, 150);
    if (!seen.has(key)) {
      seen.add(key);
      uniqueParts.push(part.text);
    }
  }

  const content = uniqueParts.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
  return content.length > 100 ? { title, content } : null;
}
