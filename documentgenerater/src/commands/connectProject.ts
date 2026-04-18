/**
 * Live AI Project Docs - Connect Project Command
 */

import * as vscode from 'vscode';
import { getProjectManager } from '../project/projectManager';

export async function connectProjectCommand(): Promise<void> {
    const projectManager = getProjectManager();

    if (projectManager.isConnected()) {
        const choice = await vscode.window.showWarningMessage(
            'A project is already connected. Do you want to reconnect?',
            'Reconnect',
            'Cancel'
        );

        if (choice !== 'Reconnect') {
            return;
        }

        await projectManager.disconnect();
    }

    await projectManager.connect();
}

export async function disconnectProjectCommand(): Promise<void> {
    const projectManager = getProjectManager();

    if (!projectManager.isConnected()) {
        vscode.window.showInformationMessage('No project is currently connected.');
        return;
    }

    const choice = await vscode.window.showWarningMessage(
        'Are you sure you want to disconnect from the project?',
        'Disconnect',
        'Cancel'
    );

    if (choice === 'Disconnect') {
        await projectManager.disconnect();
    }
}
