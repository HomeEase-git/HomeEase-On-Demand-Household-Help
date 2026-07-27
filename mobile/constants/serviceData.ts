export type ServiceTask = {
  id: string;
  name: string;
  basePrice: number;
  durationHours: number;
  description: string;
};

export type ServiceAddOn = {
  id: string;
  name: string;
  price: number;
  description: string;
};

export type ServiceConfig = {
  categoryId: string;
  categoryName: string;
  tasks: ServiceTask[];
  addOns: ServiceAddOn[];
};

export const serviceConfigs: ServiceConfig[] = [
  {
    categoryId: "plumbing",
    categoryName: "Plumbing",
    tasks: [
      {
        id: "p1",
        name: "Pipe Repair",
        basePrice: 300,
        durationHours: 1,
        description: "Fix leaking or broken pipes",
      },
      {
        id: "p2",
        name: "Drain Cleaning",
        basePrice: 250,
        durationHours: 1,
        description: "Clear blocked drains and pipes",
      },
      {
        id: "p3",
        name: "Fixture Installation",
        basePrice: 500,
        durationHours: 2,
        description: "Install faucets, toilets, or showers",
      },
      {
        id: "p4",
        name: "Full Inspection",
        basePrice: 400,
        durationHours: 2,
        description: "Complete plumbing system check",
      },
    ],
    addOns: [
      {
        id: "pa1",
        name: "Emergency Response",
        price: 200,
        description: "Priority same-day service",
      },
      {
        id: "pa2",
        name: "Parts & Materials",
        price: 150,
        description: "Basic replacement parts included",
      },
      {
        id: "pa3",
        name: "Follow-up Check",
        price: 100,
        description: "Return visit within 7 days",
      },
    ],
  },
  {
    categoryId: "electrical",
    categoryName: "Electrical",
    tasks: [
      {
        id: "e1",
        name: "Wiring Repair",
        basePrice: 350,
        durationHours: 1,
        description: "Fix faulty or damaged wiring",
      },
      {
        id: "e2",
        name: "Outlet Installation",
        basePrice: 300,
        durationHours: 1,
        description: "Install new power outlets",
      },
      {
        id: "e3",
        name: "Panel Inspection",
        basePrice: 450,
        durationHours: 2,
        description: "Check circuit breakers and panel",
      },
      {
        id: "e4",
        name: "Lighting Setup",
        basePrice: 400,
        durationHours: 2,
        description: "Install or replace light fixtures",
      },
    ],
    addOns: [
      {
        id: "ea1",
        name: "Emergency Response",
        price: 200,
        description: "Priority same-day service",
      },
      {
        id: "ea2",
        name: "Safety Certificate",
        price: 300,
        description: "Official electrical safety document",
      },
      {
        id: "ea3",
        name: "Follow-up Check",
        price: 100,
        description: "Return visit within 7 days",
      },
    ],
  },
  {
    categoryId: "aircon",
    categoryName: "Aircon",
    tasks: [
      {
        id: "ac1",
        name: "General Cleaning",
        basePrice: 350,
        durationHours: 1,
        description: "Full aircon unit cleaning",
      },
      {
        id: "ac2",
        name: "Refrigerant Refill",
        basePrice: 500,
        durationHours: 2,
        description: "Recharge refrigerant levels",
      },
      {
        id: "ac3",
        name: "Unit Installation",
        basePrice: 800,
        durationHours: 3,
        description: "Install new aircon unit",
      },
      {
        id: "ac4",
        name: "Repair & Diagnostics",
        basePrice: 400,
        durationHours: 2,
        description: "Diagnose and fix issues",
      },
    ],
    addOns: [
      {
        id: "aa1",
        name: "Deep Cleaning",
        price: 200,
        description: "Chemical wash and deep clean",
      },
      {
        id: "aa2",
        name: "Parts & Materials",
        price: 150,
        description: "Basic replacement parts included",
      },
      {
        id: "aa3",
        name: "Annual Plan",
        price: 500,
        description: "4 cleanings per year",
      },
    ],
  },
  {
    categoryId: "cleaning",
    categoryName: "Cleaning",
    tasks: [
      {
        id: "cl1",
        name: "Regular Cleaning",
        basePrice: 200,
        durationHours: 2,
        description: "Standard home cleaning",
      },
      {
        id: "cl2",
        name: "Deep Cleaning",
        basePrice: 400,
        durationHours: 4,
        description: "Thorough top-to-bottom clean",
      },
      {
        id: "cl3",
        name: "Move-in/Move-out",
        basePrice: 600,
        durationHours: 6,
        description: "Full property cleaning",
      },
      {
        id: "cl4",
        name: "Post-renovation",
        basePrice: 800,
        durationHours: 8,
        description: "Clean after construction work",
      },
    ],
    addOns: [
      {
        id: "cla1",
        name: "Laundry Service",
        price: 150,
        description: "Wash and fold clothes",
      },
      {
        id: "cla2",
        name: "Ironing",
        price: 100,
        description: "Iron and hang clothes",
      },
      {
        id: "cla3",
        name: "Organizing",
        price: 200,
        description: "Declutter and organize spaces",
      },
    ],
  },
  {
    categoryId: "carpentry",
    categoryName: "Carpentry",
    tasks: [
      {
        id: "ca1",
        name: "Furniture Repair",
        basePrice: 300,
        durationHours: 2,
        description: "Fix broken furniture",
      },
      {
        id: "ca2",
        name: "Cabinet Installation",
        basePrice: 600,
        durationHours: 3,
        description: "Install kitchen or wall cabinets",
      },
      {
        id: "ca3",
        name: "Custom Shelving",
        basePrice: 500,
        durationHours: 3,
        description: "Build and install shelves",
      },
      {
        id: "ca4",
        name: "Door Repair",
        basePrice: 350,
        durationHours: 2,
        description: "Fix or replace doors and frames",
      },
    ],
    addOns: [
      {
        id: "caa1",
        name: "Premium Materials",
        price: 300,
        description: "Higher grade wood and hardware",
      },
      {
        id: "caa2",
        name: "Painting/Finishing",
        price: 200,
        description: "Paint or varnish the work",
      },
      {
        id: "caa3",
        name: "Follow-up Check",
        price: 100,
        description: "Return visit within 7 days",
      },
    ],
  },
];
