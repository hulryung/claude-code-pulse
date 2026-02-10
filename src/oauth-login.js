const crypto = require('crypto');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { BrowserWindow } = require('electron');

const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const AUTHORIZE_URL = 'https://claude.ai/oauth/authorize';
const TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token';
const REDIRECT_URI = 'https://console.anthropic.com/oauth/code/callback';
const SCOPES = 'org:create_api_key user:profile user:inference';

const CREDENTIALS_PATH = path.join(
  process.env.HOME || process.env.USERPROFILE || '',
  '.claude',
  '.credentials.json'
);

function base64url(buffer) {
  return buffer.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function generatePKCE() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function startLogin() {
  return new Promise((resolve, reject) => {
    const { verifier, challenge } = generatePKCE();
    const state = crypto.randomBytes(32).toString('hex');
    let settled = false;
    let authWindow = null;

    const params = new URLSearchParams({
      code: 'true',
      client_id: CLIENT_ID,
      response_type: 'code',
      redirect_uri: REDIRECT_URI,
      scope: SCOPES,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: state,
    });

    const authUrl = `${AUTHORIZE_URL}?${params.toString()}`;

    // Open auth in an Electron BrowserWindow to intercept the redirect
    authWindow = new BrowserWindow({
      width: 500,
      height: 700,
      show: true,
      center: true,
      title: 'Claude Pulse - Login',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    function cleanup() {
      if (authWindow && !authWindow.isDestroyed()) {
        authWindow.close();
      }
      authWindow = null;
    }

    // Intercept navigation to the redirect URI
    authWindow.webContents.on('will-redirect', async (event, url) => {
      if (settled) return;
      if (url.startsWith(REDIRECT_URI)) {
        event.preventDefault();
        await handleCallback(url);
      }
    });

    authWindow.webContents.on('will-navigate', async (event, url) => {
      if (settled) return;
      if (url.startsWith(REDIRECT_URI)) {
        event.preventDefault();
        await handleCallback(url);
      }
    });

    // Also intercept via request filter for safety
    authWindow.webContents.session.webRequest.onBeforeRequest(
      { urls: [`${REDIRECT_URI}*`] },
      async (details, callback) => {
        callback({ cancel: true });
        if (!settled) {
          await handleCallback(details.url);
        }
      }
    );

    async function handleCallback(url) {
      if (settled) return;
      settled = true;

      try {
        const urlObj = new URL(url);
        const code = urlObj.searchParams.get('code');
        const error = urlObj.searchParams.get('error');

        if (error) {
          cleanup();
          reject(new Error(`Authorization failed: ${error}`));
          return;
        }

        if (!code) {
          cleanup();
          reject(new Error('No authorization code received'));
          return;
        }

        // Clean code (remove fragments)
        const cleanCode = code.split('#')[0];

        // Exchange code for tokens
        const tokens = await exchangeCode(cleanCode, verifier, state);
        saveCredentials(tokens);
        cleanup();
        resolve(tokens);
      } catch (err) {
        cleanup();
        reject(err);
      }
    }

    authWindow.on('closed', () => {
      authWindow = null;
      if (!settled) {
        settled = true;
        reject(new Error('Login window was closed'));
      }
    });

    authWindow.loadURL(authUrl);

    // Timeout after 5 minutes
    setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error('Login timed out'));
      }
    }, 5 * 60 * 1000);
  });
}

function exchangeCode(code, verifier, state) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code: code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
      state: state,
    });

    const url = new URL(TOKEN_URL);
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'Claude Pulse/1.0',
        'Referer': 'https://claude.ai/',
        'Origin': 'https://claude.ai',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            reject(new Error(parsed.error_description || parsed.error));
            return;
          }
          resolve({
            accessToken: parsed.access_token,
            refreshToken: parsed.refresh_token,
            expiresIn: parsed.expires_in,
            scope: parsed.scope,
          });
        } catch (e) {
          reject(new Error(`Failed to parse token response: ${data.substring(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function saveCredentials(tokens) {
  const claudeDir = path.dirname(CREDENTIALS_PATH);
  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true });
  }

  let creds = {};
  if (fs.existsSync(CREDENTIALS_PATH)) {
    try {
      creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf-8'));
    } catch {}
  }

  creds.claudeAiOauth = {
    ...creds.claudeAiOauth,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: Date.now() + (tokens.expiresIn || 86400) * 1000,
    scopes: (tokens.scope || SCOPES).split(' '),
  };

  fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(creds, null, 2), 'utf-8');
}

module.exports = { startLogin };
