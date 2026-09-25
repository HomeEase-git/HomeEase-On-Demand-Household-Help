// Single source for every legal document the app shows: the client User
// Agreement, the worker Service Agreement and the Privacy Policy. Sign-up,
// the acceptance screens and the profile screens all render from here, so
// the text a user accepted is exactly the text they can re-read later.
//
// Rules for editing:
// - Describe what the app ACTUALLY does. If a feature changes (fees,
//   timeouts, cancellation), change the text in the same PR.
// - Bump the document's version in LEGAL_VERSIONS whenever its meaning
//   changes; the version is recorded with every acceptance.
// - Sections marked "[pending counsel review]" in a comment are the legal
//   positions (liability, contractor status, venue) kept from the previous
//   terms until a Philippine lawyer reviews them. Don't reword them casually.

export const LEGAL_VERSIONS = {
  CLIENT_USER_AGREEMENT: "2026-09-25",
  WORKER_SERVICE_AGREEMENT: "2026-09-25",
  PRIVACY_NOTICE: "2026-09-25",
  KYC_CONSENT: "2026-09-25",
} as const;

export type LegalDocumentType = keyof typeof LEGAL_VERSIONS;

// TODO(before public launch): add the registered business name and address
// once DTI/SEC registration is done — the Internet Transactions Act requires
// online marketplaces to disclose them. `address: null` hides the line.
export const COMPANY = {
  name: "HomeEase",
  address: null as string | null,
  supportEmail: "homeeaseondemand@gmail.com",
  privacyEmail: "homeeaseondemand@gmail.com",
};

export type LegalSection = {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
};

export type LegalDocument = {
  title: string;
  version: string;
  sections: LegalSection[];
};

const companyLine = COMPANY.address
  ? `${COMPANY.name}, ${COMPANY.address}`
  : COMPANY.name;

const verifiedMeaning =
  "A \"Verified\" badge means a HomeEase admin has reviewed the worker's government ID, a selfie matched against it, and a police, NBI or barangay clearance, with help from an automated document check. It confirms identity and that a clearance was on file when checked. It is not a guarantee of the quality of their work or of their conduct.";

