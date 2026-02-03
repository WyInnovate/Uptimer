import { useMemo, useState } from 'react';

import type { UptimeDay } from '../api/types';

type DowntimeInterval = { start: number; end: number };

interface UptimeBar30dProps {
  days: UptimeDay[];
  maxBars?: number;
  onDayClick?: (dayStartAt: number) => void;
}

function formatDay(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString();
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

function getUptimeColorClasses(uptimePct: number | null): string {
  if (uptimePct === null) return 'bg-slate-300 dark:bg-slate-600';

  // More granularity (green -> red) for per-day uptime bars.
  // Thresholds are skewed toward high availability.
  if (uptimePct >= 99.99) return 'bg-emerald-500 dark:bg-emerald-400';
  if (uptimePct >= 99.95) return 'bg-green-500 dark:bg-green-400';
  if (uptimePct >= 99.9) return 'bg-lime-500 dark:bg-lime-400';
  if (uptimePct >= 99.5) return 'bg-yellow-500 dark:bg-yellow-400';
  if (uptimePct >= 99.0) return 'bg-amber-500 dark:bg-amber-400';
  if (uptimePct >= 98.0) return 'bg-orange-500 dark:bg-orange-400';
  if (uptimePct >= 95.0) return 'bg-red-500 dark:bg-red-400';
  return 'bg-rose-600 dark:bg-rose-400';
}

function getUptimeGlow(uptimePct: number | null): string {
  if (uptimePct === null) return '';
  if (uptimePct >= 99.95) return 'shadow-emerald-500/50';
  if (uptimePct >= 99.0) return 'shadow-amber-500/50';
  return 'shadow-red-500/50';
}

function mergeIntervals(intervals: DowntimeInterval[]): DowntimeInterval[] {
  if (intervals.length === 0) return [];

  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged: DowntimeInterval[] = [];

  for (const it of sorted) {
    const prev = merged[merged.length - 1];
    if (!prev) {
      merged.push({ start: it.start, end: it.end });
      continue;
    }

    if (it.start <= prev.end) {
      prev.end = Math.max(prev.end, it.end);
      continue;
    }

    merged.push({ start: it.start, end: it.end });
  }

  return merged;
}

interface TooltipState {
  day: UptimeDay;
  position: { x: number; y: number };
}

function Tooltip({ day, position }: { day: UptimeDay; position: { x: number; y: number } }) {
  return (
    <div
      className="fixed z-50 px-3 py-2 text-xs bg-slate-900 dark:bg-slate-700 text-white rounded-lg shadow-lg pointer-events-none animate-fade-in"
      style={{
        left: position.x,
        top: position.y - 74,
        transform: 'translateX(-50%)',
      }}
    >
      <div className="font-medium mb-1">{formatDay(day.day_start_at)}</div>
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${getUptimeColorClasses(day.uptime_pct)}`} />
        <span>
          {day.uptime_pct === null ? 'No data' : `${day.uptime_pct.toFixed(3)}%`} uptime
        </span>
      </div>
      <div className="mt-1 text-slate-300">Downtime: {formatSec(day.downtime_sec)}</div>
      {day.unknown_sec > 0 && <div className="text-slate-300">Unknown: {formatSec(day.unknown_sec)}</div>}
      <div className="absolute left-1/2 -bottom-1 -translate-x-1/2 w-2 h-2 bg-slate-900 dark:bg-slate-700 rotate-45" />
    </div>
  );
}

export function UptimeBar30d({ days, maxBars = 30, onDayClick }: UptimeBar30dProps) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const displayDays = useMemo(() => {
    if (!Array.isArray(days)) return [];
    // Backend returns oldest -> newest; we want newest on the right.
    return days.slice(-maxBars);
  }, [days, maxBars]);

  // Ensure stable layout even with fewer than maxBars days.
  const emptyCount = Math.max(0, maxBars - displayDays.length);

  const handleMouseEnter = (d: UptimeDay, e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setTooltip({
      day: d,
      position: { x: rect.left + rect.width / 2, y: rect.top },
    });
  };

  return (
    <>
      <div className="flex gap-[2px] sm:gap-[3px] h-6 sm:h-8 items-end">
        {displayDays.map((d) => {
          const pct = d.uptime_pct;

          return (
            <button
              key={d.day_start_at}
              type="button"
              aria-label={`Uptime ${formatDay(d.day_start_at)}`}
              className={`flex-1 min-w-[3px] sm:min-w-[4px] max-w-[6px] sm:max-w-[8px] rounded-sm transition-all duration-150
                ${getUptimeColorClasses(pct)}
                hover:scale-y-110 hover:shadow-md ${tooltip?.day.day_start_at === d.day_start_at ? getUptimeGlow(pct) : ''}`}
              style={{ height: '100%' }}
              onMouseEnter={(e) => handleMouseEnter(d, e)}
              onMouseLeave={() => setTooltip(null)}
              onClick={(e) => {
                e.stopPropagation();
                onDayClick?.(d.day_start_at);
              }}
            />
          );
        })}

        {emptyCount > 0 &&
          Array.from({ length: emptyCount }).map((_, idx) => (
            <div
              key={`empty-${idx}`}
              className="flex-1 min-w-[3px] sm:min-w-[4px] max-w-[6px] sm:max-w-[8px] h-[100%] rounded-sm bg-slate-200 dark:bg-slate-700"
            />
          ))}
      </div>

      {tooltip && <Tooltip day={tooltip.day} position={tooltip.position} />}
    </>
  );
}

export function computeDayDowntimeIntervals(
  dayStartAt: number,
  outages: Array<{ started_at: number; ended_at: number | null }>,
): DowntimeInterval[] {
  const dayEndAt = dayStartAt + 86400;

  const intervals: DowntimeInterval[] = [];
  for (const o of outages) {
    const s = Math.max(o.started_at, dayStartAt);
    const e = Math.min(o.ended_at ?? dayEndAt, dayEndAt);
    if (e > s) intervals.push({ start: s, end: e });
  }

  return mergeIntervals(intervals);
}

export function computeIntervalTotalSeconds(intervals: DowntimeInterval[]): number {
  return intervals.reduce((acc, it) => acc + Math.max(0, it.end - it.start), 0);
}
