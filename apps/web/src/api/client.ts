import type {
  AdminMonitor,
  AdminIncidentsResponse,
  AnalyticsOverviewResponse,
  AnalyticsOverviewRange,
  AnalyticsRange,
  CreateMonitorInput,
  CreateIncidentInput,
  CreateIncidentUpdateInput,
  CreateNotificationChannelInput,
  CreateMaintenanceWindowInput,
  LatencyResponse,
  MaintenanceWindow,
  MonitorTestResult,
  Incident,
  IncidentUpdate,
  NotificationChannel,
  NotificationChannelTestResult,
  PatchMaintenanceWindowInput,
  PatchMonitorInput,
  PatchNotificationChannelInput,
  PublicUptimeOverviewResponse,
  PublicIncidentsResponse,
  ResolveIncidentInput,
  StatusResponse,
  MonitorAnalyticsResponse,
  MonitorOutagesResponse,
  UptimeResponse,
} from './types';

// Build-time override for production deployments.
// - default: same-origin `/api/v1` (works when you route /api to the Worker on the same hostname)
// - override: set `VITE_API_BASE` to e.g. `https://<worker>.<subdomain>.workers.dev/api/v1`
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api/v1';

const PUBLIC_CACHE_TTL_MS = 30_000;
const publicCache = new Map<string, { at: number; value: unknown }>();

function getCachedPublic<T>(key: string): T | null {
  const hit = publicCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > PUBLIC_CACHE_TTL_MS) return null;
  return hit.value as T;
}

function setCachedPublic(key: string, value: unknown) {
  publicCache.set(key, { at: Date.now(), value });
}

class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function getAuthHeaders(): HeadersInit {
  const token = localStorage.getItem('admin_token');
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

function safeJsonParse(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
  // Prefer reading the body as text once and parsing ourselves so we can handle "HTML instead of JSON"
  // cases (common when API_BASE/proxy/routing is misconfigured).
  const text = await res.text();
  const body = safeJsonParse(text);

  if (!res.ok) {
    const err = (body as { error?: { code?: unknown; message?: unknown } } | null)?.error;
    const code = typeof err?.code === 'string' ? err.code : 'UNKNOWN';
    const message =
      typeof err?.message === 'string'
        ? err.message
        : text.trim().startsWith('<')
          ? 'API returned HTML instead of JSON. Check VITE_API_BASE / proxy / routing to the Worker.'
          : `Request failed (HTTP ${res.status}).`;

    throw new ApiError(code, message, res.status);
  }

  if (body === null) {
    const hint = text.trim().startsWith('<')
      ? 'API returned HTML instead of JSON. Check VITE_API_BASE / proxy / routing to the Worker.'
      : 'API returned an invalid response (expected JSON).';
    throw new ApiError('INVALID_RESPONSE', hint, res.status);
  }

  return body as T;
}

// Public API
export async function fetchStatus(): Promise<StatusResponse> {
  const url = `${API_BASE}/public/status`;
  const cached = getCachedPublic<StatusResponse>(url);
  if (cached) return cached;
  try {
    const res = await fetch(url);
    const data = await handleResponse<StatusResponse>(res);
    setCachedPublic(url, data);
    return data;
  } catch (err) {
    const stale = getCachedPublic<StatusResponse>(url);
    if (stale) return stale;
    throw err;
  }
}

export async function fetchLatency(
  monitorId: number,
  range: '24h' = '24h',
): Promise<LatencyResponse> {
  const url = `${API_BASE}/public/monitors/${monitorId}/latency?range=${range}`;
  const cached = getCachedPublic<LatencyResponse>(url);
  if (cached) return cached;
  try {
    const res = await fetch(url);
    const data = await handleResponse<LatencyResponse>(res);
    setCachedPublic(url, data);
    return data;
  } catch (err) {
    const stale = getCachedPublic<LatencyResponse>(url);
    if (stale) return stale;
    throw err;
  }
}

export async function fetchUptime(
  monitorId: number,
  range: '24h' | '7d' | '30d' = '24h',
): Promise<UptimeResponse> {
  const url = `${API_BASE}/public/monitors/${monitorId}/uptime?range=${range}`;
  const cached = getCachedPublic<UptimeResponse>(url);
  if (cached) return cached;
  try {
    const res = await fetch(url);
    const data = await handleResponse<UptimeResponse>(res);
    setCachedPublic(url, data);
    return data;
  } catch (err) {
    const stale = getCachedPublic<UptimeResponse>(url);
    if (stale) return stale;
    throw err;
  }
}

export async function fetchPublicUptimeOverview(
  range: '30d' | '90d' = '30d',
): Promise<PublicUptimeOverviewResponse> {
  const url = `${API_BASE}/public/analytics/uptime?range=${range}`;
  const cached = getCachedPublic<PublicUptimeOverviewResponse>(url);
  if (cached) return cached;
  try {
    const res = await fetch(url);
    const data = await handleResponse<PublicUptimeOverviewResponse>(res);
    setCachedPublic(url, data);
    return data;
  } catch (err) {
    const stale = getCachedPublic<PublicUptimeOverviewResponse>(url);
    if (stale) return stale;
    throw err;
  }
}

export async function fetchPublicMonitorOutages(
  monitorId: number,
  opts: { range?: '30d'; limit?: number; cursor?: number } = {},
): Promise<MonitorOutagesResponse> {
  const qs = new URLSearchParams();
  qs.set('range', opts.range ?? '30d');
  qs.set('limit', String(opts.limit ?? 200));
  if (opts.cursor !== undefined) qs.set('cursor', String(opts.cursor));

  const url = `${API_BASE}/public/monitors/${monitorId}/outages?${qs.toString()}`;
  const res = await fetch(url);
  return handleResponse<MonitorOutagesResponse>(res);
}

export { ApiError };

// Admin API - Monitors
export async function fetchAdminMonitors(limit = 50): Promise<{ monitors: AdminMonitor[] }> {
  const res = await fetch(`${API_BASE}/admin/monitors?limit=${limit}`, {
    headers: getAuthHeaders(),
  });
  return handleResponse<{ monitors: AdminMonitor[] }>(res);
}

export async function createMonitor(input: CreateMonitorInput): Promise<{ monitor: AdminMonitor }> {
  const res = await fetch(`${API_BASE}/admin/monitors`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify(input),
  });
  return handleResponse<{ monitor: AdminMonitor }>(res);
}

