/**
 * Live AI Project Docs - WebView Content Generator
 *
 * Generates the HTML/CSS/JS for the documentation panel.
 * Uses message-based updates to avoid full HTML re-renders.
 */

import * as vscode from "vscode";
import { ExtensionState } from "../types";

export function getWebViewContent(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  state: ExtensionState,
): string {
  const nonce = getNonce();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src * data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' https://cdn.jsdelivr.net; font-src https://cdn.jsdelivr.net;">
  <title>Live AI Project Docs</title>
  <script nonce="${nonce}" src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <script nonce="${nonce}" src="https://cdn.jsdelivr.net/npm/mermaid@9.4.3/dist/mermaid.min.js"></script>
  <script nonce="${nonce}" src="https://cdn.jsdelivr.net/npm/svg-pan-zoom@3.6.1/dist/svg-pan-zoom.min.js"></script>
  <script nonce="${nonce}">
    document.addEventListener("DOMContentLoaded", function() {
        if (typeof mermaid !== 'undefined') {
            mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'loose' });
        }
    });
  </script>
  <style>
    :root {
      --bg-primary: var(--vscode-editor-background);
      --bg-secondary: var(--vscode-sideBar-background);
      --text-primary: var(--vscode-editor-foreground);
      --text-secondary: var(--vscode-descriptionForeground);
      --accent: var(--vscode-textLink-foreground);
      --border: var(--vscode-panel-border);
      --success: var(--vscode-testing-iconPassed);
      --warning: var(--vscode-editorWarning-foreground);
    }
    
    * { box-sizing: border-box; margin: 0; padding: 0; }
    
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--text-primary);
      background: var(--bg-primary);
      line-height: 1.6;
    }
    
    .container { display: flex; height: 100vh; }
    
    /* Mermaid Zoom Styles */
    .mermaid {
      cursor: grab !important;
      overflow: hidden !important;
      background: var(--bg-secondary);
      border-radius: 8px;
      margin: 12px 0;
      border: 2px solid var(--accent); /* Make it obvious it's interactive */
      height: 360px !important;
      position: relative;
    }
    .mermaid:active { cursor: grabbing !important; }
    .mermaid svg { 
      width: 100% !important; 
      height: 100% !important; 
      cursor: grab !important;
      display: block;
    }
    .mermaid svg:active { cursor: grabbing !important; }

    .sidebar {
      width: 220px;
      min-width: 220px;
      background: var(--bg-secondary);
      border-right: 1px solid var(--border);
      padding: 16px 0;
      overflow-y: auto;
    }
    
    .sidebar-header {
      padding: 0 16px 16px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 8px;
    }
    
    .sidebar-header h1 {
      font-size: 14px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    .status-dot {
      width: 8px; height: 8px;
      border-radius: 50%;
      background: ${state.isConnected ? "#4caf50" : "#888"};
    }
    
    .nav-section { padding: 8px 0; }
    
    .nav-section-title {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      color: var(--text-secondary);
      padding: 8px 16px 4px;
      letter-spacing: 0.5px;
    }
    
    .nav-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 16px;
      cursor: pointer;
      color: var(--text-secondary);
      font-size: 13px;
      border-left: 3px solid transparent;
      user-select: none;
    }
    
    .nav-item:hover {
      background: var(--vscode-list-hoverBackground);
      color: var(--text-primary);
    }
    
    .nav-item.active {
      background: var(--vscode-list-activeSelectionBackground);
      color: var(--vscode-list-activeSelectionForeground);
      border-left-color: var(--accent);
    }
    
    .main {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    
    .header {
      padding: 12px 24px;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    
    .header h2 { font-size: 18px; font-weight: 600; }
    
    .btn {
      padding: 6px 12px;
      font-size: 12px;
      border: 1px solid var(--border);
      background: var(--bg-secondary);
      color: var(--text-primary);
      border-radius: 4px;
      cursor: pointer;
    }
    .btn:hover { background: var(--vscode-button-hoverBackground); }
    .btn-primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
    }
    
    .content {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
      padding: 24px;
      position: relative;
    }
    
    .doc-section {
      position: absolute;
      visibility: hidden;
      pointer-events: none;
      opacity: 0;
      width: 100%;
      transition: opacity 0.2s ease;
    }
    .doc-section.visible { 
      position: relative;
      visibility: visible;
      pointer-events: auto;
      opacity: 1;
    }
    
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    
    .doc-section h2 { font-size: 20px; margin-bottom: 12px; }
    .doc-section h3 { font-size: 16px; margin: 16px 0 8px; }
    .doc-section h4 { font-size: 14px; margin: 12px 0 6px; }
    .doc-section p { margin-bottom: 10px; }
    .doc-section ul, .doc-section ol { margin: 8px 0 8px 20px; }
    .doc-section li { margin-bottom: 4px; }
    
    .doc-section code {
      background: var(--bg-secondary);
      padding: 2px 6px;
      border-radius: 4px;
      font-family: var(--vscode-editor-font-family);
      font-size: 12px;
    }
    .doc-section pre {
      background: var(--bg-secondary);
      padding: 16px;
      border-radius: 8px;
      overflow-x: auto;
      margin: 12px 0;
    }
    .doc-section pre code { background: none; padding: 0; }

    /* Tables — scroll horizontally if too wide */
    .doc-section table {
      width: 100%;
      border-collapse: collapse;
      margin: 12px 0;
      font-size: 12px;
      overflow-x: auto;
      display: block;
    }
    .doc-section th, .doc-section td {
      border: 1px solid var(--border);
      padding: 6px 10px;
      text-align: left;
      white-space: nowrap;
    }
    .doc-section th {
      background: var(--bg-secondary);
      font-weight: 600;
    }
    .doc-section td { white-space: normal; min-width: 80px; }
    
    .timeline-entry {
      display: flex;
      gap: 16px;
      padding: 12px 0;
      border-bottom: 1px solid var(--border);
    }
    .timeline-date { min-width: 100px; font-size: 12px; color: var(--text-secondary); }
    .timeline-summary { font-weight: 500; margin-bottom: 4px; }
    .timeline-files { font-size: 12px; color: var(--text-secondary); }
    
    .qa-section {
      border-top: 1px solid var(--border);
      padding: 12px 24px;
      background: var(--bg-secondary);
    }
    .qa-input-wrapper { display: flex; gap: 8px; }
    .qa-input {
      flex: 1;
      padding: 8px 12px;
      border: 1px solid var(--border);
      background: var(--bg-primary);
      color: var(--text-primary);
      border-radius: 6px;
      font-size: 13px;
    }
    .qa-input:focus { outline: none; border-color: var(--accent); }
    
    .placeholder {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      text-align: center;
      color: var(--text-secondary);
    }
    .placeholder-icon { font-size: 48px; margin-bottom: 16px; opacity: 0.5; }
    .placeholder h3 { font-size: 18px; color: var(--text-primary); margin-bottom: 8px; }
    .placeholder p { max-width: 400px; margin-bottom: 16px; }
    
    .loading { padding: 40px; text-align: center; color: var(--text-secondary); }
    .last-updated { font-size: 11px; color: var(--text-secondary); }
  </style>
</head>
<body>
  <div class="container">
    <nav class="sidebar">
      <div class="sidebar-header">
        <h1><span class="status-dot"></span> ${state.projectName || "Live AI Docs"}</h1>
      </div>
      
      <div class="nav-section">
        <div class="nav-section-title">Documentation</div>
        <div class="nav-item active" data-section="overview">📋 Overview</div>
        <div class="nav-item" data-section="architecture">🏗️ Architecture</div>
        <div class="nav-item" data-section="modules">📦 Modules</div>
        <div class="nav-item" data-section="apis">🔌 APIs</div>
      </div>
      
      <div class="nav-section">
        <div class="nav-section-title">Activity</div>
        <div class="nav-item" data-section="changelog">📝 Change Log</div>
        <div class="nav-item" data-section="timeline">⏱️ Timeline</div>
      </div>
    </nav>
    
    <main class="main">
      <header class="header">
        <h2 id="section-title">Overview</h2>
        <div style="display:flex;gap:8px;align-items:center;">
          <span class="last-updated" id="last-updated"></span>
          <button class="btn" id="refresh-btn">↻ Refresh</button>
        </div>
      </header>
      
      <div class="content" id="content">
        <div class="loading">Loading documentation...</div>
      </div>
      
      <div class="qa-section">
        <div class="qa-input-wrapper">
          <input type="text" class="qa-input" id="qa-input" placeholder="Ask a question about this project...">
          <button class="btn btn-primary" id="ask-btn">Ask</button>
        </div>
      </div>
    </main>
  </div>
  
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let currentSection = 'overview';
    let sections = {};
    
    // --- Restore saved state (persists across webview recreation) ---
    const savedState = vscode.getState();
    if (savedState && savedState.docs) {
      currentSection = savedState.currentSection || 'overview';
      renderDocumentation(savedState.docs, savedState.timeline);
      // Restore active nav
      document.querySelectorAll('.nav-item').forEach(i => {
        i.classList.toggle('active', i.dataset.section === currentSection);
      });
      document.getElementById('section-title').textContent = 
        document.querySelector('.nav-item[data-section="' + currentSection + '"]')?.textContent?.trim() || 'Overview';
    }
    
    // --- Navigation ---
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', () => {
        const sectionId = item.dataset.section;
        if (!sectionId) return;
        
        // Update active nav
        document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        
        // Update header
        document.getElementById('section-title').textContent = item.textContent.trim();
        
        // Show the right section
        currentSection = sectionId;
        showSection(sectionId);
        
        // Persist current section selection
        const state = vscode.getState() || {};
        vscode.setState({ ...state, currentSection: sectionId });
      });
    });
    
    function showSection(sectionId) {
      document.querySelectorAll('.doc-section').forEach(s => s.classList.remove('visible'));
      const el = document.getElementById('section-' + sectionId);
      if (el) {
        el.classList.add('visible');
      } else {
        // Show a "no content" message
        const content = document.getElementById('content');
        const existing = document.getElementById('section-empty');
        if (existing) existing.remove();
        const empty = document.createElement('div');
        empty.id = 'section-empty';
        empty.className = 'doc-section visible';
        empty.innerHTML = '<p style="color:var(--text-secondary);padding:20px;">No content available for this section yet. Click Refresh to generate.</p>';
        content.appendChild(empty);
      }
    }
    
    // --- Refresh ---
    document.getElementById('refresh-btn').addEventListener('click', () => {
      // Trigger a regeneration only for the currently active section
      vscode.postMessage({ type: 'refresh', section: currentSection });
    });
    
    // --- Q&A ---
    document.getElementById('ask-btn').addEventListener('click', sendQuestion);
    document.getElementById('qa-input').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') sendQuestion();
    });
    
    function sendQuestion() {
      const input = document.getElementById('qa-input');
      const question = input.value.trim();
      if (question) {
        vscode.postMessage({ type: 'ask', payload: { question } });
        input.value = '';
      }
    }
    
    // --- Receive data from extension ---
    window.addEventListener('message', (event) => {
      const msg = event.data;
      
      if (msg.type === 'updateDocs') {
        renderDocumentation(msg.docs, msg.timeline);
        // Save state for persistence across webview recreation
        vscode.setState({ docs: msg.docs, timeline: msg.timeline, currentSection });
      }
      
      if (msg.type === 'answer') {
        const content = document.getElementById('content');
        const answerEl = document.createElement('div');
        answerEl.className = 'doc-section visible';
        answerEl.style.borderTop = '1px solid var(--border)';
        answerEl.style.marginTop = '16px';
        answerEl.style.paddingTop = '16px';
        answerEl.innerHTML = '<h3>💬 Answer</h3>' + renderMarkdown(msg.payload.response || 'No answer available.');
        content.appendChild(answerEl);
      }
    });
    
    function renderDocumentation(docs, timeline) {
      const content = document.getElementById('content');
      
      if (!docs || !docs.sections || docs.sections.length === 0) {
        content.innerHTML = '<div class="placeholder"><div class="placeholder-icon">📄</div><h3>No Documentation Yet</h3><p>Connect a project and click Refresh to generate documentation.</p></div>';
        return;
      }
      
      // Update timestamp
      if (docs.lastUpdated) {
        document.getElementById('last-updated').textContent = 'Updated ' + formatTime(docs.lastUpdated);
      }
      
      // Build section HTML
      let html = '';
      sections = {};
      
      for (const section of docs.sections) {
        sections[section.id] = true;
        const isVisible = section.id === currentSection ? 'visible' : '';
        html += '<div class="doc-section ' + isVisible + '" id="section-' + section.id + '">';
        html += renderMarkdown(section.content);
        html += '</div>';
      }
      
      // Add timeline section
      if (timeline && timeline.entries && timeline.entries.length > 0) {
        sections['timeline'] = true;
        const isVisible = currentSection === 'timeline' ? 'visible' : '';
        html += '<div class="doc-section ' + isVisible + '" id="section-timeline">';
        html += '<h2>Timeline</h2>';
        for (const entry of timeline.entries.slice(0, 20)) {
          html += '<div class="timeline-entry">';
          html += '<div class="timeline-date">' + entry.date + ' ' + entry.time + '</div>';
          html += '<div><div class="timeline-summary">' + entry.summary + '</div>';
          html += '<div class="timeline-files">' + entry.filesChanged.join(', ') + '</div></div>';
          html += '</div>';
        }
        html += '</div>';
      }
      
      // Add changelog section — populated from timeline data
      sections['changelog'] = true;
      const changelogVisible = currentSection === 'changelog' ? 'visible' : '';
      html += '<div class="doc-section ' + changelogVisible + '" id="section-changelog">';
      html += '<h2>Change Log</h2>';
      if (timeline && timeline.entries && timeline.entries.length > 0) {
        for (const entry of timeline.entries.slice(0, 50)) {
          html += '<div class="timeline-entry">';
          html += '<div class="timeline-date">' + entry.date + ' ' + entry.time + '</div>';
          html += '<div><div class="timeline-summary">' + entry.summary + '</div>';
          html += '<div class="timeline-files">' + entry.filesChanged.join(', ') + '</div></div>';
          html += '</div>';
        }
      } else {
        html += '<p style="color:var(--text-secondary)">No changes recorded yet. File edits will appear here as you code.</p>';
      }
      html += '</div>';
      
      content.innerHTML = html;
      
      // Render mermaid diagrams (with async network retry)
      let panZoomInstances = [];

      const renderMermaid = () => {
        if (typeof mermaid !== 'undefined') {
          try {
            // Clean up old instances
            panZoomInstances.forEach(pz => {
                try { pz.destroy(); } catch(e) {}
            });
            panZoomInstances = [];

            // Hide Mermaid blocks outside Architecture so diagrams are only shown there.
            const nonArchitectureMermaidBlocks = document.querySelectorAll('.doc-section:not(#section-architecture) code.language-mermaid');
            nonArchitectureMermaidBlocks.forEach(node => {
              const pre = node.parentElement;
              if (pre) {
                pre.remove();
              }
            });

            const staleNonArchitectureMermaid = document.querySelectorAll('.doc-section:not(#section-architecture) .mermaid');
            staleNonArchitectureMermaid.forEach(node => node.remove());

            // Marked.js generates <code class="language-mermaid">. Convert these to <div class="mermaid">
            const architectureSection = document.getElementById('section-architecture');
            if (!architectureSection) {
              return;
            }

            const mermaidBlocks = architectureSection.querySelectorAll('code.language-mermaid');
            mermaidBlocks.forEach(node => {
              const pre = node.parentElement;
              if (!pre) {
                return;
              }
              // Decode HTML entities from Marked.js (e.g. &lt; to <, &gt; to >)
              const decodeHTML = (html) => {
                let txt = document.createElement("textarea");
                txt.innerHTML = html;
                return txt.value;
              };
              pre.className = 'mermaid';
              pre.innerHTML = decodeHTML(node.innerHTML);
            });
              mermaid.init(undefined, '#section-architecture .mermaid');
            // Apply SVG Pan Zoom and Copy Button
            setTimeout(() => {
                const containers = architectureSection.querySelectorAll('.mermaid');
                containers.forEach(container => {
                    const svg = container.querySelector('svg');
                    if (!svg) return;

                    // Add Copy Button
                    if (!container.querySelector('.copy-btn')) {
                        const copyBtn = document.createElement('button');
                        copyBtn.className = 'btn copy-btn';
                        copyBtn.style.position = 'absolute';
                        copyBtn.style.top = '10px';
                        copyBtn.style.right = '50px'; // Offset from zoom controls
                        copyBtn.style.zIndex = '100';
                        copyBtn.innerHTML = '📋 Copy Image';
                        copyBtn.onclick = async (e) => {
                            e.stopPropagation();
                            try {
                                await copySvgAsPng(svg);
                                copyBtn.innerHTML = '✅ Copied!';
                                setTimeout(() => copyBtn.innerHTML = '📋 Copy Image', 2000);
                            } catch (err) {
                                console.error('Copy failed:', err);
                                copyBtn.innerHTML = '❌ Error';
                            }
                        };
                        container.style.position = 'relative';
                        container.appendChild(copyBtn);
                    }

                    if (typeof svgPanZoom !== 'undefined') {
                        try {
                            const pz = svgPanZoom(svg, {
                                zoomEnabled: true,
                                controlIconsEnabled: false,
                                fit: true,
                                center: true,
                                minZoom: 0.1,
                                maxZoom: 10,
                                mouseWheelZoomEnabled: true
                            });
                            panZoomInstances.push(pz);
                        } catch (err) {
                            console.error('svg-pan-zoom init error:', err);
                        }
                    }
                });
            }, 600);

          } catch (e) {
            console.error("Mermaid error:", e);
          }
        } else {
          setTimeout(renderMermaid, 200); // Retry if CDN is still downloading
        }
      };

      async function copySvgAsPng(svg) {
        return new Promise((resolve, reject) => {
          try {
            const canvas = document.createElement('canvas');
            const svgData = new XMLSerializer().serializeToString(svg);
            const img = new Image();
            const svgSize = svg.getBoundingClientRect();
            
            // Set canvas size (with scaling for quality)
            canvas.width = svgSize.width * 2;
            canvas.height = svgSize.height * 2;
            const ctx = canvas.getContext('2d');
            ctx.scale(2, 2);
            
            img.onload = () => {
              ctx.fillStyle = 'white'; // Background
              ctx.fillRect(0, 0, canvas.width, canvas.height);
              ctx.drawImage(img, 0, 0);
              
              canvas.toBlob(blob => {
                const item = new ClipboardItem({ 'image/png': blob });
                navigator.clipboard.write([item]).then(resolve).catch(reject);
              });
            };
            
            img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
          } catch (e) {
            reject(e);
          }
        });
      }
      // Give DOM a tick to paint before locking thread
      setTimeout(renderMermaid, 50);
      
      // If current section doesn't exist in new data, show overview
      if (!sections[currentSection]) {
        currentSection = 'overview';
        showSection('overview');
        document.querySelectorAll('.nav-item').forEach(i => {
          i.classList.toggle('active', i.dataset.section === 'overview');
        });
        document.getElementById('section-title').textContent = 'Overview';
      }
    }
    
    function renderMarkdown(text) {
      if (!text) return '';
      if (typeof marked !== 'undefined') {
        return marked.parse(text);
      }
      return text; // Fallback completely raw if network fails
    }
    
    function formatTime(ts) {
      const diff = Date.now() - ts;
      const mins = Math.floor(diff / 60000);
      if (mins < 1) return 'just now';
      if (mins < 60) return mins + 'm ago';
      const hrs = Math.floor(mins / 60);
      if (hrs < 24) return hrs + 'h ago';
      return Math.floor(hrs / 24) + 'd ago';
    }
    
    // Tell extension we're ready (only fetch if no saved state)
    if (!savedState || !savedState.docs) {
      vscode.postMessage({ type: 'ready' });
    }
  </script>
</body>
</html>`;
}

function getNonce(): string {
  let text = "";
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
