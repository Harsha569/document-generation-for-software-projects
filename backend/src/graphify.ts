/**
 * Live AI Docs Backend - Graphify Integration
 * 
 * Manages knowledge graph operations using the Graphify CLI.
 * Builds AST-based knowledge graphs from project source files,
 * reads back structured graph data, and provides condensed
 * summaries for LLM context (instead of raw file dumps).
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const execFileAsync = promisify(execFile);
const mkdirAsync = promisify(fs.mkdir);
const writeFileAsync = promisify(fs.writeFile);
const readFileAsync = promisify(fs.readFile);
const existsSync = fs.existsSync;

// Base directory for project files written to disk (use OS temp dir to prevent workspace watcher loops)
const GRAPHIFY_PROJECTS_DIR = path.join(os.tmpdir(), 'live-ai-docs-graphify');

// ==================== Types ====================

export interface GraphNode {
    id: string;
    label: string;
    file_type?: string;
    source_file?: string;
    source_location?: string;
    community?: number;
    [key: string]: any;
}

export interface GraphEdge {
    source: string;
    target: string;
    relation: string;
    confidence: string;
    confidence_score?: number;
    source_file?: string;
    weight?: number;
    [key: string]: any;
}

export interface GraphData {
    nodes: GraphNode[];
    edges: GraphEdge[];
    communities?: Record<string, string[]>;
    community_labels?: Record<string, string>;
    metadata?: Record<string, any>;
}

export interface GraphResult {
    graphJson: GraphData | null;
    report: string;
    buildTime: number;
}

// ==================== File Operations ====================

/**
 * Get the project directory path for storing files on disk
 */
function getProjectDir(projectId: string): string {
    return path.join(GRAPHIFY_PROJECTS_DIR, projectId);
}

/**
 * Get the graphify output directory path
 */
function getGraphifyOutDir(projectId: string): string {
    return path.join(getProjectDir(projectId), 'graphify-out');
}

/**
 * Write project files to disk so Graphify can parse them
 */
async function writeFilesToDisk(
    projectId: string,
    fileContents: Map<string, string>
): Promise<string> {
    const projectDir = getProjectDir(projectId);

    // Create project directory
    await mkdirAsync(projectDir, { recursive: true });

    // Write each file
    for (const [relativePath, content] of fileContents) {
        if (!content || content.length === 0) continue;
        
        // Ignore libraries, dependencies, and build outputs
        const lowerPath = relativePath.toLowerCase();
        if (
            lowerPath.includes('node_modules/') || 
            lowerPath.includes('.git/') || 
            lowerPath.includes('venv/') || 
            lowerPath.includes('env/') || 
            lowerPath.includes('__pycache__/') ||
            lowerPath.includes('dist/') ||
            lowerPath.includes('build/') ||
            lowerPath.includes('out/')
        ) {
            continue;
        }

        const filePath = path.join(projectDir, relativePath);
        const fileDir = path.dirname(filePath);

        // Create subdirectories
        await mkdirAsync(fileDir, { recursive: true });

        // Write file content
        await writeFileAsync(filePath, content, 'utf-8');
    }

    return projectDir;
}

// ==================== Graph Building ====================

/**
 * Build a knowledge graph for a project using Graphify CLI.
 * Uses `graphify update` which does AST-only extraction (no LLM needed).
 */
export async function buildGraph(
    projectId: string,
    fileContents: Map<string, string>
): Promise<GraphResult> {
    const startTime = Date.now();

    console.log(`[Graphify] Building knowledge graph for project: ${projectId}`);

    try {
        // Step 1: Write files to disk
        const projectDir = await writeFilesToDisk(projectId, fileContents);
        console.log(`[Graphify] Wrote ${fileContents.size} files to ${projectDir}`);

        // Step 2: Run graphify update (AST-only, no LLM)
        try {
            await execFileAsync('graphify', ['update', projectDir], {
                cwd: projectDir,
                timeout: 60000, // 60 second timeout
                env: { ...process.env },
            });
            console.log(`[Graphify] AST extraction completed`);
        } catch (execError: any) {
            // graphify update may return non-zero but still produce output
            console.log(`[Graphify] CLI output: ${execError.stdout || ''}`);
            if (execError.stderr) {
                console.warn(`[Graphify] CLI warnings: ${execError.stderr}`);
            }
        }

        // Step 3: Read graph output
        const graphOutDir = getGraphifyOutDir(projectId);
        let graphJson: GraphData | null = null;
        let report = '';

        // Read graph.json
        const graphJsonPath = path.join(graphOutDir, 'graph.json');
        if (existsSync(graphJsonPath)) {
            const raw = await readFileAsync(graphJsonPath, 'utf-8');
            graphJson = JSON.parse(raw);
            console.log(`[Graphify] Loaded graph: ${graphJson?.nodes?.length || 0} nodes, ${graphJson?.edges?.length || 0} edges`);
        } else {
            console.warn(`[Graphify] graph.json not found at ${graphJsonPath}`);
        }

        // Read GRAPH_REPORT.md
        const reportPath = path.join(graphOutDir, 'GRAPH_REPORT.md');
        if (existsSync(reportPath)) {
            report = await readFileAsync(reportPath, 'utf-8');
            console.log(`[Graphify] Loaded report (${report.length} chars)`);
        } else {
            console.warn(`[Graphify] GRAPH_REPORT.md not found at ${reportPath}`);
        }

        const buildTime = Date.now() - startTime;
        console.log(`[Graphify] ✓ Graph built in ${buildTime}ms`);

        return { graphJson, report, buildTime };

    } catch (error: any) {
        const buildTime = Date.now() - startTime;
        console.error(`[Graphify] ✗ Graph build failed (${buildTime}ms):`, error.message);
        return { graphJson: null, report: '', buildTime };
    }
}

