import { useState } from 'react';
import type { Heartbeat, CheckStatus } from '../api/types';

interface HeartbeatBarProps {
  heartbeats: Heartbeat[];
  maxBars?: number;
}

function getStatusColor(status: CheckStatus): string {
  switch (status) {
    case 'up':
      return 'bg-emerald-500 dark:bg-emerald-400';
    case 'down':
      return 'bg-red-500 dark:bg-red-400';
    case 'maintenance':
      return 'bg-blue-500 dark:bg-blue-400';
    case 'unknown':
    default:
      return 'bg-slate-300 dark:bg-slate-600';
  }
}

function getStatusGlow(status: CheckStatus): string {
  switch (status) {
    case 'up':
      return 'shadow-emerald-500/50';
    case 'down':
      return 'shadow-red-500/50';
    default:
      return '';
  }
}

function formatTime(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString();
}

interface TooltipProps {
  heartbeat: Heartbeat;
  position: { x: number; y: number };
}

function Tooltip({ heartbeat, position }: TooltipProps) {
  return (
    <div
      className="fixed z-50 px-3 py-2 text-xs bg-slate-900 dark:bg-slate-700 text-white rounded-lg shadow-lg pointer-events-none animate-fade-in"
      style={{
        left: position.x,
        top: position.y - 70,
        transform: 'translateX(-50%)',
      }}
    >
      <div className="font-medium mb-1">{formatTime(heartbeat.checked_at)}</div>
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${getStatusColor(heartbeat.status)}`} />
        <span className="capitalize">{heartbeat.status}</span>
        {heartbeat.latency_ms !== null && (
          <span className="text-slate-400 dark:text-slate-300">• {heartbeat.latency_ms}ms</span>
        )}
      </div>
      <div className="absolute left-1/2 -bottom-1 -translate-x-1/2 w-2 h-2 bg-slate-900 dark:bg-slate-700 rotate-45" />
    </div>
  );
}

export function HeartbeatBar({ heartbeats, maxBars = 60 }: HeartbeatBarProps) {
  const [tooltip, setTooltip] = useState<{ heartbeat: Heartbeat; position: { x: number; y: number } } | null>(null);

  const displayHeartbeats = heartbeats.slice(0, maxBars);
  const reversed = [...displayHeartbeats].reverse();

  const handleMouseEnter = (hb: Heartbeat, e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setTooltip({
      heartbeat: hb,
      position: { x: rect.left + rect.width / 2, y: rect.top },
    });
  };

  return (
    <>
      <div className="flex gap-[2px] sm:gap-[3px] h-6 sm:h-8 items-end">
        {reversed.map((hb, idx) => (
          <div
            key={idx}
            className={`flex-1 min-w-[3px] sm:min-w-[4px] max-w-[6px] sm:max-w-[8px] rounded-sm transition-all duration-150 cursor-pointer
              ${getStatusColor(hb.status)}
              hover:scale-y-110 hover:shadow-md ${tooltip?.heartbeat === hb ? getStatusGlow(hb.status) : ''}`}
            style={{ height: hb.status === 'up' ? '100%' : hb.status === 'down' ? '100%' : '60%' }}
            onMouseEnter={(e) => handleMouseEnter(hb, e)}
            onMouseLeave={() => setTooltip(null)}
          />
        ))}
        {reversed.length < maxBars &&
          Array.from({ length: maxBars - reversed.length }).map((_, idx) => (
            <div
              key={`empty-${idx}`}
              className="flex-1 min-w-[3px] sm:min-w-[4px] max-w-[6px] sm:max-w-[8px] h-[60%] rounded-sm bg-slate-200 dark:bg-slate-700"
            />
          ))}
      </div>
      {tooltip && <Tooltip heartbeat={tooltip.heartbeat} position={tooltip.position} />}
    </>
  );
}
