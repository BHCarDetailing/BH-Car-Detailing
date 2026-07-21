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
];
