/**
 * Live AI Docs Backend - AI Service
 *
 * Handles AI-powered documentation generation using OpenRouter (OpenAI-compatible).
 * Falls back to mock responses if no API key or on errors.
 */

import OpenAI from "openai";
import { storage } from "./storage";
import { queryGraph } from "./graphify";
import {
  Documentation,
  DocSection,
  Explanation,
  Answer,
  ExplainRequest,
  Question,
} from "./types";

// ==================== Dynamic Architecture Component Extractor ====================
// Extracts real project folders/files to enforce AI grounding and prevent hallucination

function extractProjectComponents(projectId: string): { directories: string[], keys: string[] } {
  const project = storage.getProject(projectId);
  if (!project || !project.files) return { directories: [], keys: [] };

  const dirMap = new Map<string, number>();
  const allFiles = project.files.map(f => f.relativePath.replace(/\\/g, '/'));
  
  for (const file of allFiles) {
    const parts = file.split('/');
    if (parts.length > 1) {
      const topDir = parts[0];
      if (!topDir.startsWith('.') && topDir !== 'node_modules') {
        dirMap.set(topDir, (dirMap.get(topDir) || 0) + 1);
      }
    }
  }

  const sortedDirs = [...dirMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(e => e[0]);
  const keyFiles = allFiles
    .filter(f => /main|index|app|server|extension|app\.(ts|js|py|go|java|c|cpp)$/i.test(f.split('/').pop() || ''))
    .slice(0, 5)
    .map(f => f.split('/').pop() || f);

  return { directories: sortedDirs, keys: keyFiles };
}

// Lazy-initialize AI client
let openai: OpenAI | null = null;
let aiInitialized = false;
let modelName = "";

function getClient(): OpenAI | null {
  if (!aiInitialized) {
    aiInitialized = true;

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (apiKey && apiKey !== "your_openrouter_api_key_here") {
      modelName =
        process.env.OPENROUTER_MODEL || "google/gemini-2.0-flash-lite-001";
      openai = new OpenAI({
        baseURL: "https://openrouter.ai/api/v1",
        apiKey,
      });
      console.log(`✓ AI client initialized via OpenRouter (${modelName})`);
    } else {
      console.log("⚠ No OPENROUTER_API_KEY found - using mock responses");
    }
  }
  return openai;
}

// ==================== Global Rate Limit State ====================

/** Timestamp (ms) when we can next make an AI request. ALL requests check this. */
let rateLimitedUntil = 0;

/**
 * Check if we're currently rate-limited globally.
 */
function isRateLimited(): boolean {
  return Date.now() < rateLimitedUntil;
}

/**
 * Retry helper with exponential backoff
 */
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      const status = error?.status || error?.statusCode;
      if (status === 429) {
        // Parse retry-after header if available
        const retryAfter = error?.headers?.["retry-after"];
        const delay = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : Math.min(30000 * Math.pow(2, attempt), 120000);

        rateLimitedUntil = Math.max(rateLimitedUntil, Date.now() + delay);
        console.log(
          `Rate limited (429). Global cooldown: ${Math.ceil(delay / 1000)}s.`,
        );

        if (attempt < maxRetries) {
          console.log(
            `Waiting ${Math.ceil(delay / 1000)}s then retrying (attempt ${attempt + 1}/${maxRetries})...`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
      }
      throw error;
    }
  }
  throw new Error("Max retries exceeded");
}

// ==================== Request Queue ====================

let requestQueue: Promise<any> = Promise.resolve();

/** Cooldown between consecutive AI requests (3s) */
const REQUEST_COOLDOWN_MS = 3000;

