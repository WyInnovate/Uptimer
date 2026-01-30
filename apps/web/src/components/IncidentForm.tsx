import { useMemo, useState } from 'react';
import type { CreateIncidentInput, IncidentImpact, IncidentStatus } from '../api/types';
import { Markdown } from './Markdown';
import { Button } from './ui';

const impactOptions: IncidentImpact[] = ['none', 'minor', 'major', 'critical'];
const statusOptions: Array<Exclude<IncidentStatus, 'resolved'>> = ['investigating', 'identified', 'monitoring'];

const inputClass = 'w-full px-3 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:border-slate-400 dark:focus:border-slate-500 focus:ring-1 focus:ring-slate-400 dark:focus:ring-slate-500 transition-colors';
const labelClass = 'block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5';

export function IncidentForm({
  monitors,
  onSubmit,
  onCancel,
  isLoading,
}: {
  monitors: Array<{ id: number; name: string }>;
  onSubmit: (input: CreateIncidentInput) => void;
  onCancel: () => void;
  isLoading?: boolean;
}) {
  const [title, setTitle] = useState('');
  const [impact, setImpact] = useState<IncidentImpact>('minor');
  const [status, setStatus] = useState<Exclude<IncidentStatus, 'resolved'>>('investigating');
  const [message, setMessage] = useState('');
  const [selectedMonitorIds, setSelectedMonitorIds] = useState<number[]>([]);

  const normalized = useMemo(() => message.trim(), [message]);

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (selectedMonitorIds.length === 0) return;
        const base: CreateIncidentInput = { title: title.trim(), impact, status, monitor_ids: selectedMonitorIds };
        onSubmit(normalized.length > 0 ? { ...base, message: normalized } : base);
      }}
    >
      <div>
        <div className={labelClass}>Affected Monitors</div>
        {monitors.length === 0 ? (
          <div className="text-sm text-slate-500 dark:text-slate-400">No monitors available</div>
        ) : (
          <div className="max-h-40 overflow-y-auto border border-slate-200 dark:border-slate-600 rounded-lg p-3 space-y-2 bg-white dark:bg-slate-700">
            {monitors.map((m) => (
              <label key={m.id} className="flex items-center gap-2.5 text-sm cursor-pointer text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100">
                <input
                  type="checkbox"
                  checked={selectedMonitorIds.includes(m.id)}
                  onChange={(e) => setSelectedMonitorIds(e.target.checked ? [...selectedMonitorIds, m.id] : selectedMonitorIds.filter((id) => id !== m.id))}
                  className="rounded border-slate-300 dark:border-slate-500 text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-600 focus:ring-slate-500"
                />
                <span>{m.name}</span>
              </label>
            ))}
          </div>
        )}
        {monitors.length > 0 && selectedMonitorIds.length === 0 && (
          <div className="mt-2 text-sm text-red-500 dark:text-red-400">Select at least one monitor</div>
        )}
      </div>

      <div>
        <label className={labelClass}>Title</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} placeholder="e.g. API latency issues" required />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Impact</label>
          <select value={impact} onChange={(e) => setImpact(e.target.value as IncidentImpact)} className={inputClass}>
            {impactOptions.map((it) => <option key={it} value={it}>{it}</option>)}
          </select>
        </div>
        <div>
          <label className={labelClass}>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value as Exclude<IncidentStatus, 'resolved'>)} className={inputClass}>
            {statusOptions.map((it) => <option key={it} value={it}>{it}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label className={labelClass}>Message (Markdown)</label>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={5} className={`${inputClass} font-mono`} placeholder="Describe the issue..." />
      </div>

      {normalized.length > 0 && (
        <div>
          <div className={labelClass}>Preview</div>
          <div className="border border-slate-200 dark:border-slate-600 rounded-lg p-4 bg-slate-50 dark:bg-slate-700/50">
            <Markdown text={normalized} />
          </div>
        </div>
      )}

      <div className="flex gap-3 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel} className="flex-1">Cancel</Button>
        <Button type="submit" disabled={isLoading || !title.trim() || selectedMonitorIds.length === 0} className="flex-1">
          {isLoading ? 'Saving...' : 'Create'}
        </Button>
      </div>
    </form>
  );
}
