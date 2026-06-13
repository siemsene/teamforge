import { useId, type ReactNode } from "react";

type MarkProps = {
  className?: string;
  title?: string;
};

export function TeamForgeMark({ className = "h-9 w-9", title = "TeamForge" }: MarkProps) {
  const gradientId = `teamforge-mark-bg-${useId().replace(/:/g, "")}`;

  return (
    <svg
      aria-label={title}
      className={className}
      role="img"
      viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={gradientId} x1="10" x2="54" y1="8" y2="56" gradientUnits="userSpaceOnUse">
          <stop stopColor="#4338ca" />
          <stop offset="0.58" stopColor="#0f766e" />
          <stop offset="1" stopColor="#d97706" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="#f8fafc" />
      <rect x="4.5" y="4.5" width="55" height="55" rx="13.5" fill={`url(#${gradientId})`} />
      <path
        d="M18 41.5V22.8c0-2.2 1.8-4 4-4h21.7c1.3 0 2.5.7 3.3 1.7L37.6 24H22.8v17.5H18Z"
        fill="#eef2ff"
      />
      <path
        d="M22.8 24h24.8v18.2c0 2.2-1.8 4-4 4H22.8V24Z"
        fill="#fff"
        opacity="0.94"
      />
      <path d="M32.5 28v13.7M26 34.9h13" stroke="#c7d2fe" strokeLinecap="round" strokeWidth="2.4" />
      <path d="M27.5 29.8 32.5 28l5 1.8M27.5 40l5 1.7 5-1.7" stroke="#4338ca" strokeLinecap="round" strokeWidth="2.4" />
      <circle cx="24.5" cy="34.9" r="3.9" fill="#0f766e" />
      <circle cx="40.5" cy="34.9" r="3.9" fill="#d97706" />
      <circle cx="32.5" cy="26.6" r="3.9" fill="#4338ca" />
      <circle cx="32.5" cy="43.2" r="3.9" fill="#0f766e" />
      <path d="M22.6 50.5h18.8" stroke="#e0f2fe" strokeLinecap="round" strokeWidth="3.2" />
    </svg>
  );
}

export function TeamForgeLogo({
  className = "",
  markClassName = "h-9 w-9",
  textClassName = "",
  subtitle,
}: {
  className?: string;
  markClassName?: string;
  textClassName?: string;
  subtitle?: ReactNode;
}) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <TeamForgeMark className={markClassName} />
      <span className="min-w-0">
        <span className={`block font-bold tracking-normal text-slate-950 ${textClassName}`}>TeamForge</span>
        {subtitle && <span className="block text-xs font-medium text-slate-500">{subtitle}</span>}
      </span>
    </span>
  );
}
