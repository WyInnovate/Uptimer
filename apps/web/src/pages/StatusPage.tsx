import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { fetchStatus, fetchLatency, fetchPublicIncidents } from '../api/client';
import type { Incident, MonitorStatus, PublicMonitor, StatusResponse } from '../api/types';
import { HeartbeatBar } from '../components/HeartbeatBar';
import { LatencyChart } from '../components/LatencyChart';
import { Markdown } from '../components/Markdown';
import { Badge, Card, StatusDot, ThemeToggle } from '../components/ui';

type BannerStatus = StatusResponse['banner']['status'];

function getBannerConfig(status: BannerStatus) {
  const configs = {
    operational: {
      bg: 'from-emerald-500 to-emerald-600',
      text: 'All Systems Operational',
      icon: '✓',
    },
    partial_outage: {
      bg: 'from-amber-500 to-orange-500',
      text: 'Partial System Outage',
      icon: '!',
    },
    major_outage: {
      bg: 'from-red-500 to-red-600',
      text: 'Major System Outage',
      icon: '✕',
    },
    maintenance: {
      bg: 'from-blue-500 to-blue-600',
      text: 'Scheduled Maintenance',
      icon: '⚙',
    },
    unknown: {
      bg: 'from-slate-500 to-slate-600',
      text: 'Status Unknown',
      icon: '?',
    },
  };
  return configs[status] || configs.unknown;
}

function getStatusBadgeVariant(status: MonitorStatus): 'up' | 'down' | 'maintenance' | 'paused' | 'unknown' {
  return status as 'up' | 'down' | 'maintenance' | 'paused' | 'unknown';
}

function MonitorCard({ monitor, onSelect }: { monitor: PublicMonitor; onSelect: () => void }) {
  const upCount = monitor.heartbeats.filter((h) => h.status === 'up').length;
  const totalCount = monitor.heartbeats.length;
  const uptimePercent = totalCount > 0 ? ((upCount / totalCount) * 100).toFixed(1) : null;

  return (
    <Card hover onClick={onSelect} className="p-4 sm:p-5">
      <div className="flex items-start justify-between mb-3 sm:mb-4">
        <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
          <StatusDot status={monitor.status} pulse={monitor.status === 'down'} />
          <div className="min-w-0">
            <h3 className="font-semibold text-slate-900 dark:text-slate-100 truncate">{monitor.name}</h3>
            <span className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide">{monitor.type}</span>
          </div>
        </div>
        <Badge variant={getStatusBadgeVariant(monitor.status)}>
          {monitor.status}
        </Badge>
      </div>

      <HeartbeatBar heartbeats={monitor.heartbeats} />

      <div className="mt-3 sm:mt-4 flex flex-wrap items-center justify-between gap-2 text-sm">
        <div className="flex items-center gap-3 sm:gap-4">
          {uptimePercent && (
            <span className="text-slate-600 dark:text-slate-300">
              <span className="font-medium text-emerald-600 dark:text-emerald-400">{uptimePercent}%</span> uptime
            </span>
          )}
          {monitor.last_latency_ms !== null && (
            <span className="text-slate-500 dark:text-slate-400">{monitor.last_latency_ms}ms</span>
          )}
        </div>
        <span className="text-slate-400 dark:text-slate-500 text-xs">
          {monitor.last_checked_at
            ? new Date(monitor.last_checked_at * 1000).toLocaleTimeString()
            : 'Never checked'}
        </span>
      </div>
    </Card>
  );
}

function MonitorDetail({ monitorId, onClose }: { monitorId: number; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['latency', monitorId],
    queryFn: () => fetchLatency(monitorId),
  });

  return (
    <div
      className="fixed inset-0 bg-slate-900/60 dark:bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 z-50 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-800 rounded-t-2xl sm:rounded-2xl shadow-soft-lg w-full sm:max-w-2xl p-5 sm:p-6 max-h-[90vh] overflow-y-auto animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{data?.monitor.name ?? 'Loading...'}</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {isLoading ? (
          <div className="h-[200px] flex items-center justify-center">
            <div className="w-8 h-8 border-2 border-slate-200 dark:border-slate-600 border-t-slate-600 dark:border-t-slate-300 rounded-full animate-spin" />
          </div>
        ) : data ? (
          <>
            <div className="flex gap-6 mb-6">
              <div className="bg-slate-50 dark:bg-slate-700/50 rounded-lg px-4 py-3">
                <div className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Avg Latency</div>
                <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">{data.avg_latency_ms ?? '-'}ms</div>
              </div>
              <div className="bg-slate-50 dark:bg-slate-700/50 rounded-lg px-4 py-3">
                <div className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">P95 Latency</div>
                <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">{data.p95_latency_ms ?? '-'}ms</div>
              </div>
            </div>
            <LatencyChart points={data.points} />
          </>
        ) : (
          <div className="h-[200px] flex items-center justify-center text-slate-500 dark:text-slate-400">
            Failed to load data
          </div>
        )}
      </div>
    </div>
  );
}