export const CLIENT_TERMS: LegalDocument = {
  title: "User Agreement",
  version: LEGAL_VERSIONS.CLIENT_USER_AGREEMENT,
  sections: [
    {
      heading: "1. About this agreement",
      paragraphs: [
        `This agreement is between you (the "Client") and ${companyLine} ("HomeEase", "we"). It applies when you create an account and book services through the HomeEase app.`,
        `Questions: ${COMPANY.supportEmail}.`,
      ],
    },
    {
      // [pending counsel review]
      heading: "2. What HomeEase is",
      paragraphs: [
        "HomeEase is a platform that connects clients with independent home service workers. We do not employ workers directly. Each booking is an agreement between you and the worker you book; HomeEase provides the app, payments, verification and dispute handling.",
      ],
    },
    {
      heading: "3. Verified workers",
      paragraphs: [verifiedMeaning],
    },
    {
      heading: "4. Booking",
      bullets: [
        "Bookings must be made at least 2 days ahead.",
        "A booking request expires if no worker accepts it in time. Nothing is charged for an expired request.",
        "Some jobs need a quote. If you don't approve or reject a quote within 24 hours, it is approved automatically.",
        "If a worker proposes an add-on during the job and you don't respond within 6 hours, it is approved automatically.",
        "If a worker needs to move your booking because of a scheduling conflict and you don't respond within 24 hours, the new date is confirmed automatically. You can instead cancel free of charge.",
        "If you ask to reschedule and the worker doesn't respond within 48 hours, your request is declined and the original date stays.",
      ],
    },
    {
      heading: "5. Prices and fees",
      paragraphs: [
        "The total is shown before you confirm a booking. It can include:",
      ],
      bullets: [
        "The worker's price for the job, plus any add-ons or approved quote.",
        "A tier fee for Pro or Expert workers (based on their rating and number of completed jobs).",
        "A distance fee for travel beyond the free distance, calculated from the worker's address to yours.",
        "An optional tip, which goes in full to the worker.",
        "12% VAT, only if the worker is VAT-registered.",
      ],
    },
    {
      heading: "6. Payment",
      bullets: [
        "You pay after the job is done. When the worker marks the job complete, you confirm it. If you don't respond within 24 hours, completion is confirmed automatically.",
        "GCash and Maya payments are processed by our payment provider, Xendit. HomeEase does not store your GCash or Maya login details.",
        "Cash is paid directly to the worker.",
        "If a GCash or Maya payment is still unpaid 72 hours after completion, it becomes a dispute handled by HomeEase. While a balance is unpaid, you may not be able to make new bookings.",
      ],
    },
    {
      heading: "7. Cancelling",
      bullets: [
        "You can cancel free of charge until a worker accepts your booking.",
        "After a worker accepts, you can't cancel in the app, except: if the worker hasn't checked in 2 hours after the scheduled start, or if the worker moved your booking and you don't want the new date. Both are free of charge.",
        "Otherwise, message the worker or contact HomeEase support.",
        "There are no cancellation fees.",
      ],
    },
    {
      heading: "8. Problems, disputes and refunds",
      paragraphs: [
        "If something goes wrong, open a dispute on the booking in the app. A HomeEase admin reviews the booking record, chat messages, photos, quotes and the worker's check-in location, and decides the outcome, which may include a refund to your original payment method. We don't issue platform credit.",
        "This process doesn't limit your other rights under Philippine law, including filing a complaint with the Department of Trade and Industry.",
      ],
    },
    {
      heading: "9. Your responsibilities",
      bullets: [
        "Give accurate information about the job and your address.",
        "Be reasonably available at the scheduled time and provide a safe place to work.",
        "Treat workers with respect.",
        "Don't ask for work outside what was booked without agreeing an updated price in the app.",
      ],
    },
    {
      heading: "10. Not allowed",
      bullets: [
        "Arranging or paying for services with a worker outside the app for work you found through HomeEase.",
        "False reviews or complaints.",
        "Sharing another person's personal information without their consent.",
        "Harassment, discrimination or abuse of workers.",
      ],
    },
    {
      heading: "11. Reviews",
      paragraphs: [
        "Reviews must be honest and about your own booking. HomeEase may remove reviews that are false, abusive or unrelated to the job. Workers can reply publicly.",
      ],
    },
    {
      heading: "12. Suspension",
      paragraphs: [
        "HomeEase may suspend or permanently ban accounts involved in fraud, non-payment, repeated policy violations or activity harmful to other users. We'll tell you the reason. If you believe it's a mistake, tap \"Request a review\" on the sign-in screen and an admin will review it.",
      ],
    },
    {
      heading: "13. Deleting your account",
      paragraphs: [
        "You can delete your account in Profile settings. Your profile, addresses, photos and payment details are erased. Booking, payment and tax records are kept as the law requires, with your name removed. You can't delete your account while a booking is in progress or a payment is due.",
      ],
    },
    {
      // [pending counsel review]
      heading: "14. Responsibility for services",
      paragraphs: [
        "Workers are responsible for the quality and completion of their work. HomeEase does not guarantee the quality of services performed, but will review disputes as described above.",
      ],
    },
    {
      // [pending counsel review]
      heading: "15. Changes and governing law",
      paragraphs: [
        "We may update this agreement. The date below shows the current version.",
        "This agreement is governed by the laws of the Republic of the Philippines. Disputes shall be resolved in the appropriate courts of Bulacan province.",
      ],
    },
  ],
};

