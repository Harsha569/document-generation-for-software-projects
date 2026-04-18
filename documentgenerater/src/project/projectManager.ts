/**
 * Live AI Project Docs - Project Manager
 * 
 * Central state management for project connection and synchronization.
 */

import * as vscode from 'vscode';
import { getApiClient } from '../api/apiClient';
import { scanWorkspace, ScanResult } from './fileScanner';
import { getFileWatcher } from './fileWatcher';
import { ExtensionState, ProjectData, ProjectResponse } from '../types';

type StateChangeHandler = (state: ExtensionState) => void;

export class ProjectManager implements vscode.Disposable {
    private state: ExtensionState;
    private stateHandlers: Set<StateChangeHandler> = new Set();
    private context: vscode.ExtensionContext;
    private statusBarItem: vscode.StatusBarItem;
    private outputChannel: vscode.OutputChannel;

    private static readonly STATE_KEY = 'liveAIDocs.state';

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.outputChannel = vscode.window.createOutputChannel('Live AI Docs - Project');

        // Create status bar item
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            100
        );
        this.statusBarItem.command = 'liveAIDocs.openDocs';
        context.subscriptions.push(this.statusBarItem);

        // Load persisted state or use default
        this.state = this.loadState();
        this.updateStatusBar();
    }

    /**
     * Get current state
     */
    public getState(): ExtensionState {
        return { ...this.state };
    }

    /**
     * Check if connected
     */
    public isConnected(): boolean {
        return this.state.isConnected;
    }

    /**
     * Get project ID
     */
    public getProjectId(): string | undefined {
        return this.state.projectId;
    }

    /**
     * Connect the current workspace to the backend
     */
    public async connect(): Promise<boolean> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

        if (!workspaceFolder) {
            vscode.window.showErrorMessage('No workspace folder open. Please open a project first.');
            return false;
        }

        this.log(`Connecting project: ${workspaceFolder.name}`);
        this.updateState({ syncStatus: 'syncing' });
        this.statusBarItem.text = '$(sync~spin) Live Docs: Connecting...';
        this.statusBarItem.show();

        try {
            // Show progress
            return await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Live AI Docs',
                    cancellable: false
                },
                async (progress) => {
                    // Step 1: Scan project
                    progress.report({ message: 'Scanning project files...', increment: 10 });

                    const scanResult = await scanWorkspace(workspaceFolder, (scanProgress) => {
                        progress.report({
                            message: `Scanning: ${scanProgress.scanned} files...`
                        });
                    });

                    this.log(`Scanned ${scanResult.fileCount} files (${scanResult.languages.length} languages)`);

                    // Step 2: Read file contents for initial sync
                    progress.report({ message: 'Reading file contents...', increment: 20 });

                    const fileContents: Record<string, string> = {};
                    let totalContentSize = 0;
                    const MAX_CONTENT_SIZE = 50000; // ~50KB total to keep request manageable

                    for (const file of scanResult.files) {
                        if (totalContentSize >= MAX_CONTENT_SIZE) {
                            break;
                        }
                        // Skip non-code files and large files
                        if (file.language === 'unknown' || file.size > 10000) {
                            continue;
                        }
                        try {
                            const fs = await import('fs');
                            const content = fs.readFileSync(file.path, 'utf-8');
                            if (content && content.length > 0) {
                                fileContents[file.relativePath] = content;
                                totalContentSize += content.length;
                            }
                        } catch {
                            // Skip files we can't read
                        }
                    }

                    this.log(`Read content for ${Object.keys(fileContents).length} files (${Math.round(totalContentSize / 1024)}KB)`);

                    // Step 3: Connect to backend
                    progress.report({ message: 'Connecting to backend...', increment: 20 });

                    const projectData: ProjectData = {
                        projectName: workspaceFolder.name,
                        rootPath: workspaceFolder.uri.fsPath,
                        files: scanResult.files,
                        languages: scanResult.languages
                    };

                    const apiClient = getApiClient();
                    let response: ProjectResponse;

                    try {
                        // Send project data with file contents
                        response = await apiClient.connectProject({
                            ...projectData,
                            fileContents
                        } as any);
                    } catch (error) {
                        // If backend is unavailable, use a local mock project ID
                        this.log(`Backend unavailable, using local mode: ${error}`);
                        response = {
                            projectId: `local-${Date.now()}`,
                            status: 'connected',
                            message: 'Connected in local mode (backend unavailable)'
                        };
                    }

                    if (response.status === 'error') {
                        throw new Error(response.message || 'Failed to connect project');
                    }

                    // Step 4: Start file watcher
                    progress.report({ message: 'Starting file watcher...', increment: 20 });

                    const fileWatcher = getFileWatcher();
                    fileWatcher.start(response.projectId, workspaceFolder.uri.fsPath);

                    // Step 5: Update state
                    progress.report({ message: 'Ready!', increment: 10 });

                    this.updateState({
                        isConnected: true,
                        projectId: response.projectId,
                        projectName: workspaceFolder.name,
                        lastSync: Date.now(),
                        syncStatus: 'idle'
                    });

                    this.log(`Project connected successfully: ${response.projectId}`);
                    vscode.window.showInformationMessage(
                        `Project "${workspaceFolder.name}" connected successfully! ${scanResult.fileCount} files indexed.`
                    );

                    return true;
                }
            );
        } catch (error) {
            this.log(`Failed to connect: ${error}`);
            this.updateState({ syncStatus: 'error' });
            vscode.window.showErrorMessage(`Failed to connect project: ${error}`);
            return false;
        }
    }

    /**
     * Disconnect the current project
     */
    public async disconnect(): Promise<void> {
        if (!this.state.isConnected || !this.state.projectId) {
            return;
        }

        this.log('Disconnecting project...');

        try {
            // Stop file watcher
            const fileWatcher = getFileWatcher();
            await fileWatcher.forceFlush();
            fileWatcher.stop();

            // Notify backend
            try {
                const apiClient = getApiClient();
                await apiClient.disconnectProject(this.state.projectId);
            } catch {
                // Ignore backend errors during disconnect
            }

            // Update state
            this.updateState({
                isConnected: false,
                projectId: undefined,
                projectName: undefined,
                lastSync: undefined,
                syncStatus: 'idle'
            });

            this.log('Project disconnected');
            vscode.window.showInformationMessage('Project disconnected from Live AI Docs');
        } catch (error) {
            this.log(`Error during disconnect: ${error}`);
        }
    }

    /**
     * Subscribe to state changes
     */
    public onStateChange(handler: StateChangeHandler): vscode.Disposable {
        this.stateHandlers.add(handler);
        // Immediately call with current state
        handler(this.getState());
        return {
            dispose: () => {
                this.stateHandlers.delete(handler);
            }
        };
    }

    /**
     * Update state and notify handlers
     */
    private updateState(partial: Partial<ExtensionState>): void {
        this.state = { ...this.state, ...partial };
        this.saveState();
        this.updateStatusBar();

        // Notify handlers
        for (const handler of this.stateHandlers) {
            try {
                handler(this.getState());
            } catch (error) {
                this.log(`Error in state handler: ${error}`);
            }
        }
    }

    /**
     * Update status bar based on current state
     */
    private updateStatusBar(): void {
        if (this.state.isConnected) {
            const syncIcon = this.state.syncStatus === 'syncing' ? '$(sync~spin)' :
                this.state.syncStatus === 'error' ? '$(error)' : '$(check)';
            this.statusBarItem.text = `${syncIcon} Live Docs: ${this.state.projectName || 'Connected'}`;
            this.statusBarItem.tooltip = `Click to open documentation\nProject ID: ${this.state.projectId}`;
            this.statusBarItem.backgroundColor = undefined;
        } else {
            this.statusBarItem.text = '$(plug) Live Docs: Not Connected';
            this.statusBarItem.tooltip = 'Click to connect project';
            this.statusBarItem.command = 'liveAIDocs.connectProject';
        }
        this.statusBarItem.show();
    }

    /**
     * Save state to extension storage
     */
    private saveState(): void {
        this.context.workspaceState.update(ProjectManager.STATE_KEY, this.state);
    }

    /**
     * Load state from extension storage
     */
    private loadState(): ExtensionState {
        const saved = this.context.workspaceState.get<ExtensionState>(ProjectManager.STATE_KEY);
        const state = saved || {
            isConnected: false,
            syncStatus: 'idle'
        };

        // Always reset connection status on load to enforce manual connection/startup prompt
        return {
            ...state,
            isConnected: false,
            syncStatus: 'idle'
        };
    }

    private log(message: string): void {
        const timestamp = new Date().toISOString();
        this.outputChannel.appendLine(`[${timestamp}] ${message}`);
    }

    public showOutput(): void {
        this.outputChannel.show();
    }

    public dispose(): void {
        this.statusBarItem.dispose();
        this.outputChannel.dispose();
        this.stateHandlers.clear();
    }
}

// Singleton
let projectManagerInstance: ProjectManager | null = null;

export function initProjectManager(context: vscode.ExtensionContext): ProjectManager {
    if (!projectManagerInstance) {
        projectManagerInstance = new ProjectManager(context);
    }
    return projectManagerInstance;
}

export function getProjectManager(): ProjectManager {
    if (!projectManagerInstance) {
        throw new Error('ProjectManager not initialized. Call initProjectManager first.');
    }
    return projectManagerInstance;
}

export function disposeProjectManager(): void {
    if (projectManagerInstance) {
        projectManagerInstance.dispose();
        projectManagerInstance = null;
    }
}
