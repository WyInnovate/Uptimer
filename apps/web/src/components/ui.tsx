import type { KeyboardEvent, ReactNode } from 'react';

import { useTheme } from '../app/ThemeContext';

// Status Badge Component
interface BadgeProps {
  variant: 'up' | 'down' | 'maintenance' | 'paused' | 'unknown' | 'info';
  children: ReactNode;
  size?: 'sm' | 'md';
}

const badgeStyles = {
  up: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-400/20',
  down: 'bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-400/20',
  maintenance: 'bg-blue-50 text-blue-700 ring-blue-600/20 dark:bg-blue-500/10 dark:text-blue-400 dark:ring-blue-400/20',
  paused: 'bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-400/20',
  unknown: 'bg-slate-50 text-slate-600 ring-slate-500/20 dark:bg-slate-500/10 dark:text-slate-400 dark:ring-slate-400/20',
  info: 'bg-slate-100 text-slate-600 ring-slate-500/10 dark:bg-slate-500/10 dark:text-slate-400 dark:ring-slate-400/20',
};

export function Badge({ variant, children, size = 'sm' }: BadgeProps) {
  const sizeClass = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm';
  return (
    <span className={`inline-flex items-center rounded-full font-medium ring-1 ring-inset ${badgeStyles[variant]} ${sizeClass}`}>
      {children}
    </span>
  );
}

// Status Dot Component
interface StatusDotProps {
  status: 'up' | 'down' | 'maintenance' | 'paused' | 'unknown';
  pulse?: boolean;
}

const dotColors = {
  up: 'bg-emerald-500 dark:bg-emerald-400',
  down: 'bg-red-500 dark:bg-red-400',
  maintenance: 'bg-blue-500 dark:bg-blue-400',
  paused: 'bg-amber-500 dark:bg-amber-400',
  unknown: 'bg-slate-400 dark:bg-slate-500',
};

export function StatusDot({ status, pulse = false }: StatusDotProps) {
  return (
    <span className="relative flex h-2.5 w-2.5">
      {pulse && (
        <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${dotColors[status]}`} />
      )}
      <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${dotColors[status]}`} />
    </span>
  );
}

// Card Component
interface CardProps {
  children: ReactNode;
  className?: string;
  hover?: boolean;
  onClick?: () => void;
}

export function Card({ children, className = '', hover = false, onClick }: CardProps) {
  const hoverClass = hover ? 'hover:shadow-soft-lg hover:border-slate-200 dark:hover:border-slate-600 cursor-pointer' : '';
  const clickProps = onClick ? {
    onClick,
    onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
      // Only handle keys when the Card itself is focused (not inner interactive children).
      if (e.target !== e.currentTarget) return;
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        onClick();
      }
    },
    role: 'button',
    tabIndex: 0,
  } : {};

  return (
    <div
      className={`bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 shadow-soft dark:shadow-none transition-all duration-200 ${hoverClass} ${className}`}
      {...clickProps}
    >
      {children}
    </div>
  );
}

// Button Component
export interface ButtonProps {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean | undefined;
  onClick?: () => void;
  type?: 'button' | 'submit';
  className?: string;
}

const buttonVariants = {
  primary: 'bg-slate-900 text-white hover:bg-slate-800 shadow-sm dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white',
  secondary: 'bg-white text-slate-700 hover:bg-slate-50 border border-slate-200 shadow-sm dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600 dark:hover:bg-slate-700',
  ghost: 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-800',
  danger: 'bg-red-600 text-white hover:bg-red-700 shadow-sm dark:bg-red-500 dark:hover:bg-red-600',
};

const buttonSizes = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-sm',
  lg: 'px-5 py-2.5 text-base',
};

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  disabled = false,
  onClick,
  type = 'button',
  className = '',
}: ButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center font-medium rounded-lg transition-all duration-150
        ${buttonVariants[variant]} ${buttonSizes[size]}
        disabled:opacity-50 disabled:cursor-not-allowed
        ${className}`}
    >
      {children}
    </button>
  );
}

// Theme Toggle Component
const SunIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
  </svg>
);

const MoonIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
  </svg>
);

const SystemIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
  </svg>
);

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  const cycleTheme = () => {
    if (theme === 'system') setTheme('light');
    else if (theme === 'light') setTheme('dark');
    else setTheme('system');
  };

  return (
    <button
      onClick={cycleTheme}
      className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-800 transition-colors"
      title={`Theme: ${theme}`}
    >
      {theme === 'light' && <SunIcon />}
      {theme === 'dark' && <MoonIcon />}
      {theme === 'system' && <SystemIcon />}
    </button>
  );
}
