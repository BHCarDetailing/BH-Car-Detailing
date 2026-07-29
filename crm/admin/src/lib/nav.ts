export interface NavItem {
  to: string;
  label: string;
  short: string; // bottom-nav label (mobile)
  icon: string;  // inline SVG path data, drawn in a 24x24 viewBox
  keywords?: string; // extra terms for sidebar search
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

/* Grouped navigation for the operating-system sidebar. Existing operational
   pages (Pipeline, Calendar, Inbox, Contacts, Sequences, Import, Settings) are
   preserved — nothing was removed, only organized and extended. */
export const NAV_GROUPS: NavGroup[] = [
  {
    title: "Overview",
    items: [
      { to: "/home", label: "Home", short: "Home", icon: "M3 11l9-8 9 8M5 10v10h14V10z", keywords: "start overview today due work" },
      { to: "/dashboard", label: "Dashboard", short: "Board", icon: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z", keywords: "metrics revenue stats numbers board" },
    ],
  },
  {
    title: "Growth",
    items: [
      { to: "/gtm", label: "GTM", short: "GTM", icon: "M12 3a9 9 0 100 18 9 9 0 000-18zM12 8a4 4 0 100 8 4 4 0 000-8zM12 12h.01", keywords: "go to market mission vision values roles" },
      { to: "/discovery", label: "Discovery", short: "Discover", icon: "M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-4-4", keywords: "leads notes calls" },
      { to: "/clients", label: "Clients", short: "Clients", icon: "M4 8h16v11H4zM9 8V6a3 3 0 016 0v2", keywords: "accounts customers clients" },
      { to: "/quote-builder", label: "Quote Builder", short: "Quote", icon: "M9 5h6a2 2 0 012 2v12l-5-3-5 3V7a2 2 0 012-2z", keywords: "estimate quote in person wizard sell on the spot deposit price new job book" },
      { to: "/pipeline", label: "Pipeline", short: "Pipeline", icon: "M4 6h16M4 12h10M4 18h7", keywords: "deals stages kanban" },
      { to: "/revenue", label: "Revenue", short: "Revenue", icon: "M12 3v18M8 7h6a3 3 0 010 6H8m0 0h8", keywords: "arr mrr money income sales paid deposits" },
    ],
  },
  {
    title: "Operations",
    items: [
      { to: "/calendar", label: "Calendar", short: "Calendar", icon: "M7 3v4M17 3v4M4 8h16M4 8v12h16V8", keywords: "schedule jobs appointments booking today week diary" },
      { to: "/inbox", label: "Inbox", short: "Inbox", icon: "M4 5h16v11H8l-4 4V5z", keywords: "messages sms text texting chat replies conversations webchat" },
      { to: "/contacts", label: "Contacts", short: "Contacts", icon: "M16 20a4 4 0 00-8 0M12 12a4 4 0 100-8 4 4 0 000 8", keywords: "leads people customers clients contacts phone numbers" },
      { to: "/reactivation", label: "Reactivation", short: "Reactivate", icon: "M4 4v6h6M20 20v-6h-6M20 9A8 8 0 006 5.3M4 15a8 8 0 0014 3.7", keywords: "dead book old leads follow up win back reactivate cold" },
      { to: "/onboarding", label: "Onboarding", short: "Onboard", icon: "M9 12l2 2 4-4M12 21a9 9 0 110-18 9 9 0 010 18", keywords: "new hires steps" },
      { to: "/products", label: "Products", short: "Products", icon: "M3 7l9-4 9 4-9 4-9-4zM3 7v10l9 4 9-4V7", keywords: "services pricing packages menu products price list detail wash" },
    ],
  },
  {
    title: "Performance",
    items: [
      { to: "/kpi", label: "KPI", short: "KPI", icon: "M4 20V10M10 20V4M16 20v-8M22 20H2", keywords: "goals metrics targets" },
      { to: "/accountability", label: "Accountability", short: "Tasks", icon: "M9 11l3 3 6-6M21 12a9 9 0 11-6.2-8.5", keywords: "tasks todo momentum goals" },
      { to: "/updates", label: "Updates", short: "Updates", icon: "M3 11l14-6v14L3 13zM17 8a3 3 0 010 6", keywords: "feed announcements posts" },
    ],
  },
  {
    title: "People",
    items: [
      { to: "/team", label: "Team", short: "Team", icon: "M17 20a5 5 0 00-10 0M12 11a4 4 0 100-8 4 4 0 000 8", keywords: "members roster staff" },
      { to: "/partners", label: "Partners & SDRs", short: "Partners", icon: "M9 15l6-6M10.5 6.5l1-1a3.5 3.5 0 015 5l-1 1M13.5 17.5l-1 1a3.5 3.5 0 01-5-5l1-1", keywords: "sdr outreach referral" },
      { to: "/advisors", label: "Advisors", short: "Advisors", icon: "M12 4l9 5-9 5-9-5 9-5zM6 11v4c0 1 3 3 6 3s6-2 6-3v-4", keywords: "mentors board" },
    ],
  },
  {
    title: "Tools",
    items: [
      { to: "/ask", label: "Ask Claude", short: "Ask AI", icon: "M12 3l1.8 4.7L18.5 9l-4.7 1.8L12 15l-1.8-4.2L5.5 9z", keywords: "ai assistant help copilot" },
      { to: "/sequences", label: "Sequences", short: "Sequences", icon: "M3 5h4v4H3zM3 15h4v4H3zM10 7h11M10 17h11", keywords: "email nurture automation sequences campaigns follow up" },
      { to: "/import", label: "Import", short: "Import", icon: "M12 3v12M8 11l4 4 4-4M4 19h16", keywords: "csv vcard upload" },
      { to: "/docs", label: "Docs & Legal", short: "Docs", icon: "M7 3h9l3 3v15H7zM15 3v4h4", keywords: "agreements files legal" },
      { to: "/settings", label: "Settings", short: "Settings", icon: "M12 15a3 3 0 100-6 3 3 0 000 6M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-2.9 1.2V21a2 2 0 11-4 0v-.1A1.7 1.7 0 007 19.7l-.1.1a2 2 0 11-2.8-2.8l.1-.1A1.7 1.7 0 004 15M20 12h.1M3.9 12H4", keywords: "config integrations tax stripe twilio setup preferences" },
    ],
  },
];

/** Flat list of every nav item (search, routing helpers). */
export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

/**
 * The phone's tab bar: the four things done standing up, plus More.
 *
 * Quote Builder sits in the middle as a raised button because it is the one
 * that makes money, and it needs to be reachable one-thumbed while standing
 * next to a customer's car, without opening a menu first.
 * Dashboard and Clients were here before; Dashboard duplicates Home and Clients
 * holds no records, so neither earned a permanent slot.
 */
export const BOTTOM_NAV: NavItem[] = [
  NAV_ITEMS.find((i) => i.to === "/home")!,
  NAV_ITEMS.find((i) => i.to === "/calendar")!,
  NAV_ITEMS.find((i) => i.to === "/quote-builder")!,
  NAV_ITEMS.find((i) => i.to === "/inbox")!,
];

/** Index of the slot rendered as the raised primary action. */
export const BOTTOM_NAV_PRIMARY = 2;
