# Claude Pulse

A lightweight menubar/tray app that monitors your [Claude Code](https://docs.anthropic.com/en/docs/claude-code) rate limits in real-time.

<p align="center">
  <img src="assets/screenshot.png" alt="Claude Pulse Screenshot" width="400">
</p>

## Features

- **Real-time rate limit monitoring** - Current session (5h), weekly (all models), weekly (Sonnet only), and extra usage with dollar amounts
- **CLI-style progress bars** - Visual utilization bars matching Claude Code's `/limits` output
- **Built-in OAuth login** - No need to have Claude Code installed; authenticate directly from the app
- **Auto-refresh** - Updates every 2 minutes automatically
- **Local activity stats** - Today's messages, sessions, and tool calls computed from local conversation data
- **Menubar/tray app** - Runs quietly in your system tray; click to view, click away to dismiss
- **Cross-platform** - macOS and Windows support

## Installation

```bash
git clone https://github.com/hulryung/claude-code-pulse.git
cd claude-code-pulse
npm install
npm start
```

## Usage

### First Launch

If you already have Claude Code installed and authenticated, the app will use your existing session automatically.

Otherwise, click **Login with Claude** to authenticate via OAuth.

### Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Launch the app |
| `npm run dev` | Launch with mock data (for development) |
| `npm run debug` | Launch with raw API data panel visible |

### Right-click Menu

Right-click the tray icon for quick actions: Show, Refresh Now, or Quit.

## How It Works

Claude Pulse calls the Anthropic Usage API (`/api/oauth/usage`) to fetch your current rate limit utilization. This is a read-only endpoint that does **not** consume any API credits.

Local activity stats are computed from Claude Code's conversation logs stored in `~/.claude/projects/`.

## Tech Stack

- **Electron** - Cross-platform desktop framework
- **OAuth 2.0 PKCE** - Secure authentication flow
- **Anthropic Usage API** - Rate limit data source

## License

MIT
