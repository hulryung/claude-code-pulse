const fs = require('fs');
const path = require('path');
const https = require('https');

const CLAUDE_DIR = path.join(process.env.HOME || process.env.USERPROFILE || '', '.claude');
const CREDENTIALS_PATH = path.join(CLAUDE_DIR, '.credentials.json');
const STATS_CACHE_PATH = path.join(CLAUDE_DIR, 'stats-cache.json');

const USAGE_API_URL = 'https://api.anthropic.com/api/oauth/usage';
const TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';
const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';

function readCredentials() {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    return { error: 'credentials_not_found' };
  }
  try {
    const creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf-8'));
    return creds?.claudeAiOauth || { error: 'no_oauth_data' };
  } catch (e) {
    return { error: 'parse_error', message: e.message };
  }
}

function httpsRequest(url, options, body) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const reqOptions = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {},
    };

    const req = https.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: data }));
    });

    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function refreshToken(refreshTokenValue) {
  try {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshTokenValue,
      client_id: CLIENT_ID,
    }).toString();

    const res = await httpsRequest(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    }, body);

    const data = JSON.parse(res.body);
    if (data.access_token) {
      // Update credentials file
      const creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf-8'));
      creds.claudeAiOauth.accessToken = data.access_token;
      if (data.refresh_token) {
        creds.claudeAiOauth.refreshToken = data.refresh_token;
      }
      if (data.expires_in) {
        creds.claudeAiOauth.expiresAt = Date.now() + data.expires_in * 1000;
      }
      fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(creds, null, 2), 'utf-8');
      return { success: true, accessToken: data.access_token };
    }
    return { success: false, error: data.error_description || data.error };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function isoToEpoch(isoString) {
  if (!isoString) return null;
  const ts = Math.floor(new Date(isoString).getTime() / 1000);
  return isNaN(ts) ? null : String(ts);
}

function getNextMonthStart() {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() + 1, 1);
  d.setUTCHours(0, 0, 0, 0);
  return String(Math.floor(d.getTime() / 1000));
}

function deriveOverallStatus(usageData) {
  const utils = [
    usageData.five_hour?.utilization || 0,
    usageData.seven_day?.utilization || 0,
  ];
  const maxUtil = Math.max(...utils);
  if (maxUtil >= 100) return 'rate_limited';
  if (maxUtil >= 80) return 'warning';
  return 'active';
}

async function fetchRateLimits() {
  const creds = readCredentials();
  if (creds.error) {
    return {
      error: true,
      errorType: creds.error,
      errorMessage: creds.error === 'credentials_not_found'
        ? 'No credentials found. Please login to continue.'
        : `Error reading credentials: ${creds.message || creds.error}`,
    };
  }

  let token = creds.accessToken;
  if (!token) {
    return {
      error: true,
      errorType: 'no_token',
      errorMessage: 'No access token found. Please login to continue.',
    };
  }

  // Check if token is expired
  const isExpired = creds.expiresAt && Date.now() > creds.expiresAt;
  if (isExpired && creds.refreshToken) {
    const refreshResult = await refreshToken(creds.refreshToken);
    if (refreshResult.success) {
      token = refreshResult.accessToken;
    }
    // If refresh fails, still try with the existing token
  }

  try {
    const res = await httpsRequest(USAGE_API_URL, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'oauth-2025-04-20',
      },
    });

    if (res.statusCode === 401) {
      return {
        error: true,
        errorType: 'auth_expired',
        errorMessage: 'Session expired. Please login again.',
      };
    }

    if (res.statusCode !== 200) {
      return {
        error: true,
        errorType: 'api_error',
        errorMessage: `API error (HTTP ${res.statusCode}). Please try again later.`,
      };
    }

    const usageData = JSON.parse(res.body);
    const fiveHour = usageData.five_hour || {};
    const sevenDay = usageData.seven_day || {};
    const sevenDaySonnet = usageData.seven_day_sonnet || {};
    const extraUsage = usageData.extra_usage || {};

    // Build raw data object for display
    const rawData = {};
    if (fiveHour.utilization != null) {
      rawData['five_hour.utilization'] = `${fiveHour.utilization}%`;
      rawData['five_hour.resets_at'] = fiveHour.resets_at || '';
    }
    if (sevenDay.utilization != null) {
      rawData['seven_day.utilization'] = `${sevenDay.utilization}%`;
      rawData['seven_day.resets_at'] = sevenDay.resets_at || '';
    }
    if (sevenDaySonnet.utilization != null) {
      rawData['seven_day_sonnet.utilization'] = `${sevenDaySonnet.utilization}%`;
      rawData['seven_day_sonnet.resets_at'] = sevenDaySonnet.resets_at || '';
    }
    if (extraUsage.is_enabled != null) {
      rawData['extra_usage.is_enabled'] = String(extraUsage.is_enabled);
      rawData['extra_usage.utilization'] = `${extraUsage.utilization || 0}%`;
      rawData['extra_usage.used_credits'] = String(extraUsage.used_credits || 0);
      rawData['extra_usage.monthly_limit'] = String(extraUsage.monthly_limit || 0);
    }

    return {
      error: false,
      timestamp: Date.now(),
      allHeaders: rawData,
      session: {
        utilization: (fiveHour.utilization || 0) / 100,
        reset: isoToEpoch(fiveHour.resets_at),
      },
      weekly: {
        utilization: (sevenDay.utilization || 0) / 100,
        reset: isoToEpoch(sevenDay.resets_at),
      },
      weeklySonnet: {
        utilization: (sevenDaySonnet.utilization || 0) / 100,
        reset: isoToEpoch(sevenDaySonnet.resets_at),
      },
      overage: extraUsage.is_enabled ? {
        utilization: (extraUsage.utilization || 0) / 100,
        spent: extraUsage.used_credits != null ? (extraUsage.used_credits / 100).toFixed(2) : null,
        limit: extraUsage.monthly_limit != null ? (extraUsage.monthly_limit / 100).toFixed(2) : null,
        reset: getNextMonthStart(),
      } : {
        utilization: 0,
        spent: null,
        limit: null,
        reset: null,
      },
      overallStatus: deriveOverallStatus(usageData),
      subscriptionType: creds.subscriptionType || 'unknown',
      rateLimitTier: creds.rateLimitTier || 'unknown',
      localStats: readLocalStats(),
    };
  } catch (e) {
    return {
      error: true,
      errorType: 'network_error',
      errorMessage: `Network error: ${e.message}`,
    };
  }
}

