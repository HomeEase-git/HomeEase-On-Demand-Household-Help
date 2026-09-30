/**
 * Help & Support, Contact Us and About content, shared by the client and
 * worker screens (components/support/*).
 *
 * FAQ answers are plain-language summaries of the User Agreement / Service
 * Agreement in constants/legalDocuments.ts. When a rule changes there (fees,
 * timeouts, penalties), update the matching answer here too.
 */
import type { Ionicons } from "@expo/vector-icons";
import { COMPANY } from "./legalDocuments";

export type IconName = keyof typeof Ionicons.glyphMap;

export type SupportRole = "client" | "worker";

export type FaqItem = { q: string; a: string };
export type FaqCategory = { title: string; icon: IconName; items: FaqItem[] };

// Optional contact channels. Leave null until there is a real, staffed number
// or page — the Contact Us screen hides a row whose value is null.
export const SUPPORT_CHANNELS = {
  email: COMPANY.supportEmail,
  privacyEmail: COMPANY.privacyEmail,
  phone: null as string | null,
  facebookUrl: null as string | null,
  hours: "Monday to Friday, 8:00 AM – 5:00 PM",
  responseTime: "We usually reply within 1–2 business days.",
};

export const PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=com.homeease.app";

export const CONTACT_TOPICS: Record<SupportRole, string[]> = {
  client: ["Booking", "Payment or refund", "A worker", "My account", "App problem", "Other"],
  worker: ["Verification", "Jobs", "Payouts or dues", "Taxes", "My account", "App problem", "Other"],
};

const ACCOUNT_FAQ: FaqItem[] = [
  {
    q: "I forgot my password. What do I do?",
    a: "On the sign-in screen, tap Forgot Password and enter your email. We'll send you a code to set a new password.",
  },
  {
    q: "How do I turn on two-step sign-in?",
    a: "Go to Profile → Two-Step Sign-In. Once it's on, you'll enter a code sent to your email or phone each time you sign in on a new session.",
  },
  {
    q: "My account was suspended. Can I appeal?",
    a: "Yes. We tell you the reason when an account is suspended. Tap \"Request a review\" on the sign-in screen and an admin will look at it.",
  },
  {
    q: "How do I delete my account?",
    a: "Go to Profile → Privacy Settings and tap Delete Account. Your profile, addresses, photos and payment details are erased. Booking, payment and tax records are kept as the law requires, with your name removed. You can't delete your account while a booking is in progress or a payment is due.",
  },
  {
    q: "How can I get a copy of my data?",
    a: `Email ${COMPANY.privacyEmail} with your request. Under the Data Privacy Act you can ask to access, correct or erase your data, or get a copy of it.`,
  },
];

