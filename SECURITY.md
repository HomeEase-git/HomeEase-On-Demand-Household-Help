# Security policy

Thank you for helping keep HomeEase and the people who use it safe.

## Reporting a vulnerability

Email **homeeaseondemand@gmail.com** with the subject line
**"Security report"**. Please don't open a public GitHub issue for a
security problem.

Include:
- what the problem is and what an attacker could do with it
- the steps to reproduce it (requests, screenshots, a short script)
- the account(s) you used, and roughly when you tested

If your report involves personal data you came across, describe it; don't
send it.

## What happens next

| Step | Target |
|---|---|
| We confirm we received your report | 3 working days |
| We tell you whether it's a real issue and how serious | 10 working days |
| Fix released: critical / high / medium or low | 7 days / 30 days / 90 days |

We'll keep you updated, tell you when it's fixed, and credit you in the
fix notes if you'd like. There's no paid bug bounty at the moment.

## Testing rules (safe harbour)

We won't take legal action against, or ask anyone else to act against,
research done in good faith within these rules:

- Test only with accounts you created. Don't access, change or delete other
  people's data. If you reach someone else's data by accident, stop, don't
  keep a copy, and tell us.
- No denial-of-service, spam, or load testing; no social engineering of
  users, workers or staff; no physical attacks.
- Don't make real payments or payouts beyond the smallest amounts needed to
  show the problem, and tell us about any you made.
- Give us a reasonable time to fix the problem before telling anyone else.

## In scope

- The backend API (`homeease-on-demand-household-help.onrender.com`)
- The admin website (`home-ease-on-demand-household-help.vercel.app`)
- The HomeEase Android app, latest version
- This repository's code and GitHub Actions workflows

## Out of scope

- Problems in third-party services themselves (Xendit, Supabase, Neon,
  Render, Vercel, Google): report those to the provider
- Findings from automated scanners without a demonstrated impact
- Missing security headers, cookie flags or email (SPF/DKIM/DMARC) settings
  without a working attack
- Rate limits that can be exceeded without harming anyone
- Anything requiring a rooted or compromised device, or physical access to
  an unlocked phone

How we handle incidents, including notifying the National Privacy
Commission when personal data is at risk, is described in
[docs/INCIDENT-RESPONSE.md](docs/INCIDENT-RESPONSE.md).
