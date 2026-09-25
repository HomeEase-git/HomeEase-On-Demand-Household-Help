// Standalone links render directly; grouped links collapse related pages
// behind a single dropdown so the sidebar doesn't list every page at once.
export const NAV_STRUCTURE = [
  { type: 'link', to: '/dashboard', page: 'dashboard', icon: 'fa-th-large', label: 'Dashboard' },
  {
    type: 'group',
    key: 'people',
    icon: 'fa-users',
    label: 'Users',
    children: [
      { to: '/users', page: 'users', icon: 'fa-users', label: 'Clients' },
      { to: '/workers', page: 'workers', icon: 'fa-user-cog', label: 'Workers' },
      { to: '/verification', page: 'verification', icon: 'fa-id-card', label: 'Verification' },
    ],
  },
  {
    type: 'group',
    key: 'catalog',
    icon: 'fa-list-check',
    label: 'Catalog & Pricing',
    children: [
      { to: '/service-catalog', page: 'service-catalog', icon: 'fa-list-check', label: 'Service Catalog' },
      { to: '/price-control', page: 'price-control', icon: 'fa-sliders', label: 'Price Control' },
      { to: '/pricing-rules', page: 'pricing-rules', icon: 'fa-coins', label: 'Pricing Rules' },
      { to: '/promo-banners', page: 'promo-banners', icon: 'fa-images', label: 'Promo Banners' },
    ],
  },
  // Bookings and Payments already expose their sub-pages (Disputes, Payouts,
  // Refunds) via an in-page SubNav tab strip, so they stay single links here
  // instead of duplicating that navigation as a sidebar dropdown too. Tax is
  // deliberately its own group rather than more Payments tabs: it's periodic,
  // deadline-driven BIR work (2307s, remittances, VAT review), not day-to-day
  // money movement.
  { type: 'link', to: '/bookings', page: 'bookings', icon: 'fa-calendar-check', label: 'Bookings' },
  { type: 'link', to: '/payments', page: 'payments', icon: 'fa-credit-card', label: 'Payments' },
  {
    type: 'group',
    key: 'tax',
    icon: 'fa-file-invoice-dollar',
    label: 'Tax & Compliance',
    children: [
      { to: '/tax/certificates', page: 'tax-certificates', icon: 'fa-file-invoice', label: 'Tax Certificates' },
      { to: '/tax/remittance', page: 'tax-remittance', icon: 'fa-building-columns', label: 'Tax Remittance' },
      { to: '/tax/vat-registrations', page: 'vat-registrations', icon: 'fa-receipt', label: 'VAT Registrations' },
      { to: '/tax/settings', page: 'tax-settings', icon: 'fa-gear', label: 'Tax Settings' },
    ],
  },
  { type: 'link', to: '/reviews', page: 'reviews', icon: 'fa-star', label: 'Reviews' },
  {
    type: 'group',
    key: 'insights',
    icon: 'fa-chart-line',
    label: 'Insights',
    children: [
      { to: '/reports/logs', page: 'reports', icon: 'fa-chart-bar', label: 'Reports' },
      { to: '/analytics', page: 'analytics', icon: 'fa-chart-line', label: 'Analytics' },
    ],
  },
  { type: 'link', to: '/settings', page: 'settings', icon: 'fa-cog', label: 'Settings' },
]

// Every page in the sidebar as a flat list (group children carry their
// group's name), for the Ctrl/Cmd+K command palette.
export const NAV_PAGES = NAV_STRUCTURE.flatMap((item) =>
  item.type === 'link'
    ? [{ to: item.to, icon: item.icon, label: item.label, group: null }]
    : item.children.map((child) => ({ to: child.to, icon: child.icon, label: child.label, group: item.label })),
)
