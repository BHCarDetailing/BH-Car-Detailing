export interface NavItem {
  to: string;
  label: string;
  short: string; // bottom-nav label (mobile)
  icon: string;  // inline SVG path data, drawn in a 24x24 viewBox
}

export const NAV_ITEMS: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", short: "Home", icon: "M3 12l9-9 9 9M5 10v10h14V10" },
  { to: "/pipeline", label: "Pipeline", short: "Pipeline", icon: "M4 6h16M4 12h10M4 18h7" },
  { to: "/calendar", label: "Calendar", short: "Calendar", icon: "M7 3v4M17 3v4M4 8h16M4 8v12h16V8" },
  { to: "/inbox", label: "Inbox", short: "Inbox", icon: "M4 5h16v11H8l-4 4V5z" },
  { to: "/contacts", label: "Contacts", short: "Contacts", icon: "M16 20a4 4 0 00-8 0M12 12a4 4 0 100-8 4 4 0 000 8" },
  { to: "/settings", label: "Settings", short: "Settings", icon: "M12 15a3 3 0 100-6 3 3 0 000 6M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-2.9 1.2V21a2 2 0 11-4 0v-.1A1.7 1.7 0 007 19.7l-.1.1a2 2 0 11-2.8-2.8l.1-.1A1.7 1.7 0 004 15M20 12h.1M3.9 12H4" },
];
