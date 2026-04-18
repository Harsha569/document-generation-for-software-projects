/**
 * Live AI Project Docs - Configuration Management
 */

import * as vscode from 'vscode';

export interface Config {
    backendUrl: string;
    authToken: string;
    autoConnect: boolean;
    syncDebounceMs: number;
    excludePatterns: string[];
}

const CONFIG_SECTION = 'liveAIDocs';

/**
 * Get the current configuration from VS Code settings
 */
export function getConfig(): Config {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);

    return {
        backendUrl: config.get<string>('backendUrl', 'http://localhost:3000/api'),
        authToken: config.get<string>('authToken', ''),
        autoConnect: config.get<boolean>('autoConnect', false),
        syncDebounceMs: config.get<number>('syncDebounceMs', 500),
        excludePatterns: config.get<string[]>('excludePatterns', [
            '**/node_modules/**',
            '**/.git/**',
            '**/dist/**',
            '**/build/**',
            '**/*.log',
            '**/.env*'
        ])
    };
}

/**
 * Update a configuration value
 */
export async function updateConfig<K extends keyof Config>(
    key: K,
    value: Config[K],
    global: boolean = false
): Promise<void> {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    await config.update(key, value, global ? vscode.ConfigurationTarget.Global : vscode.ConfigurationTarget.Workspace);
}

/**
 * Listen for configuration changes
 */
export function onConfigChange(callback: (config: Config) => void): vscode.Disposable {
    return vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration(CONFIG_SECTION)) {
            callback(getConfig());
        }
    });
}

/**
 * Validate configuration
 */
export function validateConfig(config: Config): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!config.backendUrl) {
        errors.push('Backend URL is required');
    } else {
        try {
            new URL(config.backendUrl);
        } catch {
            errors.push('Backend URL is not a valid URL');
        }
    }

    if (config.syncDebounceMs < 100) {
        errors.push('Sync debounce must be at least 100ms');
    }

    if (config.syncDebounceMs > 10000) {
        errors.push('Sync debounce must be at most 10000ms');
    }

    return {
        valid: errors.length === 0,
        errors
    };
}