let _liveStatsCache = null;
let _liveStatsCacheTime = 0;
const LIVE_STATS_TTL = 5 * 60 * 1000; // 5 minutes

function computeTodayStatsFromJsonl() {
  // Return cached result if fresh
  const now = Date.now();
  if (_liveStatsCache && (now - _liveStatsCacheTime) < LIVE_STATS_TTL) {
    return _liveStatsCache;
  }
  const today = new Date().toISOString().split('T')[0];
  const projectsDir = path.join(CLAUDE_DIR, 'projects');

  if (!fs.existsSync(projectsDir)) return null;

  let totalMessages = 0;
  let totalToolCalls = 0;
  const sessionIds = new Set();

  function findJsonlFiles(dir) {
    const files = [];
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          files.push(...findJsonlFiles(fullPath));
        } else if (entry.name.endsWith('.jsonl')) {
          const stat = fs.statSync(fullPath);
          const mdate = new Date(stat.mtimeMs).toISOString().split('T')[0];
          if (mdate === today) {
            files.push(fullPath);
          }
        }
      }
    } catch {}
    return files;
  }

  const files = findJsonlFiles(projectsDir);

  for (const filePath of files) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      for (const line of lines) {
        if (!line.trim() || !line.includes(today)) continue;

        try {
          const entry = JSON.parse(line);
          const ts = entry.timestamp || '';
          if (!ts.startsWith(today)) continue;

          if (entry.sessionId) sessionIds.add(entry.sessionId);

          if (entry.type === 'user') {
            totalMessages++;
          }

          if (entry.type === 'assistant') {
            const blocks = entry.message?.content;
            if (Array.isArray(blocks)) {
              for (const block of blocks) {
                if (block?.type === 'tool_use') {
                  totalToolCalls++;
                }
              }
            }
          }
        } catch {}
      }
    } catch {}
  }

  if (totalMessages === 0 && sessionIds.size === 0 && totalToolCalls === 0) {
    return null;
  }

  const result = {
    activityDate: today,
    todayMessages: totalMessages,
    todaySessions: sessionIds.size,
    todayToolCalls: totalToolCalls,
  };

  _liveStatsCache = result;
  _liveStatsCacheTime = Date.now();

  return result;
}

