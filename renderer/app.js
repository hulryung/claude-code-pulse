const loadingState = document.getElementById('loading-state');
const errorState = document.getElementById('error-state');
const dataDisplay = document.getElementById('data-display');
const errorMessage = document.getElementById('error-message');
const rateSections = document.getElementById('rate-sections');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const planBadge = document.getElementById('plan-badge');
const lastUpdated = document.getElementById('last-updated');
const rawHeadersContent = document.getElementById('raw-headers-content');
const rawHeaders = document.getElementById('raw-headers');
const btnRawToggle = document.getElementById('btn-raw-toggle');
const localStatsEl = document.getElementById('local-stats');
const statsGrid = document.getElementById('stats-grid');
const btnRefresh = document.getElementById('btn-refresh');
const btnRetry = document.getElementById('btn-retry');
const btnClose = document.getElementById('btn-close');

const BAR_WIDTH = 50; // 50 characters wide, matching CLI

function getBarLevel(ratio) {
  if (ratio >= 0.8) return 'critical';
  if (ratio >= 0.6) return 'high';
  if (ratio >= 0.3) return 'medium';
  return 'low';
}

function buildBlockBar(ratio) {
  // Build CLI-style block bar: █████░░░░░░░░░░░░░
  const filled = Math.round(Math.min(ratio, 1) * BAR_WIDTH);
  const empty = BAR_WIDTH - filled;
  const level = getBarLevel(ratio);

  // Use partial block for fractional part
  const exactFill = Math.min(ratio, 1) * BAR_WIDTH;
  const wholeFilled = Math.floor(exactFill);
  const fractional = exactFill - wholeFilled;

  let filledStr = '█'.repeat(wholeFilled);
  if (fractional >= 0.75) {
    filledStr += '█';
  } else if (fractional >= 0.5) {
    filledStr += '▊';
  } else if (fractional >= 0.25) {
    filledStr += '▌';
  } else if (fractional > 0.05 && wholeFilled === 0) {
    filledStr += '▎';
  }

  const actualFilled = filledStr.length;
  const emptyStr = ' '.repeat(Math.max(0, BAR_WIDTH - actualFilled));

  return `<span class="bar-filled ${level}">${filledStr}</span><span class="bar-empty">${emptyStr}</span>`;
}

function formatTime(d) {
  // CLI style: "6pm", "1pm", "9am", "12:30pm"
  let hours = d.getHours();
  const minutes = d.getMinutes();
  const ampm = hours >= 12 ? 'pm' : 'am';
  hours = hours % 12 || 12;
  if (minutes === 0) {
    return `${hours}${ampm}`;
  }
  return `${hours}:${String(minutes).padStart(2, '0')}${ampm}`;
}

function formatReset(resetValue) {
  if (!resetValue) return '';
  try {
    const epoch = typeof resetValue === 'string' ? parseInt(resetValue, 10) : resetValue;
    if (isNaN(epoch) || epoch === 0) return '';
    const d = new Date(epoch * 1000);
    const now = new Date();
    const diffMs = d - now;

    if (diffMs < 0) return 'Just reset';

    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const timeStr = formatTime(d);

    const isToday = d.getDate() === now.getDate() &&
                    d.getMonth() === now.getMonth() &&
                    d.getFullYear() === now.getFullYear();

    const isTomorrow = (() => {
      const tmr = new Date(now);
      tmr.setDate(tmr.getDate() + 1);
      return d.getDate() === tmr.getDate() &&
             d.getMonth() === tmr.getMonth() &&
             d.getFullYear() === tmr.getFullYear();
    })();

    if (isToday) {
      return `Resets ${timeStr} (${tz})`;
    }

    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const dateStr = `${months[d.getMonth()]} ${d.getDate()}`;

    // If reset is far in future (> 7 days), just show date without time
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    if (diffDays > 7) {
      return `Resets ${dateStr} (${tz})`;
    }

    return `Resets ${dateStr} at ${timeStr} (${tz})`;
  } catch {
    return '';
  }
}

