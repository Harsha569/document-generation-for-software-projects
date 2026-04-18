/**
 * Live AI Docs Backend - API Routes
 */

import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { storage } from './storage';
import { generateDocumentation, refreshSection, explainCode, answerQuestion } from './ai';
import { buildGraph, isGraphifyAvailable } from './graphify';
import {
    ProjectData,
    Project,
    FileUpdate,
    FileUpdateBatch,
    TimelineEntry,
    ExplainRequest,
    Question
} from './types';

const router = Router();

// ==================== Health Check ====================

router.get('/health', (req: Request, res: Response) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// ==================== Project Endpoints ====================

/**
 * POST /project/connect
 * Connect a project and start tracking
 */
router.post('/project/connect', async (req: Request, res: Response) => {
    try {
        const data: ProjectData = req.body;

        if (!data.projectName || !data.rootPath) {
            return res.status(400).json({
                projectId: '',
                status: 'error',
                message: 'Missing required fields: projectName and rootPath'
            });
        }

        // Create project record
        const project: Project = {
            ...data,
            id: uuidv4(),
            connectedAt: Date.now(),
            lastUpdated: Date.now()
        };

        // Save to storage
        storage.saveProject(project);

        // Store initial file contents if provided
        const fileContents: Record<string, string> | undefined = req.body.fileContents;
        if (fileContents) {
            for (const [filePath, content] of Object.entries(fileContents)) {
                if (content && content.length > 0) {
                    storage.updateFileContent(project.id, filePath, content);
                }
            }
            console.log(`  Stored content for ${Object.keys(fileContents).length} files`);
        }

        console.log(`✓ Project connected: ${project.projectName} (${project.id})`);
        console.log(`  Files: ${data.files?.length || 0}, Languages: ${data.languages?.join(', ')}`);

        // Build knowledge graph in background (non-blocking)
        const contents = storage.getAllFileContents(project.id);
        if (contents && contents.size > 0) {
            buildGraphInBackground(project.id, contents);
        }

        res.json({
            projectId: project.id,
            status: 'connected',
            message: `Project "${project.projectName}" connected successfully`
        });
    } catch (error) {
        console.error('Error connecting project:', error);
        res.status(500).json({
            projectId: '',
            status: 'error',
            message: 'Failed to connect project'
        });
    }
});

/**
 * POST /project/disconnect
 * Disconnect a project
 */
router.post('/project/disconnect', (req: Request, res: Response) => {
    try {
        const { projectId } = req.body;

        if (!projectId) {
            return res.status(400).json({ error: 'Missing projectId' });
        }

        const deleted = storage.deleteProject(projectId);

        if (deleted) {
            console.log(`✓ Project disconnected: ${projectId}`);
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'Project not found' });
        }
    } catch (error) {
        console.error('Error disconnecting project:', error);
        res.status(500).json({ error: 'Failed to disconnect project' });
    }
});

// ==================== File Update Endpoints ====================

/**
 * POST /file/update
 * Handle a single file update
 */
router.post('/file/update', async (req: Request, res: Response) => {
    try {
        const update: FileUpdate = req.body;

        if (!update.projectId || !update.relativePath) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const project = storage.getProject(update.projectId);
        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        // Update file content
        if (update.changeType === 'delete') {
            storage.deleteFileContent(update.projectId, update.relativePath);
        } else if (update.content !== undefined) {
            storage.updateFileContent(update.projectId, update.relativePath, update.content);
        }

        // Add timeline entry
        const timelineEntry: TimelineEntry = {
            id: uuidv4(),
            date: new Date().toISOString().split('T')[0],
            time: new Date().toLocaleTimeString(),
            filesChanged: [update.relativePath],
            summary: getChangeSummary(update.changeType, update.relativePath),
            affectedSection: 'modules',
            changeType: update.changeType
        };
        storage.addTimelineEntry(update.projectId, timelineEntry);
        storage.updateProjectTimestamp(update.projectId);

        console.log(`  File ${update.changeType}: ${update.relativePath}`);

        // Respond immediately, then trigger background doc regeneration
        res.json({ success: true, docsUpdated: true });

        // Background: rebuild knowledge graph (debounced). AI docs will trigger if graph changes.
        scheduleGraphRebuild(update.projectId);
    } catch (error) {
        console.error('Error updating file:', error);
        res.status(500).json({ error: 'Failed to update file' });
    }
});

/**
 * POST /file/update-batch
 * Handle batch file updates
 */