// ==================== Graph Querying ====================

/**
 * Run a targeted query against the project's knowledge graph.
 * Uses `graphify query` for BFS traversal.
 */
export async function queryGraph(
    projectId: string,
    question: string
): Promise<string> {
    const projectDir = getProjectDir(projectId);
    const graphJsonPath = path.join(getGraphifyOutDir(projectId), 'graph.json');

    if (!existsSync(graphJsonPath)) {
        return '';
    }

    try {
        const { stdout } = await execFileAsync('graphify', [
            'query', question,
            '--graph', graphJsonPath,
            '--budget', '3000'
        ], {
            cwd: projectDir,
            timeout: 15000,
        });
        return stdout.trim();
    } catch (error: any) {
        console.warn(`[Graphify] Query failed:`, error.message);
        return error.stdout?.trim() || '';
    }
}

// ==================== Graph Summary ====================

/**
 * Build a condensed text summary from graph data for LLM context.
 * This replaces the raw file dump with structured knowledge.
 */
export function buildGraphSummary(
    projectName: string,
    languages: string[],
    graphData: GraphData | null,
    report: string
): string {
    if (!graphData && !report) {
        return '';
    }

    const parts: string[] = [];

    parts.push(`# Project Knowledge Graph: ${projectName}`);
    parts.push(`Languages: ${languages.join(', ')}`);
    parts.push('');

    // If we have the graph report, use it as the primary context
    if (report) {
        parts.push('## Graph Analysis Report');
        parts.push(report);
        parts.push('');
    }

    if (graphData) {
        const nodes = graphData.nodes || [];
        const edges = graphData.edges || [];

        parts.push(`## Graph Statistics`);
        parts.push(`- Total nodes: ${nodes.length}`);
        parts.push(`- Total edges: ${edges.length}`);
        parts.push('');

        // List all file nodes (project structure)
        const fileNodes = nodes.filter(n => n.file_type === 'code' && n.source_file);
        if (fileNodes.length > 0) {
            parts.push('## Project Structure (files)');
            const uniqueFiles = [...new Set(fileNodes.map(n => n.source_file).filter(Boolean))];
            for (const f of uniqueFiles.slice(0, 50)) {
                parts.push(`- ${f}`);
            }
            parts.push('');
        }

        // List key entities (classes, functions) grouped by file
        const entityNodes = nodes.filter(n =>
            n.label &&
            !n.label.endsWith('.ts') &&
            !n.label.endsWith('.js') &&
            !n.label.endsWith('.py') &&
            n.source_file
        );

        if (entityNodes.length > 0) {
            parts.push('## Key Entities');

            // Group by source file
            const byFile = new Map<string, GraphNode[]>();
            for (const node of entityNodes) {
                const file = node.source_file || 'unknown';
                if (!byFile.has(file)) byFile.set(file, []);
                byFile.get(file)!.push(node);
            }

            for (const [file, fileNodes] of byFile) {
                const shortFile = file.split(/[/\\]/).slice(-2).join('/');
                parts.push(`\n### ${shortFile}`);
                for (const node of fileNodes.slice(0, 20)) {
                    parts.push(`- ${node.label} (${node.id})`);
                }
            }
            parts.push('');
        }

        // List relationships
        const importantRelations = ['contains', 'calls', 'imports', 'imports_from', 'inherits', 'implements'];
        const keyEdges = edges.filter(e => importantRelations.includes(e.relation));

        if (keyEdges.length > 0) {
            parts.push('## Key Relationships');

            // Group by relation type
            const byRelation = new Map<string, GraphEdge[]>();
            for (const edge of keyEdges) {
                if (!byRelation.has(edge.relation)) byRelation.set(edge.relation, []);
                byRelation.get(edge.relation)!.push(edge);
            }

            for (const [relation, relEdges] of byRelation) {
                parts.push(`\n### ${relation} (${relEdges.length} edges)`);
                for (const edge of relEdges.slice(0, 30)) {
                    parts.push(`- ${edge.source} → ${edge.target}`);
                }
                if (relEdges.length > 30) {
                    parts.push(`- ... and ${relEdges.length - 30} more`);
                }
            }
            parts.push('');
        }
    }

    return parts.join('\n');
}

// ==================== Status Checks ====================

/**
 * Check if a graph exists for a project
 */
export function hasGraph(projectId: string): boolean {
    const graphJsonPath = path.join(getGraphifyOutDir(projectId), 'graph.json');
    return existsSync(graphJsonPath);
}

/**
 * Check if Graphify CLI is available
 */
export async function isGraphifyAvailable(): Promise<boolean> {
    try {
        await execFileAsync('graphify', ['--help'], { timeout: 5000 });
        return true;
    } catch {
        return false;
    }
}