function createRateSection(label, utilization, resetValue, extraDetail, isOverage) {
  const pct = Math.round(utilization * 100);
  const barHtml = buildBlockBar(utilization);
  const resetStr = formatReset(resetValue);

  const section = document.createElement('div');
  section.className = 'rate-section';

  let metaLine = '';
  if (extraDetail && resetStr) {
    metaLine = `<div class="rate-meta"><span class="rate-detail">${extraDetail}</span> · ${resetStr}</div>`;
  } else if (resetStr) {
    metaLine = `<div class="rate-meta">${resetStr}</div>`;
  } else if (extraDetail) {
    metaLine = `<div class="rate-meta"><span class="rate-detail">${extraDetail}</span></div>`;
  }

  section.innerHTML = `
    <div class="rate-label">${label}</div>
    <div class="rate-bar-row">
      <span class="rate-bar-blocks">${barHtml}</span>
      <span class="rate-pct">${pct}% used</span>
    </div>
    ${metaLine}
  `;

  return section;
}

const loginState = document.getElementById('login-state');
const btnLogin = document.getElementById('btn-login');

function showState(state) {
  loadingState.classList.toggle('hidden', state !== 'loading');
  errorState.classList.toggle('hidden', state !== 'error');
  loginState.classList.toggle('hidden', state !== 'login');
  dataDisplay.classList.toggle('hidden', state !== 'data');
}