router.post('/file/update-batch', async (req: Request, res: Response) => {
    try {
        const batch: FileUpdateBatch = req.body;

        if (!batch.projectId || !batch.updates?.length) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const project = storage.getProject(batch.projectId);
        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        const filesChanged: string[] = [];

        for (const update of batch.updates) {
            if (update.changeType === 'delete') {
                storage.deleteFileContent(batch.projectId, update.relativePath);
            } else if (update.content !== undefined) {
                storage.updateFileContent(batch.projectId, update.relativePath, update.content);
            }
            filesChanged.push(update.relativePath);
        }

        // Add single timeline entry for batch
        const timelineEntry: TimelineEntry = {
            id: uuidv4(),
            date: new Date().toISOString().split('T')[0],
            time: new Date().toLocaleTimeString(),
            filesChanged,
            summary: `Updated ${filesChanged.length} file(s)`,
            affectedSection: 'modules',
            changeType: 'save'
        };
        storage.addTimelineEntry(batch.projectId, timelineEntry);
        storage.updateProjectTimestamp(batch.projectId);

        console.log(`  Batch update: ${filesChanged.length} files`);

        res.json({ success: true, docsUpdated: true });

        // Background: rebuild knowledge graph (debounced). AI docs will trigger if graph changes.
        scheduleGraphRebuild(batch.projectId);
    } catch (error) {
        console.error('Error batch updating files:', error);
        res.status(500).json({ error: 'Failed to batch update files' });
    }
});

// ==================== Documentation Endpoints ====================

/**
 * GET /project/:id/docs
 * Get documentation for a project
 */
router.get('/project/:id/docs', async (req: Request, res: Response) => {
    try {
        const projectId = req.params.id;

        const docs = storage.getDocumentation(projectId);

        if (!docs) {
            // Return empty docs — never auto-generate on GET
            // User must click Refresh to trigger generation
            return res.json({
                projectId,
                sections: [],
                lastUpdated: 0,
                generationStatus: 'pending'
            });
        }

        res.json(docs);
    } catch (error) {
        console.error('Error getting docs:', error);
        res.status(500).json({ error: 'Failed to get documentation' });
    }
});

/**
 * POST /project/:id/docs/refresh
 * Regenerate documentation (debounced — ignores requests within 10s of last)
 */
const lastRefreshTime = new Map<string, number>();

router.post('/project/:id/docs/refresh', async (req: Request, res: Response) => {
    try {
        const projectId = req.params.id;
        const { section } = req.body; // optional: refresh only this section

        const project = storage.getProject(projectId);
        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        // Debounce: if we refreshed within the last 10 seconds, return cached docs
        const debounceKey = `${projectId}:${section || 'all'}`;
        const lastRefresh = lastRefreshTime.get(debounceKey) || 0;
        if (Date.now() - lastRefresh < 10000) {
            const cached = storage.getDocumentation(projectId);
            if (cached) {
                return res.json(cached);
            }
        }

        lastRefreshTime.set(debounceKey, Date.now());

        let docs;
        if (section && ['overview', 'architecture', 'modules', 'apis'].includes(section)) {
            // Per-section refresh — only regenerate this one section
            console.log(`Refreshing section "${section}" for: ${projectId}`);
            docs = await refreshSection(projectId, section);
        } else {
            // Full docs refresh
            console.log(`Refreshing all documentation for: ${projectId}`);
            docs = await generateDocumentation(projectId);
        }

        res.json(docs);
    } catch (error) {
        console.error('Error refreshing docs:', error);
        res.status(500).json({ error: 'Failed to refresh documentation' });
    }
});

/**
 * GET /project/:id/timeline
 * Get change timeline
 */
router.get('/project/:id/timeline', (req: Request, res: Response) => {
    try {
        const projectId = req.params.id;

        const timeline = storage.getTimeline(projectId);
        if (!timeline) {
            return res.status(404).json({ error: 'Project not found' });
        }

        res.json(timeline);
    } catch (error) {
        console.error('Error getting timeline:', error);
        res.status(500).json({ error: 'Failed to get timeline' });
    }
});

// ==================== AI Endpoints ====================

/**
 * POST /explain
 * Explain code using AI
 */
router.post('/explain', async (req: Request, res: Response) => {
    try {
        const request: ExplainRequest = req.body;

        if (!request.code || !request.projectId) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const explanation = await explainCode(request);
        res.json(explanation);
    } catch (error) {
        console.error('Error explaining code:', error);
        res.status(500).json({ error: 'Failed to explain code' });
    }
});

/**
 * POST /ask
 * Answer a question about the project
 */
