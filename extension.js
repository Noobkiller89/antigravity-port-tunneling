const vscode = require('vscode');
const { spawn } = require('child_process');
const http = require('http');

let activeProcess = null;
let statusBarItem = null;
let activeTunnelInfo = null; // { port, provider, url, status }
let webviewProvider = null;

function activate(context) {
    console.log('Antigravity Port Tunneling extension is active');

    // Create Status Bar Item
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'antigravity-tunnels.exposePort';
    updateStatusBar();
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // Register Webview View Provider
    const provider = new TunnelsViewProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(TunnelsViewProvider.viewType, provider)
    );

    // Register Expose Port Command
    let exposePortCmd = vscode.commands.registerCommand('antigravity-tunnels.exposePort', async () => {
        if (activeTunnelInfo && activeTunnelInfo.status === 'active') {
            const action = await vscode.window.showInformationMessage(
                `Tunnel active: Port ${activeTunnelInfo.port} exposed via ${activeTunnelInfo.provider} at ${activeTunnelInfo.url}`,
                'Copy URL',
                'Open Browser',
                'Stop Tunnel'
            );
            if (action === 'Copy URL') {
                await vscode.env.clipboard.writeText(activeTunnelInfo.url);
                vscode.window.showInformationMessage('Copied to clipboard!');
            } else if (action === 'Open Browser') {
                vscode.env.openExternal(vscode.Uri.parse(activeTunnelInfo.url));
            } else if (action === 'Stop Tunnel') {
                vscode.commands.executeCommand('antigravity-tunnels.stopTunnels');
            }
            return;
        }

        // 1. Prompt for Port
        const portInput = await vscode.window.showInputBox({
            prompt: 'Enter the local port to forward',
            placeHolder: 'e.g. 5173, 3000, 8080',
            value: '5173',
            validateInput: (value) => {
                const port = parseInt(value, 10);
                if (isNaN(port) || port < 1 || port > 65535) {
                    return 'Please enter a valid port number (1-65535)';
                }
                return null;
            }
        });

        if (!portInput) return;
        const port = parseInt(portInput, 10);

        // 2. Prompt for Provider
        const providerSelection = await vscode.window.showQuickPick([
            'Dev Tunnels (Official - *.use.devtunnels.ms)',
            'Localtunnel (Free, no login)',
            'Ngrok (Requires auth token)'
        ], {
            placeHolder: 'Select a tunnel provider'
        });

        if (!providerSelection) return;
        let selectedProvider = '';
        if (providerSelection.startsWith('Dev Tunnels')) selectedProvider = 'Devtunnels';
        else if (providerSelection.startsWith('Localtunnel')) selectedProvider = 'Localtunnel';
        else selectedProvider = 'Ngrok';

        // Start the tunnel
        startTunnel(port, selectedProvider);
    });

    // Register Stop Tunnels Command
    let stopTunnelsCmd = vscode.commands.registerCommand('antigravity-tunnels.stopTunnels', () => {
        stopTunnel();
    });

    context.subscriptions.push(exposePortCmd);
    context.subscriptions.push(stopTunnelsCmd);
}

