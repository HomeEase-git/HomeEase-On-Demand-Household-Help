# HomeEaseAdmin - React Dashboard

Admin dashboard for HomeEase, built with React and Vite.

## Project Structure

```
src/
├── main.jsx              # Entry point
├── App.jsx               # App shell with routing
├── components/
│   ├── layout/           # Sidebar, Header, MainLayout
│   └── common/           # Reusable UI (StatCard, SectionCard, Badge, etc.)
├── pages/                # Page components (Dashboard, Users, Workers, etc.)
└── styles/
    └── index.css         # Global styles
```

## Run

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Routes

- `/dashboard` - Main dashboard
- `/analytics` - Analytics & reports
- `/users` - User management (All / Clients / Workers)
- `/workers` - Worker management
- `/verification` - Pending verifications
- `/bookings` - Booking management
- `/payments` - Payments & refunds
- `/reviews` - Reviews management
- `/reports` - System logs & exports
- `/settings` - Admin settings
