import { useMemo } from 'react';

import type { Outage } from '../api/types';
import { Button } from './ui';
import { computeDayDowntimeIntervals, computeIntervalTotalSeconds } from './UptimeBar30d';

function formatDay(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString();
}

function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatSec(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

export function DayDowntimeModal({
  dayStartAt,
  outages,
  onClose,
}: {
  dayStartAt: number;
  outages: Outage[];
  onClose: () => void;
}) {
  const intervals = useMemo(
    () => computeDayDowntimeIntervals(dayStartAt, outages),
    [dayStartAt, outages],
  );

  const totalDowntimeSec = useMemo(() => computeIntervalTotalSeconds(intervals), [intervals]);

  return (
    <div
      className="fixed inset-0 bg-slate-900/60 dark:bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 z-50 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-800 rounded-t-2xl sm:rounded-2xl shadow-soft-lg w-full sm:max-w-xl p-5 sm:p-6 max-h-[90vh] overflow-y-auto animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1">
              Downtime
            </div>
            <h2 className="text-lg sm:text-xl font-semibold text-slate-900 dark:text-slate-100">
              {formatDay(dayStartAt)}
            </h2>
            <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Total: {formatSec(totalDowntimeSec)}
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>

        {intervals.length === 0 ? (
          <div className="text-slate-500 dark:text-slate-400">No downtime recorded for this day.</div>
        ) : (
          <div className="space-y-2">
            {intervals.map((it, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between gap-4 p-3 rounded-lg bg-slate-50 dark:bg-slate-700/50"
              >
                <div className="text-sm text-slate-700 dark:text-slate-200">
                  {formatTime(it.start)} – {formatTime(it.end)}
                </div>
                <div className="text-sm font-medium text-slate-900 dark:text-slate-100 tabular-nums">
                  {formatSec(it.end - it.start)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
