import { QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';

import { AuthProvider } from './app/AuthContext';
import { I18nProvider } from './app/I18nContext';
import { queryClient } from './app/queryClient';
import { router } from './app/router';
import { ThemeProvider } from './app/ThemeContext';
import type { StatusResponse } from './api/types';
import './styles.css';

declare global {
  var __UPTIMER_INITIAL_STATUS__: StatusResponse | undefined;
}

const LS_PUBLIC_STATUS_KEY = 'uptimer_public_status_snapshot_v1';

type PersistedStatusCache = {
  at: number;
  value: StatusResponse;
};

function readPersistedStatusCache(): StatusResponse | null {
  try {
    const raw = localStorage.getItem(LS_PUBLIC_STATUS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;

    const value = (parsed as { value?: unknown }).value;
    if (!value || typeof value !== 'object') return null;

    // Minimal shape check.
    if (typeof (value as { generated_at?: unknown }).generated_at !== 'number') return null;

    return value as StatusResponse;
  } catch {
    return null;
  }
}

function writePersistedStatusCache(value: StatusResponse): void {
  try {
    const payload: PersistedStatusCache = { at: Date.now(), value };
    localStorage.setItem(LS_PUBLIC_STATUS_KEY, JSON.stringify(payload));
  } catch {
    // Best-effort only.
  }
}

const initialStatus = globalThis.__UPTIMER_INITIAL_STATUS__;
const persistedStatus = initialStatus ? null : readPersistedStatusCache();
const seedStatus = initialStatus ?? persistedStatus;

if (seedStatus) {
  // Seed React Query so the status page can render instantly on slow networks.
  // Use the server-provided timestamp so we don't hide stale data.
  const updatedAt =
    typeof seedStatus.generated_at === 'number' ? seedStatus.generated_at * 1000 : Date.now();

  queryClient.setQueryData<StatusResponse>(['status'], seedStatus, { updatedAt });
  writePersistedStatusCache(seedStatus);
}

function PreloadCleanup() {
  // Remove the server-rendered preload right before the first paint with React,
  // avoiding a flash of duplicated content.
  React.useLayoutEffect(() => {
    document.getElementById('uptimer-preload')?.remove();
  }, []);

  return null;
}

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Missing #root element');

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <I18nProvider>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <PreloadCleanup />
            <RouterProvider
              router={router}
              fallbackElement={<div className="min-h-screen bg-slate-50 dark:bg-slate-900" />}
            />
          </AuthProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </I18nProvider>
  </React.StrictMode>,
);