export const CLIENT_FAQ: FaqCategory[] = [
  {
    title: "Booking",
    icon: "calendar-outline",
    items: [
      {
        q: "How do I book a service?",
        a: "On Home, pick a category and a service, choose a worker, then pick a date, an exact start time and your address. Review the total and confirm. The worker has a limited time to accept.",
      },
      {
        q: "What times can I book?",
        a: "Jobs can start any time between 7:00 AM and 6:00 PM, on the worker's working days. Same-day bookings must be at least 2 hours ahead and include a same-day fee of 25% of the service price.",
      },
      {
        q: "What happens if no worker accepts?",
        a: "The request expires and nothing is charged. You can book again with the same or another worker.",
      },
      {
        q: "Can I change the date of my booking?",
        a: "You can ask the worker to reschedule from the booking. If they don't respond within 48 hours, your original date stays. If a worker needs to move your booking, you can accept the new date or cancel for free; if you don't respond within 24 hours, the new date is confirmed.",
      },
      {
        q: "What is a quote, and do I have to accept it?",
        a: "Some jobs need the worker to see the problem first. They send a quote, with photos of receipts for any materials. You can approve it, refuse it so they revise it, or open a dispute. If you don't respond within 24 hours, it's approved automatically.",
      },
      {
        q: "The worker added something to the job. What should I do?",
        a: "Add-ons need your approval in the app before they're added to the price. If you don't respond within 6 hours, the add-on is approved automatically, so check your notifications during the job.",
      },
      {
        q: "Can I see where my worker is?",
        a: "Yes. Once the worker starts travelling to your booking, you can follow their live location on the booking screen until they check in.",
      },
    ],
  },
  {
    title: "Prices & payment",
    icon: "wallet-outline",
    items: [
      {
        q: "How are prices set?",
        a: "HomeEase sets a fixed price for each job. The total you see before confirming can also include a tier fee for Pro or Expert workers, a same-day fee, a distance fee for longer trips, 12% VAT if the worker is VAT-registered, and any tip you add.",
      },
      {
        q: "When and how do I pay?",
        a: "You pay after the job is done, with GCash, Maya or cash. When the worker marks the job complete, you confirm it and pay. If you don't respond within 24 hours, completion is confirmed automatically.",
      },
      {
        q: "Is it safe to pay with GCash or Maya?",
        a: "Yes. GCash and Maya payments go through our payment provider, Xendit. HomeEase never sees or stores your GCash or Maya login.",
      },
      {
        q: "I paid but the app still says the payment is pending.",
        a: "GCash and Maya payments can take a few minutes to confirm. Leave the booking and open it again to refresh. If it still shows unpaid after an hour, contact us with your booking ID. Don't pay a second time.",
      },
      {
        q: "Do tips go to the worker?",
        a: "Yes, tips go to the worker in full.",
      },
      {
        q: "Why can't I make a new booking?",
        a: "New bookings are paused while you have an unpaid balance. That can be a GCash or Maya payment still due, or a ₱200 fee for a job the worker couldn't do because of you. Pay it from the booking to continue.",
      },
    ],
  },
  {
    title: "Cancelling & problems",
    icon: "alert-circle-outline",
    items: [
      {
        q: "Can I cancel a booking?",
        a: "Yes, free of charge until a worker accepts it. Open the booking and tap Cancel Booking. After a worker accepts, message them or contact us. If the worker moves your booking and you don't want the new date, you can cancel for free.",
      },
      {
        q: "The worker didn't show up.",
        a: "If the worker hasn't checked in 1 hour after the start time, the booking is cancelled automatically and you aren't charged.",
      },
      {
        q: "Is there a cancellation fee?",
        a: "Only in one case: a worker arrives but can't do the job because of you (for example, no one lets them in). They must send photo proof, and if HomeEase agrees after reviewing it, you pay ₱200 to compensate them. There are no other cancellation fees.",
      },
      {
        q: "I'm not happy with the work. What can I do?",
        a: "Open the booking and open a dispute, explaining what went wrong. A HomeEase admin reviews the booking, chat, photos, quotes and the worker's check-in, and decides the outcome, which can include a refund.",
      },
      {
        q: "How do refunds work?",
        a: "Refunds are approved by a HomeEase admin after reviewing a dispute, and go back to your original payment method. We don't issue platform credit.",
      },
    ],
  },
  {
    title: "Safety & workers",
    icon: "shield-checkmark-outline",
    items: [
      {
        q: "What does \"Verified\" mean?",
        a: "A HomeEase admin has reviewed the worker's government ID, a selfie matched against it, and a police, NBI or barangay clearance. It confirms who they are. It isn't a guarantee of the quality of their work.",
      },
      {
        q: "What are Pro and Expert workers?",
        a: "Tiers based on a worker's rating, completed jobs and years of experience. Pro and Expert workers add a tier fee to the price.",
      },
      {
        q: "Can I pay a worker outside the app?",
        a: "No. Arranging or paying for work outside the app isn't allowed, and it also means we can't help with disputes or refunds for that work.",
      },
      {
        q: "How do I report a worker?",
        a: "For a problem with a booking, open a dispute on it. For anything about your safety, contact us right away with the booking ID. If you're in danger, call 911 first.",
      },
    ],
  },
  { title: "Account", icon: "person-circle-outline", items: ACCOUNT_FAQ },
];

