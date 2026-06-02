# Antigravity Port Tunneling Extension

A global editor extension for Antigravity IDE (and VS Code) that enables sharing local web servers and services securely to the internet with a single click.

## Features

- 🌐 **Microsoft Dev Tunnels**: Generates clean subdomain-based public HTTPS URLs (`*.use.devtunnels.ms`).
- ⚡ **Localtunnel Integration**: Create tunnels instantly with no sign-ups or credentials required.
- 🔑 **Ngrok Support**: For developers who prefer ngrok tunnels.
- 🎨 **Left Sidebar UI**: Dedicated interactive panel (Globe icon) in the Activity Bar to manage tunnels visually.
- 📊 **Status Bar & Notifications**: Real-time connection feedback, instant clipboard copying, and convenient controls.

---

## Installation

### Method A: Install from VSIX
1. Download the `antigravity-tunnels-1.0.0.vsix` file from this repository.
2. Open your IDE.
3. Open the **Extensions** view (`Ctrl+Shift+X`).
4. Click the three dots menu **`...`** in the top-right corner of the Extensions panel.
5. Select **Install from VSIX...** and choose the downloaded file.
6. Reload the IDE window if prompted.

### Method B: CLI Installation
Execute the following command in your terminal:
```bash
code --install-extension antigravity-tunnels-1.0.0.vsix
```
*(Or `antigravity-ide.cmd --install-extension antigravity-tunnels-1.0.0.vsix` if you are using Antigravity).*

---

## Usage with Dev Tunnels

1. Run your local server (e.g. `npm run dev` on port `3000` or `5173`).
2. Log in to Microsoft Dev Tunnels once on your machine by running:
   ```bash
   devtunnel user login -g
   ```
3. Open the **Globe** panel on the left sidebar.
4. Input the port number, select **Dev Tunnels**, and click **Expose Port**.
5. The public URL will be copied to your clipboard automatically!
