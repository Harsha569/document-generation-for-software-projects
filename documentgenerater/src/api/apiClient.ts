/**
 * Live AI Project Docs - API Client
 * 
 * Reusable HTTP client with retry logic, timeout handling,
 * authentication, and error handling.
 */

import axios, { AxiosInstance, AxiosError, AxiosRequestConfig } from 'axios';
import * as vscode from 'vscode';
import { getConfig } from '../config';
import {
    ProjectData,
    ProjectResponse,
    FileUpdate,
    FileUpdateBatch,
    Documentation,
    Question,
    Answer,
    ExplainRequest,
    Explanation,
    Timeline,
    ApiError
} from '../types';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
const REQUEST_TIMEOUT_MS = 30000;
const AI_REQUEST_TIMEOUT_MS = 120000; // 2 min for AI endpoints

class ApiClient {
    private client: AxiosInstance;
    private outputChannel: vscode.OutputChannel;

    constructor() {
        this.outputChannel = vscode.window.createOutputChannel('Live AI Docs');
        this.client = this.createClient();
    }

    private createClient(): AxiosInstance {
        const config = getConfig();

        const instance = axios.create({
            baseURL: config.backendUrl,
            timeout: REQUEST_TIMEOUT_MS,
            headers: {
                'Content-Type': 'application/json',
            }
        });

        // Request interceptor for auth token
        instance.interceptors.request.use((requestConfig) => {
            const currentConfig = getConfig();
            if (currentConfig.authToken) {
                requestConfig.headers.Authorization = `Bearer ${currentConfig.authToken}`;
            }
            this.log(`→ ${requestConfig.method?.toUpperCase()} ${requestConfig.url}`);
            return requestConfig;
        });

        // Response interceptor for logging
        instance.interceptors.response.use(
            (response) => {
                this.log(`← ${response.status} ${response.config.url}`);
                return response;
            },
            (error) => {
                this.logError(`← Error: ${error.message}`);
                return Promise.reject(error);
            }
        );

        return instance;
    }

    /**
     * Refresh the client with new configuration
     */
    public refreshClient(): void {
        this.client = this.createClient();
        this.log('API client refreshed with new configuration');
    }

    /**
     * Make a request with retry logic
     */
    private async requestWithRetry<T>(
        config: AxiosRequestConfig,
        retries: number = MAX_RETRIES
    ): Promise<T> {
        try {
            const response = await this.client.request<T>(config);
            return response.data;
        } catch (error) {
            const axiosError = error as AxiosError<ApiError>;

            // Don't retry on client errors (4xx)
            if (axiosError.response && axiosError.response.status >= 400 && axiosError.response.status < 500) {
                throw this.formatError(axiosError);
            }

            // Retry on server errors or network issues
            if (retries > 0) {
                this.log(`Retrying request... (${MAX_RETRIES - retries + 1}/${MAX_RETRIES})`);
                await this.delay(RETRY_DELAY_MS * (MAX_RETRIES - retries + 1)); // Exponential backoff
                return this.requestWithRetry<T>(config, retries - 1);
            }

            throw this.formatError(axiosError);
        }
    }

    private formatError(error: AxiosError<ApiError>): Error {
        if (error.response?.data) {
            return new Error(error.response.data.message || 'API request failed');
        }
        if (error.code === 'ECONNREFUSED') {
            return new Error('Cannot connect to backend server. Is it running?');
        }
        if (error.code === 'ETIMEDOUT') {
            return new Error('Request timed out. Please try again.');
        }
        return new Error(error.message || 'Unknown error occurred');
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private log(message: string): void {
        const timestamp = new Date().toISOString();
        this.outputChannel.appendLine(`[${timestamp}] ${message}`);
    }

    private logError(message: string): void {
        const timestamp = new Date().toISOString();
        this.outputChannel.appendLine(`[${timestamp}] ERROR: ${message}`);
    }

    // ==================== API Methods ====================

    /**
     * Connect a project to the backend
     */
    async connectProject(data: ProjectData): Promise<ProjectResponse> {
        return this.requestWithRetry<ProjectResponse>({
            method: 'POST',
            url: '/project/connect',
            data
        });
    }

    /**
     * Disconnect a project
     */
    async disconnectProject(projectId: string): Promise<void> {
        return this.requestWithRetry<void>({
            method: 'POST',
            url: '/project/disconnect',
            data: { projectId }
        });
    }

    /**
     * Send a single file update
     */
    async updateFile(update: FileUpdate): Promise<void> {
        return this.requestWithRetry<void>({
            method: 'POST',
            url: '/file/update',
            data: update
        });
    }

    /**
     * Send a batch of file updates
     */
    async updateFilesBatch(batch: FileUpdateBatch): Promise<void> {
        return this.requestWithRetry<void>({
            method: 'POST',
            url: '/file/update-batch',
            data: batch
        });
    }

    /**
     * Get the current documentation
     */
    async getDocumentation(projectId: string): Promise<Documentation> {
        return this.requestWithRetry<Documentation>({
            method: 'GET',
            url: `/project/${projectId}/docs`,
            timeout: AI_REQUEST_TIMEOUT_MS
        });
    }

    /**
     * Trigger documentation refresh
     */
    async refreshDocumentation(projectId: string, section?: string): Promise<void> {
        return this.requestWithRetry<void>({
            method: 'POST',
            url: `/project/${projectId}/docs/refresh`,
            data: section ? { section } : {},
            timeout: AI_REQUEST_TIMEOUT_MS
        });
    }

    /**
     * Ask a question about the project
     */
    async askQuestion(question: Question): Promise<Answer> {
        return this.requestWithRetry<Answer>({
            method: 'POST',
            url: '/ask',
            data: question
        });
    }

    /**
     * Get AI explanation for code
     */
    async explainCode(request: ExplainRequest): Promise<Explanation> {
        return this.requestWithRetry<Explanation>({
            method: 'POST',
            url: '/explain',
            data: request,
            timeout: AI_REQUEST_TIMEOUT_MS
        });
    }

    /**
     * Get the change timeline
     */
    async getTimeline(projectId: string): Promise<Timeline> {
        return this.requestWithRetry<Timeline>({
            method: 'GET',
            url: `/project/${projectId}/timeline`
        });
    }

    /**
     * Check backend health
     */
    async healthCheck(): Promise<boolean> {
        try {
            await this.client.get('/health', { timeout: 5000 });
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Show the output channel
     */
    public showOutput(): void {
        this.outputChannel.show();
    }

    /**
     * Dispose resources
     */
    public dispose(): void {
        this.outputChannel.dispose();
    }
}

// Singleton instance
let apiClientInstance: ApiClient | null = null;

export function getApiClient(): ApiClient {
    if (!apiClientInstance) {
        apiClientInstance = new ApiClient();
    }
    return apiClientInstance;
}

export function disposeApiClient(): void {
    if (apiClientInstance) {
        apiClientInstance.dispose();
        apiClientInstance = null;
    }
}
