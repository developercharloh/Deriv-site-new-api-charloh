import React from 'react';

type IconProps = { size?: number; className?: string; strokeWidth?: number; color?: string; style?: React.CSSProperties };

export const Loader2 = ({ size = 24, className, strokeWidth = 2, color, style }: IconProps) => (
    <svg xmlns='http://www.w3.org/2000/svg' width={size} height={size} viewBox='0 0 24 24'
        fill='none' stroke={color ?? 'currentColor'} strokeWidth={strokeWidth}
        strokeLinecap='round' strokeLinejoin='round' className={className} style={style}>
        <path d='M21 12a9 9 0 1 1-6.219-8.56'/>
    </svg>
);

export const X = ({ size = 24, className, strokeWidth = 2, color, style }: IconProps) => (
    <svg xmlns='http://www.w3.org/2000/svg' width={size} height={size} viewBox='0 0 24 24'
        fill='none' stroke={color ?? 'currentColor'} strokeWidth={strokeWidth}
        strokeLinecap='round' strokeLinejoin='round' className={className} style={style}>
        <path d='M18 6 6 18'/><path d='m6 6 12 12'/>
    </svg>
);

export const Zap = ({ size = 24, className, strokeWidth = 2, color, style }: IconProps) => (
    <svg xmlns='http://www.w3.org/2000/svg' width={size} height={size} viewBox='0 0 24 24'
        fill='none' stroke={color ?? 'currentColor'} strokeWidth={strokeWidth}
        strokeLinecap='round' strokeLinejoin='round' className={className} style={style}>
        <path d='M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z'/>
    </svg>
);

export const RefreshCw = ({ size = 24, className, strokeWidth = 2, color, style }: IconProps) => (
    <svg xmlns='http://www.w3.org/2000/svg' width={size} height={size} viewBox='0 0 24 24'
        fill='none' stroke={color ?? 'currentColor'} strokeWidth={strokeWidth}
        strokeLinecap='round' strokeLinejoin='round' className={className} style={style}>
        <path d='M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8'/>
        <path d='M21 3v5h-5'/>
        <path d='M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16'/>
        <path d='M8 16H3v5'/>
    </svg>
);

export const PlayCircle = ({ size = 24, className, strokeWidth = 2, color, style }: IconProps) => (
    <svg xmlns='http://www.w3.org/2000/svg' width={size} height={size} viewBox='0 0 24 24'
        fill='none' stroke={color ?? 'currentColor'} strokeWidth={strokeWidth}
        strokeLinecap='round' strokeLinejoin='round' className={className} style={style}>
        <circle cx='12' cy='12' r='10'/>
        <polygon points='10 8 16 12 10 16 10 8'/>
    </svg>
);

export const TrendingUp = ({ size = 24, className, strokeWidth = 2, color, style }: IconProps) => (
    <svg xmlns='http://www.w3.org/2000/svg' width={size} height={size} viewBox='0 0 24 24'
        fill='none' stroke={color ?? 'currentColor'} strokeWidth={strokeWidth}
        strokeLinecap='round' strokeLinejoin='round' className={className} style={style}>
        <path d='m22 7-8.5 8.5-5-5L2 17'/><path d='M16 7h6v6'/>
    </svg>
);

export const TrendingDown = ({ size = 24, className, strokeWidth = 2, color, style }: IconProps) => (
    <svg xmlns='http://www.w3.org/2000/svg' width={size} height={size} viewBox='0 0 24 24'
        fill='none' stroke={color ?? 'currentColor'} strokeWidth={strokeWidth}
        strokeLinecap='round' strokeLinejoin='round' className={className} style={style}>
        <path d='m22 17-8.5-8.5-5 5L2 7'/><path d='M16 17h6v-6'/>
    </svg>
);

export const ChevronDown = ({ size = 24, className, strokeWidth = 2, color, style }: IconProps) => (
    <svg xmlns='http://www.w3.org/2000/svg' width={size} height={size} viewBox='0 0 24 24'
        fill='none' stroke={color ?? 'currentColor'} strokeWidth={strokeWidth}
        strokeLinecap='round' strokeLinejoin='round' className={className} style={style}>
        <path d='m6 9 6 6 6-6'/>
    </svg>
);

export const Wifi = ({ size = 24, className, strokeWidth = 2, color, style }: IconProps) => (
    <svg xmlns='http://www.w3.org/2000/svg' width={size} height={size} viewBox='0 0 24 24'
        fill='none' stroke={color ?? 'currentColor'} strokeWidth={strokeWidth}
        strokeLinecap='round' strokeLinejoin='round' className={className} style={style}>
        <path d='M5 12.55a11 11 0 0 1 14.08 0'/>
        <path d='M1.42 9a16 16 0 0 1 21.16 0'/>
        <path d='M8.53 16.11a6 6 0 0 1 6.95 0'/>
        <line x1='12' x2='12.01' y1='20' y2='20'/>
    </svg>
);

export const WifiOff = ({ size = 24, className, strokeWidth = 2, color, style }: IconProps) => (
    <svg xmlns='http://www.w3.org/2000/svg' width={size} height={size} viewBox='0 0 24 24'
        fill='none' stroke={color ?? 'currentColor'} strokeWidth={strokeWidth}
        strokeLinecap='round' strokeLinejoin='round' className={className} style={style}>
        <path d='M12 20h.01'/>
        <path d='M8.5 16.5a5 5 0 0 1 7 0'/>
        <path d='M5 12.5a9.8 9.8 0 0 1 5.17-2.56'/>
        <path d='m1.5 1.5 21 21'/>
        <path d='M13.91 9.98a10 10 0 0 1 6.59 3.52'/>
    </svg>
);

export const Bot = ({ size = 24, className, strokeWidth = 2, color, style }: IconProps) => (
    <svg xmlns='http://www.w3.org/2000/svg' width={size} height={size} viewBox='0 0 24 24'
        fill='none' stroke={color ?? 'currentColor'} strokeWidth={strokeWidth}
        strokeLinecap='round' strokeLinejoin='round' className={className} style={style}>
        <path d='M12 8V4H8'/>
        <rect width='16' height='12' x='4' y='8' rx='2'/>
        <path d='M2 14h2'/><path d='M20 14h2'/>
        <path d='M15 13v2'/><path d='M9 13v2'/>
    </svg>
);
