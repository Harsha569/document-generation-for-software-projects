/**
 * Live AI Docs Backend - In-Memory Storage
 * 
 * Simple in-memory storage for projects, documentation, and timelines.
 * In production, replace with a proper database.
 */

import { Project, Documentation, Timeline, TimelineEntry, FileUpdate } from './types';
import { GraphData, buildGraphSummary } from './graphify';

class Storage {
    private projects: Map<string, Project> = new Map();
    private documentation: Map<string, Documentation> = new Map();
    private timelines: Map<string, Timeline> = new Map();
    private fileContents: Map<string, Map<string, string>> = new Map(); // projectId -> (filePath -> content)
    private graphData: Map<string, { graphJson: GraphData | null; report: string }> = new Map(); // projectId -> graph data

    // ==================== Projects ====================

    saveProject(project: Project): void {
        this.projects.set(project.id, project);
        this.fileContents.set(project.id, new Map());

        // Store initial file contents
        const contents = this.fileContents.get(project.id)!;
        for (const file of project.files) {
            // We'll get actual content from file updates
            contents.set(file.relativePath, '');
        }

        // Initialize empty timeline
        this.timelines.set(project.id, {
            projectId: project.id,
            entries: []
        });
    }

    getProject(projectId: string): Project | undefined {
        return this.projects.get(projectId);
    }

    deleteProject(projectId: string): boolean {
        this.fileContents.delete(projectId);
        this.documentation.delete(projectId);
        this.timelines.delete(projectId);
        return this.projects.delete(projectId);
    }

    getAllProjects(): Project[] {
        return Array.from(this.projects.values());
    }

    updateProjectTimestamp(projectId: string): void {
        const project = this.projects.get(projectId);
        if (project) {
            project.lastUpdated = Date.now();
        }
    }

    // ==================== File Contents ====================

    updateFileContent(projectId: string, relativePath: string, content: string): void {
        const contents = this.fileContents.get(projectId);
        if (contents) {
            contents.set(relativePath, content);
        }
    }

    getFileContent(projectId: string, relativePath: string): string | undefined {
        return this.fileContents.get(projectId)?.get(relativePath);
    }

    getAllFileContents(projectId: string): Map<string, string> | undefined {
        return this.fileContents.get(projectId);
    }

    deleteFileContent(projectId: string, relativePath: string): void {
        this.fileContents.get(projectId)?.delete(relativePath);
    }

    // ==================== Knowledge Graph ====================

    saveGraphData(projectId: string, graphJson: GraphData | null, report: string): void {
        this.graphData.set(projectId, { graphJson, report });
    }

    getGraphData(projectId: string): { graphJson: GraphData | null; report: string } | undefined {
        return this.graphData.get(projectId);
    }

    /**
     * Get a structured knowledge graph summary for LLM context.
     * Falls back to raw file summary if no graph is available.
     */
    getGraphSummary(projectId: string): string {
        const project = this.projects.get(projectId);
        if (!project) return '';

        const graphInfo = this.graphData.get(projectId);
        if (graphInfo && (graphInfo.graphJson || graphInfo.report)) {
            return buildGraphSummary(
                project.projectName,
                project.languages,
                graphInfo.graphJson,
                graphInfo.report
            );
        }

        // Fallback to raw file summary
        return this.getRawProjectSummary(projectId);
    }

    // ==================== Documentation ====================

    saveDocumentation(docs: Documentation): void {
        this.documentation.set(docs.projectId, docs);
    }

    getDocumentation(projectId: string): Documentation | undefined {
        return this.documentation.get(projectId);
    }

    // ==================== Timeline ====================

    addTimelineEntry(projectId: string, entry: TimelineEntry): void {
        const timeline = this.timelines.get(projectId);
        if (timeline) {
            timeline.entries.unshift(entry); // Add to beginning
            // Keep only last 100 entries
            if (timeline.entries.length > 100) {
                timeline.entries = timeline.entries.slice(0, 100);
            }
        }
    }

    getTimeline(projectId: string): Timeline | undefined {
        return this.timelines.get(projectId);
    }

    // ==================== Utilities ====================

    /**
     * Get project summary using knowledge graph (preferred) or raw files (fallback).
     */
    getProjectSummary(projectId: string): string {
        return this.getGraphSummary(projectId);
    }

    /**
     * Get raw file content summary (legacy, used as fallback).
     */
    getRawProjectSummary(projectId: string): string {
        const project = this.projects.get(projectId);
        const contents = this.fileContents.get(projectId);

        if (!project || !contents) return '';

        let summary = `Project: ${project.projectName}\n`;
        summary += `Languages: ${project.languages.join(', ')}\n`;
        summary += `Files: ${project.files.length}\n\n`;

        // Include content from key files (limit to prevent token explosion)
        let totalChars = 0;
        const maxChars = 50000; // ~12k tokens

        for (const [path, content] of contents) {
            if (totalChars > maxChars) break;
            if (content && content.length > 0) {
                summary += `--- ${path} ---\n`;
                const truncated = content.slice(0, Math.min(content.length, maxChars - totalChars));
                summary += truncated + '\n\n';
                totalChars += truncated.length;
            }
        }

        return summary;
    }
}

// Singleton instance
export const storage = new Storage();