export async function updateMonitor(
  id: number,
  input: PatchMonitorInput,
): Promise<{ monitor: AdminMonitor }> {
  const res = await fetch(`${API_BASE}/admin/monitors/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify(input),
  });
  return handleResponse<{ monitor: AdminMonitor }>(res);
}

export async function deleteMonitor(id: number): Promise<{ deleted: boolean }> {
  const res = await fetch(`${API_BASE}/admin/monitors/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  return handleResponse<{ deleted: boolean }>(res);
}

export async function testMonitor(id: number): Promise<MonitorTestResult> {
  const res = await fetch(`${API_BASE}/admin/monitors/${id}/test`, {
    method: 'POST',
    headers: getAuthHeaders(),
  });
  return handleResponse<MonitorTestResult>(res);
}

// Admin API - Notification Channels
export async function fetchNotificationChannels(
  limit = 50,
): Promise<{ notification_channels: NotificationChannel[] }> {
  const res = await fetch(`${API_BASE}/admin/notification-channels?limit=${limit}`, {
    headers: getAuthHeaders(),
  });
  return handleResponse<{ notification_channels: NotificationChannel[] }>(res);
}

export async function createNotificationChannel(
  input: CreateNotificationChannelInput,
): Promise<{ notification_channel: NotificationChannel }> {
  const res = await fetch(`${API_BASE}/admin/notification-channels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify(input),
  });
  return handleResponse<{ notification_channel: NotificationChannel }>(res);
}

export async function updateNotificationChannel(
  id: number,
  input: PatchNotificationChannelInput,
): Promise<{ notification_channel: NotificationChannel }> {
  const res = await fetch(`${API_BASE}/admin/notification-channels/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify(input),
  });
  return handleResponse<{ notification_channel: NotificationChannel }>(res);
}

export async function testNotificationChannel(id: number): Promise<NotificationChannelTestResult> {
  const res = await fetch(`${API_BASE}/admin/notification-channels/${id}/test`, {
    method: 'POST',
    headers: getAuthHeaders(),
  });
  return handleResponse<NotificationChannelTestResult>(res);
}