function enqueueRequest<T>(fn: () => Promise<T>): Promise<T> {
  const result = requestQueue
    .then(async () => {
      // Check global rate limit before proceeding
      if (isRateLimited()) {
        const waitMs = rateLimitedUntil - Date.now();
        console.log(
          `⏳ Rate limited — waiting ${Math.ceil(waitMs / 1000)}s before next AI request...`,
        );
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
      // Always add cooldown between requests
      await new Promise((resolve) => setTimeout(resolve, REQUEST_COOLDOWN_MS));
      return fn();
    })
    .catch((err) => {
      throw err;
    });
  requestQueue = result.catch(() => {});
  return result;
}

/**
 * Make a chat completion call to OpenRouter
 */
async function chatCompletion(
  systemPrompt: string,
  userPrompt: string,
  options?: {
    maxTokens?: number;
    continueOnLength?: boolean;
    maxContinuations?: number;
  },
): Promise<string> {
  const client = getClient();
  if (!client) {
    throw new Error("AI client not initialized");
  }

  const maxTokens = options?.maxTokens ?? 2000;
  const continueOnLength = options?.continueOnLength ?? false;
  const maxContinuations = options?.maxContinuations ?? 0;
  const messages: any[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  let combinedContent = "";

  for (let attempt = 0; attempt <= maxContinuations; attempt++) {
    const response = await client.chat.completions.create({
      model: modelName,
      messages,
      max_tokens: maxTokens,
      temperature: 0, // Enforce deterministic output to prevent diagrams from changing on every refresh
    });

    const choice = response.choices[0];
    const chunk = choice?.message?.content || "";
    const finishReason = choice?.finish_reason;

    if (chunk) {
      combinedContent += (combinedContent ? "\n" : "") + chunk;
    }

    if (!continueOnLength || finishReason !== "length") {
      break;
    }

    messages.push({ role: "assistant", content: chunk });
    messages.push({
      role: "user",
      content:
        "Continue from exactly where you stopped. Do not repeat prior text. Keep the same markdown structure.",
    });
  }

  return combinedContent;
}

/**
 * Deduplication: track in-flight doc generation per project
 */
const pendingDocGeneration = new Map<string, Promise<Documentation>>();

/**
 * Generate documentation for a project (with deduplication)
 */
export async function generateDocumentation(
  projectId: string,
): Promise<Documentation> {
  // Dedup: if already generating for this project, return existing promise
  const pending = pendingDocGeneration.get(projectId);
  if (pending) {
    console.log(
      `Documentation generation already in progress for ${projectId}, waiting...`,
    );
    return pending;
  }

  const promise = _generateDocumentation(projectId);
  pendingDocGeneration.set(projectId, promise);

  try {
    return await promise;
  } finally {
    pendingDocGeneration.delete(projectId);
  }
}

async function _generateDocumentation(
  projectId: string,
): Promise<Documentation> {
  const project = storage.getProject(projectId);

  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  console.log(`Generating documentation for project: ${project.projectName}`);

  // Check global rate limit before even trying
  if (isRateLimited()) {
    console.log(`⏳ AI rate limited — returning mock docs for now`);
    const docs = generateMockDocumentation(
      projectId,
      project.projectName,
      project.languages,
      project.files.length,
    );
    storage.saveDocumentation(docs);
    return docs;
  }

  const projectSummary = storage.getProjectSummary(projectId);

  // Only call AI if we have actual context content
  const hasFileContent = projectSummary.length > 50;

  if (getClient() && hasFileContent) {
    try {
      const existingDocs = storage.getDocumentation(projectId);
      const docs = await enqueueRequest(() =>
        generateWithAI(
          projectId,
          project.projectName,
          projectSummary,
          existingDocs,
        ),
      );
      storage.saveDocumentation(docs);
      return docs;
    } catch (error) {
      console.error("AI error, falling back to mock:", error);
    }
  } else if (!hasFileContent) {
    console.log(
      `Skipping AI generation for ${projectId}: no file content available yet`,
    );
  }

  const docs = generateMockDocumentation(
    projectId,
    project.projectName,
    project.languages,
    project.files.length,
  );
  storage.saveDocumentation(docs);
  return docs;
}

/**
 * Generate documentation using OpenRouter
 */
async function generateWithAI(
  projectId: string,
  projectName: string,
  projectSummary: string,
  existingDocs?: Documentation,
): Promise<Documentation> {
  const projectComponents = extractProjectComponents(projectId);

  const systemPrompt = `You are an expert technical documentation writer. Generate thorough, well-structured documentation for a software project from its KNOWLEDGE GRAPH analysis.

The knowledge graph contains: files, classes, functions, imports, call relationships, and detected communities.

Return sections in this exact order: # Overview, # Architecture, # Modules, # APIs
Reference actual filenames, class names, function names, and routes from the graph — no generic filler.

# Overview
Write a COMPREHENSIVE and DETAILED overview that covers EVERY significant aspect found in the project.
Include ALL of the following sub-sections (use ## sub-headings):
## Purpose
What problem this project solves and who uses it.
## Technology Stack
Every language, framework, runtime, and major library detected.
## Project Structure
Every significant directory and file with its role. List all important source files.
## Key Components
All major classes, modules, services, and their responsibilities.
## Data Flow
Step-by-step description of the primary runtime flow from trigger to output.
## Entry Points
All startup files, main functions, command registrations, or server bootstraps.
## Dependencies & Integrations
All external APIs, SDKs, databases, or third-party services used.
## Configuration
Any .env variables, config files, or settings that affect behavior.
Be exhaustive — the reader should understand the ENTIRE project from this section alone.
NO Mermaid diagrams in this section.

# Architecture
Output EXACTLY TWO mermaid diagrams with NO other prose except captions.
CRITICAL: Use ONLY the following real components and directories from this project in your diagrams:
Top directories: $\{projectComponents.directories.join(", ") || "src, lib"\}
Key files: $\{projectComponents.keys.join(", ") || "index.ts, main.ts"\}

First — HLD flowchart:
\`\`\`mermaid
flowchart LR
  [use ONLY the real directories or files listed above]
\`\`\`
Caption: one sentence describing the HLD.

Second — Sequence diagram showing Module Interaction:
\`\`\`mermaid
sequenceDiagram
  [use ONLY the real files/directories listed above to show how they interact]
\`\`\`
Caption: one sentence describing the module interaction sequence.

CRITICAL RENDERING RULES:
- Flowchart node IDs: letters and digits ONLY (e.g. NodeA not node-a)
- Flowchart labels: MUST use double quotes — NodeId["Readable Label"]
- Sequence arrows: ONLY ->> for request, ONLY -->> for response
- ABSOLUTELY NO subgraph blocks

# Modules
Output a markdown TABLE:
| Module | File Path | Responsibility | Key Exports | Depends On |
Include EVERY significant file or module found. NO diagrams.

# APIs
Output a markdown TABLE:
| Method | Path / Function | Parameters | Returns | Description |
List EVERY endpoint and exported function found. Add an "**Error Behavior**" paragraph below the table. NO diagrams.

DIAGRAM POLICY: Mermaid ONLY in # Architecture. Zero diagrams in all other sections.`;

  const content = await withRetry(() =>
    chatCompletion(
      systemPrompt,
      `Generate documentation for this project based on the following knowledge graph analysis:\n\n${projectSummary}`,
      {
        maxTokens: 5000,
        continueOnLength: true,
        maxContinuations: 2,
      },
    ),
  );

  const sections = parseAIResponse(content, projectId);

  return {
    projectId,
    sections,
    lastUpdated: Date.now(),
    generationStatus: "ready",
  };
}

/**
 * Regenerate a single documentation section without touching others
 */
export async function refreshSection(
  projectId: string,
  sectionType: string,
): Promise<Documentation | null> {
  const project = storage.getProject(projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  // Check rate limit for AI-based sections
  if (isRateLimited()) {
    console.log(`⏳ AI rate limited — skipping section refresh`);
    return storage.getDocumentation(projectId) || null;
  }

  const projectSummary = storage.getProjectSummary(projectId);
  const hasFileContent = projectSummary.length > 50;
  const projectComponents = extractProjectComponents(projectId);

  if (!getClient() || !hasFileContent) {
    return storage.getDocumentation(projectId) || null;
  }

  const sectionInstructions: Record<string, string> = {
    overview:
      `Write a COMPREHENSIVE and DETAILED overview covering EVERY significant aspect found in the project.
Use the following ## sub-sections — fill each one fully based on the knowledge graph:
## Purpose
What problem this project solves and who it is for.
## Technology Stack
Every language, framework, runtime, and major library detected.
## Project Structure
Every significant directory and file with its role.
## Key Components
All major classes, modules, and services and their responsibilities.
## Data Flow
Step-by-step description of the primary runtime flow from start to output.
## Entry Points
All startup files, main functions, server bootstraps, or command registrations found.
## Dependencies and Integrations
All external APIs, SDKs, databases, or third-party services used.
## Configuration
All .env variables, config files, or environment settings affecting behavior.
Be exhaustive — the reader must understand the ENTIRE project from this section alone.
NO Mermaid diagrams.`,
    architecture:
      `Read the knowledge graph analysis provided. 
CRITICAL: Use ONLY the following real components and directories from this project in your diagrams:
Top directories: $\{projectComponents.directories.join(", ") || "src, lib"\}
Key files: $\{projectComponents.keys.join(", ") || "index.ts, main.ts"\}

Write each mermaid code block FIRST, then place the caption on the line immediately after the closing triple-backtick.

First — HLD flowchart:
\`\`\`mermaid
flowchart LR
  [insert ONLY the real nodes listed above]
\`\`\`
Caption: one sentence describing the HLD.

Second — Sequence diagram showing Module Interaction:
\`\`\`mermaid
sequenceDiagram
  [insert ONLY the real files/directories listed above to show how they interact]
\`\`\`
Caption: one sentence describing the module interaction sequence.

CRITICAL RENDERING RULES:
- Flowchart node IDs: letters and digits ONLY (e.g. NodeA not node-a)
- Flowchart labels: MUST use double quotes — NodeId["Readable Label"]
- Sequence arrows: ONLY ->> for request, ONLY -->> for response
- Max 7 nodes in HLD, max 6 steps in sequence
- ABSOLUTELY NO subgraph blocks`,
    modules:
      `Output a markdown TABLE:
| Module | File Path | Responsibility | Key Exports | Depends On |
Include EVERY significant file or module found. NO Mermaid diagrams.`,
    apis:
      `Output a markdown TABLE:
| Method | Path / Function | Parameters | Returns | Description |
List EVERY endpoint and exported function. Add an "**Error Behavior**" paragraph below. NO Mermaid diagrams.`,
  };

  const sectionDesc = sectionInstructions[sectionType] || `Write detailed documentation for the ${sectionType} section.`;

  const sectionMaxTokens: Record<string, number> = {
    overview: 4000,
    architecture: 2200,
    modules: 2000,
    apis: 2000,
  };

  const systemPrompt = `You are an expert technical documentation writer. Generate ONLY the "${sectionType}" section for a software project, from its KNOWLEDGE GRAPH analysis.

Instructions:
${sectionDesc}

RULES:
- Output ONLY this section's content
- Start with heading: # ${sectionType.charAt(0).toUpperCase() + sectionType.slice(1)}
- Reference actual files, class names, functions, and routes found in the graph
- DIAGRAM POLICY: Mermaid diagrams are ONLY allowed in the architecture section. All other sections must contain ZERO diagrams.
- When using Mermaid: always wrap in \`\`\`mermaid, always double-quote ALL labels, use alphanumeric node IDs only, use ->> and -->> for sequence arrows`;

  try {
    const content = await withRetry(() =>
      enqueueRequest(() =>
        chatCompletion(
          systemPrompt,
          `Generate the ${sectionType} section for this project:\n\n${projectSummary}`,
          {
            maxTokens: sectionMaxTokens[sectionType] ?? 2500,
            continueOnLength: true,
            maxContinuations: sectionType === "overview" ? 2 : 1,
          },
        ),
      ),
    );

    let finalContent = content.trim();

    if (sectionType !== "architecture") {
      finalContent = stripMermaidBlocks(finalContent);
    }

    // Foolproof fallback: if AI forgot backticks on a raw diagram, force wrap it!
    // We look for common Mermaid starting keywords even if they aren't at the very start of the string
    const hasBackticks = finalContent.includes("```");
    const isRawDiagram =
      /(?:%%\{init:|graph |flowchart |sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|gitGraph)/i.test(
        finalContent,
      );

    if (isRawDiagram && !hasBackticks) {
      // Find where the diagram actually starts
      const diagramStartMatch = finalContent.match(
        /(?:%%\{init:|graph |flowchart |sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|gitGraph)/i,
      );
      if (diagramStartMatch) {
        const startIdx = diagramStartMatch.index || 0;
        const textBefore = finalContent.slice(0, startIdx).trim();
        const diagramBody = finalContent.slice(startIdx).trim();
        finalContent =
          (textBefore ? textBefore + "\n\n" : "") +
          `\`\`\`mermaid\n${diagramBody}\n\`\`\``;
      }
    }

    // Build the new section
    const newSection: DocSection = {
      id: sectionType,
      title: sectionType.charAt(0).toUpperCase() + sectionType.slice(1),
      type: sectionType as DocSection["type"],
      content: finalContent,
      lastUpdated: Date.now(),
    };

    // Merge into existing docs
    let docs = storage.getDocumentation(projectId);
    if (docs) {
      const idx = docs.sections.findIndex((s) => s.id === sectionType);
      if (idx >= 0) {
        docs.sections[idx] = newSection;
      } else {
        docs.sections.push(newSection);
      }
      docs.lastUpdated = Date.now();
    } else {
      docs = {
        projectId,
        sections: [newSection],
        lastUpdated: Date.now(),
        generationStatus: "ready",
      };
    }

    storage.saveDocumentation(docs);
    return docs;
  } catch (error: any) {
    console.error(`Error refreshing section ${sectionType}:`, error.message);
    return storage.getDocumentation(projectId) || null;
  }
}

function stripMermaidBlocks(input: string): string {
  if (!input) {
    return input;
  }

  return input
    .replace(/```\s*mermaid[\s\S]*?```/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function titleForSectionType(type: DocSection["type"]): string {
  switch (type) {
    case "overview":
      return "Overview";
    case "architecture":
      return "Architecture";
    case "modules":
      return "Modules";
    case "apis":
      return "APIs";
    case "flow":
      return "Flow";
    case "changelog":
      return "Change Log";
    default:
      return "Documentation";
  }
}

function buildFallbackSection(
  type: "overview" | "architecture" | "modules" | "apis",
  projectId: string,
): DocSection {
  const now = Date.now();
  const project = storage.getProject(projectId);
  const projectSummary = storage.getProjectSummary(projectId);
  const fileContents = storage.getAllFileContents(projectId);
  const summarySnippet = projectSummary
    ? projectSummary.slice(0, 2000) +
      (projectSummary.length > 2000 ? "\n\n... (truncated)" : "")
    : "Project summary is still being prepared.";

  const fileHighlights = (project?.files || [])
    .slice(0, 25)
    .map((f) => `- ${f.relativePath} (${f.language})`)
    .join("\n");

  const endpointSet = new Set<string>();
  if (fileContents) {
    const endpointRegex =
      /\b(app|router)\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/gi;
    for (const [, , method, route] of Array.from(fileContents.values())
      .join("\n\n")
      .matchAll(endpointRegex)) {
      endpointSet.add(`${String(method).toUpperCase()} ${route}`);
      if (endpointSet.size >= 25) break;
    }
  }
  const endpointLines = Array.from(endpointSet)
    .map((e) => `- ${e}`)
    .join("\n");

  if (type === "overview") {
    return {
      id: "overview",
      title: "Overview",
      type: "overview",
      content: `# Overview\n\n${project?.projectName || "This project"} contains modular components that are continuously analyzed to produce live technical documentation.\n\n## Current Scope\n- Languages: ${(project?.languages || []).join(", ") || "Unknown"}\n- Indexed files: ${project?.files?.length || 0}\n\n## Key Files and Ownership\n${fileHighlights || "- File inventory is still being loaded."}\n\n## Graph-Derived Context\n${summarySnippet}`,
      lastUpdated: now,
    };
  }

  if (type === "architecture") {
    return {
      id: "architecture",
      title: "Architecture",
      type: "architecture",
      content: `# Architecture\n\nThe architecture is organized around scanning, graph extraction, AI generation, and surfaced documentation.\n\n## Core Components\n- File indexing and change tracking\n- Knowledge graph extraction\n- AI section generation\n- Webview presentation and refresh cycle\n\n## Data Movement\nChanges flow from file watchers to graph/context builders, then into generation and section rendering.`,
      lastUpdated: now,
    };
  }

  if (type === "modules") {
    return {
      id: "modules",
      title: "Modules",
      type: "modules",
      content: `# Modules\n\nKey modules are grouped by responsibilities such as API integration, project state management, generation orchestration, and UI rendering.\n\n## Observed Module Candidates\n${fileHighlights || "- Module list will appear after indexing completes."}\n\n## Dependency and Coupling Notes\nUse this section to inspect boundaries between backend services, orchestration logic, and UI integration points. This fallback is detailed by file inventory until full AI analysis completes.`,
      lastUpdated: now,
    };
  }

  return {
    id: "apis",
    title: "APIs",
    type: "apis",
    content: `# APIs\n\nAPI documentation is being assembled from detected routes, exported functions, and class interfaces.\n\n## Detected Endpoints\n${endpointLines || "- No explicit HTTP endpoints detected yet."}\n\n## Status\nA complete endpoint/function table with parameters, return types, and error behavior will appear after successful AI generation.`,
    lastUpdated: now,
  };
}

function ensureRequiredSections(
  sections: DocSection[],
  projectId: string,
): DocSection[] {
  const byType = new Map<DocSection["type"], DocSection>();

  for (const section of sections) {
    const normalizedContent =
      section.type !== "architecture"
        ? stripMermaidBlocks(section.content)
        : section.content;

    const normalized: DocSection = {
      ...section,
      title: section.title || titleForSectionType(section.type),
      content: normalizedContent,
    };

    if (section.type === "custom") {
      continue;
    }

    const existing = byType.get(section.type);
    if (!existing) {
      byType.set(section.type, normalized);
      continue;
    }

    // Merge duplicate model output for the same section type.
    existing.content = `${existing.content}\n\n${normalized.content}`
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    existing.lastUpdated = Date.now();
  }

  const requiredTypes: Array<"overview" | "architecture" | "modules" | "apis"> =
    ["overview", "architecture", "modules", "apis"];

  for (const type of requiredTypes) {
    if (!byType.has(type)) {
      byType.set(type, buildFallbackSection(type, projectId));
    }
  }

  const ordered = requiredTypes.map((type) => byType.get(type)!);
  const optional = sections.filter(
    (s) => !requiredTypes.includes(s.type as any),
  );
  return [...ordered, ...optional];
}

/**
 * Parse AI-generated content into documentation sections
 */
function parseAIResponse(content: string, projectId: string): DocSection[] {
  const sections: DocSection[] = [];
  const sectionPatterns = [
    { type: "overview" as const, pattern: /(?:overview|introduction|about)/i },
    {
      type: "architecture" as const,
      pattern: /(?:architecture|design|structure)/i,
    },
    { type: "modules" as const, pattern: /(?:modules?|components?|files?)/i },
    { type: "apis" as const, pattern: /(?:api|functions?|classes?|methods?)/i },
    { type: "flow" as const, pattern: /(?:flow|process|how it works)/i },
  ];

  // Foolproof fallback: find raw mermaid blocks that lack backticks and wrap them
  let processedContent = content;
  const mermaidRegex =
    /((?:%%\{init:|graph |flowchart |sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|gitGraph)[\s\S]*?)(?=\n#|\n\`\`\`|$)/gi;

  processedContent = processedContent.replace(mermaidRegex, (match) => {
    // Only wrap if it doesn't already have backticks nearby (avoid double-wrapping)
    if (!match.includes("```")) {
      return `\n\`\`\`mermaid\n${match.trim()}\n\`\`\`\n`;
    }
    return match;
  });

  // Prefer extracting only canonical required sections to avoid splitting
  // by incidental subheadings and losing/chipping content.
  const canonicalSections = parseCanonicalSections(processedContent);
  if (canonicalSections.length > 0) {
    return ensureRequiredSections(canonicalSections, projectId);
  }

  // Split by a single heading level only, otherwise section subsections (##)
  // get incorrectly split into separate top-level sections and disappear from nav.
  const h1Regex = /^#\s+(.+)$/gm;
  const h2Regex = /^##\s+(.+)$/gm;
  const headers: {
    title: string;
    headerStart: number;
    contentStart: number;
  }[] = [];

  // Prefer true top-level sections. If the model outputs only ## headings,
  // fall back to parsing those so we still recover structured sections.
  let headerRegex: RegExp = h1Regex;
  if (!h1Regex.test(processedContent)) {
    headerRegex = h2Regex;
  }
  headerRegex.lastIndex = 0;

  let match;
  while ((match = headerRegex.exec(processedContent)) !== null) {
    headers.push({
      title: match[1].trim(),
      headerStart: match.index,
      contentStart: match.index + match[0].length,
    });
  }

  // Build sections from headers
  for (let i = 0; i < headers.length; i++) {
    const title = headers[i].title;
    const start = headers[i].contentStart;
    const end =
      i < headers.length - 1
        ? headers[i + 1].headerStart
        : processedContent.length;
    const sectionContent = processedContent.slice(start, end).trim();

    // Determine section type from title
    let sectionType: DocSection["type"] = "custom";
    for (const { type, pattern } of sectionPatterns) {
      if (pattern.test(title)) {
        sectionType = type;
        break;
      }
    }

    const normalizedSectionContent =
      sectionType === "architecture"
        ? sectionContent
        : stripMermaidBlocks(sectionContent);

    sections.push({
      id: sectionType,
      title,
      type: sectionType,
      content: `# ${title}\n\n${normalizedSectionContent}`,
      lastUpdated: Date.now(),
    });
  }

  // If parsing failed entirely, keep content as overview seed and still enforce section coverage.
  if (sections.length === 0) {
    sections.push({
      id: "overview",
      title: "Overview",
      type: "overview",
      content:
        stripMermaidBlocks(processedContent) ||
        "Documentation is being generated...",
      lastUpdated: Date.now(),
    });
  }

  return ensureRequiredSections(sections, projectId);
}

function parseCanonicalSections(content: string): DocSection[] {
  const sections: DocSection[] = [];
  const headingRegex =
    /^#{1,3}\s*(overview|architecture|modules|apis)\b[^\n]*$/gim;
  const headers: {
    type: "overview" | "architecture" | "modules" | "apis";
    headerStart: number;
    contentStart: number;
  }[] = [];

  let match;
  while ((match = headingRegex.exec(content)) !== null) {
    headers.push({
      type: match[1].toLowerCase() as
        | "overview"
        | "architecture"
        | "modules"
        | "apis",
      headerStart: match.index,
      contentStart: match.index + match[0].length,
    });
  }

  if (headers.length === 0) {
    return sections;
  }

  for (let i = 0; i < headers.length; i++) {
    const start = headers[i].contentStart;
    const end =
      i < headers.length - 1 ? headers[i + 1].headerStart : content.length;
    const sectionType = headers[i].type;
    const sectionBody = content.slice(start, end).trim();
    const normalizedBody =
      sectionType === "architecture"
        ? sectionBody
        : stripMermaidBlocks(sectionBody);

    sections.push({
      id: sectionType,
      title: titleForSectionType(sectionType),
      type: sectionType,
      content: `# ${titleForSectionType(sectionType)}\n\n${normalizedBody}`,
      lastUpdated: Date.now(),
    });
  }

  return sections;
}

/**
 * Generate mock documentation (fallback)
 */
function generateMockDocumentation(
  projectId: string,
  projectName: string,
  languages: string[],
  fileCount: number,
): Documentation {
  const graphSummary = storage.getProjectSummary(projectId);
  const hasGraphSummary = graphSummary && graphSummary.length > 100;
  const fileContents = storage.getAllFileContents(projectId);

  // Extract likely HTTP endpoints from source for a stronger local fallback.
  const endpointSet = new Set<string>();
  if (fileContents) {
    const endpointRegex =
      /\b(app|router)\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/gi;
    for (const [, , method, route] of Array.from(fileContents.values())
      .join("\n\n")
      .matchAll(endpointRegex)) {
      endpointSet.add(`${String(method).toUpperCase()} ${route}`);
      if (endpointSet.size >= 20) break;
    }
  }

  const endpointLines = Array.from(endpointSet)
    .map((e) => `- ${e}`)
    .join("\n");
  const overviewDetails = hasGraphSummary
    ? `\n\n## Knowledge Graph Highlights\nThis overview was generated from the current project knowledge graph and file index, so it reflects real structure even without live LLM output.\n\n${graphSummary.slice(0, 2200)}${graphSummary.length > 2200 ? "\n\n... (truncated for readability)" : ""}`
    : "";

  const apiFallback =
    endpointSet.size > 0
      ? `## Detected Endpoints\n${endpointLines}\n\n## Notes\nThese endpoints were inferred from current source code patterns and may be partial until full AI generation is available.`
      : `## Detected Endpoints\nNo explicit endpoints were detected yet. Connect backend routes and refresh after initial indexing.\n\n## Notes\nFull API details (params, return types, examples) will populate after AI generation completes.`;

  return {
    projectId,
    lastUpdated: Date.now(),
    generationStatus: "ready",
    sections: [
      {
        id: "overview",
        title: "Project Overview",
        type: "overview",
        content: `# ${projectName}\n\n${projectName} is currently documented in local fallback mode. The system has indexed project metadata and file structure, and this overview is generated from available project context while AI generation is unavailable or still warming up.\n\n## Project Statistics\n- **Languages**: ${languages.join(", ") || "Unknown"}\n- **Total Files**: ${fileCount}\n- **Last Updated**: ${new Date().toLocaleString()}\n\n## What This Project Appears To Do\nThe codebase is organized into functional modules that can be automatically scanned and tracked as files change. Documentation is continuously refreshed from detected structure, module boundaries, and relationships between components.${overviewDetails}\n\n## How To Improve This Section\n- Ensure backend AI configuration is valid (API key + model).\n- Keep core files saved so indexing captures current content.\n- Trigger a manual refresh after major refactors.`,
        lastUpdated: Date.now(),
      },
      {
        id: "architecture",
        title: "Architecture",
        type: "architecture",
        content: `# Architecture\n\n\`\`\`mermaid\nflowchart LR\n  Client["Client"]\n  Extension["VS Code Extension"]\n  Backend["Backend Server"]\n  AIService["AI Service"]\n  Storage["Storage"]\n  Client --> Extension\n  Extension --> Backend\n  Backend --> AIService\n  Backend --> Storage\n\`\`\`\n\nHigh-level view: the extension connects to the backend, which delegates to the AI service and persists data in storage.\n\n\`\`\`mermaid\nsequenceDiagram\n  participant Ext as "Extension"\n  participant API as "Backend"\n  participant AI as "AI Service"\n  Ext->>API: POST /project/connect\n  API-->>Ext: projectId\n  Ext->>API: POST /docs/refresh\n  API->>AI: Generate docs\n  AI-->>API: Sections\n  API-->>Ext: Documentation\n\`\`\`\n\nOn refresh: the extension sends a request to the backend, which calls the AI service and returns generated documentation sections.`,
        lastUpdated: Date.now(),
      },
      {
        id: "modules",
        title: "Modules",
        type: "modules",
        content: `# Modules\n\nThe project contains ${fileCount} files organized into logical modules.\n\n## Current Module Insight\n${hasGraphSummary ? "Module insights are inferred from knowledge graph entities and relationships." : "Module insight is currently based on file inventory only. Run refresh after indexing for richer responsibilities and dependencies."}`,
        lastUpdated: Date.now(),
      },
      {
        id: "apis",
        title: "APIs",
        type: "apis",
        content: `# APIs\n\n${apiFallback}`,
        lastUpdated: Date.now(),
      },
      {
        id: "changelog",
        title: "Change Log",
        type: "changelog",
        content: `# Change Log\n\nRecent changes are tracked automatically as you edit files.\n\nView the Timeline for detailed change history.`,
        lastUpdated: Date.now(),
      },
    ],
  };
}

/**
 * Explain code using AI
 */
export async function explainCode(
  request: ExplainRequest,
): Promise<Explanation> {
  if (isRateLimited() || !getClient()) {
    return {
      summary: `Analysis of ${request.filePath.split("/").pop()}`,
      details: `This ${request.language} code appears to be part of the project.\n\n**What it does:**\nThe code defines functionality that contributes to the overall application.\n\n**Key patterns:**\n- Standard ${request.language} patterns are used\n- The code follows common conventions`,
      relatedDocs: [],
    };
  }

  try {
    const content = await enqueueRequest(() =>
      withRetry(() =>
        chatCompletion(
          "You are an expert code explainer. Provide: 1. A brief one-line summary 2. Detailed explanation 3. Key patterns or concepts used.",
          `Explain this ${request.language} code from ${request.filePath}:\n\n\`\`\`${request.language}\n${request.code}\n\`\`\``,
        ),
      ),
    );

    const lines = content.split("\n");
    return {
      summary: lines[0] || "Code explanation",
      details: content,
      relatedDocs: [],
    };
  } catch (error) {
    console.error("AI explain error:", error);
  }

  return {
    summary: `Analysis of ${request.filePath.split("/").pop()}`,
    details: `This ${request.language} code appears to be part of the project.\n\n**What it does:**\nThe code defines functionality that contributes to the overall application.\n\n**Key patterns:**\n- Standard ${request.language} patterns are used\n- The code follows common conventions`,
    relatedDocs: [],
  };
}

/**
 * Answer a question about the project (RAG-style)
 */
export async function answerQuestion(question: Question): Promise<Answer> {
  const projectSummary = storage.getProjectSummary(question.projectId);

  if (isRateLimited() || !getClient() || projectSummary.length === 0) {
    return {
      response: `I can answer questions about your project once AI is configured.\n\nYour question: "${question.query}"\n\nTo enable AI-powered Q&A:\n1. Get an API key from OpenRouter\n2. Add it as OPENROUTER_API_KEY in the backend .env file\n3. Restart the backend server`,
      sources: [],
      confidence: 0.5,
    };
  }

  // Try graphify query for targeted context retrieval
  let graphContext = "";
  try {
    graphContext = await queryGraph(question.projectId, question.query);
  } catch (err) {
    // Fallback to full summary if query fails
  }

  const context = graphContext || projectSummary;

  try {
    const content = await enqueueRequest(() =>
      withRetry(() =>
        chatCompletion(
          "You are a helpful assistant that answers questions about a software project. You are given a knowledge graph analysis of the project. Be specific and reference actual files/functions when possible. If unsure, say so.",
          `Project knowledge graph:\n${context}\n\nQuestion: ${question.query}`,
        ),
      ),
    );

    return {
      response: content || "Unable to generate answer",
      sources: [],
      confidence: 0.8,
    };
  } catch (error) {
    console.error("AI Q&A error:", error);
  }

  return {
    response: `I can answer questions about your project once AI is configured.\n\nYour question: "${question.query}"`,
    sources: [],
    confidence: 0.5,
  };
}