router.post('/ask', async (req: Request, res: Response) => {
    try {
        const question: Question = req.body;

        if (!question.query || !question.projectId) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const answer = await answerQuestion(question);
        res.json(answer);
    } catch (error) {
        console.error('Error answering question:', error);
        res.status(500).json({ error: 'Failed to answer question' });
    }
});

// ==================== Helpers ====================

function getChangeSummary(changeType: string, filePath: string): string {
    const fileName = filePath.split('/').pop() || filePath;
    switch (changeType) {
        case 'create':
            return `Created ${fileName}`;
        case 'delete':
            return `Deleted ${fileName}`;
        case 'rename':
            return `Renamed ${fileName}`;
        default:
            return `Modified ${fileName}`;
    }
}

// ==================== Knowledge Graph: Background Build ====================

/**
 * Build knowledge graph in background (non-blocking).
 * Called on project connect. Returns true if the graph output changed materially.
 */
async function buildGraphInBackground(projectId: string, fileContents: Map<string, string>): Promise<boolean> {
    try {
        const available = await isGraphifyAvailable();
        if (!available) {
            console.log('[Graphify] CLI not available — skipping graph build');
            return false;
        }

        const oldGraphInfo = storage.getGraphData(projectId);
        const oldReport = oldGraphInfo?.report || '';

        console.log(`[Graphify] Starting background graph build for: ${projectId}`);
        const result = await buildGraph(projectId, fileContents);

        if (result.graphJson || result.report) {
            storage.saveGraphData(projectId, result.graphJson, result.report);
            console.log(`[Graphify] ✓ Graph data saved for: ${projectId}`);
            
            // Check if graph topology changed by comparing the human-readable summary
            if (oldReport !== '' && result.report !== oldReport) {
                console.log(`[Graphify] 🔄 Graph topology changed structurally.`);
                return true;
            }
        }
    } catch (error: any) {
        console.error('[Graphify] Background build failed:', error.message);
    }
    return false;
}

/**
 * Debounced graph rebuild after file changes.
 * Waits 10 seconds after the last file change before rebuilding.
 */
const graphRebuildTimers = new Map<string, NodeJS.Timeout>();

function scheduleGraphRebuild(projectId: string): void {
    const existing = graphRebuildTimers.get(projectId);
    if (existing) {
        clearTimeout(existing);
    }

    // 10 second debounce for graph rebuilds (longer than doc regen)
    const timer = setTimeout(async () => {
        graphRebuildTimers.delete(projectId);

        const contents = storage.getAllFileContents(projectId);
        if (!contents || contents.size === 0) return;

        const graphChanged = await buildGraphInBackground(projectId, contents);
        
        if (graphChanged) {
            console.log(`[Live Sync] 🔄 Graph changed. Auto-regenerating docs...`);
            try {
                await generateDocumentation(projectId);
                console.log(`[Live Sync] ✓ Docs auto-regenerated successfully for: ${projectId}`);
            } catch (err) {
                console.error(`[Live Sync] ✗ Auto-regeneration failed:`, err);
            }
        }
    }, 10000);

    graphRebuildTimers.set(projectId, timer);
}

// ==================== Manual Graph Rebuild Endpoint ====================

/**
 * POST /project/:id/graph/rebuild
 * Manually trigger a knowledge graph rebuild
 */
router.post('/project/:id/graph/rebuild', async (req: Request, res: Response) => {
    try {
        const projectId = req.params.id;

        const project = storage.getProject(projectId);
        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        const available = await isGraphifyAvailable();
        if (!available) {
            return res.status(503).json({ error: 'Graphify CLI not available. Install with: pip install graphifyy' });
        }

        const contents = storage.getAllFileContents(projectId);
        if (!contents || contents.size === 0) {
            return res.status(400).json({ error: 'No file contents available for this project' });
        }

        console.log(`[Graphify] Manual graph rebuild for: ${projectId}`);
        const result = await buildGraph(projectId, contents);

        if (result.graphJson || result.report) {
            storage.saveGraphData(projectId, result.graphJson, result.report);
        }

        res.json({
            success: true,
            nodes: result.graphJson?.nodes?.length || 0,
            edges: result.graphJson?.edges?.length || 0,
            buildTimeMs: result.buildTime,
            hasReport: result.report.length > 0
        });
    } catch (error: any) {
        console.error('Error rebuilding graph:', error);
        res.status(500).json({ error: 'Failed to rebuild graph' });
    }
});

// Live sync has been optimized to only trigger on structural graph changes.


export default router;
