/**
 * Live AI Project Docs - VS Code Extension
 * 
 * Main entry point for the extension.
 * Automatically connects projects to an AI documentation engine
 * and continuously generates up-to-date documentation.
 */

import * as vscode from 'vscode';

// Configuration
import { getConfig, onConfigChange } from './config';

// API
import { getApiClient, disposeApiClient } from './api/apiClient';

// Project Management
import { initProjectManager, getProjectManager, disposeProjectManager } from './project/projectManager';
import { getFileWatcher, disposeFileWatcher } from './project/fileWatcher';

// WebView
import { DocsPanel } from './webview/docsPanel';
import { DocsSidebarProvider } from './webview/docsSidebarProvider';

// Commands
import { connectProjectCommand, disconnectProjectCommand } from './commands/connectProject';
import { openDocsCommand, refreshDocsCommand, showTimelineCommand } from './commands/openDocs';
import { explainFileCommand, explainSelectionCommand, askProjectCommand } from './commands/explainCode';

/**
 * This method is called when the extension is activated.
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
	console.log('Live AI Project Docs is now activating...');

	// Initialize the project manager (sets up state and status bar)
	const projectManager = initProjectManager(context);

	// Register all commands
	const commands: Array<[string, (...args: any[]) => any]> = [
		['liveAIDocs.connectProject', connectProjectCommand],
		['liveAIDocs.disconnectProject', disconnectProjectCommand],
		['liveAIDocs.openDocs', () => openDocsCommand(context.extensionUri)],
		['liveAIDocs.refreshDocs', refreshDocsCommand],
		['liveAIDocs.explainFile', explainFileCommand],
		['liveAIDocs.explainSelection', explainSelectionCommand],
		['liveAIDocs.askProject', askProjectCommand],
		['liveAIDocs.showTimeline', () => showTimelineCommand(context.extensionUri)],
	];

	for (const [commandId, handler] of commands) {
		const disposable = vscode.commands.registerCommand(commandId, handler);
		context.subscriptions.push(disposable);
	}

	// Register sidebar webview provider
	const sidebarProvider = new DocsSidebarProvider(context.extensionUri);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			DocsSidebarProvider.viewType,
			sidebarProvider,
			{ webviewOptions: { retainContextWhenHidden: true } }
		)
	);

	// Register live sync refresh command — called by FileWatcher after
	// backend auto-regenerates docs, so panels re-fetch the latest content
	context.subscriptions.push(
		vscode.commands.registerCommand('liveAIDocs.liveSyncRefresh', async () => {
			console.log('[Live Sync] Re-fetching docs in all panels...');

			// Re-fetch in editor panel (if open)
			if (DocsPanel.currentPanel) {
				await DocsPanel.currentPanel.liveSyncReload();
			}

			// Re-fetch in sidebar
			await sidebarProvider.liveSyncReload();
		})
	);

	// Listen for configuration changes
	context.subscriptions.push(
		onConfigChange((config) => {
			console.log('Configuration changed:', config);
			// Refresh API client with new config
			getApiClient().refreshClient();
		})
	);

	// Startup Prompt: Instead of auto-connecting, ask the user to open or connect a project
	setTimeout(async () => {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		const isConnected = projectManager.isConnected();

		if (!isConnected) {
			if (!workspaceFolders || workspaceFolders.length === 0) {
				const action = await vscode.window.showInformationMessage(
					'No workspace open. Would you like to open a folder for Live AI Docs?',
					'Open Folder'
				);
				if (action === 'Open Folder') {
					vscode.commands.executeCommand('vscode.openFolder');
				}
			} else {
				const action = await vscode.window.showInformationMessage(
					`Workspace "${workspaceFolders[0].name}" is ready. Connect to Live AI Docs?`,
					'Connect Project'
				);
				if (action === 'Connect Project') {
					vscode.commands.executeCommand('liveAIDocs.connectProject');
				}
			}
		}
	}, 3000); // Slight delay to ensure status bar and project manager are ready

	// Set up file watcher event handler for notifications
	const fileWatcher = getFileWatcher();
	context.subscriptions.push(
		fileWatcher.onFileChange((update) => {
			// Could show notifications or update status bar
			// Currently handled by the file watcher itself
		})
	);

	// Register WebView serializer for persistence
	if (vscode.window.registerWebviewPanelSerializer) {
		vscode.window.registerWebviewPanelSerializer('liveAIDocs.docsPanel', {
			async deserializeWebviewPanel(webviewPanel: vscode.WebviewPanel, state: any) {
				// Restore the existing webview panel instead of creating a new one
				DocsPanel.revive(webviewPanel, context.extensionUri);
			}
		});
	}

	console.log('Live AI Project Docs is now active!');

	// Show welcome message on first activation
	const hasShownWelcome = context.globalState.get('liveAIDocs.hasShownWelcome');
	if (!hasShownWelcome) {
		const action = await vscode.window.showInformationMessage(
			'Live AI Project Docs is installed! Connect your project to start generating documentation.',
			'Connect Project',
			'Later'
		);

		if (action === 'Connect Project') {
			vscode.commands.executeCommand('liveAIDocs.connectProject');
		}

		context.globalState.update('liveAIDocs.hasShownWelcome', true);
	}
}

/**
 * This method is called when the extension is deactivated.
 */
export function deactivate(): void {
	console.log('Live AI Project Docs is deactivating...');

	// Clean up resources
	disposeFileWatcher();
	disposeProjectManager();
	disposeApiClient();

	console.log('Live AI Project Docs has been deactivated.');
}
