/**
 * Live AI Project Docs - File Watcher
 * 
 * Watches for file changes and sends updates to the backend.
 * This is the MOST IMPORTANT component for live documentation updates.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { getConfig } from '../config';
import { getApiClient } from '../api/apiClient';
import { getFileContent, getLanguageFromPath } from './fileScanner';
import { FileUpdate, ChangeType, FileUpdateBatch } from '../types';

type FileWatcherEventHandler = (update: FileUpdate) => void;

export class FileWatcher implements vscode.Disposable {
    private watcher: vscode.FileSystemWatcher | null = null;
    private documentWatcher: vscode.Disposable | null = null;
    private projectId: string | null = null;
    private rootPath: string | null = null;
    private pendingUpdates: Map<string, FileUpdate> = new Map();
    private debounceTimer: NodeJS.Timeout | null = null;
    private disposables: vscode.Disposable[] = [];
    private outputChannel: vscode.OutputChannel;
    private eventHandlers: Set<FileWatcherEventHandler> = new Set();
    private isEnabled: boolean = false;

    constructor() {
        this.outputChannel = vscode.window.createOutputChannel('Live AI Docs - File Watcher');
    }

    /**
     * Start watching a project
     */
    public start(projectId: string, rootPath: string): void {
        this.stop(); // Clean up any existing watchers

        this.projectId = projectId;
        this.rootPath = rootPath;
        this.isEnabled = true;

        this.log(`Starting file watcher for project: ${projectId}`);
        this.log(`Root path: ${rootPath}`);

        // Create file system watcher
        const pattern = new vscode.RelativePattern(rootPath, '**/*');
        this.watcher = vscode.workspace.createFileSystemWatcher(pattern);

        // Watch for file changes
        this.watcher.onDidCreate(uri => this.handleFileEvent(uri, 'create'));
        this.watcher.onDidChange(uri => this.handleFileEvent(uri, 'save'));
        this.watcher.onDidDelete(uri => this.handleFileEvent(uri, 'delete'));

        this.disposables.push(this.watcher);

        // Also watch for document saves (more reliable for content)
        this.documentWatcher = vscode.workspace.onDidSaveTextDocument(doc => {
            if (doc.uri.fsPath.startsWith(rootPath)) {
                this.handleDocumentSave(doc);
            }
        });
        this.disposables.push(this.documentWatcher);

        this.log('File watcher started successfully');
    }

    /**
     * Stop watching
     */
    public stop(): void {
        this.log('Stopping file watcher');
        this.isEnabled = false;

        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }

        // Flush pending updates
        if (this.pendingUpdates.size > 0) {
            this.flushUpdates();
        }

        // Dispose watchers
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        this.disposables = [];
        this.watcher = null;
        this.documentWatcher = null;
        this.projectId = null;
        this.rootPath = null;
    }

    /**
     * Handle file system events
     */
    private async handleFileEvent(uri: vscode.Uri, changeType: ChangeType): Promise<void> {
        if (!this.isEnabled || !this.projectId || !this.rootPath) {
            return;
        }

        const filePath = uri.fsPath;
        const relativePath = path.relative(this.rootPath, filePath).replace(/\\/g, '/');

        // Check exclusion patterns
        if (this.shouldExclude(relativePath)) {
            return;
        }

        this.log(`File ${changeType}: ${relativePath}`);

        // Create file update
        const update: FileUpdate = {
            projectId: this.projectId,
            filePath,
            relativePath,
            changeType,
            timestamp: Date.now()
        };

        // For non-delete changes, get content
        if (changeType !== 'delete') {
            const content = await getFileContent(filePath);
            if (content !== null) {
                update.content = content;
            }
        }

        // Queue the update
        this.queueUpdate(update);
    }

    /**
     * Handle document save (more reliable for content)
     */
    private handleDocumentSave(document: vscode.TextDocument): void {
        if (!this.isEnabled || !this.projectId || !this.rootPath) {
            return;
        }

        const filePath = document.uri.fsPath;
        const relativePath = path.relative(this.rootPath, filePath).replace(/\\/g, '/');

        // Check exclusion patterns
        if (this.shouldExclude(relativePath)) {
            return;
        }

        this.log(`Document saved: ${relativePath}`);

        const update: FileUpdate = {
            projectId: this.projectId,
            filePath,
            relativePath,
            content: document.getText(),
            changeType: 'save',
            timestamp: Date.now()
        };

        this.queueUpdate(update);
    }

    /**
     * Check if a file should be excluded
     */
    private shouldExclude(relativePath: string): boolean {
        const config = getConfig();

        // Check common exclusions
        if (relativePath.includes('node_modules/') ||
            relativePath.includes('.git/') ||
            relativePath.includes('dist/') ||
            relativePath.includes('build/') ||
            relativePath.startsWith('.')) {
            return true;
        }

        // Check extension-based exclusions
        const ext = path.extname(relativePath).toLowerCase();
        if (['.log', '.lock', '.map'].includes(ext)) {
            return true;
        }

        // Check config patterns
        for (const pattern of config.excludePatterns) {
            if (pattern.includes('**')) {
                const cleanPattern = pattern.replace(/\*\*\//g, '').replace(/\*+/g, '');
                if (cleanPattern && relativePath.includes(cleanPattern)) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Queue an update for batched sending
     */
    private queueUpdate(update: FileUpdate): void {
        // Use relative path as key to deduplicate rapid changes
        this.pendingUpdates.set(update.relativePath, update);

        // Notify event handlers
        for (const handler of this.eventHandlers) {
            try {
                handler(update);
            } catch (error) {
                this.log(`Error in event handler: ${error}`);
            }
        }

        // Debounce the flush
        const config = getConfig();
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }

        this.debounceTimer = setTimeout(() => {
            this.flushUpdates();
        }, config.syncDebounceMs);
    }

    /**
     * Flush pending updates to the backend
     */
    private async flushUpdates(): Promise<void> {
        if (this.pendingUpdates.size === 0 || !this.projectId) {
            return;
        }

        const updates = Array.from(this.pendingUpdates.values());
        this.pendingUpdates.clear();

        this.log(`Flushing ${updates.length} updates to backend`);

        try {
            const apiClient = getApiClient();

            if (updates.length === 1) {
                // Single update
                await apiClient.updateFile(updates[0]);
            } else {
                // Batch update
                const batch: FileUpdateBatch = {
                    projectId: this.projectId,
                    updates,
                    batchTimestamp: Date.now()
                };
                await apiClient.updateFilesBatch(batch);
            }

            this.log(`Successfully sent ${updates.length} updates`);
            vscode.window.setStatusBarMessage(`$(cloud-upload) Live Docs: Synced ${updates.length} file(s)`, 3000);

            // Live Sync: after backend processes updates, wait a bit for
            // auto-regeneration to complete, then notify panels to re-fetch docs
            setTimeout(() => {
                this.notifyPanelsToRefresh();
            }, 8000); // 8 seconds — gives backend 5s debounce + 3s AI generation time

        } catch (error) {
            this.log(`Failed to send updates: ${error}`);
            // Re-queue failed updates
            for (const update of updates) {
                this.pendingUpdates.set(update.relativePath, update);
            }
            vscode.window.setStatusBarMessage('$(error) Live Docs: Sync failed', 3000);
        }
    }

    /**
     * Register an event handler for file changes
     */
    public onFileChange(handler: FileWatcherEventHandler): vscode.Disposable {
        this.eventHandlers.add(handler);
        return {
            dispose: () => {
                this.eventHandlers.delete(handler);
            }
        };
    }

    /**
     * Get pending update count
     */
    public getPendingCount(): number {
        return this.pendingUpdates.size;
    }

    /**
     * Check if watcher is active
     */
    public isActive(): boolean {
        return this.isEnabled && this.watcher !== null;
    }

    /**
     * Force flush any pending updates
     */
    public async forceFlush(): Promise<void> {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
        await this.flushUpdates();
    }

    /**
     * Notify open documentation panels to re-fetch latest docs from backend.
     * This is the key to live synchronization — after file changes are sent
     * to the backend and docs are regenerated, we tell the UI to update.
     */
    private notifyPanelsToRefresh(): void {
        this.log('Live Sync: Notifying panels to re-fetch docs...');

        // Use VS Code command to trigger re-fetch in all open panels
        vscode.commands.executeCommand('liveAIDocs.liveSyncRefresh').then(
            () => this.log('Live Sync: Panels notified successfully'),
            (err) => this.log(`Live Sync: Notification failed: ${err}`)
        );

        vscode.window.setStatusBarMessage('$(check) Live Docs: Documentation updated', 3000);
    }

    private log(message: string): void {
        const timestamp = new Date().toISOString();
        this.outputChannel.appendLine(`[${timestamp}] ${message}`);
    }

    public showOutput(): void {
        this.outputChannel.show();
    }

    public dispose(): void {
        this.stop();
        this.outputChannel.dispose();
        this.eventHandlers.clear();
    }
}

// Singleton instance
let fileWatcherInstance: FileWatcher | null = null;

export function getFileWatcher(): FileWatcher {
    if (!fileWatcherInstance) {
        fileWatcherInstance = new FileWatcher();
    }
    return fileWatcherInstance;
}

export function disposeFileWatcher(): void {
    if (fileWatcherInstance) {
        fileWatcherInstance.dispose();
        fileWatcherInstance = null;
    }
}
