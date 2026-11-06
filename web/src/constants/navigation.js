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
      { to: '/service-requests', page: 'service-requests', icon: 'fa-screwdriver-wrench', label: 'Service Requests' },
    ],
  },
  {
    type: 'group',
    key: 'catalog',
    icon: 'fa-list-check',
    label: 'Catalog & Pricing',
    children: [
      { to: '/service-catalog', page: 'service-catalog', icon: 'fa-list-check', label: 'Service Catalog' },
      { to: '/price-list', page: 'price-list', icon: 'fa-tags', label: 'Price List' },
      { to: '/price-adjustments', page: 'price-adjustments', icon: 'fa-sliders', label: 'Price Adjustments' },
      { to: '/worker-packages', page: 'worker-packages', icon: 'fa-box', label: 'Worker Packages' },
    ],
  },
  { type: 'link', to: '/bookings', page: 'bookings', icon: 'fa-calendar-check', label: 'Bookings' },
  { type: 'link', to: '/payments', page: 'payments', icon: 'fa-credit-card', label: 'Payments' },
  { type: 'link', to: '/reviews', page: 'reviews', icon: 'fa-star', label: 'Reviews' },
  { type: 'link', to: '/reports/logs', page: 'reports', icon: 'fa-chart-bar', label: 'Reports' },
  { type: 'link', to: '/promo-banners', page: 'promo-banners', icon: 'fa-images', label: 'Promo Banners' },
  { type: 'link', to: '/settings', page: 'settings', icon: 'fa-cog', label: 'Settings' },
]

export const NAV_PAGES = NAV_STRUCTURE.flatMap((item) =>
  item.type === 'link'
    ? [{ to: item.to, icon: item.icon, label: item.label, group: null }]
    : item.children.map((child) => ({ to: child.to, icon: child.icon, label: child.label, group: item.label })),
)
