/**
 * Live AI Project Docs - Documentation Panel
 * 
 * Manages the WebView panel for displaying documentation.
 * Uses postMessage to update content without re-rendering the entire HTML.
 */

import * as vscode from 'vscode';
import { getProjectManager } from '../project/projectManager';
import { getApiClient } from '../api/apiClient';
import { getWebViewContent } from './webviewContent';
import { Documentation, Timeline, AskPayload } from '../types';

export class DocsPanel implements vscode.Disposable {
    public static currentPanel: DocsPanel | undefined;
    private static readonly viewType = 'liveAIDocs.docsPanel';

    private readonly panel: vscode.WebviewPanel;
    private readonly extensionUri: vscode.Uri;
    private documentation: Documentation | undefined;
    private timeline: Timeline | undefined;
    private disposables: vscode.Disposable[] = [];
    private refreshInterval: NodeJS.Timeout | undefined;
    private isLoading = false;
    private htmlInitialized = false;

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this.panel = panel;
        this.extensionUri = extensionUri;

        // Set HTML content ONCE
        this.initializeHtml();

        // Listen for panel disposal
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

        // Listen for messages from the WebView
        this.panel.webview.onDidReceiveMessage(
            (message) => this.handleMessage(message),
            null,
            this.disposables
        );

        // Listen for project state changes (auto-load docs when connected)
        const projectManager = getProjectManager();
        this.disposables.push(
            projectManager.onStateChange((state) => {
                if (state.isConnected && !this.isLoading) {
                    console.log('[DocsPanel] Project connected, auto-loading documentation...');
                    this.loadDocumentation();
                }
            })
        );

