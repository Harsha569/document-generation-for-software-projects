/**
 * Live AI Project Docs - Sidebar WebView Provider
 *
 * Provides the documentation UI inside the VS Code sidebar (Activity Bar view).
 * Uses the same HTML/data flow as the editor-tab DocsPanel.
 */

import * as vscode from 'vscode';
import { getProjectManager } from '../project/projectManager';
import { getApiClient } from '../api/apiClient';
import { getWebViewContent } from './webviewContent';
import { Documentation, Timeline, AskPayload } from '../types';

export class DocsSidebarProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'liveAIDocs.docsPanel';

    private view?: vscode.WebviewView;
    private documentation: Documentation | undefined;
    private timeline: Timeline | undefined;
    private isLoading = false;

    constructor(private readonly extensionUri: vscode.Uri) {}

    /**
     * Called by VS Code when the sidebar view becomes visible
     */
    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void {
        this.view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri]
        };

        // Set the HTML content
        const projectManager = getProjectManager();
        const state = projectManager.getState();
        webviewView.webview.html = getWebViewContent(
            webviewView.webview,
            this.extensionUri,
            state
        );

        // Listen for messages from the webview
        webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.type) {
                case 'ready':
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
        });

        // Listen for project state changes (auto-load docs when connected)
        projectManager.onStateChange((state) => {
            if (state.isConnected && !this.isLoading) {
                console.log('[Sidebar] Project connected, auto-loading documentation...');
                this.loadDocumentation();
            }
        });
    }

    /**
     * Load documentation from backend (read-only, no regeneration)
     */
    private async loadDocumentation(): Promise<void> {
        if (this.isLoading || !this.view) {
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

            if (projectId.startsWith('local-')) {
                this.documentation = undefined;
                this.pushDataToWebView();
                return;
            }

            try {
                const apiClient = getApiClient();
                const [docs, timeline] = await Promise.allSettled([
                    apiClient.getDocumentation(projectId),
                    apiClient.getTimeline(projectId)
                ]);

                if (docs.status === 'fulfilled' && docs.value) {
                    this.documentation = docs.value;
                }

                if (timeline.status === 'fulfilled' && timeline.value) {
                    this.timeline = timeline.value;
                }
            } catch {
                // Silently fail — docs may not be generated yet
            }

            this.pushDataToWebView();
        } catch (error) {
            console.error('Sidebar: Error loading documentation:', error);
        } finally {
            this.isLoading = false;
        }
    }

    /**
     * Refresh documentation (triggers AI regeneration)
     */
    public async refresh(section?: string): Promise<void> {
        const projectManager = getProjectManager();
        const projectId = projectManager.getProjectId();

        if (!projectId || projectId.startsWith('local-')) {
            return;
        }

        const label = section ? `"${section}" section` : 'documentation';
        vscode.window.setStatusBarMessage(`$(sync~spin) Refreshing ${label}...`, 3000);

        try {
            const apiClient = getApiClient();
            await apiClient.refreshDocumentation(projectId, section);
            await this.loadDocumentation();
            vscode.window.setStatusBarMessage(`$(check) ${label} refreshed`, 3000);
        } catch {
            await this.loadDocumentation();
        }
    }

    /**
     * Live Sync reload — re-fetch docs from backend without triggering
     * AI regeneration (backend already auto-regenerated in the background).
     */
    public async liveSyncReload(): Promise<void> {
        console.log('[Sidebar] Live Sync: re-fetching docs...');
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

            this.view?.webview.postMessage({
                type: 'answer',
                payload: answer
            });
        } catch {
            vscode.window.showErrorMessage('Failed to get answer. Please try again.');
        }
    }

    /**
     * Push data to the webview via postMessage
     */
    private pushDataToWebView(): void {
        if (!this.view) {
            return;
        }
        this.view.webview.postMessage({
            type: 'updateDocs',
            docs: this.documentation || null,
            timeline: this.timeline || null
        });
    }
}
