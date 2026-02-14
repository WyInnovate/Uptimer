import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { useAuth } from '../app/AuthContext';
import { ADMIN_ANALYTICS_PATH } from '../app/adminPaths';
import {
  ApiError,
  fetchAdminMonitors,
  createMonitor,
  updateMonitor,
  deleteMonitor,
  testMonitor,
  pauseMonitor,
  resumeMonitor,
  fetchNotificationChannels,
  createNotificationChannel,
  updateNotificationChannel,
  testNotificationChannel,
  deleteNotificationChannel,
  fetchAdminIncidents,
  createIncident,
  addIncidentUpdate,
  resolveIncident,
  deleteIncident,
  fetchMaintenanceWindows,
  createMaintenanceWindow,
  updateMaintenanceWindow,
  deleteMaintenanceWindow,
  fetchAdminSettings,
  patchAdminSettings,
} from '../api/client';
import type {
  AdminMonitor,
  AdminSettings,
  Incident,
  MaintenanceWindow,
  NotificationChannel,
  StatusResponse,
} from '../api/types';
import { IncidentForm } from '../components/IncidentForm';
import { IncidentUpdateForm } from '../components/IncidentUpdateForm';
import { MaintenanceWindowForm } from '../components/MaintenanceWindowForm';
import { MonitorForm } from '../components/MonitorForm';
import { NotificationChannelForm } from '../components/NotificationChannelForm';
import { ResolveIncidentForm } from '../components/ResolveIncidentForm';
import {
  Badge,
  Button,
  Card,
  MODAL_OVERLAY_CLASS,
  MODAL_PANEL_CLASS,
  TABLE_ACTION_BUTTON_CLASS,
  ThemeToggle,
  cn,
} from '../components/ui';
import { formatDateTime } from '../utils/datetime';

type Tab = 'monitors' | 'notifications' | 'incidents' | 'maintenance' | 'settings';

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


type MonitorTestFeedback = {
  at: number;
  monitor: Awaited<ReturnType<typeof testMonitor>>['monitor'];
  result: Awaited<ReturnType<typeof testMonitor>>['result'];
};

type MonitorTestErrorState = {
  monitorId: number;
  at: number;
  message: string;
};

type ChannelTestFeedback = {
  at: number;
  channelId: number;
  eventKey: Awaited<ReturnType<typeof testNotificationChannel>>['event_key'];
  delivery: Awaited<ReturnType<typeof testNotificationChannel>>['delivery'];
};

type ChannelTestErrorState = {
  channelId: number;
  at: number;
  message: string;
};

const navActionClass =
  'flex items-center justify-center h-10 rounded-lg px-3 text-base transition-colors';

const tabContainerClass =
  'flex gap-1 rounded-xl border border-slate-200/70 bg-white/80 p-1 shadow-sm dark:border-slate-700 dark:bg-slate-800/80';

const SETTINGS_ICON_PATH =
  'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z';

const tabs: { key: Tab; label: string; icon: string }[] = [
  {
    key: 'monitors',
    label: 'Monitors',
    icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
  },
  {
    key: 'notifications',
    label: 'Notifications',
    icon: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9',
  },
  {
    key: 'incidents',
    label: 'Incidents',
    icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z',
  },
  {
    key: 'settings',
    label: 'Settings',
    icon: SETTINGS_ICON_PATH,
  },
  {
    key: 'maintenance',
    label: 'Maintenance',
    icon: 'M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z',
  },
];

function formatError(err: unknown): string | undefined {
  if (!err) return undefined;
  if (err instanceof ApiError) return `${err.code}: ${err.message}`;
  if (err instanceof Error) return err.message;
  return String(err);
}

function sanitizeSiteTitle(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) return 'Uptimer';
  return trimmed.slice(0, 100);
}

function sanitizeSiteDescription(value: string): string {
  return value.trim().slice(0, 500);
}

