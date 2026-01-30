import { useState } from 'react';
import type { AdminMonitor, CreateMonitorInput, MonitorType } from '../api/types';
import { Button } from './ui';

interface MonitorFormProps {
  monitor?: AdminMonitor | undefined;
  onSubmit: (data: CreateMonitorInput) => void;
  onCancel: () => void;
  isLoading?: boolean;
  error?: string | undefined;
}

const inputClass = 'w-full px-3 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:border-slate-400 dark:focus:border-slate-500 focus:ring-1 focus:ring-slate-400 dark:focus:ring-slate-500 transition-colors';
const labelClass = 'block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5';

export function MonitorForm({ monitor, onSubmit, onCancel, isLoading, error }: MonitorFormProps) {
  const [name, setName] = useState(monitor?.name ?? '');
  const [type, setType] = useState<MonitorType>(monitor?.type ?? 'http');
  const [target, setTarget] = useState(monitor?.target ?? '');
  const [intervalSec, setIntervalSec] = useState(monitor?.interval_sec ?? 60);
  const [timeoutMs, setTimeoutMs] = useState(monitor?.timeout_ms ?? 10000);
  const [httpMethod, setHttpMethod] = useState(monitor?.http_method ?? 'GET');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const data: CreateMonitorInput = { name, type, target, interval_sec: intervalSec, timeout_ms: timeoutMs };
    if (type === 'http') data.http_method = httpMethod;
    onSubmit(data);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}
      <div>
        <label className={labelClass}>Name</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} required />
      </div>

      <div>
        <label className={labelClass}>Type</label>
        <select value={type} onChange={(e) => setType(e.target.value as MonitorType)} className={inputClass} disabled={!!monitor}>
          <option value="http">HTTP</option>
          <option value="tcp">TCP</option>
        </select>
      </div>

      <div>
        <label className={labelClass}>{type === 'http' ? 'URL' : 'Host:Port'}</label>
        <input
          type="text"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder={type === 'http' ? 'https://example.com' : 'example.com:443'}
          className={inputClass}
          required
        />
      </div>

      {type === 'http' && (
        <div>
          <label className={labelClass}>Method</label>
          <select value={httpMethod} onChange={(e) => setHttpMethod(e.target.value)} className={inputClass}>
            <option value="GET">GET</option>
            <option value="POST">POST</option>
            <option value="HEAD">HEAD</option>
          </select>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Interval (sec)</label>
          <input type="number" value={intervalSec} onChange={(e) => setIntervalSec(Number(e.target.value))} min={60} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Timeout (ms)</label>
          <input type="number" value={timeoutMs} onChange={(e) => setTimeoutMs(Number(e.target.value))} min={1000} className={inputClass} />
        </div>
      </div>

      <div className="flex gap-3 pt-2">
        <Button type="submit" disabled={isLoading} className="flex-1">
          {isLoading ? 'Saving...' : monitor ? 'Update' : 'Create'}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel} className="flex-1">
          Cancel
        </Button>
      </div>
    </form>
  );
}
