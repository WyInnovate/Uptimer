import { useMemo, useState } from 'react';
import type { CreateIncidentUpdateInput, IncidentStatus } from '../api/types';
import { Markdown } from './Markdown';
import { Button } from './ui';

const statusOptions: Array<Exclude<IncidentStatus, 'resolved'>> = ['investigating', 'identified', 'monitoring'];
const inputClass = 'w-full px-3 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg text-sm text-slate-900 dark:text-slate-100 focus:border-slate-400 dark:focus:border-slate-500 focus:ring-1 focus:ring-slate-400 dark:focus:ring-slate-500 transition-colors';
const labelClass = 'block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5';

export function IncidentUpdateForm({ onSubmit, onCancel, isLoading }: {
  onSubmit: (input: CreateIncidentUpdateInput) => void;
  onCancel: () => void;
  isLoading?: boolean;
}) {
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<Exclude<IncidentStatus, 'resolved'> | ''>('');
  const normalized = useMemo(() => message.trim(), [message]);

  return (
    <form className="space-y-5" onSubmit={(e) => {
      e.preventDefault();
      onSubmit(status === '' ? { message: normalized } : { message: normalized, status });
    }}>
      <div>
        <label className={labelClass}>Status (optional)</label>
        <select value={status} onChange={(e) => setStatus(e.target.value as Exclude<IncidentStatus, 'resolved'> | '')} className={inputClass}>
          <option value="">Keep current</option>
          {statusOptions.map((it) => <option key={it} value={it}>{it}</option>)}
        </select>
      </div>

      <div>
        <label className={labelClass}>Update message (Markdown)</label>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={5} className={`${inputClass} font-mono`} placeholder="What changed?" required />
      </div>

      {normalized && (
        <div>
          <div className={labelClass}>Preview</div>
          <div className="border border-slate-200 dark:border-slate-600 rounded-lg p-4 bg-slate-50 dark:bg-slate-700/50"><Markdown text={normalized} /></div>
        </div>
      )}

      <div className="flex gap-3 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel} className="flex-1">Cancel</Button>
        <Button type="submit" disabled={isLoading || !normalized} className="flex-1">{isLoading ? 'Saving...' : 'Post Update'}</Button>
      </div>
    </form>
  );
}