export const WORKER_FAQ: FaqCategory[] = [
  {
    title: "Getting verified",
    icon: "id-card-outline",
    items: [
      {
        q: "What documents do I need?",
        a: "A government ID (front and back), a selfie, an NBI clearance, a health certificate and your resume. A barangay or police clearance and cedula are optional. Some services also need a certification. You must be at least 18.",
      },
      {
        q: "How long does verification take?",
        a: "A HomeEase admin reviews every application. An automated check runs first to help them, but a person makes the decision. You'll get a notification when it's done.",
      },
      {
        q: "My verification was rejected. What now?",
        a: "The rejection notice tells you what needs fixing. Upload the corrected documents and submit again. If you think it was a mistake, contact us.",
      },
      {
        q: "My clearance expired.",
        a: "Clearances expire (an NBI clearance after 1 year). The app asks you to upload a new one. Upload it in Profile → My Documents to keep taking jobs.",
      },
      {
        q: "Who can see my documents?",
        a: "Only HomeEase admins. Your ID, selfie, clearances, resume, phone number and home address are never on your public profile. A client you've accepted a booking with can see your phone number and, while you travel to their job, your live location.",
      },
    ],
  },
  {
    title: "Jobs",
    icon: "construct-outline",
    items: [
      {
        q: "How do I get more jobs?",
        a: "Keep your services and weekly schedule up to date in Profile, accept requests quickly, and keep a good rating. Late cancellations and no-shows lower your position when clients are matched with workers.",
      },
      {
        q: "Can I set my own prices?",
        a: "No. HomeEase sets the price of each job. It changes only with add-ons, distance, your tier, the number of units and the same-day fee. Pro and Expert tiers add a tier fee.",
      },
      {
        q: "Can I decline a request?",
        a: "Yes. But if you decline 3 requests within 7 days, new requests pause for 24 hours.",
      },
      {
        q: "How do I check in?",
        a: "While you travel to a job, the client can see your live location. You must be at the client's address to check in, and your live location stops being shared once you do. Fake-GPS apps are detected and block check-in.",
      },
      {
        q: "How do quotes and add-ons work?",
        a: "For jobs that need a quote, send it from the booking. Attach photos of the receipt and of the materials for any materials you add. The client can approve it or ask you to revise it. Add-ons during a job also need the client's approval.",
      },
      {
        q: "Two of my jobs overlap. What do I do?",
        a: "Ask one of the clients to reschedule from the booking. If you miss a job, it counts as a no-show.",
      },
    ],
  },
  {
    title: "Cancelling & no-shows",
    icon: "close-circle-outline",
    items: [
      {
        q: "Can I cancel a job I accepted?",
        a: "Before you arrive, yes, giving a reason. After you've checked in, you can only cancel with photo proof and by saying whose fault it is.",
      },
      {
        q: "What is the no-show penalty?",
        a: "If you haven't checked in 1 hour after the start time, the booking is cancelled as a no-show and a ₱200 penalty is added to your dues. The same penalty applies if you cancel after check-in and it's your fault.",
      },
      {
        q: "The client wasn't there or wouldn't let me in.",
        a: "Cancel from the booking with photo proof and say it's the client's fault. HomeEase reviews it. If approved, you receive ₱200 compensation.",
      },
    ],
  },
  {
    title: "Earnings & payouts",
    icon: "cash-outline",
    items: [
      {
        q: "How much does HomeEase keep?",
        a: "A 10% commission on the job price, fixed when you accept the job. 2% withholding tax is also deducted and paid to the BIR for you. Tips go to you in full.",
      },
      {
        q: "When do I get paid?",
        a: "For GCash and Maya jobs, your earnings are sent to your GCash or Maya account through Xendit once the client's payment is confirmed. For cash jobs, the client pays you directly.",
      },
      {
        q: "I haven't received my payout.",
        a: "Check that you've added a payout account in Earnings → Payout Method. Earnings are held until you do. If you owe dues from cash jobs, they're deducted from your payouts first. If it still looks wrong, contact us with the booking ID.",
      },
      {
        q: "What are dues?",
        a: "For cash jobs, the commission and withholding tax are recorded as an amount you owe HomeEase, along with any penalties. Dues are deducted from your next payouts. If you owe more than ₱500, you can't accept new jobs until you settle them.",
      },
      {
        q: "Will I get a BIR Form 2307?",
        a: "Yes, each quarter, if your TIN is on file. Registering for and paying your own taxes is still your responsibility.",
      },
    ],
  },
  {
    title: "Ratings & disputes",
    icon: "star-outline",
    items: [
      {
        q: "A client left an unfair review.",
        a: "You can reply publicly to any review. HomeEase may remove reviews that are false, abusive or unrelated to the job. Contact us with the booking ID if you think a review breaks the rules.",
      },
      {
        q: "Can my account be suspended automatically?",
        a: "Yes, if your average rating falls too low or you get too many disputes in a short period. We tell you the reason. Tap \"Request a review\" on the sign-in screen and an admin will look at it.",
      },
      {
        q: "How are disputes decided?",
        a: "Either you or the client can open a dispute on a booking. A HomeEase admin reviews the chat, booking records, quotes, photos and check-in location, and decides. If you think a decision is wrong, contact us to ask for it to be reconsidered.",
      },
    ],
  },
  { title: "Account", icon: "person-circle-outline", items: ACCOUNT_FAQ },
];

export const ABOUT_CONTENT: Record<
  SupportRole,
  { intro: string; highlights: { icon: IconName; title: string; body: string }[] }
> = {
  client: {
    intro:
      "HomeEase connects households with verified home service workers for plumbing, cleaning, electrical, aircon, carpentry and more. Fixed prices, no haggling, and you only pay once the job is done.",
    highlights: [
      {
        icon: "shield-checkmark-outline",
        title: "Verified workers",
        body: "Every worker's ID, selfie and clearance is reviewed by a HomeEase admin.",
      },
      {
        icon: "pricetag-outline",
        title: "Clear, fixed prices",
        body: "You see the full total before you book.",
      },
      {
        icon: "checkmark-done-outline",
        title: "Pay after the job",
        body: "Pay with GCash, Maya or cash once the work is done.",
      },
      {
        icon: "people-outline",
        title: "Help when it goes wrong",
        body: "Disputes are reviewed by a real person at HomeEase.",
      },
    ],
  },
  worker: {
    intro:
      "HomeEase helps skilled home service workers find jobs near them. Set your schedule, get booked at fair fixed prices, and get paid to your GCash or Maya account.",
    highlights: [
      {
        icon: "calendar-outline",
        title: "Your schedule",
        body: "Choose the days you work and accept the jobs you want.",
      },
      {
        icon: "pricetag-outline",
        title: "Fixed prices",
        body: "No haggling. Tiers reward experience and good ratings.",
      },
      {
        icon: "wallet-outline",
        title: "Fast payouts",
        body: "GCash and Maya earnings go straight to your account.",
      },
      {
        icon: "document-text-outline",
        title: "Taxes handled",
        body: "Withholding tax is filed for you, with a quarterly BIR Form 2307.",
      },
    ],
  },
};

export const DEVELOPER_CREDIT =
  "Developed by Dela Cruz, Flores, Relleja, Robles — BulSU 2026";