export async function deleteNotificationChannel(id: number): Promise<{ deleted: boolean }> {
  const res = await fetch(`${API_BASE}/admin/notification-channels/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  return handleResponse<{ deleted: boolean }>(res);
}

// Public API - Incidents
export async function fetchPublicIncidents(limit = 20, cursor?: number): Promise<PublicIncidentsResponse> {
  const qs = new URLSearchParams({ limit: String(limit) });
  if (cursor) qs.set('cursor', String(cursor));
  const res = await fetch(`${API_BASE}/public/incidents?${qs.toString()}`);
  return handleResponse<PublicIncidentsResponse>(res);
}

// Admin API - Incidents
export async function fetchAdminIncidents(limit = 50): Promise<AdminIncidentsResponse> {
  const res = await fetch(`${API_BASE}/admin/incidents?limit=${limit}`, {
    headers: getAuthHeaders(),
  });
  return handleResponse<AdminIncidentsResponse>(res);
}

export async function createIncident(input: CreateIncidentInput): Promise<{ incident: Incident }> {
  const res = await fetch(`${API_BASE}/admin/incidents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify(input),
  });
  return handleResponse<{ incident: Incident }>(res);
}

export async function addIncidentUpdate(
  id: number,
  input: CreateIncidentUpdateInput,
): Promise<{ incident: Incident; update: IncidentUpdate }> {
  const res = await fetch(`${API_BASE}/admin/incidents/${id}/updates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify(input),
  });
  return handleResponse<{ incident: Incident; update: IncidentUpdate }>(res);
}

export async function resolveIncident(
  id: number,
  input: ResolveIncidentInput,
): Promise<{ incident: Incident; update?: IncidentUpdate }> {
  const res = await fetch(`${API_BASE}/admin/incidents/${id}/resolve`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify(input),
  });
  return handleResponse<{ incident: Incident; update?: IncidentUpdate }>(res);
}

export async function deleteIncident(id: number): Promise<{ deleted: boolean }> {
  const res = await fetch(`${API_BASE}/admin/incidents/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  return handleResponse<{ deleted: boolean }>(res);
}

// Admin API - Maintenance Windows
export async function fetchMaintenanceWindows(limit = 50): Promise<{ maintenance_windows: MaintenanceWindow[] }> {
  const res = await fetch(`${API_BASE}/admin/maintenance-windows?limit=${limit}`, {
    headers: getAuthHeaders(),
  });
  return handleResponse<{ maintenance_windows: MaintenanceWindow[] }>(res);
}

export async function createMaintenanceWindow(
  input: CreateMaintenanceWindowInput,
): Promise<{ maintenance_window: MaintenanceWindow }> {
  const res = await fetch(`${API_BASE}/admin/maintenance-windows`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify(input),
  });
  return handleResponse<{ maintenance_window: MaintenanceWindow }>(res);
}

export async function updateMaintenanceWindow(
  id: number,
  input: PatchMaintenanceWindowInput,
): Promise<{ maintenance_window: MaintenanceWindow }> {
  const res = await fetch(`${API_BASE}/admin/maintenance-windows/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify(input),
  });
  return handleResponse<{ maintenance_window: MaintenanceWindow }>(res);
}

export async function deleteMaintenanceWindow(id: number): Promise<{ deleted: boolean }> {
  const res = await fetch(`${API_BASE}/admin/maintenance-windows/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  return handleResponse<{ deleted: boolean }>(res);
}

// Admin API - Analytics
export async function fetchAdminAnalyticsOverview(
  range: AnalyticsOverviewRange = '24h',
): Promise<AnalyticsOverviewResponse> {
  const res = await fetch(`${API_BASE}/admin/analytics/overview?range=${range}`, {
    headers: getAuthHeaders(),
  });
  return handleResponse<AnalyticsOverviewResponse>(res);
}

export async function fetchAdminMonitorAnalytics(
  monitorId: number,
  range: AnalyticsRange = '24h',
): Promise<MonitorAnalyticsResponse> {
  const res = await fetch(`${API_BASE}/admin/analytics/monitors/${monitorId}?range=${range}`, {
    headers: getAuthHeaders(),
  });
  return handleResponse<MonitorAnalyticsResponse>(res);
}

export async function fetchAdminMonitorOutages(
  monitorId: number,
  opts: { range?: AnalyticsRange; limit?: number; cursor?: number } = {},
): Promise<MonitorOutagesResponse> {
  const qs = new URLSearchParams();
  qs.set('range', opts.range ?? '7d');
  qs.set('limit', String(opts.limit ?? 50));
  if (opts.cursor !== undefined) qs.set('cursor', String(opts.cursor));

  const res = await fetch(`${API_BASE}/admin/analytics/monitors/${monitorId}/outages?${qs.toString()}`, {
    headers: getAuthHeaders(),
  });
  return handleResponse<MonitorOutagesResponse>(res);
}