function IncidentCard({ incident, onClick }: { incident: Incident; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 shadow-soft dark:shadow-none p-5 hover:shadow-soft-lg hover:border-slate-200 dark:hover:border-slate-600 transition-all"
    >
      <div className="flex items-start justify-between gap-4 mb-2">
        <h4 className="font-semibold text-slate-900 dark:text-slate-100">{incident.title}</h4>
        <Badge variant={incident.impact === 'critical' ? 'down' : incident.impact === 'major' ? 'down' : 'paused'}>
          {incident.impact}
        </Badge>
      </div>
      <div className="flex items-center gap-3 text-sm text-slate-500 dark:text-slate-400 mb-3">
        <Badge variant="info">{incident.status}</Badge>
        <span>{new Date(incident.started_at * 1000).toLocaleString()}</span>
      </div>
      {incident.message && (
        <p className="text-sm text-slate-600 dark:text-slate-300 line-clamp-2">{incident.message}</p>
      )}
    </button>
  );
}

function IncidentDetail({
  incident,
  monitorNames,
  onClose,
}: {
  incident: Incident;
  monitorNames: Map<number, string>;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 bg-slate-900/60 dark:bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-800 rounded-2xl shadow-soft-lg max-w-2xl w-full p-6 max-h-[85vh] overflow-y-auto animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-start mb-6">
          <div>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-2">{incident.title}</h2>
            <div className="flex items-center gap-2">
              <Badge variant={incident.impact === 'critical' || incident.impact === 'major' ? 'down' : 'paused'}>{incident.impact}</Badge>
              <Badge variant="info">{incident.status}</Badge>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-3 text-sm text-slate-600 dark:text-slate-300 mb-6 pb-6 border-b border-slate-100 dark:border-slate-700">
          <div className="flex gap-2">
            <span className="text-slate-400 dark:text-slate-500 w-20">Affected:</span>
            <span>{incident.monitor_ids.map((id) => monitorNames.get(id) ?? `#${id}`).join(', ')}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-slate-400 dark:text-slate-500 w-20">Started:</span>
            <span>{new Date(incident.started_at * 1000).toLocaleString()}</span>
          </div>
          {incident.resolved_at && (
            <div className="flex gap-2">
              <span className="text-slate-400 dark:text-slate-500 w-20">Resolved:</span>
              <span>{new Date(incident.resolved_at * 1000).toLocaleString()}</span>
            </div>
          )}
        </div>

        <div className="space-y-4">
          {incident.message && (
            <div className="bg-slate-50 dark:bg-slate-700/50 rounded-lg p-4">
              <div className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">Initial Report</div>
              <Markdown text={incident.message} />
            </div>
          )}

          {incident.updates.map((u) => (
            <div key={u.id} className="border-l-2 border-slate-200 dark:border-slate-600 pl-4">
              <div className="flex items-center gap-3 mb-2">
                {u.status && <Badge variant="info">{u.status}</Badge>}
                <span className="text-xs text-slate-400 dark:text-slate-500">{new Date(u.created_at * 1000).toLocaleString()}</span>
              </div>
              <Markdown text={u.message} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function StatusPage() {
  const [selectedMonitorId, setSelectedMonitorId] = useState<number | null>(null);
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['status'],
    queryFn: fetchStatus,
    refetchInterval: 30000,
  });

  const incidentsQuery = useQuery({
    queryKey: ['public-incidents'],
    queryFn: () => fetchPublicIncidents(20),
    refetchInterval: 30000,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-slate-200 dark:border-slate-600 border-t-slate-600 dark:border-t-slate-300 rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-500 dark:text-red-400 text-lg font-medium mb-2">Failed to load status</div>
          <p className="text-slate-500 dark:text-slate-400 text-sm">Please try again later</p>
        </div>
      </div>
    );
  }

  const bannerConfig = getBannerConfig(data.banner.status);
  const monitorNames = new Map(data.monitors.map((m) => [m.id, m.name] as const));
  const activeIncidents = (incidentsQuery.data?.incidents ?? []).filter((it) => it.status !== 'resolved');

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      {/* Header */}
      <header className="bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex justify-between items-center">
          <h1 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100">Uptimer</h1>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Link
              to="/admin"
              className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition-colors px-3 py-1.5 -mr-3 rounded-lg active:bg-slate-100 dark:active:bg-slate-700"
            >
              Admin
            </Link>
          </div>
        </div>
      </header>

      {/* Status Banner */}
      <div className={`bg-gradient-to-r ${bannerConfig.bg} text-white`}>
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-12 text-center">
          <div className="inline-flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-white/20 text-xl sm:text-2xl mb-3 sm:mb-4">
            {bannerConfig.icon}
          </div>
          <h2 className="text-xl sm:text-2xl font-bold mb-2">{bannerConfig.text}</h2>
          {data.banner.source === 'incident' && data.banner.incident && (
            <p className="text-white/80 text-sm px-4">Incident: {data.banner.incident.title}</p>
          )}
          {data.banner.source === 'maintenance' && data.banner.maintenance_window && (
            <p className="text-white/80 text-sm px-4">Maintenance: {data.banner.maintenance_window.title}</p>
          )}
          <p className="text-white/60 text-xs mt-3">
            Last updated: {new Date(data.generated_at * 1000).toLocaleString()}
          </p>
        </div>
      </div>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        {/* Maintenance Windows */}
        {(data.maintenance_windows.active.length > 0 || data.maintenance_windows.upcoming.length > 0) && (
          <section className="mb-10">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4 flex items-center gap-2">
              <svg className="w-5 h-5 text-blue-500 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Maintenance
            </h3>

            {data.maintenance_windows.active.length > 0 && (
              <div className="mb-4">
                <div className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">Active</div>
                <div className="space-y-3">
                  {data.maintenance_windows.active.map((w) => (
                    <Card key={w.id} className="p-4 sm:p-5 border-l-4 border-l-blue-500 dark:border-l-blue-400">
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-4 mb-2">
                        <h4 className="font-semibold text-slate-900 dark:text-slate-100">{w.title}</h4>
                        <span className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                          {new Date(w.starts_at * 1000).toLocaleString()} – {new Date(w.ends_at * 1000).toLocaleString()}
                        </span>
                      </div>
                      <div className="text-sm text-slate-600 dark:text-slate-300 mb-2">
                        Affected: {w.monitor_ids.map((id) => monitorNames.get(id) ?? `#${id}`).join(', ')}
                      </div>
                      {w.message && <Markdown text={w.message} />}
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {data.maintenance_windows.upcoming.length > 0 && (
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">Upcoming</div>
                <div className="space-y-3">
                  {data.maintenance_windows.upcoming.map((w) => (
                    <Card key={w.id} className="p-4 sm:p-5 border-l-4 border-l-slate-300 dark:border-l-slate-600">
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-4 mb-2">
                        <h4 className="font-semibold text-slate-900 dark:text-slate-100">{w.title}</h4>
                        <span className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                          {new Date(w.starts_at * 1000).toLocaleString()} – {new Date(w.ends_at * 1000).toLocaleString()}
                        </span>
                      </div>
                      <div className="text-sm text-slate-600 dark:text-slate-300">
                        Affected: {w.monitor_ids.map((id) => monitorNames.get(id) ?? `#${id}`).join(', ')}
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {/* Active Incidents */}
        {activeIncidents.length > 0 && (
          <section className="mb-10">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4 flex items-center gap-2">
              <svg className="w-5 h-5 text-amber-500 dark:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              Active Incidents
            </h3>
            <div className="space-y-3">
              {activeIncidents.map((it) => (
                <IncidentCard key={it.id} incident={it} onClick={() => setSelectedIncident(it)} />
              ))}
            </div>
          </section>
        )}

        {/* Monitors */}
        <section>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4">Services</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            {data.monitors.map((monitor) => (
              <MonitorCard
                key={monitor.id}
                monitor={monitor}
                onSelect={() => setSelectedMonitorId(monitor.id)}
              />
            ))}
          </div>
          {data.monitors.length === 0 && (
            <Card className="p-8 text-center">
              <p className="text-slate-500 dark:text-slate-400">No monitors configured</p>
            </Card>
          )}
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-800">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 sm:py-6 text-center text-sm text-slate-400 dark:text-slate-500">
          Powered by Uptimer
        </div>
      </footer>

      {/* Modals */}
      {selectedMonitorId !== null && (
        <MonitorDetail monitorId={selectedMonitorId} onClose={() => setSelectedMonitorId(null)} />
      )}

      {selectedIncident && (
        <IncidentDetail
          incident={selectedIncident}
          monitorNames={monitorNames}
          onClose={() => setSelectedIncident(null)}
        />
      )}
    </div>
  );
}
