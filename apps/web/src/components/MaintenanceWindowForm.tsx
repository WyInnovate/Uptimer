import { useMemo, useState } from 'react';
import type { CreateMaintenanceWindowInput, MaintenanceWindow, PatchMaintenanceWindowInput } from '../api/types';
import { Markdown } from './Markdown';
import { Button } from './ui';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toDatetimeLocal(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function fromDatetimeLocal(value: string): number | null {
  if (!value) return null;
  const d = new Date(value);
  const ms = d.getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / 1000);
}

const inputClass = 'w-full px-3 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg text-sm text-slate-900 dark:text-slate-100 focus:border-slate-400 dark:focus:border-slate-500 focus:ring-1 focus:ring-slate-400 dark:focus:ring-slate-500 transition-colors';
const labelClass = 'block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5';

type CommonProps = { onCancel: () => void; isLoading?: boolean; monitors: Array<{ id: number; name: string }> };
type CreateProps = CommonProps & { window?: undefined; onSubmit: (input: CreateMaintenanceWindowInput) => void };
type EditProps = CommonProps & { window: MaintenanceWindow; onSubmit: (input: PatchMaintenanceWindowInput) => void };

export function MaintenanceWindowForm(props: CreateProps | EditProps) {
  const { window, onCancel, isLoading, monitors } = props;

  const [title, setTitle] = useState(window?.title ?? '');
  const [message, setMessage] = useState(window?.message ?? '');
  const [startsAt, setStartsAt] = useState(window ? toDatetimeLocal(window.starts_at) : '');
  const [endsAt, setEndsAt] = useState(window ? toDatetimeLocal(window.ends_at) : '');
  const [selectedMonitorIds, setSelectedMonitorIds] = useState<number[]>(window?.monitor_ids ?? []);

  const normalized = useMemo(() => message.trim(), [message]);
  const parsed = useMemo(() => ({ starts_at: fromDatetimeLocal(startsAt), ends_at: fromDatetimeLocal(endsAt) }), [startsAt, endsAt]);

  const timeError = parsed.starts_at === null || parsed.ends_at === null ? 'Start/end time required' : parsed.starts_at >= parsed.ends_at ? 'Start must be before end' : null;
  const monitorsError = monitors.length === 0 ? 'No monitors' : selectedMonitorIds.length === 0 ? 'Select at least one' : null;

  return (
    <form className="space-y-5" onSubmit={(e) => {
      e.preventDefault();
      if (timeError || parsed.starts_at === null || parsed.ends_at === null || selectedMonitorIds.length === 0) return;
      const base = { title: title.trim(), starts_at: parsed.starts_at, ends_at: parsed.ends_at, monitor_ids: selectedMonitorIds };
      if (props.window) props.onSubmit({ ...base, message: normalized || null });
      else props.onSubmit(normalized ? { ...base, message: normalized } : base);
    }}>
      <div>
        <div className={labelClass}>Affected Monitors</div>
        {monitors.length === 0 ? <div className="text-sm text-slate-500 dark:text-slate-400">No monitors</div> : (
          <div className="max-h-40 overflow-y-auto border border-slate-200 dark:border-slate-600 rounded-lg p-3 space-y-2 bg-white dark:bg-slate-700">
            {monitors.map((m) => (
              <label key={m.id} className="flex items-center gap-2.5 text-sm text-slate-700 dark:text-slate-300 cursor-pointer hover:text-slate-900 dark:hover:text-slate-100">
                <input type="checkbox" checked={selectedMonitorIds.includes(m.id)} onChange={(e) => setSelectedMonitorIds(e.target.checked ? [...selectedMonitorIds, m.id] : selectedMonitorIds.filter((id) => id !== m.id))} className="rounded border-slate-300 dark:border-slate-500 dark:bg-slate-600" />
                <span>{m.name}</span>
              </label>
            ))}
          </div>
        )}
        {monitorsError && <div className="mt-2 text-sm text-red-500 dark:text-red-400">{monitorsError}</div>}
      </div>

      <div>
        <label className={labelClass}>Title</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} placeholder="e.g. Database maintenance" required />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Starts</label>
          <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className={inputClass} required />
        </div>
        <div>
          <label className={labelClass}>Ends</label>
          <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className={inputClass} required />
        </div>
      </div>
      {timeError && <div className="text-sm text-red-500 dark:text-red-400">{timeError}</div>}

      <div>
        <label className={labelClass}>Message (Markdown)</label>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} className={`${inputClass} font-mono`} placeholder="Optional details..." />
      </div>

      {normalized && (
        <div>
          <div className={labelClass}>Preview</div>
          <div className="border border-slate-200 dark:border-slate-600 rounded-lg p-4 bg-slate-50 dark:bg-slate-700/50"><Markdown text={normalized} /></div>
        </div>
      )}

      <div className="flex gap-3 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel} className="flex-1">Cancel</Button>
        <Button type="submit" disabled={isLoading || !title.trim() || !!timeError || !selectedMonitorIds.length} className="flex-1">
          {isLoading ? 'Saving...' : window ? 'Save' : 'Create'}
        </Button>
      </div>
    </form>
  );
}
