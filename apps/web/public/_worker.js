const SNAPSHOT_MAX_AGE_SECONDS = 60;
const PREFERRED_MAX_AGE_SECONDS = 30;

function acceptsHtml(request) {
  const accept = request.headers.get('Accept') || '';
  return accept.includes('text/html');
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeJsonForInlineScript(value) {
  // Prevent breaking out of <script> tags via `</script>`.
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function computeCacheControl(ageSeconds) {
  const remaining = Math.max(0, SNAPSHOT_MAX_AGE_SECONDS - ageSeconds);
  const maxAge = Math.min(PREFERRED_MAX_AGE_SECONDS, remaining);
  const stale = Math.max(0, remaining - maxAge);
  return `public, max-age=${maxAge}, stale-while-revalidate=${stale}, stale-if-error=${stale}`;
}

function formatTime(tsSec) {
  try {
    return new Date(tsSec * 1000).toLocaleString();
  } catch {
    return '';
  }
}

function statusDotClass(status) {
  switch (status) {
    case 'up':
      return 'bg-emerald-500';
    case 'down':
      return 'bg-red-500';
    case 'maintenance':
      return 'bg-blue-500';
    case 'paused':
      return 'bg-amber-500';
    default:
      return 'bg-slate-400';
  }
}

function statusBadgeClass(status) {
  switch (status) {
    case 'up':
      return 'bg-emerald-50 text-emerald-700 ring-emerald-600/20';
    case 'down':
      return 'bg-red-50 text-red-700 ring-red-600/20';
    case 'maintenance':
      return 'bg-blue-50 text-blue-700 ring-blue-600/20';
    case 'paused':
      return 'bg-amber-50 text-amber-700 ring-amber-600/20';
    default:
      return 'bg-slate-50 text-slate-600 ring-slate-500/20';
  }
}

function renderPreload(snapshot) {
  const overall = typeof snapshot.overall_status === 'string' ? snapshot.overall_status : 'unknown';
  const bannerTitle =
    snapshot && snapshot.banner && typeof snapshot.banner.title === 'string' ? snapshot.banner.title : 'Status';
  const generatedAt =
    typeof snapshot.generated_at === 'number' ? snapshot.generated_at : Math.floor(Date.now() / 1000);

  const monitors = Array.isArray(snapshot.monitors) ? snapshot.monitors : [];

  const monitorCards = monitors
    .map((m) => {
      const id = typeof m.id === 'number' ? m.id : 0;
      const name = escapeHtml(m.name ?? `#${id}`);
      const type = escapeHtml(m.type ?? '');
      const status = typeof m.status === 'string' ? m.status : 'unknown';
      const lastCheckedAt = typeof m.last_checked_at === 'number' ? m.last_checked_at : null;

      const lastChecked = lastCheckedAt ? `Last checked: ${escapeHtml(formatTime(lastCheckedAt))}` : 'Never checked';

      return `
        <div class="bg-white rounded-xl border border-slate-100 shadow-soft p-4">
          <div class="flex items-start justify-between mb-3">
            <div class="flex items-center gap-2.5 min-w-0">
              <span class="relative flex h-2.5 w-2.5"><span class="relative inline-flex h-2.5 w-2.5 rounded-full ${statusDotClass(
                status,
              )}"></span></span>
              <div class="min-w-0">
                <div class="font-semibold text-slate-900 truncate">${name}</div>
                <div class="text-xs text-slate-500 uppercase tracking-wide">${type}</div>
              </div>
            </div>
            <span class="inline-flex items-center rounded-full font-medium ring-1 ring-inset px-2 py-0.5 text-xs ${statusBadgeClass(
              status,
            )}">${escapeHtml(status)}</span>
          </div>
          <div class="text-xs text-slate-400">${lastChecked}</div>
        </div>
      `;
    })
    .join('');

  return `
    <div class="min-h-screen bg-slate-50">
      <header class="bg-white border-b border-slate-100">
        <div class="max-w-5xl mx-auto px-4 py-4 flex justify-between items-center">
          <div class="text-lg font-bold text-slate-900">Uptimer</div>
          <span class="inline-flex items-center rounded-full font-medium ring-1 ring-inset px-2.5 py-1 text-sm ${statusBadgeClass(
            overall,
          )}">${escapeHtml(overall)}</span>
        </div>
      </header>

      <main class="max-w-5xl mx-auto px-4 py-6">
        <div class="rounded-2xl p-5 border border-slate-100 bg-white shadow-soft mb-6">
          <div class="text-sm text-slate-500">${escapeHtml(bannerTitle)}</div>
          <div class="text-xs text-slate-400 mt-1">Updated: ${escapeHtml(formatTime(generatedAt))}</div>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">${monitorCards}</div>
      </main>
    </div>
  `;
}

async function fetchPublicStatusSnapshot(env) {
  const apiOrigin = env.UPTIMER_API_ORIGIN;
  if (typeof apiOrigin !== 'string' || apiOrigin.length === 0) return null;

  const statusUrl = new URL('/api/v1/public/status', apiOrigin);

  // Keep HTML fast: if the API is slow, fall back to a static HTML shell.
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 800);

  try {
    const resp = await fetch(statusUrl.toString(), {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });

    if (!resp.ok) return null;

    const data = await resp.json();
    if (!data || typeof data !== 'object') return null;

    return data;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // HTML requests: serve SPA entry for client-side routes.
    const wantsHtml = request.method === 'GET' && acceptsHtml(request);

    // Special-case the status page for HTML injection.
    const isStatusPage = url.pathname === '/' || url.pathname === '/index.html';
    if (wantsHtml && isStatusPage) {
      const cacheKey = new Request(url.origin + '/', { method: 'GET' });
      const cached = await caches.default.match(cacheKey);
      if (cached) return cached;

      const base = await env.ASSETS.fetch(
        new Request(new URL('/index.html', url).toString(), request),
      );
      const html = await base.text();

      const snapshot = await fetchPublicStatusSnapshot(env);
      if (!snapshot) {
        const resp = new Response(html, base);
        resp.headers.set('Content-Type', 'text/html; charset=utf-8');
        resp.headers.append('Vary', 'Accept');
        return resp;
      }

      const now = Math.floor(Date.now() / 1000);
      const generatedAt = typeof snapshot.generated_at === 'number' ? snapshot.generated_at : now;
      const age = Math.max(0, now - generatedAt);

      let injected = html.replace(
        '<div id="root"></div>',
        `<div id="uptimer-preload">${renderPreload(snapshot)}</div><div id="root"></div>`,
      );

      injected = injected.replace(
        '</head>',
        `  <script>globalThis.__UPTIMER_INITIAL_STATUS__=${safeJsonForInlineScript(snapshot)};</script>\n</head>`,
      );

      const resp = new Response(injected, base);
      resp.headers.set('Content-Type', 'text/html; charset=utf-8');
      resp.headers.set('Cache-Control', computeCacheControl(age));
      resp.headers.append('Vary', 'Accept');

      ctx.waitUntil(caches.default.put(cacheKey, resp.clone()));
      return resp;
    }

    // Default: serve static assets.
    const assetResp = await env.ASSETS.fetch(request);

    // SPA fallback for client-side routes.
    if (wantsHtml && assetResp.status === 404) {
      const indexResp = await env.ASSETS.fetch(
        new Request(new URL('/index.html', url).toString(), request),
      );
      const out = new Response(await indexResp.text(), indexResp);
      out.headers.set('Content-Type', 'text/html; charset=utf-8');
      out.headers.append('Vary', 'Accept');
      return out;
    }

    return assetResp;
  },
};
