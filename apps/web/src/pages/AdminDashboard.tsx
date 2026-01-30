import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { useAuth } from '../app/AuthContext';
import {
  ApiError,
  fetchAdminMonitors, createMonitor, updateMonitor, deleteMonitor, testMonitor,
  fetchNotificationChannels, createNotificationChannel, updateNotificationChannel, testNotificationChannel,
  fetchAdminIncidents, createIncident, addIncidentUpdate, resolveIncident, deleteIncident,
  fetchMaintenanceWindows, createMaintenanceWindow, updateMaintenanceWindow, deleteMaintenanceWindow,
} from '../api/client';
import type { AdminMonitor, Incident, MaintenanceWindow, NotificationChannel } from '../api/types';
import { IncidentForm } from '../components/IncidentForm';
import { IncidentUpdateForm } from '../components/IncidentUpdateForm';
import { MaintenanceWindowForm } from '../components/MaintenanceWindowForm';
import { MonitorForm } from '../components/MonitorForm';
import { NotificationChannelForm } from '../components/NotificationChannelForm';
import { ResolveIncidentForm } from '../components/ResolveIncidentForm';
import { Badge, Button, Card, ThemeToggle } from '../components/ui';

type Tab = 'monitors' | 'notifications' | 'incidents' | 'maintenance';
type ModalState =
  | { type: 'none' }
  | { type: 'create-monitor' }
  | { type: 'edit-monitor'; monitor: AdminMonitor }
  | { type: 'create-channel' }
  | { type: 'edit-channel'; channel: NotificationChannel }
  | { type: 'create-incident' }
  | { type: 'add-incident-update'; incident: Incident }
  | { type: 'resolve-incident'; incident: Incident }
  | { type: 'create-maintenance' }
  | { type: 'edit-maintenance'; window: MaintenanceWindow };

