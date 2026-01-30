import { useMemo, useState } from 'react';
import type { ResolveIncidentInput } from '../api/types';
import { Markdown } from './Markdown';
import { Button } from './ui';

const inputClass = 'w-full px-3 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg text-sm text-slate-900 dark:text-slate-100 focus:border-slate-400 dark:focus:border-slate-500 focus:ring-1 focus:ring-slate-400 dark:focus:ring-slate-500 transition-colors';
const labelClass = 'block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5';

export function ResolveIncidentForm({ onSubmit, onCancel, isLoading }: {
  onSubmit: (input: ResolveIncidentInput) => void;
  onCancel: () => void;
  isLoading?: boolean;
}) {
  const [message, setMessage] = useState('');
  const normalized = useMemo(() => message.trim(), [message]);

  return (
    <form className="space-y-5" onSubmit={(e) => {
      e.preventDefault();
      onSubmit(normalized ? { message: normalized } : {});
    }}>
      <div>
        <label className={labelClass}>Resolution message (optional)</label>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} className={`${inputClass} font-mono`} placeholder="Describe the resolution..." />
      </div>

      {normalized && (
        <div>
          <div className={labelClass}>Preview</div>
          <div className="border border-slate-200 dark:border-slate-600 rounded-lg p-4 bg-slate-50 dark:bg-slate-700/50"><Markdown text={normalized} /></div>
        </div>
      )}

      <div className="flex gap-3 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel} className="flex-1">Cancel</Button>
        <Button type="submit" disabled={isLoading} className="flex-1 !bg-emerald-600 hover:!bg-emerald-700">
          {isLoading ? 'Resolving...' : 'Resolve'}
        </Button>
      </div>
    </form>
  );
}
