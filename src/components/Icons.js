import React from "react";

// Small inline SVG icons (consistent on every phone, unlike emoji).
// Line icons use currentColor, so they follow the button's text color.

const Line = ({ children, size = 22, ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    {...props}
  >
    {children}
  </svg>
);

export const SunIcon = (p) => (
  <Line {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Line>
);

export const MoonIcon = (p) => (
  <Line {...p}>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
  </Line>
);

// Auto theme: half light, half dark
export const AutoThemeIcon = (p) => (
  <Line {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" />
  </Line>
);

export const GroupIcon = (p) => (
  <Line {...p}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
    <circle cx="17" cy="9" r="2.5" />
    <path d="M17 14.5a4.5 4.5 0 0 1 4.5 4.5" />
  </Line>
);

// Locate me (not following); `active` = following me
export const LocateIcon = ({ active, ...p }) => (
  <Line {...p}>
    <circle cx="12" cy="12" r="7" />
    <circle cx="12" cy="12" r="3" fill={active ? "currentColor" : "none"} />
    <path d="M12 1v4M12 19v4M1 12h4M19 12h4" />
  </Line>
);

// Heading up ("Rumbo"): navigation arrow
export const NavigationIcon = (p) => (
  <Line {...p}>
    <path d="M12 2l7 19-7-4-7 4z" fill="currentColor" />
  </Line>
);

export const FullscreenIcon = (p) => (
  <Line {...p}>
    <path d="M3 9V3h6M15 3h6v6M21 15v6h-6M9 21H3v-6" />
  </Line>
);

export const ExitFullscreenIcon = (p) => (
  <Line {...p}>
    <path d="M9 3v6H3M21 9h-6V3M15 21v-6h6M3 15h6v6" />
  </Line>
);

export const PencilIcon = (p) => (
  <Line {...p}>
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z" />
    <path d="M14.5 5.5l3 3" />
  </Line>
);

export const MoreIcon = (p) => (
  <Line {...p}>
    <circle cx="5" cy="12" r="1.4" fill="currentColor" />
    <circle cx="12" cy="12" r="1.4" fill="currentColor" />
    <circle cx="19" cy="12" r="1.4" fill="currentColor" />
  </Line>
);

// Navigation apps (simplified marks in their brand colors, for the "open in"
// links: the only hardcoded colors allowed outside theme.css)
export const GoogleMapsIcon = ({ size = 26 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 1.5a7.5 7.5 0 0 0-7.5 7.5c0 2 .8 3.8 2 5.2L12 9z" fill="#1a73e8" />
    <path d="M12 1.5L12 9l7 0a7.5 7.5 0 0 0-7-7.5z" fill="#ea4335" />
    <path d="M19 9h-7l-5.5 5.2L12 22.5s7.5-8.2 7.5-13.5c0 0 0 0-.5 0z" fill="#fbbc04" />
    <path d="M6.5 14.2L12 9v13.5c-1.6-2-4-5-5.5-8.3z" fill="#34a853" />
    <circle cx="12" cy="9" r="2.6" fill="#fff" />
  </svg>
);

export const WazeIcon = ({ size = 26 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M12 3c5 0 9 3.4 9 7.6 0 2.6-1.5 4.8-3.8 6.1H8.6c-1.6 0-3-.8-3.8-2.1-.9.1-2-.5-2.3-1.6 1.3 0 1.6-.8 1.6-2.4C4.1 6.4 7.6 3 12 3z"
      fill="#33ccff"
      stroke="#0a0a0a"
      strokeWidth="1.2"
      strokeLinejoin="round"
    />
    <circle cx="9.6" cy="9" r="1" fill="#0a0a0a" />
    <circle cx="14.6" cy="9" r="1" fill="#0a0a0a" />
    <path d="M9.4 11.8c1.4 1.4 3.8 1.4 5.2 0" fill="none" stroke="#0a0a0a" strokeWidth="1.2" strokeLinecap="round" />
    <circle cx="8.5" cy="18.5" r="2" fill="#0a0a0a" stroke="#fff" strokeWidth="1" />
    <circle cx="16" cy="18.5" r="2" fill="#0a0a0a" stroke="#fff" strokeWidth="1" />
  </svg>
);
