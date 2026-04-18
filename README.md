# Live AI Project Docs

🚀 **Live AI Project Docs** is a powerful VS Code Extension and Backend Server combo that automatically maps your codebase and generates real-time, interactive documentation and architectural diagrams using AI.

## Features

- **Live Codebase Syncing**: Automatically watches files directly in VS Code and pushes structural updates to the backend.
- **Knowledge Graph Integration**: Generates deep project insights using [Graphify](https://pypi.org/project/graphifyy/) to extract AST nodes, imports, functions, and community groupings.
- **AI-Powered Generation**: Integrates seamlessly with OpenRouter (Gemini, Claude, GPT) to build comprehensive summaries, endpoint lists, and architecture documentation.
- **Auto-Generated Mermaid Diagrams**: Automatically generates syntactically correct High-Level Design (HLD) flowcharts and Module Interaction sequence diagrams.
- **In-Editor WebView & Sidebar**: Read the documentation natively right inside VS Code without switching windows.

---

## Project Structure

This repository contains two main components:

1. **`documentgenerater/` (VS Code Extension)**
   - Displays the interactive webviews (DocsPanel and DocsSidebarProvider).
   - Monitors standard editors and file changes via `vscode.workspace`.
   - Renders Markdown and interactive Mermaid SVG diagrams.

2. **`backend/` (Node.js AI Server)**
   - Parses the knowledge graph using Python's `graphifyy`.
   - Sends carefully structured prompts to LLMs to generate project documentation.
   - Manages state, components, and project timelines.

---

## Getting Started

### 1. Prerequisites
- **Node.js** (v18+)
- **Python 3** (For building the knowledge graph)
- **OpenRouter API Key** (or another OpenAI-compatible API)

### 2. Backend Setup
```bash
cd backend
npm install
pip install graphifyy
```
Create a `.env` file in the `backend/` directory:
```env
PORT=3000
OPENROUTER_API_KEY=your_api_key_here
OPENROUTER_MODEL=google/gemini-2.0-flash-lite-001
```
Start the backend:
```bash
npm run dev
```

### 3. Extension Setup
In a new terminal window:
```bash
cd documentgenerater
npm install
npm run compile
```
To launch the extension:
- Open the `documentgenerater` folder in VS Code.
- Run without debugging (`Ctrl` + `F5`).
- A new VS Code window will open with the extension running.
- Open the project folder in the new VS Code window.


---

## Settings & Commands

### Commands
- These commands are visible in the command palette (Ctrl + Shift + P) after running the extension.
- **Live Docs: Open Documentation**: Opens the main WebView tab.
- **Live Docs: Refresh Documentation**: Triggers a full documentation regeneration for the current project.
- **Live Docs: Connect Project**: Connects the currently open VS Code workspace to the AI documentation backend.
- **Live Docs: Explain This File / Selection**: Highlight code to instantly get an AI explanation widget.

### Extension Settings
You can customize the extension directly in the VS Code Settings panel:
- `liveAIDocs.backendUrl`: Defaults to `http://localhost:3000/api`.
- `liveAIDocs.autoConnect`: Automatically connect the project when a workspace opens.
- `liveAIDocs.excludePatterns`: Define glob patterns to omit from the knowledge graph (e.g., `node_modules`, `dist`).

---