export const WORKER_AGREEMENT: LegalDocument = {
  title: "Service Agreement",
  version: LEGAL_VERSIONS.WORKER_SERVICE_AGREEMENT,
  sections: [
    {
      heading: "1. About this agreement",
      paragraphs: [
        `This agreement is between you (the "Worker") and ${companyLine} ("HomeEase", "we"). It applies when you register and offer services through the HomeEase app.`,
        `Questions: ${COMPANY.supportEmail}.`,
      ],
    },
    {
      // [pending counsel review]
      heading: "2. Independent contractor",
      paragraphs: [
        "HomeEase is an intermediary platform that connects independent service workers with clients. HomeEase does not employ you. You operate as an independent contractor and are responsible for the quality and completion of the services you provide.",
      ],
    },
    {
      heading: "3. Verification",
      bullets: [
        "You must be at least 18 years old.",
        "You submit a government ID, a selfie, a clearance (NBI, police or barangay) and any certifications. An automated service checks the documents first to help the reviewer; a HomeEase admin makes the decision.",
        "Clearances expire (an NBI clearance after 1 year). When one expires you'll be asked to upload a new one.",
        verifiedMeaning,
      ],
    },
    {
      heading: "4. What clients see",
      paragraphs: [
        "Clients see your name, photo, bio, city, rating, reviews, services and prices, and only the certifications you choose to show. Your ID, selfie, clearances, resume file, phone number and home address are never shown on your public profile. A client you've accepted a booking with can see your phone number and, while you travel to their job, your live location.",
      ],
    },
    {
      heading: "5. Jobs and your prices",
      bullets: [
        "You set your prices for each job, within the price range HomeEase sets for each city.",
        "You're free to accept or decline requests. If you decline 3 requests within 7 days, new requests pause for 24 hours.",
        "Late cancellations and no-shows lower your position when clients are matched with workers.",
        "Pro and Expert tiers are based on your rating and completed jobs, and add a tier fee to your price.",
      ],
    },
    {
      heading: "6. Travel and check-in",
      paragraphs: [
        "While you travel to an accepted booking, the app shares your live location with that client. To check in, you must be at the client's address. Fake-GPS apps are detected and block check-in. Your live location is cleared when you check in, and never kept for more than 2 hours after your last update.",
      ],
    },
    {
      heading: "7. Commission, tax and payouts",
      bullets: [
        "HomeEase keeps a commission from the job price, currently 10%. The rate is fixed when you accept each job.",
        "2% withholding tax is deducted and paid to the BIR on your behalf. If your TIN is on file, you receive a BIR Form 2307 each quarter.",
        "Tips go to you in full. If you're VAT-registered, the VAT the client pays is passed to you, and filing it is your responsibility. We'll notify you if your earnings pass the ₱3,000,000 VAT registration threshold.",
        "Registering for and paying your own taxes is your responsibility.",
        "For GCash and Maya jobs, your earnings are sent to your GCash or Maya account through Xendit once the client's payment is confirmed. If you haven't added a payout account, earnings are held until you do.",
        "For cash jobs, the client pays you directly, and the commission and withholding tax are recorded as an amount you owe HomeEase. It is deducted from your next payouts. If you owe more than the limit set by HomeEase (currently ₱500), you can't accept new jobs until it's settled.",
      ],
    },
    {
      heading: "8. Cancellations and no-shows",
      paragraphs: [
        "You can cancel an accepted booking, giving a reason. If you haven't checked in 2 hours after the scheduled start, the booking is marked as a possible no-show and the client can cancel free of charge. Cancellations that are your fault and no-shows are recorded.",
      ],
    },
    {
      heading: "9. Ratings and automatic suspension",
      paragraphs: [
        "HomeEase may automatically suspend an account whose average rating falls to or below a limit, or that receives more than a set number of disputes within a period. The limits are set by HomeEase. You'll be told the reason. Tap \"Request a review\" on the sign-in screen and an admin will review it; only an admin can permanently ban an account.",
      ],
    },
    {
      heading: "10. Disputes",
      paragraphs: [
        "Either you or the client can open a dispute on a booking. HomeEase reviews the chat messages, booking records, quotes, photos and check-in location, and decides the outcome (for example approving a quote, requesting a revised quote, or cancelling with a refund). If you think a decision is wrong, contact support to ask for it to be reconsidered. This process doesn't limit your other legal remedies.",
      ],
    },
    {
      heading: "11. Not allowed",
      bullets: [
        "Arranging jobs or payment with a client outside the app for work you found through HomeEase.",
        "Misrepresenting your qualifications or submitting false documents.",
        "Sharing a client's personal information with anyone.",
        "Discrimination, harassment or working under the influence of alcohol or drugs.",
      ],
    },
    {
      // [pending counsel review]
      heading: "12. Ending this agreement",
      paragraphs: [
        "Either party may end this agreement with 7 days' written notice, or you can delete your account at any time when no booking or payout is pending. HomeEase may immediately suspend accounts involved in fraud, harm to others or serious policy violations.",
      ],
    },
    {
      // [pending counsel review]
      heading: "13. Changes and governing law",
      paragraphs: [
        "We may update this agreement. The date below shows the current version.",
        "This agreement is governed by the laws of the Republic of the Philippines. Disputes shall be resolved in the appropriate courts of Bulacan province.",
      ],
    },
  ],
};