function readLocalStats() {
  try {
    const today = new Date().toISOString().split('T')[0];

    // Try stats-cache.json first
    if (fs.existsSync(STATS_CACHE_PATH)) {
      const stats = JSON.parse(fs.readFileSync(STATS_CACHE_PATH, 'utf-8'));
      const dailyActivity = stats.dailyActivity || [];
      const todayActivity = dailyActivity.find(d => d.date === today);

      if (todayActivity) {
        return {
          activityDate: today,
          todayMessages: todayActivity.messageCount || 0,
          todaySessions: todayActivity.sessionCount || 0,
          todayToolCalls: todayActivity.toolCallCount || 0,
        };
      }
    }

    // Cache doesn't have today's data - compute from JSONL files
    const liveStats = computeTodayStatsFromJsonl();
    if (liveStats) return liveStats;

    // Fallback to most recent cached date
    if (fs.existsSync(STATS_CACHE_PATH)) {
      const stats = JSON.parse(fs.readFileSync(STATS_CACHE_PATH, 'utf-8'));
      const dailyActivity = stats.dailyActivity || [];
      if (dailyActivity.length > 0) {
        const sorted = [...dailyActivity].sort((a, b) => b.date.localeCompare(a.date));
        const latest = sorted[0];
        return {
          activityDate: latest.date,
          todayMessages: latest.messageCount || 0,
          todaySessions: latest.sessionCount || 0,
          todayToolCalls: latest.toolCallCount || 0,
        };
      }
    }

    return null;
  } catch {
    return null;
  }
}

function getMockData() {
  const now = Date.now();
  // Realistic reset times matching Claude Code's actual schedule
  // Session resets: today 6pm KST (9am UTC)
  const today6pmKST = new Date();
  today6pmKST.setHours(18, 0, 0, 0);
  if (today6pmKST.getTime() < now) today6pmKST.setDate(today6pmKST.getDate() + 1);

  // Weekly all models resets: Feb 13 at 1pm KST
  const weeklyReset = new Date('2026-02-13T04:00:00Z'); // 1pm KST = 4am UTC

  // Weekly Sonnet resets: Feb 12 at 9am KST
  const sonnetReset = new Date('2026-02-12T00:00:00Z'); // 9am KST = 0am UTC

  // Overage resets: Mar 1 KST
  const overageReset = new Date('2026-03-01T00:00:00Z');

  const sessionResetEpoch = String(Math.floor(today6pmKST.getTime() / 1000));
  const weeklyResetEpoch = String(Math.floor(weeklyReset.getTime() / 1000));
  const sonnetResetEpoch = String(Math.floor(sonnetReset.getTime() / 1000));
  const overageResetEpoch = String(Math.floor(overageReset.getTime() / 1000));

  return {
    error: false,
    timestamp: now,
    statusCode: 200,
    allHeaders: {
      'anthropic-ratelimit-unified-5h-utilization': '0.21',
      'anthropic-ratelimit-unified-5h-reset': sessionResetEpoch,
      'anthropic-ratelimit-unified-5h-status': 'active',
      'anthropic-ratelimit-unified-7d-utilization': '0.68',
      'anthropic-ratelimit-unified-7d-reset': weeklyResetEpoch,
      'anthropic-ratelimit-unified-7d-status': 'active',
      'anthropic-ratelimit-unified-7d-sonnet-utilization': '0.02',
      'anthropic-ratelimit-unified-7d-sonnet-reset': sonnetResetEpoch,
      'anthropic-ratelimit-unified-7d-sonnet-status': 'active',
      'anthropic-ratelimit-unified-status': 'active',
      'anthropic-ratelimit-unified-representative-claim': 'seven_day',
      'anthropic-ratelimit-unified-overage-status': 'active',
      'anthropic-ratelimit-unified-overage-utilization': '0.31',
      'anthropic-ratelimit-unified-overage-spent': '15.82',
      'anthropic-ratelimit-unified-overage-limit': '50.00',
      'anthropic-ratelimit-unified-overage-reset': overageResetEpoch,
    },
    session: {
      utilization: 0.21,
      reset: sessionResetEpoch,
      status: 'active',
    },
    weekly: {
      utilization: 0.68,
      reset: weeklyResetEpoch,
      status: 'active',
    },
    weeklySonnet: {
      utilization: 0.02,
      reset: sonnetResetEpoch,
      status: 'active',
    },
    overallStatus: 'active',
    overage: {
      status: 'active',
      utilization: 0.31,
      spent: '15.82',
      limit: '50.00',
      reset: overageResetEpoch,
    },
    representativeClaim: 'seven_day',
    fallbackPercentage: null,
    subscriptionType: 'max',
    rateLimitTier: 'default_claude_max_5x',
    localStats: readLocalStats(),
  };
}

function logout() {
  try {
    if (!fs.existsSync(CREDENTIALS_PATH)) return;
    const creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf-8'));
    delete creds.claudeAiOauth;
    fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(creds, null, 2), 'utf-8');
  } catch {}
  _liveStatsCache = null;
  _liveStatsCacheTime = 0;
}

module.exports = { fetchRateLimits, readCredentials, getMockData, logout };
