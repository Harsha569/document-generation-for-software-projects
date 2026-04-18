/**
 * Live AI Project Docs - Explain Code Commands
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { getProjectManager } from '../project/projectManager';
import { getApiClient } from '../api/apiClient';
import { getLanguageFromPath } from '../project/fileScanner';

/**
 * Explain the entire current file
 */
export async function explainFileCommand(): Promise<void> {
    const editor = vscode.window.activeTextEditor;

    if (!editor) {
        vscode.window.showWarningMessage('No file is currently open.');
        return;
    }

    const projectManager = getProjectManager();
    const projectId = projectManager.getProjectId();

    if (!projectId) {
        vscode.window.showWarningMessage('Please connect a project first.');
        return;
    }

    const document = editor.document;
    const content = document.getText();
    const filePath = document.uri.fsPath;
    const language = getLanguageFromPath(filePath);

    await showExplanation(projectId, content, filePath, language, 'file');
}

/**
 * Explain the selected code
 */
export async function explainSelectionCommand(): Promise<void> {
    const editor = vscode.window.activeTextEditor;

    if (!editor) {
        vscode.window.showWarningMessage('No file is currently open.');
        return;
    }

    const selection = editor.selection;

    if (selection.isEmpty) {
        vscode.window.showWarningMessage('Please select some code to explain.');
        return;
    }

    const projectManager = getProjectManager();
    const projectId = projectManager.getProjectId();

    if (!projectId) {
        vscode.window.showWarningMessage('Please connect a project first.');
        return;
    }

    const document = editor.document;
    const selectedText = document.getText(selection);
    const filePath = document.uri.fsPath;
    const language = getLanguageFromPath(filePath);

    await showExplanation(projectId, selectedText, filePath, language, 'selection');
}

/**
 * Show explanation in a hover-like format or panel
 */
async function showExplanation(
    projectId: string,
    code: string,
    filePath: string,
    language: string,
    type: 'file' | 'selection' | 'function'
): Promise<void> {
    const fileName = path.basename(filePath);

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Analyzing ${type === 'file' ? fileName : 'selection'}...`,
            cancellable: false
        },
        async (progress) => {
            try {
                const apiClient = getApiClient();
                const explanation = await apiClient.explainCode({
                    projectId,
                    code,
                    filePath,
                    language,
                    type
                });

                // Show explanation in a webview panel or quick info
                await showExplanationPanel(explanation.summary, explanation.details, fileName);
            } catch (error) {
                // Show a mock explanation if backend is unavailable
                await showExplanationPanel(
                    `Analysis of ${fileName}`,
                    `This feature requires connection to the AI backend.\n\nOnce connected, you'll receive:\n- Code summary\n- Functionality explanation\n- Key patterns used\n- Related documentation`,
                    fileName
                );
            }
        }
    );
}

/**
 * Display the explanation in a panel
 */
async function showExplanationPanel(
    title: string,
    content: string,
    fileName: string
): Promise<void> {
    // Create a virtual document to show the explanation
    const panel = vscode.window.createWebviewPanel(
        'liveAIDocs.explanation',
        `Explanation: ${fileName}`,
        vscode.ViewColumn.Beside,
        {
            enableScripts: false
        }
    );

    panel.webview.html = `<!DOCTYPE html>
<html>
<head>
  <style>
    body {
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
      padding: 20px;
      line-height: 1.6;
      color: var(--vscode-editor-foreground, #333);
      background: var(--vscode-editor-background, #fff);
    }
    h1 {
      font-size: 20px;
      margin-bottom: 16px;
      border-bottom: 1px solid var(--vscode-panel-border, #ddd);
      padding-bottom: 12px;
    }
    .content {
      white-space: pre-wrap;
      font-size: 14px;
    }
    .badge {
      display: inline-block;
      padding: 4px 12px;
      background: var(--vscode-badge-background, #007acc);
      color: var(--vscode-badge-foreground, #fff);
      border-radius: 4px;
      font-size: 12px;
      margin-bottom: 16px;
    }
  </style>
</head>
<body>
  <span class="badge">AI Explanation</span>
  <h1>${escapeHtml(title)}</h1>
  <div class="content">${escapeHtml(content)}</div>
</body>
</html>`;
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Ask a question about the project
 */
export async function askProjectCommand(): Promise<void> {
    const projectManager = getProjectManager();
    const projectId = projectManager.getProjectId();

    if (!projectId) {
        vscode.window.showWarningMessage('Please connect a project first.');
        return;
    }

    const question = await vscode.window.showInputBox({
        prompt: 'Ask a question about your project',
        placeHolder: 'e.g., How does the authentication system work?'
    });

    if (!question) {
        return;
    }

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'Finding answer...',
            cancellable: false
        },
        async () => {
            try {
                const apiClient = getApiClient();
                const answer = await apiClient.askQuestion({
                    projectId,
                    query: question
                });

                // Show answer in a panel
                await showExplanationPanel('Answer', answer.response, 'Q&A');
            } catch (error) {
                vscode.window.showErrorMessage('Unable to get an answer. Please ensure the backend is running.');
            }
        }
    );
}