export const PRIVACY_POLICY: LegalDocument = {
  title: "Privacy Policy",
  version: LEGAL_VERSIONS.PRIVACY_NOTICE,
  sections: [
    {
      heading: "1. Who we are",
      paragraphs: [
        `${companyLine} runs the HomeEase app and is responsible for your personal data under the Data Privacy Act of 2012 (RA 10173).`,
        `Data Protection Officer: ${COMPANY.privacyEmail}`,
      ],
    },
    {
      heading: "2. What we collect",
      bullets: [
        "Everyone: name, email, phone number, password (stored hashed), profile photo, notification settings, device push token, and the IP address and device used when you sign up or accept our terms.",
        "Clients: service addresses and their map location, booking details and photos you attach.",
        "Workers: government ID, selfie, police/NBI/barangay clearance, certifications, resume, date of birth, home address, TIN, GCash or Maya payout account, and VAT registration documents.",
        "Location: a worker's live GPS location while travelling to an accepted booking, and their check-in location, including whether a fake-GPS app was detected.",
        "Chat messages and photos, ratings, reviews, disputes, and payment records (amounts, method and status).",
      ],
      paragraphs: [
        "Government ID numbers, your TIN, clearances and your selfie are sensitive personal information. We collect them only with your specific consent, given before you upload them.",
      ],
    },
    {
      heading: "3. Why we use it",
      bullets: [
        "To provide the service you signed up for: bookings, matching, payments, payouts, notifications and support.",
        "To verify workers' identity and eligibility (with your consent).",
        "To meet legal duties, such as BIR withholding tax, Form 2307 and record-keeping.",
        "To keep the platform safe: preventing fraud, detecting fake GPS, resolving disputes and enforcing our terms.",
      ],
    },
    {
      heading: "4. Automated decisions",
      bullets: [
        "An automated AI service reviews verification documents and resumes to help admins. It never approves or rejects anyone; an admin decides.",
        "Worker accounts can be suspended automatically if their rating falls below, or their disputes exceed, limits set by HomeEase. Worker matching considers rating and cancellation history. You can ask for a human review from the sign-in screen.",
      ],
    },
    {
      heading: "5. Who sees your data",
      bullets: [
        "The other person in a booking: a worker sees your name, service address and phone number; a client sees the worker's name, photo, rating, phone number, and live location while the worker travels to that job.",
        "Clients browsing see a worker's public profile only (never their ID documents, phone number or home address).",
        "HomeEase admins, who use two-factor login and whose actions are logged.",
        "Service providers that process data for us: Supabase (file storage), Neon (database, Singapore), Render (servers, Singapore), Anthropic (automated document and resume review, USA), Xendit (payments and payouts), Google Maps (address lookup and distances), PhilSMS (text messages), Brevo (email) and Expo / Google Firebase (push notifications).",
        "Government authorities such as the BIR, when the law requires it.",
      ],
      paragraphs: [
        "Some of these providers store or process data outside the Philippines (Singapore and the USA). We remain responsible for your data when they do.",
      ],
    },
    {
      heading: "6. How long we keep it",
      bullets: [
        "Account and profile data: while your account is active.",
        "ID, selfie, clearance, certification and resume files: while your account is active; erased when you delete it.",
        "Live location: only while travelling to a job; cleared at check-in, and never kept more than 2 hours after the last update.",
        "Booking, payment, payout and tax records: for the period required by tax and accounting law, even after you delete your account (with your name removed).",
        "Chat messages you sent stay visible to the person you sent them to.",
      ],
    },
    {
      heading: "7. Your rights",
      paragraphs: [
        `Under the Data Privacy Act you can ask to be informed about, access, correct, or erase your data, object to its processing, get a copy of it, and withdraw your consent. You can delete your account yourself in Profile settings. For anything else, email ${COMPANY.privacyEmail}.`,
        "Withdrawing consent to identity verification means you can no longer work on HomeEase. You can also complain to the National Privacy Commission (privacy.gov.ph).",
      ],
    },
    {
      heading: "8. Security",
      paragraphs: [
        "ID documents, resumes and chat photos are stored privately and shown only through links that expire after an hour. Payout account numbers and TINs are encrypted. If a breach puts your data at real risk, we will notify you and the National Privacy Commission as the law requires.",
      ],
    },
    {
      heading: "9. Age",
      paragraphs: ["HomeEase is for people aged 18 and over. Workers must be at least 18."],
    },
    {
      heading: "10. Changes",
      paragraphs: [
        "We'll update the date below when this policy changes, and ask for your consent again if a change needs it.",
      ],
    },
  ],
};