function updateStatusBar() {
    if (!statusBarItem) return;
    if (activeTunnelInfo && activeTunnelInfo.status === 'active') {
        statusBarItem.text = `$(rss) Tunnel: ${activeTunnelInfo.port}`;
        statusBarItem.tooltip = `Port ${activeTunnelInfo.port} is public via ${activeTunnelInfo.provider} at:\n${activeTunnelInfo.url}\n\nClick to manage tunnel.`;
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else if (activeTunnelInfo && activeTunnelInfo.status === 'starting') {
        statusBarItem.text = `$(sync~spin) Starting Tunnel...`;
        statusBarItem.tooltip = `Setting up ${activeTunnelInfo.provider} tunnel...`;
        statusBarItem.backgroundColor = undefined;
    } else {
        statusBarItem.text = `$(globe) Share Port`;
        statusBarItem.tooltip = `Expose a local port to the internet`;
        statusBarItem.backgroundColor = undefined;
    }
}

function notifyWebviewState() {
    if (webviewProvider) {
        webviewProvider.updateState();
    }
}

async function startTunnel(port, provider) {
    if (activeProcess) {
        stopTunnel();
    }

    activeTunnelInfo = { port, provider, url: 'Starting...', status: 'starting' };
    updateStatusBar();
    notifyWebviewState();

    if (provider === 'Devtunnels') {
        console.log(`Spawning devtunnel for port ${port}`);
        
        const devtunnelPath = 'C:\\Users\\USUARIO\\AppData\\Local\\Microsoft\\WinGet\\Links\\devtunnel.exe';
        activeProcess = spawn(devtunnelPath, ['host', '-p', port.toString(), '--allow-anonymous']);
        
        let urlDetected = false;
        
        activeProcess.stdout.on('data', (data) => {
            const output = data.toString();
            console.log(`devtunnel stdout: ${output}`);
            
            // Match the specific port-included subdomain URL, e.g. https://xxx-3000.use.devtunnels.ms or use2.devtunnels.ms
            const regex = new RegExp(`(https?:\\/\\/[a-z0-9]+-${port}\\.[a-z0-9\\.]*devtunnels\\.ms)`, 'i');
            const match = output.match(regex);
            if (match && !urlDetected) {
                urlDetected = true;
                const url = match[1].trim();
                handleTunnelSuccess(port, provider, url);
            }
        });

        activeProcess.stderr.on('data', (data) => {
            console.error(`devtunnel stderr: ${data.toString()}`);
        });

        activeProcess.on('close', (code) => {
            console.log(`devtunnel exited with code ${code}`);
            if (!urlDetected) {
                handleTunnelError(provider, `Process exited with code ${code}. Please make sure you are logged in by running "devtunnel user login" in your terminal first.`);
            } else {
                handleTunnelClosed();
            }
        });
        
        setTimeout(() => {
            if (!urlDetected && activeProcess) {
                handleTunnelError(provider, 'Connection timed out. Please check if you are logged in (run "devtunnel user login" in terminal) or try again.');
            }
        }, 15000);

    } else if (provider === 'Localtunnel') {
        console.log(`Spawning localtunnel for port ${port}`);
        
        activeProcess = spawn('lt', ['--port', port.toString()], { shell: true });
        
        let urlDetected = false;
        
        activeProcess.stdout.on('data', (data) => {
            const output = data.toString();
            console.log(`localtunnel stdout: ${output}`);
            const match = output.match(/your url is:\s*(https?:\/\/[^\s]+)/i);
            if (match && !urlDetected) {
                urlDetected = true;
                const url = match[1].trim();
                handleTunnelSuccess(port, provider, url);
            }
        });

        activeProcess.stderr.on('data', (data) => {
            console.error(`localtunnel stderr: ${data.toString()}`);
        });

        activeProcess.on('close', (code) => {
            console.log(`localtunnel exited with code ${code}`);
            if (!urlDetected) {
                handleTunnelError(provider, `Process exited with code ${code}`);
            } else {
                handleTunnelClosed();
            }
        });
        
        setTimeout(() => {
            if (!urlDetected && activeProcess) {
                handleTunnelError(provider, 'Connection timed out. Please check if the local server is running or try again.');
            }
        }, 15000);

    } else if (provider === 'Ngrok') {
        console.log(`Spawning ngrok for port ${port}`);
        
        const ngrokPath = 'C:\\Users\\USUARIO\\AppData\\Roaming\\npm\\node_modules\\ngrok\\bin\\ngrok.exe';
        activeProcess = spawn(ngrokPath, ['http', port.toString()]);

        activeProcess.on('close', (code) => {
            console.log(`ngrok exited with code ${code}`);
            handleTunnelClosed();
        });

        let attempts = 0;
        const maxAttempts = 15;
        
        const checkNgrokApi = setInterval(async () => {
            attempts++;
            if (!activeProcess) {
                clearInterval(checkNgrokApi);
                return;
            }
            try {
                const response = await fetchNgrokTunnels();
                if (response && response.tunnels && response.tunnels.length > 0) {
                    clearInterval(checkNgrokApi);
                    const url = response.tunnels[0].public_url;
                    handleTunnelSuccess(port, provider, url);
                }
            } catch (err) {
                console.log(`Attempt ${attempts} to fetch ngrok API failed: ${err.message}`);
            }

            if (attempts >= maxAttempts) {
                clearInterval(checkNgrokApi);
                if (activeProcess) {
                    handleTunnelError(provider, 'Could not retrieve ngrok tunnel. Make sure ngrok is authenticated or try again.');
                }
            }
        }, 800);
    }
}

function fetchNgrokTunnels() {
    return new Promise((resolve, reject) => {
        http.get('http://127.0.0.1:4040/api/tunnels', (res) => {
            let rawData = '';
            res.on('data', (chunk) => { rawData += chunk; });
            res.on('end', () => {
                try {
                    const parsedData = JSON.parse(rawData);
                    resolve(parsedData);
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', (e) => {
            reject(e);
        });
    });
}

async function handleTunnelSuccess(port, provider, url) {
    activeTunnelInfo = { port, provider, url, status: 'active' };
    updateStatusBar();
    notifyWebviewState();

    // Copy to clipboard automatically
    await vscode.env.clipboard.writeText(url);

    // Show information message
    const action = await vscode.window.showInformationMessage(
        `🚀 Port ${port} is now public via ${provider} at: ${url}`,
        'Open Browser',
        'Stop Tunnel'
    );

    if (action === 'Open Browser') {
        vscode.env.openExternal(vscode.Uri.parse(url));
    } else if (action === 'Stop Tunnel') {
        vscode.commands.executeCommand('antigravity-tunnels.stopTunnels');
    }
}

function handleTunnelError(provider, errorMsg) {
    stopTunnel();
    vscode.window.showErrorMessage(`Failed to start ${provider} tunnel: ${errorMsg}`);
}

function handleTunnelClosed() {
    activeTunnelInfo = null;
    activeProcess = null;
    updateStatusBar();
    notifyWebviewState();
}

function stopTunnel() {
    if (activeProcess) {
        console.log('Stopping active tunnel process');
        try {
            const { exec } = require('child_process');
            exec(`taskkill /pid ${activeProcess.pid} /f /t`, (err) => {
                if (err) {
                    activeProcess.kill();
                }
            });
        } catch (e) {
            activeProcess.kill();
        }
        activeProcess = null;
    }
    
    if (activeTunnelInfo && activeTunnelInfo.status === 'active') {
        vscode.window.showInformationMessage(`Tunnel on port ${activeTunnelInfo.port} stopped.`);
    }
    activeTunnelInfo = null;
    updateStatusBar();
    notifyWebviewState();
}

function deactivate() {
    stopTunnel();
}

class TunnelsViewProvider {
    static viewType = 'antigravity-tunnels-view';
    constructor(extensionUri) {
        this._extensionUri = extensionUri;
    }

    resolveWebviewView(webviewView, context, _token) {
        webviewProvider = this;
        this._view = webviewView;
        
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };
        
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'startTunnel':
                    startTunnel(parseInt(data.port, 10), data.provider);
                    break;
                case 'stopTunnel':
                    stopTunnel();
                    break;
                case 'openBrowser':
                    if (activeTunnelInfo && activeTunnelInfo.status === 'active') {
                        vscode.env.openExternal(vscode.Uri.parse(activeTunnelInfo.url));
                    }
                    break;
                case 'copyUrl':
                    if (activeTunnelInfo && activeTunnelInfo.status === 'active') {
                        await vscode.env.clipboard.writeText(activeTunnelInfo.url);
                        vscode.window.showInformationMessage('Copied to clipboard!');
                    }
                    break;
            }
        });

        this.updateState();
    }

    updateState() {
        if (this._view) {
            this._view.webview.postMessage({
                type: 'stateUpdate',
                activeTunnelInfo
            });
        }
    }

    _getHtmlForWebview(webview) {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body {
            font-family: var(--vscode-font-family, sans-serif);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 15px;
            font-size: 13px;
            line-height: 1.4;
        }
        h2 {
            font-size: 15px;
            font-weight: 600;
            margin-top: 0;
            margin-bottom: 15px;
            color: var(--vscode-settings-headerForeground, var(--vscode-foreground));
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .form-group {
            margin-bottom: 15px;
        }
        label {
            display: block;
            font-weight: 500;
            margin-bottom: 5px;
            color: var(--vscode-descriptionForeground);
        }
        input, select {
            width: 100%;
            box-sizing: border-box;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border, transparent);
            padding: 8px;
            border-radius: 4px;
            font-size: 13px;
        }
        input:focus, select:focus {
            outline: 1px solid var(--vscode-focusBorder);
        }
        button {
            width: 100%;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 10px;
            border-radius: 4px;
            cursor: pointer;
            font-weight: 600;
            font-size: 13px;
            transition: background-color 0.2s;
        }
        button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        button.stop-btn {
            background-color: var(--vscode-statusBarItem-errorBackground, #d9534f);
            color: white;
            margin-top: 10px;
        }
        button.stop-btn:hover {
            background-color: #c9302c;
        }
        .active-tunnel-card {
            background: var(--vscode-editor-lineHighlightBackground, rgba(255, 255, 255, 0.05));
            border-left: 4px solid var(--vscode-charts-yellow, #e5c07b);
            padding: 12px;
            border-radius: 4px;
            margin-top: 20px;
        }
        .tunnel-title {
            font-weight: 600;
            margin-bottom: 8px;
            display: flex;
            align-items: center;
            gap: 5px;
        }
        .tunnel-url {
            word-break: break-all;
            background: var(--vscode-textCodeBlock-background, rgba(0,0,0,0.2));
            padding: 6px;
            border-radius: 3px;
            font-family: monospace;
            margin-bottom: 12px;
            color: var(--vscode-textLink-foreground);
            user-select: all;
        }
        .actions-grid {
            display: flex;
            gap: 8px;
            margin-bottom: 8px;
        }
        .action-btn {
            flex: 1;
            padding: 6px;
            font-size: 12px;
            background: var(--vscode-button-secondaryBackground, #555);
            color: var(--vscode-button-secondaryForeground, #fff);
        }
        .action-btn:hover {
            background: var(--vscode-button-secondaryHoverBackground, #666);
        }
        .hint {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            margin-top: 5px;
            line-height: 1.3;
        }
    </style>
</head>
<body>
    <h2>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="2" y1="12" x2="22" y2="12"></line>
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
        </svg>
        Port Forwarding
    </h2>
    
    <div id="setup-view">
        <div class="form-group">
            <label for="port">Local Port</label>
            <input type="number" id="port" value="5173" min="1" max="65535">
        </div>
        
        <div class="form-group">
            <label for="provider">Tunnel Provider</label>
            <select id="provider">
                <option value="Devtunnels">Dev Tunnels (Official - *.use.devtunnels.ms)</option>
                <option value="Localtunnel">Localtunnel (Free, no login)</option>
                <option value="Ngrok">Ngrok (Requires token)</option>
            </select>
            <div class="hint" id="provider-hint">
                Allows sharing local services securely via Microsoft Dev Tunnels. Requires running <code>devtunnel user login</code> in terminal first.
            </div>
        </div>
        
        <button id="start-btn">Expose Port</button>
    </div>

    <div id="active-view" style="display: none;">
        <div class="active-tunnel-card">
            <div class="tunnel-title">
                <span id="status-emoji">🟢</span> <span id="status-text">Active Tunnel</span> (Port <span id="active-port">5173</span>)
            </div>
            <div class="hint" style="margin-bottom: 8px;">
                Exposing via <span id="active-provider">Devtunnels</span>
            </div>
            <div class="tunnel-url" id="active-url">
                https://xxx-5173.use.devtunnels.ms
            </div>
            <div class="actions-grid" id="actions-panel">
                <button class="action-btn" id="copy-btn">Copy Link</button>
                <button class="action-btn" id="open-btn">Open Page</button>
            </div>
            <button class="stop-btn" id="stop-btn-active">Stop Tunnel</button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const startBtn = document.getElementById('start-btn');
        const stopBtnActive = document.getElementById('stop-btn-active');
        const copyBtn = document.getElementById('copy-btn');
        const openBtn = document.getElementById('open-btn');
        const portInput = document.getElementById('port');
        const providerSelect = document.getElementById('provider');
        const providerHint = document.getElementById('provider-hint');
        const setupView = document.getElementById('setup-view');
        const activeView = document.getElementById('active-view');
        const activePort = document.getElementById('active-port');
        const activeProvider = document.getElementById('active-provider');
        const activeUrl = document.getElementById('active-url');
        const statusEmoji = document.getElementById('status-emoji');
        const statusText = document.getElementById('status-text');
        const actionsPanel = document.getElementById('actions-panel');

        providerSelect.addEventListener('change', () => {
            const val = providerSelect.value;
            if (val === 'Devtunnels') {
                providerHint.innerHTML = "Allows sharing local services securely via Microsoft Dev Tunnels. Requires running <code>devtunnel user login</code> in terminal first.";
            } else if (val === 'Localtunnel') {
                providerHint.innerHTML = "Free and instant sharing. No accounts or login required.";
            } else if (val === 'Ngrok') {
                providerHint.innerHTML = "Requires configuring your ngrok authtoken in the terminal first.";
            }
        });

        startBtn.addEventListener('click', () => {
            const port = portInput.value;
            const provider = providerSelect.value;
            vscode.postMessage({
                type: 'startTunnel',
                port,
                provider
            });
        });

        stopBtnActive.addEventListener('click', () => {
            vscode.postMessage({ type: 'stopTunnel' });
        });

        copyBtn.addEventListener('click', () => {
            vscode.postMessage({ type: 'copyUrl' });
        });

        openBtn.addEventListener('click', () => {
            vscode.postMessage({ type: 'openBrowser' });
        });

        window.addEventListener('message', event => {
            const message = event.data;
            if (message.type === 'stateUpdate') {
                const info = message.activeTunnelInfo;
                if (info) {
                    setupView.style.display = 'none';
                    activeView.style.display = 'block';
                    activePort.textContent = info.port;
                    activeProvider.textContent = info.provider;
                    activeUrl.textContent = info.url;
                    
                    if (info.status === 'starting') {
                        statusEmoji.textContent = '🟡';
                        statusText.textContent = 'Starting...';
                        actionsPanel.style.display = 'none';
                    } else {
                        statusEmoji.textContent = '🟢';
                        statusText.textContent = 'Active Tunnel';
                        actionsPanel.style.display = 'flex';
                    }
                } else {
                    setupView.style.display = 'block';
                    activeView.style.display = 'none';
                }
            }
        });
    </script>
</body>
</html>`;
    }
}

module.exports = {
    activate,
    deactivate
};