        // Auto-refresh every 2 minutes
        this.startAutoRefresh();
    }

    /**
     * Set the HTML content once - never replace it again
     */
    private initializeHtml(): void {
        const projectManager = getProjectManager();
        const state = projectManager.getState();

        this.panel.webview.html = getWebViewContent(
            this.panel.webview,
            this.extensionUri,
            state
        );
        this.htmlInitialized = true;
    }

    /**
     * Push documentation data to the WebView via postMessage
     */
    private pushDataToWebView(): void {
        if (!this.htmlInitialized) {
            return;
        }
        this.panel.webview.postMessage({
            type: 'updateDocs',
            docs: this.documentation || null,
            timeline: this.timeline || null
        });
    }

    /**
     * Create or show the documentation panel
     */
    public static createOrShow(extensionUri: vscode.Uri): DocsPanel {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (DocsPanel.currentPanel) {
            DocsPanel.currentPanel.panel.reveal(column);
            return DocsPanel.currentPanel;
        }

        const panel = vscode.window.createWebviewPanel(
            DocsPanel.viewType,
            'Live AI Docs',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [extensionUri]
            }
        );

        DocsPanel.currentPanel = new DocsPanel(panel, extensionUri);
        return DocsPanel.currentPanel;
    }

    /**
     * Use an existing panel (from serialization)
     */
    public static revive(panel: vscode.WebviewPanel, extensionUri: vscode.Uri): void {
        DocsPanel.currentPanel = new DocsPanel(panel, extensionUri);
    }

    /**
     * Handle messages from the WebView
     */
    private async handleMessage(message: any): Promise<void> {
        switch (message.type) {
            case 'ready':
                // WebView loaded - fetch and push data (no HTML replacement!)
                await this.loadDocumentation();
                break;

            case 'refresh':
                await this.refresh(message.section);
                break;

            case 'ask':
                const askPayload = message.payload as AskPayload;
                await this.askQuestion(askPayload.question);
                break;

            case 'connect':
                await vscode.commands.executeCommand('liveAIDocs.connectProject');
                break;
        }
    }

    /**
     * Load documentation from backend and push to WebView
     */
    private async loadDocumentation(): Promise<void> {
        if (this.isLoading) {
            return;
        }
        this.isLoading = true;

        try {
            const projectManager = getProjectManager();
            const projectId = projectManager.getProjectId();

            if (!projectId) {
                this.documentation = undefined;
                this.pushDataToWebView();
                return;
            }

            // Local mode - use mock
            if (projectId.startsWith('local-')) {
                this.documentation = this.getMockDocumentation(projectId);
                this.pushDataToWebView();
                return;
            }

            // Fetch from backend
            try {
                const apiClient = getApiClient();
                const [docs, timeline] = await Promise.allSettled([
                    apiClient.getDocumentation(projectId),
                    apiClient.getTimeline(projectId)
                ]);

                if (docs.status === 'fulfilled' && docs.value) {
                    this.documentation = docs.value;
                } else {
                    this.documentation = this.getMockDocumentation(projectId);
                }

                if (timeline.status === 'fulfilled' && timeline.value) {
                    this.timeline = timeline.value;
                }
            } catch {
                this.documentation = this.getMockDocumentation(projectId);
            }

            this.pushDataToWebView();
        } catch (error) {
            console.error('Error loading documentation:', error);
        } finally {
            this.isLoading = false;
        }
    }

    /**
     * Refresh documentation
     */
    public async refresh(section?: string): Promise<void> {
        const projectManager = getProjectManager();
        const projectId = projectManager.getProjectId();

        if (!projectId) {
            return;
        }

        const label = section ? `"${section}" section` : 'documentation';
        vscode.window.setStatusBarMessage(`$(sync~spin) Refreshing ${label}...`, 3000);

        try {
            if (!projectId.startsWith('local-')) {
                const apiClient = getApiClient();
                await apiClient.refreshDocumentation(projectId, section);
            }
            await this.loadDocumentation();
            vscode.window.setStatusBarMessage(`$(check) ${label} refreshed`, 3000);
        } catch {
            await this.loadDocumentation();
        }
    }

    /**
     * Live Sync reload — re-fetch docs from backend without triggering
     * AI regeneration (backend already auto-regenerated in the background).
     * This is called by the liveSyncRefresh command after file changes.
     */
    public async liveSyncReload(): Promise<void> {
        console.log('[DocsPanel] Live Sync: re-fetching docs...');
        await this.loadDocumentation();
    }

    /**
     * Ask a question about the project
     */
    private async askQuestion(question: string): Promise<void> {
        const projectManager = getProjectManager();
        const projectId = projectManager.getProjectId();

        if (!projectId) {
            vscode.window.showWarningMessage('Please connect a project first');
            return;
        }

        try {
            const apiClient = getApiClient();
            const answer = await apiClient.askQuestion({
                projectId,
                query: question
            });

            vscode.window.showInformationMessage(answer.response, { modal: false });

            this.panel.webview.postMessage({
                type: 'answer',
                payload: answer
            });
        } catch {
            vscode.window.showErrorMessage('Failed to get answer. Please try again.');
        }
    }

    /**
     * Start auto-refresh timer
     */
    private startAutoRefresh(): void {
        this.stopAutoRefresh();
        this.refreshInterval = setInterval(() => {
            const projectManager = getProjectManager();
            if (projectManager.isConnected()) {
                this.loadDocumentation();
            }
        }, 600000); // 10 minutes (loadDocumentation only fetches cached docs, no AI calls)
    }

    /**
     * Stop auto-refresh timer
     */
    private stopAutoRefresh(): void {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = undefined;
        }
    }

    /**
     * Get mock documentation for when backend is unavailable
     */
    private getMockDocumentation(projectId: string): Documentation {
        return {
            projectId,
            lastUpdated: Date.now(),
            generationStatus: 'ready',
            sections: [
                {
                    id: 'overview',
                    title: 'Project Overview',
                    type: 'overview',
                    content: `# Project Overview\n\nThis documentation is generated by **Live AI Project Docs**.\n\nThe system is currently running in **local mode** because the AI backend is not connected. Once you connect to a backend server, the documentation will be automatically generated based on your project's code.\n\n## Features\n\n- **Real-time synchronization**: Changes are detected as you code\n- **Automatic documentation**: AI generates docs from your code\n- **Q&A system**: Ask questions about your project\n- **Timeline view**: Track all changes and their impact\n\n## Getting Started\n\n1. Configure the backend URL in settings\n2. Use "Live Docs: Connect Project" to start\n3. View auto-generated documentation here`,
                    lastUpdated: Date.now()
                },
                {
                    id: 'architecture',
                    title: 'Architecture',
                    type: 'architecture',
                    content: `# Architecture\n\nDocumentation will be generated here once connected to the AI backend.\n\nThe architecture section typically includes:\n- System components overview\n- Data flow diagrams\n- Module dependencies\n- Integration points`,
                    lastUpdated: Date.now()
                },
                {
                    id: 'modules',
                    title: 'Modules',
                    type: 'modules',
                    content: `# Modules\n\nModule documentation will appear here after AI analysis.\n\nEach module section includes:\n- Purpose and responsibility\n- Public APIs\n- Dependencies\n- Usage examples`,
                    lastUpdated: Date.now()
                }
            ]
        };
    }

    public dispose(): void {
        DocsPanel.currentPanel = undefined;
        this.stopAutoRefresh();
        this.panel.dispose();

        while (this.disposables.length) {
            const disposable = this.disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}
