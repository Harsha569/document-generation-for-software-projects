/**
 * Live AI Docs Backend - Express Server
 * 
 * Main entry point for the backend API server.
 */

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import routes from './routes';
import { isGraphifyAvailable } from './graphify';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Large payloads for file content
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${req.method} ${req.path}`);
    next();
});

// Mount API routes
app.use('/api', routes);

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        name: 'Live AI Docs Backend',
        version: '1.0.0',
        status: 'running',
        endpoints: {
            health: '/api/health',
            connectProject: 'POST /api/project/connect',
            disconnectProject: 'POST /api/project/disconnect',
            updateFile: 'POST /api/file/update',
            updateFileBatch: 'POST /api/file/update-batch',
            getDocs: 'GET /api/project/:id/docs',
            refreshDocs: 'POST /api/project/:id/docs/refresh',
            getTimeline: 'GET /api/project/:id/timeline',
            explainCode: 'POST /api/explain',
            askQuestion: 'POST /api/ask'
        }
    });
});

// Error handling
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('   🚀  Live AI Docs Backend Server');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`   Server running at: http://localhost:${PORT}`);
    console.log(`   API endpoints at:  http://localhost:${PORT}/api`);
    console.log('');
    if (process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY !== 'your_openrouter_api_key_here') {
        console.log(`   ✓ AI integration: OpenRouter ENABLED (${process.env.OPENROUTER_MODEL || 'google/gemini-2.0-flash-lite-001'})`);
    } else {
        console.log('   ⚠ AI integration: DISABLED (using mock responses)');
        console.log('     Add OPENROUTER_API_KEY to .env for AI features');
    }

    // Check Graphify availability
    isGraphifyAvailable().then(available => {
        if (available) {
            console.log('   ✓ Knowledge Graph: Graphify ENABLED');
        } else {
            console.log('   ⚠ Knowledge Graph: Graphify NOT INSTALLED');
            console.log('     Install with: pip install graphifyy');
        }
        console.log('');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('');
    });
});

export default app;