const tabs: { key: Tab; label: string; icon: string }[] = [
  { key: 'monitors', label: 'Monitors', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
  { key: 'notifications', label: 'Notifications', icon: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9' },
  { key: 'incidents', label: 'Incidents', icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z' },
  { key: 'maintenance', label: 'Maintenance', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z' },
];

function formatError(err: unknown): string | undefined {
  if (!err) return undefined;
  if (err instanceof ApiError) return `${err.code}: ${err.message}`;
  if (err instanceof Error) return err.message;
  return String(err);
}

export function AdminDashboard() {
  const { logout } = useAuth();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('monitors');
  const [modal, setModal] = useState<ModalState>({ type: 'none' });
  const [testingMonitorId, setTestingMonitorId] = useState<number | null>(null);
  const [testingChannelId, setTestingChannelId] = useState<number | null>(null);

  const monitorsQuery = useQuery({ queryKey: ['admin-monitors'], queryFn: () => fetchAdminMonitors() });
  const channelsQuery = useQuery({ queryKey: ['admin-channels'], queryFn: () => fetchNotificationChannels() });
  const incidentsQuery = useQuery({ queryKey: ['admin-incidents'], queryFn: () => fetchAdminIncidents() });
  const maintenanceQuery = useQuery({ queryKey: ['admin-maintenance-windows'], queryFn: () => fetchMaintenanceWindows() });

  const invalidate = (key: string) => queryClient.invalidateQueries({ queryKey: [key] });
  const closeModal = () => setModal({ type: 'none' });

  const createMonitorMut = useMutation({ mutationFn: createMonitor, onSuccess: () => { invalidate('admin-monitors'); closeModal(); } });
  const updateMonitorMut = useMutation({ mutationFn: ({ id, data }: { id: number; data: Parameters<typeof updateMonitor>[1] }) => updateMonitor(id, data), onSuccess: () => { invalidate('admin-monitors'); closeModal(); } });
  const deleteMonitorMut = useMutation({ mutationFn: deleteMonitor, onSuccess: () => invalidate('admin-monitors') });
  const testMonitorMut = useMutation({ mutationFn: testMonitor, onSettled: () => setTestingMonitorId(null) });

  const createChannelMut = useMutation({ mutationFn: createNotificationChannel, onSuccess: () => { invalidate('admin-channels'); closeModal(); } });
  const updateChannelMut = useMutation({ mutationFn: ({ id, data }: { id: number; data: Parameters<typeof updateNotificationChannel>[1] }) => updateNotificationChannel(id, data), onSuccess: () => { invalidate('admin-channels'); closeModal(); } });
  const testChannelMut = useMutation({ mutationFn: testNotificationChannel, onSettled: () => setTestingChannelId(null) });

  const createIncidentMut = useMutation({ mutationFn: createIncident, onSuccess: () => { invalidate('admin-incidents'); closeModal(); } });
  const addIncidentUpdateMut = useMutation({ mutationFn: ({ id, data }: { id: number; data: Parameters<typeof addIncidentUpdate>[1] }) => addIncidentUpdate(id, data), onSuccess: () => { invalidate('admin-incidents'); closeModal(); } });
  const resolveIncidentMut = useMutation({ mutationFn: ({ id, data }: { id: number; data: Parameters<typeof resolveIncident>[1] }) => resolveIncident(id, data), onSuccess: () => { invalidate('admin-incidents'); closeModal(); } });
  const deleteIncidentMut = useMutation({ mutationFn: deleteIncident, onSuccess: () => invalidate('admin-incidents') });

  const createMaintenanceMut = useMutation({ mutationFn: createMaintenanceWindow, onSuccess: () => { invalidate('admin-maintenance-windows'); closeModal(); } });
  const updateMaintenanceMut = useMutation({ mutationFn: ({ id, data }: { id: number; data: Parameters<typeof updateMaintenanceWindow>[1] }) => updateMaintenanceWindow(id, data), onSuccess: () => { invalidate('admin-maintenance-windows'); closeModal(); } });
  const deleteMaintenanceMut = useMutation({ mutationFn: deleteMaintenanceWindow, onSuccess: () => invalidate('admin-maintenance-windows') });

  const monitorNameById = new Map((monitorsQuery.data?.monitors ?? []).map((m) => [m.id, m.name] as const));

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <header className="bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex justify-between items-center">
          <h1 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100">Admin Dashboard</h1>
          <div className="flex items-center gap-2 sm:gap-4">
            <ThemeToggle />
            <Link to="/admin/analytics" className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition-colors px-2 py-1.5 rounded-lg active:bg-slate-100 dark:active:bg-slate-700">Analytics</Link>
            <Link to="/" className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition-colors px-2 py-1.5 rounded-lg active:bg-slate-100 dark:active:bg-slate-700">Status</Link>
            <button onClick={logout} className="text-sm text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-colors px-2 py-1.5 rounded-lg active:bg-red-50 dark:active:bg-red-900/20">Logout</button>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-4 sm:pt-6">
        <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg overflow-x-auto scrollbar-hide">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 rounded-md text-sm font-medium transition-all whitespace-nowrap ${tab === t.key ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'}`}
            >
              <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={t.icon} /></svg>
              <span className="hidden xs:inline sm:inline">{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-4 sm:py-6">
        {tab === 'monitors' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Monitors</h2>
              <Button onClick={() => { createMonitorMut.reset(); updateMonitorMut.reset(); setModal({ type: 'create-monitor' }); }}>Add Monitor</Button>
            </div>
            {monitorsQuery.isLoading ? (
              <div className="text-slate-500 dark:text-slate-400">Loading...</div>
            ) : monitorsQuery.isError ? (
              <Card className="p-8 text-center">
                <div className="text-red-600 dark:text-red-400 font-medium mb-2">Failed to load monitors</div>
                <div className="text-sm text-slate-500 dark:text-slate-400">{formatError(monitorsQuery.error) ?? 'Unknown error'}</div>
              </Card>
            ) : !monitorsQuery.data?.monitors.length ? (
              <Card className="p-6 sm:p-8 text-center text-slate-500 dark:text-slate-400">No monitors yet</Card>
            ) : (
              <Card className="overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[600px]">
                    <thead className="bg-slate-50 dark:bg-slate-700/50 border-b border-slate-100 dark:border-slate-700">
                      <tr>
                        <th className="px-3 sm:px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Name</th>
                        <th className="px-3 sm:px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Type</th>
                        <th className="px-3 sm:px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Target</th>
                        <th className="px-3 sm:px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Status</th>
                        <th className="px-3 sm:px-4 py-3 text-right text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                      {monitorsQuery.data.monitors.map((m) => (
                        <tr key={m.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                          <td className="px-3 sm:px-4 py-3 text-sm font-medium text-slate-900 dark:text-slate-100">{m.name}</td>
                          <td className="px-3 sm:px-4 py-3"><Badge variant="info">{m.type}</Badge></td>
                          <td className="px-3 sm:px-4 py-3 text-sm text-slate-500 dark:text-slate-400 truncate max-w-[200px]">{m.target}</td>
                          <td className="px-3 sm:px-4 py-3"><Badge variant={m.is_active ? 'up' : 'unknown'}>{m.is_active ? 'Active' : 'Paused'}</Badge></td>
                          <td className="px-3 sm:px-4 py-3 text-right whitespace-nowrap">
                            <button onClick={() => { setTestingMonitorId(m.id); testMonitorMut.mutate(m.id); }} disabled={testingMonitorId === m.id} className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 disabled:opacity-50 px-1.5 py-1">{testingMonitorId === m.id ? 'Testing...' : 'Test'}</button>
                            <button onClick={() => { createMonitorMut.reset(); updateMonitorMut.reset(); setModal({ type: 'edit-monitor', monitor: m }); }} className="text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 px-1.5 py-1">Edit</button>
                            <button onClick={() => confirm('Delete?') && deleteMonitorMut.mutate(m.id)} className="text-sm text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 px-1.5 py-1">Delete</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </div>
        )}

        {tab === 'notifications' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Notification Channels</h2>
              <Button onClick={() => setModal({ type: 'create-channel' })}>Add Channel</Button>
            </div>
            {channelsQuery.isLoading ? (
              <div className="text-slate-500 dark:text-slate-400">Loading...</div>
            ) : !channelsQuery.data?.notification_channels.length ? (
              <Card className="p-6 sm:p-8 text-center text-slate-500 dark:text-slate-400">No channels yet</Card>
            ) : (
              <Card className="overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[500px]">
                    <thead className="bg-slate-50 dark:bg-slate-700/50 border-b border-slate-100 dark:border-slate-700">
                      <tr>
                        <th className="px-3 sm:px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Name</th>
                        <th className="px-3 sm:px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Type</th>
                        <th className="px-3 sm:px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">URL</th>
                        <th className="px-3 sm:px-4 py-3 text-right text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                      {channelsQuery.data.notification_channels.map((ch) => (
                        <tr key={ch.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                          <td className="px-3 sm:px-4 py-3 text-sm font-medium text-slate-900 dark:text-slate-100">{ch.name}</td>
                          <td className="px-3 sm:px-4 py-3"><Badge variant="info">{ch.type}</Badge></td>
                          <td className="px-3 sm:px-4 py-3 text-sm text-slate-500 dark:text-slate-400 truncate max-w-[200px]">{ch.config_json.url}</td>
                          <td className="px-3 sm:px-4 py-3 text-right whitespace-nowrap">
                            <button onClick={() => { setTestingChannelId(ch.id); testChannelMut.mutate(ch.id); }} disabled={testingChannelId === ch.id} className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 disabled:opacity-50 px-1.5 py-1">{testingChannelId === ch.id ? 'Testing...' : 'Test'}</button>
                            <button onClick={() => setModal({ type: 'edit-channel', channel: ch })} className="text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 px-1.5 py-1">Edit</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </div>
        )}

        {tab === 'incidents' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Incidents</h2>
              <Button onClick={() => setModal({ type: 'create-incident' })}>Create Incident</Button>
            </div>
            {incidentsQuery.isLoading ? (
              <div className="text-slate-500 dark:text-slate-400">Loading...</div>
            ) : !incidentsQuery.data?.incidents.length ? (
              <Card className="p-6 sm:p-8 text-center text-slate-500 dark:text-slate-400">No incidents yet</Card>
            ) : (
              <Card className="overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[600px]">
                    <thead className="bg-slate-50 dark:bg-slate-700/50 border-b border-slate-100 dark:border-slate-700">
                      <tr>
                        <th className="px-3 sm:px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Title</th>
                        <th className="px-3 sm:px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Monitors</th>
                        <th className="px-3 sm:px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Status</th>
                        <th className="px-3 sm:px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Impact</th>
                        <th className="px-3 sm:px-4 py-3 text-right text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                      {incidentsQuery.data.incidents.map((it) => (
                        <tr key={it.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                          <td className="px-3 sm:px-4 py-3 text-sm font-medium text-slate-900 dark:text-slate-100">{it.title}</td>
                          <td className="px-3 sm:px-4 py-3 text-sm text-slate-500 dark:text-slate-400 truncate max-w-[150px]">{it.monitor_ids.map((id) => monitorNameById.get(id) ?? `#${id}`).join(', ')}</td>
                          <td className="px-3 sm:px-4 py-3"><Badge variant={it.status === 'resolved' ? 'up' : 'paused'}>{it.status}</Badge></td>
                          <td className="px-3 sm:px-4 py-3"><Badge variant={it.impact === 'critical' ? 'down' : it.impact === 'major' ? 'down' : 'paused'}>{it.impact}</Badge></td>
                          <td className="px-3 sm:px-4 py-3 text-right whitespace-nowrap">
                            <button onClick={() => setModal({ type: 'add-incident-update', incident: it })} disabled={it.status === 'resolved'} className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 disabled:opacity-50 px-1.5 py-1">Update</button>
                            <button onClick={() => setModal({ type: 'resolve-incident', incident: it })} disabled={it.status === 'resolved'} className="text-sm text-emerald-600 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300 disabled:opacity-50 px-1.5 py-1">Resolve</button>
                            <button onClick={() => confirm(`Delete "${it.title}"?`) && deleteIncidentMut.mutate(it.id)} className="text-sm text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 px-1.5 py-1">Delete</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </div>
        )}

        {tab === 'maintenance' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Maintenance Windows</h2>
              <Button onClick={() => setModal({ type: 'create-maintenance' })}>Create Window</Button>
            </div>
            {maintenanceQuery.isLoading ? (
              <div className="text-slate-500 dark:text-slate-400">Loading...</div>
            ) : !maintenanceQuery.data?.maintenance_windows.length ? (
              <Card className="p-6 sm:p-8 text-center text-slate-500 dark:text-slate-400">No maintenance windows yet</Card>
            ) : (
              <Card className="overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[650px]">
                    <thead className="bg-slate-50 dark:bg-slate-700/50 border-b border-slate-100 dark:border-slate-700">
                      <tr>
                        <th className="px-3 sm:px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Title</th>
                        <th className="px-3 sm:px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Monitors</th>
                        <th className="px-3 sm:px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Schedule</th>
                        <th className="px-3 sm:px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">State</th>
                        <th className="px-3 sm:px-4 py-3 text-right text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                      {maintenanceQuery.data.maintenance_windows.map((w) => {
                        const now = Math.floor(Date.now() / 1000);
                        const state = w.starts_at <= now && w.ends_at > now ? 'Active' : w.starts_at > now ? 'Upcoming' : 'Ended';
                        return (
                          <tr key={w.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                            <td className="px-3 sm:px-4 py-3 text-sm font-medium text-slate-900 dark:text-slate-100">{w.title}</td>
                            <td className="px-3 sm:px-4 py-3 text-sm text-slate-500 dark:text-slate-400 truncate max-w-[120px]">{w.monitor_ids.map((id) => monitorNameById.get(id) ?? `#${id}`).join(', ')}</td>
                            <td className="px-3 sm:px-4 py-3 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">{new Date(w.starts_at * 1000).toLocaleString()} – {new Date(w.ends_at * 1000).toLocaleString()}</td>
                            <td className="px-3 sm:px-4 py-3"><Badge variant={state === 'Active' ? 'maintenance' : state === 'Upcoming' ? 'paused' : 'unknown'}>{state}</Badge></td>
                            <td className="px-3 sm:px-4 py-3 text-right whitespace-nowrap">
                              <button onClick={() => setModal({ type: 'edit-maintenance', window: w })} className="text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 px-1.5 py-1">Edit</button>
                              <button onClick={() => confirm(`Delete "${w.title}"?`) && deleteMaintenanceMut.mutate(w.id)} className="text-sm text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 px-1.5 py-1">Delete</button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </div>
        )}
      </main>

      {modal.type !== 'none' && (
        <div className="fixed inset-0 bg-slate-900/60 dark:bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 z-50 animate-fade-in">
          <div className="bg-white dark:bg-slate-800 rounded-t-2xl sm:rounded-2xl shadow-soft-lg w-full sm:max-w-md p-5 sm:p-6 max-h-[90vh] overflow-y-auto animate-slide-up">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-5">
              {modal.type === 'create-monitor' && 'Create Monitor'}
              {modal.type === 'edit-monitor' && 'Edit Monitor'}
              {modal.type === 'create-channel' && 'Create Channel'}
              {modal.type === 'edit-channel' && 'Edit Channel'}
              {modal.type === 'create-incident' && 'Create Incident'}
              {modal.type === 'add-incident-update' && 'Post Update'}
              {modal.type === 'resolve-incident' && 'Resolve Incident'}
              {modal.type === 'create-maintenance' && 'Create Maintenance'}
              {modal.type === 'edit-maintenance' && 'Edit Maintenance'}
            </h2>

            {(modal.type === 'create-monitor' || modal.type === 'edit-monitor') && (
              <MonitorForm
                monitor={modal.type === 'edit-monitor' ? modal.monitor : undefined}
                onSubmit={(data) =>
                  modal.type === 'edit-monitor'
                    ? updateMonitorMut.mutate({ id: modal.monitor.id, data })
                    : createMonitorMut.mutate(data)
                }
                onCancel={closeModal}
                isLoading={createMonitorMut.isPending || updateMonitorMut.isPending}
                error={modal.type === 'create-monitor' ? formatError(createMonitorMut.error) : formatError(updateMonitorMut.error)}
              />
            )}
            {(modal.type === 'create-channel' || modal.type === 'edit-channel') && (
              <NotificationChannelForm channel={modal.type === 'edit-channel' ? modal.channel : undefined} onSubmit={(data) => modal.type === 'edit-channel' ? updateChannelMut.mutate({ id: modal.channel.id, data }) : createChannelMut.mutate(data)} onCancel={closeModal} isLoading={createChannelMut.isPending || updateChannelMut.isPending} />
            )}
            {modal.type === 'create-incident' && (
              <IncidentForm monitors={(monitorsQuery.data?.monitors ?? []).map((m) => ({ id: m.id, name: m.name }))} onSubmit={(data) => createIncidentMut.mutate(data)} onCancel={closeModal} isLoading={createIncidentMut.isPending} />
            )}
            {modal.type === 'add-incident-update' && (
              <IncidentUpdateForm onSubmit={(data) => addIncidentUpdateMut.mutate({ id: modal.incident.id, data })} onCancel={closeModal} isLoading={addIncidentUpdateMut.isPending} />
            )}
            {modal.type === 'resolve-incident' && (
              <ResolveIncidentForm onSubmit={(data) => resolveIncidentMut.mutate({ id: modal.incident.id, data })} onCancel={closeModal} isLoading={resolveIncidentMut.isPending} />
            )}
            {modal.type === 'create-maintenance' && (
              <MaintenanceWindowForm monitors={(monitorsQuery.data?.monitors ?? []).map((m) => ({ id: m.id, name: m.name }))} onSubmit={(data) => createMaintenanceMut.mutate(data)} onCancel={closeModal} isLoading={createMaintenanceMut.isPending} />
            )}
            {modal.type === 'edit-maintenance' && (
              <MaintenanceWindowForm monitors={(monitorsQuery.data?.monitors ?? []).map((m) => ({ id: m.id, name: m.name }))} window={modal.window} onSubmit={(data) => updateMaintenanceMut.mutate({ id: modal.window.id, data })} onCancel={closeModal} isLoading={updateMaintenanceMut.isPending} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
