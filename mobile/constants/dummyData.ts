export const workers = [
  {
    id: 'w1',
    name: 'Juan Dela Cruz',
    service: 'Plumbing',
    rate: 250,
    rating: 4.8,
    reviews: 120,
    status: 'available',
    lat: 14.5995,
    lng: 120.9842, // Manila
  },
  {
    id: 'w2',
    name: 'Maria Santos',
    service: 'Electrical',
    rate: 300,
    rating: 4.9,
    reviews: 98,
    status: 'available',
    lat: 14.6091,
    lng: 121.0223, // Cubao, Quezon City (~4km from Manila)
  },
  {
    id: 'w3',
    name: 'Pedro Reyes',
    service: 'Aircon Services',
    rate: 350,
    rating: 4.7,
    reviews: 75,
    status: 'unavailable',
    lat: 14.5547,
    lng: 121.0244, // Makati (~7km from Manila)
  },
  {
    id: 'w4',
    name: 'Ana Lim',
    service: 'House Cleaning',
    rate: 200,
    rating: 5.0,
    reviews: 200,
    status: 'available',
    lat: 14.5511,
    lng: 121.0509, // BGC, Taguig (~9km from Manila)
  },
  {
    id: 'w5',
    name: 'Jose Garcia',
    service: 'Carpentry',
    rate: 280,
    rating: 4.6,
    reviews: 55,
    status: 'available',
    lat: 14.4599,
    lng: 120.8998, // Bacoor, Cavite (~18km from Manila)
  }
] as const;

export const categories = [
  { id: 'plumbing', name: 'Plumbing', count: 24 },
  { id: 'electrical', name: 'Electrical', count: 18 },
  { id: 'aircon', name: 'Aircon', count: 15 },
  { id: 'cleaning', name: 'Cleaning', count: 32 },
  { id: 'carpentry', name: 'Carpentry', count: 12 },
  { id: 'painting', name: 'Painting', count: 9 },
  { id: 'gardening', name: 'Gardening', count: 7 },
  { id: 'appliance', name: 'Appliance', count: 20 }
] as const;

export const bookings = [
  {
    id: 'BK-001',
    service: 'House Cleaning',
    worker: 'Ana Lim',
    date: '2026-03-01',
    status: 'Pending',
    amount: 400,
    paymentMethod: 'Cash'
  },
  {
    id: 'BK-002',
    service: 'Plumbing',
    worker: 'Juan',
    date: '2026-02-28',
    status: 'Active',
    amount: 500,
    paymentMethod: 'Cash'
  },
  {
    id: 'BK-003',
    service: 'Electrical',
    worker: 'Maria',
    date: '2026-02-20',
    status: 'Completed',
    amount: 600,
    paymentMethod: 'Maya',
    address: '123 Sample Street, Makati City',
    time: '10:30',
    workerId: 'w2',
    category: 'Electrical',
    selectedTaskId: 'e2',
    selectedAddOnIds: ['ea2', 'ea3']
  },
  {
    id: 'BK-004',
    service: 'Aircon',
    worker: 'Pedro',
    date: '2026-02-15',
    status: 'Cancelled',
    amount: 700,
    paymentMethod: 'GCash'
  }
] as const;

export const transactions = [
  {
    id: 'TXN-001',
    bookingId: 'BK-003',
    amount: 600,
    method: 'GCash',
    status: 'Completed',
    date: '2026-02-20'
  },
  {
    id: 'TXN-002',
    bookingId: 'BK-001',
    amount: 400,
    method: 'Cash',
    status: 'Pending',
    date: '2026-03-01'
  },
  {
    id: 'TXN-003',
    bookingId: 'BK-002',
    amount: 500,
    method: 'Maya',
    status: 'Completed',
    date: '2026-02-28'
  }
] as const;

export const conversations = [
  {
    id: 'c1',
    name: 'Juan Dela Cruz',
    lastMessage: 'On my way na po!',
    time: '10:30 AM',
    unread: 2
  },
  {
    id: 'c2',
    name: 'Ana Lim',
    lastMessage: 'Done na po, please check.',
    time: 'Yesterday',
    unread: 0
  },
  {
    id: 'c3',
    name: 'Maria Santos',
    lastMessage: 'Sige po, confirmed!',
    time: 'Mon',
    unread: 1
  }
] as const;