function renderData(data) {
  if (data.error) {
    showState('error');
    errorMessage.textContent = data.errorMessage;
    return;
  }

  showState('data');

  // Status
  const status = data.overallStatus || 'active';
  statusDot.className = 'status-dot';
  if (status === 'rate_limited') {
    statusDot.classList.add('rate-limited');
    statusText.textContent = 'Rate Limited';
  } else if (status === 'warning') {
    statusDot.classList.add('warning');
    statusText.textContent = 'Warning';
  } else {
    statusText.textContent = 'Active';
  }

  // Plan badge
  planBadge.textContent = '';
  if (data.rateLimitTier && data.rateLimitTier !== 'unknown') {
    const tierMatch = data.rateLimitTier.match(/(\d+)x/);
    if (tierMatch) {
      planBadge.textContent = `Max ${tierMatch[1]}x`;
    } else if (data.subscriptionType && data.subscriptionType !== 'unknown') {
      planBadge.textContent = data.subscriptionType.charAt(0).toUpperCase() + data.subscriptionType.slice(1);
    }
  } else if (data.subscriptionType && data.subscriptionType !== 'unknown') {
    planBadge.textContent = data.subscriptionType.charAt(0).toUpperCase() + data.subscriptionType.slice(1);
  }

  // Rate sections
  rateSections.innerHTML = '';

  // Current session (5h)
  rateSections.appendChild(
    createRateSection('Current session', data.session.utilization, data.session.reset)
  );

  // Current week - all models (7d)
  rateSections.appendChild(
    createRateSection('Current week (all models)', data.weekly.utilization, data.weekly.reset)
  );

  // Current week - Sonnet only
  if (data.weeklySonnet && (data.weeklySonnet.utilization > 0 || data.weeklySonnet.reset)) {
    rateSections.appendChild(
      createRateSection('Current week (Sonnet only)', data.weeklySonnet.utilization, data.weeklySonnet.reset)
    );
  }

  // Extra usage / Overage
  if (data.overage && (data.overage.utilization > 0 || data.overage.spent)) {
    const spent = data.overage.spent ? parseFloat(data.overage.spent).toFixed(2) : '0.00';
    const limit = data.overage.limit ? parseFloat(data.overage.limit).toFixed(2) : '0.00';
    const detail = data.overage.spent ? `$${spent} / $${limit} spent` : '';
    rateSections.appendChild(
      createRateSection('Extra usage', data.overage.utilization, data.overage.reset, detail, true)
    );
  }

  // Fallback: parse unknown utilization headers
  if (rateSections.children.length === 0) {
    const allHeaders = data.allHeaders || {};
    const utilHeaders = Object.entries(allHeaders)
      .filter(([k]) => k.includes('utilization'))
      .sort(([a], [b]) => a.localeCompare(b));

    for (const [key, value] of utilHeaders) {
      const label = key
        .replace('anthropic-ratelimit-unified-', '')
        .replace('-utilization', '')
        .replace(/-/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
      const resetKey = key.replace('-utilization', '-reset');
      const resetVal = allHeaders[resetKey] || null;
      rateSections.appendChild(
        createRateSection(label, parseFloat(value) || 0, resetVal)
      );
    }
  }

  // Local stats
  const stats = data.localStats;
  if (stats && (stats.todayMessages > 0 || stats.todaySessions > 0 || stats.todayToolCalls > 0)) {
    localStatsEl.classList.remove('hidden');
    statsGrid.innerHTML = '';

    // Update header with date context
    const statsHeader = localStatsEl.querySelector('.stats-header');
    if (statsHeader && stats.activityDate) {
      const today = new Date().toISOString().split('T')[0];
      const badge = '<span class="stats-local-badge">local only</span>';
      if (stats.activityDate === today) {
        statsHeader.innerHTML = `Today's Activity ${badge}`;
      } else {
        const d = new Date(stats.activityDate + 'T00:00:00');
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        statsHeader.innerHTML = `Activity (${months[d.getMonth()]} ${d.getDate()}) ${badge}`;
      }
    }

    const items = [
      { value: stats.todayMessages, label: 'Messages' },
      { value: stats.todaySessions, label: 'Sessions' },
      { value: stats.todayToolCalls, label: 'Tool Calls' },
    ];

    for (const item of items) {
      const el = document.createElement('div');
      el.className = 'stat-item';
      el.innerHTML = `
        <span class="stat-value">${item.value.toLocaleString()}</span>
        <span class="stat-label">${item.label}</span>
      `;
      statsGrid.appendChild(el);
    }
  } else {
    localStatsEl.classList.add('hidden');
  }

  // Raw headers
  const allHeaders = data.allHeaders || {};
  const headerLines = Object.entries(allHeaders)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
  rawHeadersContent.textContent = headerLines || 'No usage data available';

  // Last updated
  const now = new Date();
  lastUpdated.textContent = `Updated ${now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' })}`;
}

// Event handlers
btnRefresh.addEventListener('click', async () => {
  btnRefresh.classList.add('refreshing');
  const data = await window.api.fetchRateLimits();
  renderData(data);
  btnRefresh.classList.remove('refreshing');
});

btnRetry.addEventListener('click', async () => {
  showState('loading');
  const data = await window.api.fetchRateLimits();
  renderData(data);
});

btnLogin.addEventListener('click', async () => {
  showState('login');
  const result = await window.api.startLogin();
  if (result.success) {
    renderData(result.data);
  } else {
    showState('error');
    errorMessage.textContent = result.error || 'Login failed. Please try again.';
  }
});

btnClose.addEventListener('click', () => {
  window.close();
});

const btnLogout = document.getElementById('btn-logout');
btnLogout.addEventListener('click', async () => {
  await window.api.logout();
  showState('error');
  errorMessage.textContent = 'Logged out. Please login to continue.';
});

let rawVisible = false;
btnRawToggle.addEventListener('click', () => {
  rawVisible = !rawVisible;
  rawHeaders.classList.toggle('hidden', !rawVisible);
  btnRawToggle.textContent = rawVisible ? 'Hide Raw Data' : 'Show Raw Data';
});

// Auto-refresh listener
window.api.onAutoRefresh((data) => {
  renderData(data);
});

// Initial load
(async () => {
  const settings = await window.api.getSettings();
  if (!settings.debug) {
    document.querySelector('.raw-section').classList.add('hidden');
  }
  showState('loading');
  const data = await window.api.fetchRateLimits();
  renderData(data);
})();