function clampInt(value: number, min: number, max: number): number {
  const n = Math.trunc(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

export function AdminDashboard() {
  const { logout } = useAuth();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('monitors');
  const [modal, setModal] = useState<ModalState>({ type: 'none' });
  const [testingMonitorId, setTestingMonitorId] = useState<number | null>(null);
  const [testingChannelId, setTestingChannelId] = useState<number | null>(null);
  const [monitorTestFeedback, setMonitorTestFeedback] = useState<MonitorTestFeedback | null>(null);
  const [monitorTestError, setMonitorTestError] = useState<MonitorTestErrorState | null>(null);
  const [channelTestFeedback, setChannelTestFeedback] = useState<ChannelTestFeedback | null>(null);
  const [channelTestError, setChannelTestError] = useState<ChannelTestErrorState | null>(null);

  const monitorsQuery = useQuery({ queryKey: ['admin-monitors'], queryFn: () => fetchAdminMonitors() });
  const channelsQuery = useQuery({ queryKey: ['admin-channels'], queryFn: () => fetchNotificationChannels() });
  const incidentsQuery = useQuery({ queryKey: ['admin-incidents'], queryFn: () => fetchAdminIncidents() });
  const maintenanceQuery = useQuery({ queryKey: ['admin-maintenance-windows'], queryFn: () => fetchMaintenanceWindows() });

  const settingsQuery = useQuery({
    queryKey: ['admin-settings'],
    queryFn: fetchAdminSettings,
  });

  const settings = settingsQuery.data?.settings;

  const [settingsDraft, setSettingsDraft] = useState<AdminSettings | null>(null);
  const [focusedSetting, setFocusedSetting] = useState<keyof AdminSettings | null>(null);

  useEffect(() => {
    if (!settings) return;

    // Keep draft in sync with server, but don't clobber the field the user is currently editing.
    setSettingsDraft((prev) => {
      if (!prev) return settings;
      if (!focusedSetting) return settings;
      return { ...settings, [focusedSetting]: prev[focusedSetting] };
    });
  }, [settings, focusedSetting]);

  const patchSettingsMut = useMutation({
    mutationFn: (patch: Partial<AdminSettings>) => patchAdminSettings(patch),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: ['admin-settings'] });
      await queryClient.cancelQueries({ queryKey: ['status'] });

      const prevSettings = queryClient.getQueryData<{ settings: AdminSettings }>(['admin-settings']);
      const prevStatus = queryClient.getQueryData<StatusResponse>(['status']);

      if (prevSettings) {
        queryClient.setQueryData<{ settings: AdminSettings }>(['admin-settings'], {
          settings: { ...prevSettings.settings, ...patch },
        });
      }

      // Keep status page data in sync for fields used there (title + uptime rating).
      if (prevStatus) {
        const nextSiteTitle = typeof patch.site_title === 'string' ? patch.site_title : undefined;
        const nextRating = patch.uptime_rating_level as 1 | 2 | 3 | 4 | 5 | undefined;

        queryClient.setQueryData<StatusResponse>(['status'], {
          ...prevStatus,
          ...(nextSiteTitle ? { site_title: nextSiteTitle } : {}),
          ...(nextRating
            ? {
                uptime_rating_level: nextRating,
                monitors: prevStatus.monitors.map((m) => ({ ...m, uptime_rating_level: nextRating })),
              }
            : {}),
        });
      }

      return { prevSettings, prevStatus };
    },
    onError: (_err, _patch, ctx) => {
      const prevSettings = (ctx as { prevSettings?: { settings: AdminSettings } } | undefined)?.prevSettings;
      const prevStatus = (ctx as { prevStatus?: StatusResponse } | undefined)?.prevStatus;

      if (prevSettings) queryClient.setQueryData(['admin-settings'], prevSettings);
      if (prevStatus) queryClient.setQueryData(['status'], prevStatus);
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['admin-settings'], data);

      setSettingsDraft(data.settings);

      // Update status query cache so StatusPage header updates instantly.
      const title = data.settings.site_title;
      const level = data.settings.uptime_rating_level;
      queryClient.setQueryData<StatusResponse>(['status'], (old) =>
        old
          ? {
              ...old,
              site_title: title,
              uptime_rating_level: level,
              monitors: old.monitors.map((m) => ({ ...m, uptime_rating_level: level })),
            }
          : old,
      );
    },
  });

  const closeModal = () => setModal({ type: 'none' });

  const createMonitorMut = useMutation({
    mutationFn: createMonitor,
    onSuccess: (data) => {
      queryClient.setQueryData(['admin-monitors'], (old: { monitors: AdminMonitor[] } | undefined) => ({
        monitors: [...(old?.monitors ?? []), data.monitor].sort((a, b) => a.id - b.id),
      }));
      closeModal();
    },
  });
  const updateMonitorMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof updateMonitor>[1] }) => updateMonitor(id, data),
    onSuccess: (data) => {
      queryClient.setQueryData(['admin-monitors'], (old: { monitors: AdminMonitor[] } | undefined) => ({
        monitors: (old?.monitors ?? []).map((m) => (m.id === data.monitor.id ? data.monitor : m)),
      }));
      closeModal();
    },
  });
  const deleteMonitorMut = useMutation({
    mutationFn: deleteMonitor,
    onSuccess: (_data, id) => {
      queryClient.setQueryData(['admin-monitors'], (old: { monitors: AdminMonitor[] } | undefined) => ({
        monitors: (old?.monitors ?? []).filter((m) => m.id !== id),
      }));
    },
  });

  const pauseMonitorMut = useMutation({
    mutationFn: pauseMonitor,
    onSuccess: (data) => {
      queryClient.setQueryData(['admin-monitors'], (old: { monitors: AdminMonitor[] } | undefined) => ({
        monitors: (old?.monitors ?? []).map((m) => (m.id === data.monitor.id ? data.monitor : m)),
      }));
    },
  });

  const resumeMonitorMut = useMutation({
    mutationFn: resumeMonitor,
    onSuccess: (data) => {
      queryClient.setQueryData(['admin-monitors'], (old: { monitors: AdminMonitor[] } | undefined) => ({
        monitors: (old?.monitors ?? []).map((m) => (m.id === data.monitor.id ? data.monitor : m)),
      }));
    },
  });

  const testMonitorMut = useMutation({
    mutationFn: testMonitor,
    onSuccess: (data) => {
      setMonitorTestFeedback({ at: Math.floor(Date.now() / 1000), monitor: data.monitor, result: data.result });
      setMonitorTestError(null);
    },
    onError: (err, monitorId) => {
      setMonitorTestError({
        monitorId,
        at: Math.floor(Date.now() / 1000),
        message: formatError(err) ?? 'Failed to run monitor test',
      });
      setMonitorTestFeedback(null);
    },
    onSettled: () => setTestingMonitorId(null),
  });

  const createChannelMut = useMutation({
    mutationFn: createNotificationChannel,
    onSuccess: (data) => {
      queryClient.setQueryData(['admin-channels'], (old: { notification_channels: NotificationChannel[] } | undefined) => ({
        notification_channels: [...(old?.notification_channels ?? []), data.notification_channel].sort((a, b) => a.id - b.id),
      }));
      closeModal();
    },
  });
  const updateChannelMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof updateNotificationChannel>[1] }) =>
      updateNotificationChannel(id, data),
    onSuccess: (data) => {
      queryClient.setQueryData(['admin-channels'], (old: { notification_channels: NotificationChannel[] } | undefined) => ({
        notification_channels: (old?.notification_channels ?? []).map((ch) =>
          ch.id === data.notification_channel.id ? data.notification_channel : ch,
        ),
      }));
      closeModal();
    },
  });
  const testChannelMut = useMutation({
    mutationFn: testNotificationChannel,
    onSuccess: (data, channelId) => {
      setChannelTestFeedback({
        at: Math.floor(Date.now() / 1000),
        channelId,
        eventKey: data.event_key,
        delivery: data.delivery,
      });
      setChannelTestError(null);
    },
    onError: (err, channelId) => {
      setChannelTestError({
        channelId,
        at: Math.floor(Date.now() / 1000),
        message: formatError(err) ?? 'Failed to run webhook test',
      });
      setChannelTestFeedback(null);
    },
    onSettled: () => setTestingChannelId(null),
  });

  const deleteChannelMut = useMutation({
    mutationFn: deleteNotificationChannel,
    onSuccess: (_data, id) => {
      queryClient.setQueryData(['admin-channels'], (old: { notification_channels: NotificationChannel[] } | undefined) => ({
        notification_channels: (old?.notification_channels ?? []).filter((ch) => ch.id !== id),
      }));
    },
  });

  const createIncidentMut = useMutation({
    mutationFn: createIncident,
    onSuccess: (data) => {
      queryClient.setQueryData(['admin-incidents'], (old: { incidents: Incident[] } | undefined) => ({
        incidents: [data.incident, ...(old?.incidents ?? [])],
      }));
      closeModal();
    },
  });
  const addIncidentUpdateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof addIncidentUpdate>[1] }) => addIncidentUpdate(id, data),
    onSuccess: (data) => {
      queryClient.setQueryData(['admin-incidents'], (old: { incidents: Incident[] } | undefined) => ({
        incidents: (old?.incidents ?? []).map((it) => (it.id === data.incident.id ? data.incident : it)),
      }));
      closeModal();
    },
  });
  const resolveIncidentMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof resolveIncident>[1] }) => resolveIncident(id, data),
    onSuccess: (data) => {
      queryClient.setQueryData(['admin-incidents'], (old: { incidents: Incident[] } | undefined) => ({
        incidents: (old?.incidents ?? []).map((it) => (it.id === data.incident.id ? data.incident : it)),
      }));
      closeModal();
    },
  });
  const deleteIncidentMut = useMutation({
    mutationFn: deleteIncident,
    onSuccess: (_data, id) => {
      queryClient.setQueryData(['admin-incidents'], (old: { incidents: Incident[] } | undefined) => ({
        incidents: (old?.incidents ?? []).filter((it) => it.id !== id),
      }));
    },
  });

  const createMaintenanceMut = useMutation({
    mutationFn: createMaintenanceWindow,
    onSuccess: (data) => {
      queryClient.setQueryData(['admin-maintenance-windows'], (old: { maintenance_windows: MaintenanceWindow[] } | undefined) => ({
        maintenance_windows: [data.maintenance_window, ...(old?.maintenance_windows ?? [])],
      }));
      closeModal();
    },
  });
  const updateMaintenanceMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof updateMaintenanceWindow>[1] }) =>
      updateMaintenanceWindow(id, data),
    onSuccess: (data) => {
      queryClient.setQueryData(['admin-maintenance-windows'], (old: { maintenance_windows: MaintenanceWindow[] } | undefined) => ({
        maintenance_windows: (old?.maintenance_windows ?? []).map((w) =>
          w.id === data.maintenance_window.id ? data.maintenance_window : w,
        ),
      }));
      closeModal();
    },
  });
  const deleteMaintenanceMut = useMutation({
    mutationFn: deleteMaintenanceWindow,
    onSuccess: (_data, id) => {
      queryClient.setQueryData(['admin-maintenance-windows'], (old: { maintenance_windows: MaintenanceWindow[] } | undefined) => ({
        maintenance_windows: (old?.maintenance_windows ?? []).filter((w) => w.id !== id),
      }));
    },
  });

  const monitorNameById = useMemo(
    () => new Map((monitorsQuery.data?.monitors ?? []).map((m) => [m.id, m.name] as const)),
    [monitorsQuery.data?.monitors],
  );

  const channelNameById = useMemo(
    () => new Map((channelsQuery.data?.notification_channels ?? []).map((ch) => [ch.id, ch.name] as const)),
    [channelsQuery.data?.notification_channels],
  );

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <header className="bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700">
        <div className="mx-auto max-w-[92rem] px-4 py-3 sm:px-6 sm:py-4 lg:px-8 flex justify-between items-center">
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100">Admin Dashboard</h1>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <Link
              to={ADMIN_ANALYTICS_PATH}
              className={cn(navActionClass, 'text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100')}
            >
              <svg className="w-5 h-5 sm:hidden" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                />
              </svg>
              <span className="hidden sm:inline">Analytics</span>
            </Link>
            <Link
              to="/"
              className={cn(navActionClass, 'text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100')}
            >
              <svg className="w-5 h-5 sm:hidden" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <span className="hidden sm:inline">Status</span>
            </Link>
            <button
              onClick={logout}
              className={cn(navActionClass, 'text-red-500 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-900/20 dark:hover:text-red-300')}
            >
              <svg className="w-5 h-5 sm:hidden" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                />
              </svg>
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[92rem] px-4 pt-4 sm:px-6 sm:pt-6 lg:px-8">
        <div className={`${tabContainerClass} overflow-x-auto scrollbar-hide`}>
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              aria-label={t.label}
              title={t.label}
              className={cn(
                'flex items-center gap-1.5 rounded-lg px-3 py-2 text-base font-medium transition-all sm:gap-2 sm:px-4 whitespace-nowrap',
                tab === t.key
                  ? 'bg-slate-900 text-white shadow-sm dark:bg-slate-100 dark:text-slate-900'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200',
              )}
            >
              <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={t.icon} />
              </svg>
              <span className="hidden sm:inline">{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      <main className="mx-auto max-w-[92rem] px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
        {tab === 'monitors' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Monitors</h2>
              <Button onClick={() => setModal({ type: 'create-monitor' })}>Add Monitor</Button>
            </div>
            {testingMonitorId !== null && (
              <Card className="p-3 border-blue-200 bg-blue-50/70 dark:bg-blue-500/10 dark:border-blue-400/30">
                <div className="text-sm text-blue-700 dark:text-blue-300">
                  Running test for{' '}
                  <span className="font-medium">{monitorNameById.get(testingMonitorId) ?? `#${testingMonitorId}`}</span>
                  ...
                </div>
              </Card>
            )}

            {monitorTestFeedback && (
              <Card className="p-3 border-slate-200 dark:border-slate-600">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                    Last test: {monitorTestFeedback.monitor.name}
                  </div>
                  <Badge
                    variant={
                      monitorTestFeedback.result.status === 'up'
                        ? 'up'
                        : monitorTestFeedback.result.status === 'down'
                          ? 'down'
                          : monitorTestFeedback.result.status === 'maintenance'
                            ? 'maintenance'
                            : 'unknown'
                    }
                  >
                    {monitorTestFeedback.result.status}
                  </Badge>
                </div>
                <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {formatDateTime(monitorTestFeedback.at, settings?.site_timezone)}
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
                  <span>Attempts: {monitorTestFeedback.result.attempts}</span>
                  <span>
                    HTTP: {monitorTestFeedback.result.http_status !== null ? monitorTestFeedback.result.http_status : '-'}
                  </span>
                  <span>
                    Latency: {monitorTestFeedback.result.latency_ms !== null ? `${monitorTestFeedback.result.latency_ms}ms` : '-'}
                  </span>
                </div>
                <div
                  className={`mt-2 text-sm ${
                    monitorTestFeedback.result.error
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-emerald-700 dark:text-emerald-400'
                  }`}
                >
                  {monitorTestFeedback.result.error ?? 'No error returned'}
                </div>
              </Card>
            )}

            {monitorTestError && (
              <Card className="p-3 border-red-200 bg-red-50/70 dark:bg-red-500/10 dark:border-red-400/30">
                <div className="text-sm font-medium text-red-700 dark:text-red-300">
                  Monitor test failed: {monitorNameById.get(monitorTestError.monitorId) ?? `#${monitorTestError.monitorId}`}
                </div>
                <div className="mt-1 text-xs text-red-600 dark:text-red-400">
                  {formatDateTime(monitorTestError.at, settings?.site_timezone)}
                </div>
                <div className="mt-1 text-sm text-red-700 dark:text-red-300">{monitorTestError.message}</div>
              </Card>
            )}

            {monitorsQuery.isLoading ? (
              <div className="text-slate-500 dark:text-slate-400">Loading...</div>
            ) : !monitorsQuery.data?.monitors.length ? (
              <Card className="p-6 sm:p-8 text-center text-slate-500 dark:text-slate-400">No monitors yet</Card>
            ) : (
              <Card className="overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px]">
                    <thead className="bg-slate-50 dark:bg-slate-700/50 border-b border-slate-100 dark:border-slate-700">
                      <tr>
                        <th className="px-3 sm:px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Name</th>
                        <th className="px-3 sm:px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Type</th>
                        <th className="px-3 sm:px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Target</th>
                        <th className="px-3 sm:px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Status</th>
                        <th className="px-3 sm:px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Last Check</th>
                        <th className="px-3 sm:px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Last Error</th>
                        <th className="px-3 sm:px-4 py-3 text-right text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                      {monitorsQuery.data.monitors.map((m) => (
                        <tr key={m.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                          <td className="px-3 sm:px-4 py-3 text-sm font-medium text-slate-900 dark:text-slate-100">{m.name}</td>
                          <td className="px-3 sm:px-4 py-3">
                            <Badge variant="info">{m.type}</Badge>
                          </td>
                          <td className="px-3 sm:px-4 py-3 text-sm text-slate-500 dark:text-slate-400 truncate max-w-[200px]">{m.target}</td>
                          <td className="px-3 sm:px-4 py-3">
                            <div className="flex items-center gap-2">
                              <Badge
                                variant={
                                  m.status === 'up'
                                    ? 'up'
                                    : m.status === 'down'
                                      ? 'down'
                                      : m.status === 'maintenance'
                                        ? 'maintenance'
                                        : m.status === 'paused'
                                          ? 'paused'
                                          : 'unknown'
                                }
                              >
                                {m.status}
                              </Badge>
                              {!m.is_active && <Badge variant="unknown">inactive</Badge>}
                            </div>
                          </td>
                          <td className="px-3 sm:px-4 py-3 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                            {m.last_checked_at ? (
                              <>
                                {formatDateTime(m.last_checked_at, settings?.site_timezone)}
                                {m.last_latency_ms !== null ? ` (${m.last_latency_ms}ms)` : ''}
                              </>
                            ) : (
                              '-'
                            )}
                          </td>
                          <td className="px-3 sm:px-4 py-3 text-xs text-slate-500 dark:text-slate-400 max-w-[260px]">
                            <span className="block truncate" title={m.last_error ?? undefined}>
                              {m.last_error ? m.last_error : '-'}
                            </span>
                          </td>
                          <td className="px-3 sm:px-4 py-3 text-right whitespace-nowrap">
                            <div className="flex items-center justify-end gap-1 sm:gap-0">
                              <button
                                onClick={() => {
                                  setTestingMonitorId(m.id);
                                  setMonitorTestFeedback(null);
                                  setMonitorTestError(null);
                                  testMonitorMut.mutate(m.id);
                                }}
                                disabled={testMonitorMut.isPending}
                                className={cn(TABLE_ACTION_BUTTON_CLASS, 'text-blue-600 hover:bg-blue-50 hover:text-blue-800 dark:text-blue-400 dark:hover:bg-blue-900/20 dark:hover:text-blue-300 disabled:opacity-50')}
                              >
                                {testingMonitorId === m.id ? 'Testing...' : 'Test'}
                              </button>
                              <button
                                onClick={() => {
                                  if (m.status === 'paused') {
                                    resumeMonitorMut.mutate(m.id);
                                  } else {
                                    pauseMonitorMut.mutate(m.id);
                                  }
                                }}
                                disabled={
                                  pauseMonitorMut.isPending ||
                                  resumeMonitorMut.isPending ||
                                  testingMonitorId === m.id
                                }
                                className={cn(TABLE_ACTION_BUTTON_CLASS, 'text-amber-700 hover:bg-amber-50 hover:text-amber-900 dark:text-amber-300 dark:hover:bg-amber-900/20 dark:hover:text-amber-200 disabled:opacity-50')}
                              >
                                {m.status === 'paused' ? 'Resume' : 'Pause'}
                              </button>
                              <button
                                onClick={() => {
                                  createMonitorMut.reset();
                                  updateMonitorMut.reset();
                                  setModal({ type: 'edit-monitor', monitor: m });
                                }}
                                className={cn(TABLE_ACTION_BUTTON_CLASS, 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200')}
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => confirm('Delete?') && deleteMonitorMut.mutate(m.id)}
                                className={cn(TABLE_ACTION_BUTTON_CLASS, 'text-red-500 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-900/20 dark:hover:text-red-300')}
                              >
                                Delete
                              </button>
                            </div>
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
              <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Notification Channels</h2>
              <Button onClick={() => setModal({ type: 'create-channel' })}>Add Channel</Button>
            </div>
            {testingChannelId !== null && (
              <Card className="p-3 border-blue-200 bg-blue-50/70 dark:bg-blue-500/10 dark:border-blue-400/30">
                <div className="text-sm text-blue-700 dark:text-blue-300">
                  Sending test webhook to{' '}
                  <span className="font-medium">{channelNameById.get(testingChannelId) ?? `#${testingChannelId}`}</span>
                  ...
                </div>
              </Card>
            )}

            {channelTestFeedback && (
              <Card className="p-3 border-slate-200 dark:border-slate-600">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                    Last webhook test: {channelNameById.get(channelTestFeedback.channelId) ?? `#${channelTestFeedback.channelId}`}
                  </div>
                  <Badge
                    variant={
                      channelTestFeedback.delivery?.status === 'success'
                        ? 'up'
                        : channelTestFeedback.delivery?.status === 'failed'
                          ? 'down'
                          : 'unknown'
                    }
                  >
                    {channelTestFeedback.delivery?.status ?? 'unknown'}
                  </Badge>
                </div>
                <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {formatDateTime(channelTestFeedback.at, settings?.site_timezone)}
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
                  <span>HTTP: {channelTestFeedback.delivery?.http_status ?? '-'}</span>
                  <span className="max-w-full truncate" title={channelTestFeedback.eventKey}>
                    Event key: {channelTestFeedback.eventKey}
                  </span>
                </div>
                <div
                  className={`mt-2 text-sm ${
                    channelTestFeedback.delivery?.status === 'success'
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-red-600 dark:text-red-400'
                  }`}
                >
                  {channelTestFeedback.delivery?.error
                    ? channelTestFeedback.delivery.error
                    : channelTestFeedback.delivery
                      ? 'Delivery recorded successfully'
                      : 'No delivery row returned by API'}
                </div>
              </Card>
            )}

            {channelTestError && (
              <Card className="p-3 border-red-200 bg-red-50/70 dark:bg-red-500/10 dark:border-red-400/30">
                <div className="text-sm font-medium text-red-700 dark:text-red-300">
                  Webhook test failed: {channelNameById.get(channelTestError.channelId) ?? `#${channelTestError.channelId}`}
                </div>
                <div className="mt-1 text-xs text-red-600 dark:text-red-400">
                  {formatDateTime(channelTestError.at, settings?.site_timezone)}
                </div>
                <div className="mt-1 text-sm text-red-700 dark:text-red-300">{channelTestError.message}</div>
              </Card>
            )}

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
                          <td className="px-3 sm:px-4 py-3">
                            <Badge variant="info">{ch.type}</Badge>
                          </td>
                          <td className="px-3 sm:px-4 py-3 text-sm text-slate-500 dark:text-slate-400 truncate max-w-[200px]">{ch.config_json.url}</td>
                          <td className="px-3 sm:px-4 py-3 text-right whitespace-nowrap">
                            <div className="flex items-center justify-end gap-1 sm:gap-0">
                              <button
                                onClick={() => {
                                  setTestingChannelId(ch.id);
                                  setChannelTestFeedback(null);
                                  setChannelTestError(null);
                                  testChannelMut.mutate(ch.id);
                                }}
                                disabled={testChannelMut.isPending}
                                className={cn(TABLE_ACTION_BUTTON_CLASS, 'text-blue-600 hover:bg-blue-50 hover:text-blue-800 dark:text-blue-400 dark:hover:bg-blue-900/20 dark:hover:text-blue-300 disabled:opacity-50')}
                              >
                                {testingChannelId === ch.id ? 'Testing...' : 'Test'}
                              </button>
                              <button
                                onClick={() => setModal({ type: 'edit-channel', channel: ch })}
                                className={cn(TABLE_ACTION_BUTTON_CLASS, 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200')}
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => confirm(`Delete "${ch.name}"?`) && deleteChannelMut.mutate(ch.id)}
                                className={cn(TABLE_ACTION_BUTTON_CLASS, 'text-red-500 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-900/20 dark:hover:text-red-300')}
                              >
                                Delete
                              </button>
                            </div>
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

        {tab === 'settings' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Settings</h2>
            </div>

            <Card className="p-4 sm:p-5">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-slate-900 dark:text-slate-100">Uptime Color Rating</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Controls the color thresholds for daily bars and 30d uptime.
                  </div>
                </div>

                <select
                  value={settingsDraft?.uptime_rating_level ?? 3}
                  onChange={(e) => {
                    const next = Number(e.target.value) as 1 | 2 | 3 | 4 | 5;
                    const cur = settingsDraft?.uptime_rating_level ?? 3;
                    if (next === cur) return;
                    setSettingsDraft((prev) => (prev ? { ...prev, uptime_rating_level: next } : prev));
                    patchSettingsMut.mutate({ uptime_rating_level: next });
                  }}
                  disabled={settingsQuery.isLoading || !settingsDraft}
                  className="border dark:border-slate-600 rounded px-3 py-2 text-sm bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 disabled:opacity-50"
                >
                  <option value={1}>Level 1 - Personal / Hobby</option>
                  <option value={2}>Level 2 - Basic Business / Content</option>
                  <option value={3}>Level 3 - Production / SaaS</option>
                  <option value={4}>Level 4 - High Availability / Critical</option>
                  <option value={5}>Level 5 - Financial / Mission Critical</option>
                </select>
              </div>

              {settingsQuery.isError && (
                <div className="mt-3 text-sm text-red-600 dark:text-red-400">Failed to load settings</div>
              )}

              {patchSettingsMut.isError && (
                <div className="mt-3 text-sm text-red-600 dark:text-red-400">
                  {formatError(patchSettingsMut.error) ?? 'Failed to update settings'}
                </div>
              )}
            </Card>

            <Card className="p-4 sm:p-5">
              <div className="space-y-4">
                <div>
                  <div className="text-sm font-medium text-slate-900 dark:text-slate-100">Site Branding</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Controls the status page title and description.
                  </div>
                </div>

                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                      Site Title
                    </label>
                    <input
                      value={settingsDraft?.site_title ?? ''}
                      aria-label="Site Title"
                      onChange={(e) => {
                        const next = e.target.value.slice(0, 100);
                        setSettingsDraft((prev) => (prev ? { ...prev, site_title: next } : prev));
                      }}
                      onFocus={() => setFocusedSetting('site_title')}
                      onBlur={(e) => {
                        setFocusedSetting(null);
                        const next = sanitizeSiteTitle(e.currentTarget.value);
                        setSettingsDraft((prev) => (prev ? { ...prev, site_title: next } : prev));
                        patchSettingsMut.mutate({ site_title: next });
                      }}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter') return;
                        (e.currentTarget as HTMLInputElement).blur();
                      }}
                      disabled={settingsQuery.isLoading || !settingsDraft}
                      className="w-full border dark:border-slate-600 rounded px-3 py-2 text-sm bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 disabled:opacity-50"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                      Timezone
                    </label>
                    <input
                      value={settingsDraft?.site_timezone ?? ''}
                      aria-label="Timezone"
                      onChange={(e) => {
                        const next = e.target.value.slice(0, 64);
                        setSettingsDraft((prev) => (prev ? { ...prev, site_timezone: next } : prev));
                      }}
                      onFocus={() => setFocusedSetting('site_timezone')}
                      onBlur={(e) => {
                        setFocusedSetting(null);
                        const next = e.currentTarget.value.trim().slice(0, 64) || 'UTC';
                        setSettingsDraft((prev) => (prev ? { ...prev, site_timezone: next } : prev));
                        patchSettingsMut.mutate({ site_timezone: next });
                      }}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter') return;
                        (e.currentTarget as HTMLInputElement).blur();
                      }}
                      disabled={settingsQuery.isLoading || !settingsDraft}
                      placeholder="UTC"
                      className="w-full border dark:border-slate-600 rounded px-3 py-2 text-sm bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 disabled:opacity-50"
                    />
                    <div className="text-xs text-slate-400 dark:text-slate-500 mt-1">IANA name (e.g. UTC, Asia/Shanghai)</div>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                    Site Description
                  </label>
                  <textarea
                    value={settingsDraft?.site_description ?? ''}
                    aria-label="Site Description"
                    onChange={(e) => {
                      const next = e.target.value.slice(0, 500);
                      setSettingsDraft((prev) => (prev ? { ...prev, site_description: next } : prev));
                    }}
                    onFocus={() => setFocusedSetting('site_description')}
                    onBlur={(e) => {
                      setFocusedSetting(null);
                      const next = sanitizeSiteDescription(e.currentTarget.value);
                      setSettingsDraft((prev) => (prev ? { ...prev, site_description: next } : prev));
                      patchSettingsMut.mutate({ site_description: next });
                    }}
                    disabled={settingsQuery.isLoading || !settingsDraft}
                    rows={3}
                    className="w-full border dark:border-slate-600 rounded px-3 py-2 text-sm bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 disabled:opacity-50"
                  />
                </div>
              </div>
            </Card>

            <Card className="p-4 sm:p-5">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-slate-900 dark:text-slate-100">Retention</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    How many days of raw check results to keep.
                  </div>
                </div>

                <input
                  type="number"
                  min={1}
                  max={365}
                  aria-label="Retention Days"
                  value={settingsDraft?.retention_check_results_days ?? 7}
                  onChange={(e) => {
                    const raw = Number(e.target.value);
                    const next = Number.isFinite(raw) ? Math.trunc(raw) : 1;
                    setSettingsDraft((prev) => (prev ? { ...prev, retention_check_results_days: next } : prev));
                  }}
                  onFocus={() => setFocusedSetting('retention_check_results_days')}
                  onBlur={(e) => {
                    setFocusedSetting(null);
                    const next = clampInt(Number(e.currentTarget.value), 1, 365);
                    setSettingsDraft((prev) => (prev ? { ...prev, retention_check_results_days: next } : prev));
                    patchSettingsMut.mutate({ retention_check_results_days: next });
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return;
                    (e.currentTarget as HTMLInputElement).blur();
                  }}
                  disabled={settingsQuery.isLoading || !settingsDraft}
                  className="w-40 border dark:border-slate-600 rounded px-3 py-2 text-sm bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 disabled:opacity-50"
                />
              </div>
            </Card>

            <Card className="p-4 sm:p-5">
              <div className="space-y-4">
                <div>
                  <div className="text-sm font-medium text-slate-900 dark:text-slate-100">State Machine Defaults</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Global thresholds for UP/DOWN transitions.
                  </div>
                </div>

                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                      Failures to mark DOWN
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={settingsDraft?.state_failures_to_down_from_up ?? 2}
                      onChange={(e) => {
                        const raw = Number(e.target.value);
                        const next = Number.isFinite(raw) ? Math.trunc(raw) : 1;
                        setSettingsDraft((prev) => (prev ? { ...prev, state_failures_to_down_from_up: next } : prev));
                      }}
                      onFocus={() => setFocusedSetting('state_failures_to_down_from_up')}
                      onBlur={(e) => {
                        setFocusedSetting(null);
                        const next = clampInt(Number(e.currentTarget.value), 1, 10);
                        setSettingsDraft((prev) => (prev ? { ...prev, state_failures_to_down_from_up: next } : prev));
                        patchSettingsMut.mutate({ state_failures_to_down_from_up: next });
                      }}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter') return;
                        (e.currentTarget as HTMLInputElement).blur();
                      }}
                      disabled={settingsQuery.isLoading || !settingsDraft}
                      className="w-full border dark:border-slate-600 rounded px-3 py-2 text-sm bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 disabled:opacity-50"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                      Successes to mark UP
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={settingsDraft?.state_successes_to_up_from_down ?? 2}
                      onChange={(e) => {
                        const raw = Number(e.target.value);
                        const next = Number.isFinite(raw) ? Math.trunc(raw) : 1;
                        setSettingsDraft((prev) => (prev ? { ...prev, state_successes_to_up_from_down: next } : prev));
                      }}
                      onFocus={() => setFocusedSetting('state_successes_to_up_from_down')}
                      onBlur={(e) => {
                        setFocusedSetting(null);
                        const next = clampInt(Number(e.currentTarget.value), 1, 10);
                        setSettingsDraft((prev) => (prev ? { ...prev, state_successes_to_up_from_down: next } : prev));
                        patchSettingsMut.mutate({ state_successes_to_up_from_down: next });
                      }}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter') return;
                        (e.currentTarget as HTMLInputElement).blur();
                      }}
                      disabled={settingsQuery.isLoading || !settingsDraft}
                      className="w-full border dark:border-slate-600 rounded px-3 py-2 text-sm bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 disabled:opacity-50"
                    />
                  </div>
                </div>
              </div>
            </Card>

            <Card className="p-4 sm:p-5">
              <div className="space-y-4">
                <div>
                  <div className="text-sm font-medium text-slate-900 dark:text-slate-100">Admin Defaults</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Default ranges used in Analytics.
                  </div>
                </div>

                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                      Overview Range
                    </label>
                    <select
                      value={settingsDraft?.admin_default_overview_range ?? '24h'}
                      onChange={(e) => {
                        const next = e.target.value as '24h' | '7d';
                        setSettingsDraft((prev) => (prev ? { ...prev, admin_default_overview_range: next } : prev));
                        patchSettingsMut.mutate({ admin_default_overview_range: next });
                      }}
                      disabled={settingsQuery.isLoading || !settingsDraft}
                      className="w-full border dark:border-slate-600 rounded px-3 py-2 text-sm bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 disabled:opacity-50"
                    >
                      <option value="24h">24h</option>
                      <option value="7d">7d</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                      Monitor Range
                    </label>
                    <select
                      value={settingsDraft?.admin_default_monitor_range ?? '24h'}
                      onChange={(e) => {
                        const next = e.target.value as AdminSettings['admin_default_monitor_range'];
                        setSettingsDraft((prev) => (prev ? { ...prev, admin_default_monitor_range: next } : prev));
                        patchSettingsMut.mutate({ admin_default_monitor_range: next });
                      }}
                      disabled={settingsQuery.isLoading || !settingsDraft}
                      className="w-full border dark:border-slate-600 rounded px-3 py-2 text-sm bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 disabled:opacity-50"
                    >
                      <option value="24h">24h</option>
                      <option value="7d">7d</option>
                      <option value="30d">30d</option>
                      <option value="90d">90d</option>
                    </select>
                  </div>
                </div>
              </div>
            </Card>
          </div>
        )}

        {tab === 'incidents' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Incidents</h2>
              <Button onClick={() => setModal({ type: 'create-incident' })}>Create Incident</Button>
            </div>
            {incidentsQuery.isLoading ? (
              <div className="text-slate-500 dark:text-slate-400">Loading...</div>
            ) : !incidentsQuery.data?.incidents.length ? (
              <Card className="p-6 sm:p-8 text-center text-slate-500 dark:text-slate-400">No incidents yet</Card>
            ) : (
              <Card className="overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[650px]">
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
                          <td className="px-3 sm:px-4 py-3 text-sm text-slate-500 dark:text-slate-400 truncate max-w-[150px]">
                            {it.monitor_ids.map((id) => monitorNameById.get(id) ?? `#${id}`).join(', ')}
                          </td>
                          <td className="px-3 sm:px-4 py-3">
                            <Badge variant={it.status === 'resolved' ? 'up' : 'paused'}>{it.status}</Badge>
                          </td>
                          <td className="px-3 sm:px-4 py-3">
                            <Badge variant={it.impact === 'critical' ? 'down' : it.impact === 'major' ? 'down' : 'paused'}>
                              {it.impact}
                            </Badge>
                          </td>
                          <td className="px-3 sm:px-4 py-3 text-right whitespace-nowrap">
                            <div className="flex items-center justify-end gap-1 sm:gap-0">
                              <button
                                onClick={() => setModal({ type: 'add-incident-update', incident: it })}
                                disabled={it.status === 'resolved'}
                                className={cn(TABLE_ACTION_BUTTON_CLASS, 'text-blue-600 hover:bg-blue-50 hover:text-blue-800 dark:text-blue-400 dark:hover:bg-blue-900/20 dark:hover:text-blue-300 disabled:opacity-50')}
                              >
                                Update
                              </button>
                              <button
                                onClick={() => setModal({ type: 'resolve-incident', incident: it })}
                                disabled={it.status === 'resolved'}
                                className={cn(TABLE_ACTION_BUTTON_CLASS, 'text-emerald-600 hover:bg-emerald-50 hover:text-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-900/20 dark:hover:text-emerald-300 disabled:opacity-50')}
                              >
                                Resolve
                              </button>
                              <button
                                onClick={() => confirm(`Delete "${it.title}"?`) && deleteIncidentMut.mutate(it.id)}
                                className={cn(TABLE_ACTION_BUTTON_CLASS, 'text-red-500 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-900/20 dark:hover:text-red-300')}
                              >
                                Delete
                              </button>
                            </div>
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
              <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Maintenance Windows</h2>
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
                            <td className="px-3 sm:px-4 py-3 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">{formatDateTime(w.starts_at, settings?.site_timezone)} – {formatDateTime(w.ends_at, settings?.site_timezone)}</td>
                            <td className="px-3 sm:px-4 py-3">
                              <Badge variant={state === 'Active' ? 'maintenance' : state === 'Upcoming' ? 'paused' : 'unknown'}>
                                {state}
                              </Badge>
                            </td>
                            <td className="px-3 sm:px-4 py-3 text-right whitespace-nowrap">
                              <div className="flex items-center justify-end gap-1 sm:gap-0">
                                <button
                                  onClick={() => setModal({ type: 'edit-maintenance', window: w })}
                                  className={cn(TABLE_ACTION_BUTTON_CLASS, 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200')}
                                >
                                  Edit
                                </button>
                                <button
                                  onClick={() => confirm(`Delete "${w.title}"?`) && deleteMaintenanceMut.mutate(w.id)}
                                  className={cn(TABLE_ACTION_BUTTON_CLASS, 'text-red-500 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-900/20 dark:hover:text-red-300')}
                                >
                                  Delete
                                </button>
                              </div>
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
        <div className={MODAL_OVERLAY_CLASS}>
          <div className={`${MODAL_PANEL_CLASS} sm:max-w-md p-5 sm:p-6`}>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-5">
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
              <>
                {modal.type === 'create-monitor' && (
                  <MonitorForm
                    onSubmit={(data) => createMonitorMut.mutate(data)}
                    onCancel={closeModal}
                    isLoading={createMonitorMut.isPending}
                    error={formatError(createMonitorMut.error)}
                  />
                )}
                {modal.type === 'edit-monitor' && (
                  <MonitorForm
                    monitor={modal.monitor}
                    onSubmit={(data) => updateMonitorMut.mutate({ id: modal.monitor.id, data })}
                    onCancel={closeModal}
                    isLoading={updateMonitorMut.isPending}
                    error={formatError(updateMonitorMut.error)}
                  />
                )}
              </>
            )}
            {(modal.type === 'create-channel' || modal.type === 'edit-channel') && (
              <NotificationChannelForm
                channel={modal.type === 'edit-channel' ? modal.channel : undefined}
                onSubmit={(data) =>
                  modal.type === 'edit-channel'
                    ? updateChannelMut.mutate({ id: modal.channel.id, data })
                    : createChannelMut.mutate(data)
                }
                onCancel={closeModal}
                isLoading={createChannelMut.isPending || updateChannelMut.isPending}
                error={
                  modal.type === 'edit-channel'
                    ? formatError(updateChannelMut.error)
                    : formatError(createChannelMut.error)
                }
              />
            )}
            {modal.type === 'create-incident' && (
              <IncidentForm
                monitors={(monitorsQuery.data?.monitors ?? []).map((m) => ({ id: m.id, name: m.name }))}
                onSubmit={(data) => createIncidentMut.mutate(data)}
                onCancel={closeModal}
                isLoading={createIncidentMut.isPending}
              />
            )}
            {modal.type === 'add-incident-update' && (
              <IncidentUpdateForm
                onSubmit={(data) => addIncidentUpdateMut.mutate({ id: modal.incident.id, data })}
                onCancel={closeModal}
                isLoading={addIncidentUpdateMut.isPending}
              />
            )}
            {modal.type === 'resolve-incident' && (
              <ResolveIncidentForm
                onSubmit={(data) => resolveIncidentMut.mutate({ id: modal.incident.id, data })}
                onCancel={closeModal}
                isLoading={resolveIncidentMut.isPending}
              />
            )}
            {modal.type === 'create-maintenance' && (
              <MaintenanceWindowForm
                monitors={(monitorsQuery.data?.monitors ?? []).map((m) => ({ id: m.id, name: m.name }))}
                onSubmit={(data) => createMaintenanceMut.mutate(data)}
                onCancel={closeModal}
                isLoading={createMaintenanceMut.isPending}
              />
            )}
            {modal.type === 'edit-maintenance' && (
              <MaintenanceWindowForm
                monitors={(monitorsQuery.data?.monitors ?? []).map((m) => ({ id: m.id, name: m.name }))}
                window={modal.window}
                onSubmit={(data) => updateMaintenanceMut.mutate({ id: modal.window.id, data })}
                onCancel={closeModal}
                isLoading={updateMaintenanceMut.isPending}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
