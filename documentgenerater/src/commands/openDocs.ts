/**
 * Live AI Project Docs - Open Docs Command
 */

import * as vscode from 'vscode';
import { DocsPanel } from '../webview/docsPanel';

export function openDocsCommand(extensionUri: vscode.Uri): void {
    DocsPanel.createOrShow(extensionUri);
}

export async function refreshDocsCommand(): Promise<void> {
    if (DocsPanel.currentPanel) {
        await DocsPanel.currentPanel.refresh();
    } else {
        vscode.window.showInformationMessage('Open the documentation panel first.');
    }
}

export function showTimelineCommand(extensionUri: vscode.Uri): void {
    // Open docs panel and navigate to timeline
    const panel = DocsPanel.createOrShow(extensionUri);
    // The panel will handle navigating to the timeline section
}
