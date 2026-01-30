import { useState } from 'react';
import type { NotificationChannel, CreateNotificationChannelInput } from '../api/types';
import { Button } from './ui';

interface NotificationChannelFormProps {
  channel?: NotificationChannel | undefined;
  onSubmit: (data: CreateNotificationChannelInput) => void;
  onCancel: () => void;
  isLoading?: boolean;
}

const inputClass = 'w-full px-3 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:border-slate-400 dark:focus:border-slate-500 focus:ring-1 focus:ring-slate-400 dark:focus:ring-slate-500 transition-colors';
const labelClass = 'block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5';

export function NotificationChannelForm({ channel, onSubmit, onCancel, isLoading }: NotificationChannelFormProps) {
  const [name, setName] = useState(channel?.name ?? '');
  const [url, setUrl] = useState(channel?.config_json.url ?? '');
  const [method, setMethod] = useState(channel?.config_json.method ?? 'POST');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({ name, type: 'webhook', config_json: { url, method } });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label className={labelClass}>Name</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} required />
      </div>

      <div>
        <label className={labelClass}>Webhook URL</label>
        <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/webhook" className={inputClass} required />
      </div>

      <div>
        <label className={labelClass}>Method</label>
        <select value={method} onChange={(e) => setMethod(e.target.value)} className={inputClass}>
          <option value="POST">POST</option>
          <option value="GET">GET</option>
        </select>
      </div>

      <div className="flex gap-3 pt-2">
        <Button type="submit" disabled={isLoading} className="flex-1">
          {isLoading ? 'Saving...' : channel ? 'Update' : 'Create'}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel} className="flex-1">Cancel</Button>
      </div>
    </form>
  );
}
