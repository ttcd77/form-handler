# Form Handler for Google Sheets

A one-time-purchase toolkit that pipes your static website's contact form submissions into Google Sheets — with email notifications, spam protection, and a setup dashboard. No monthly subscription. One $25 payment. Use on unlimited client sites.

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## The Problem

Freelancers and agencies building static sites hit the same wall: the client wants a contact form, but nobody wants to set up a backend for 5 lines of HTML.

Existing solutions charge monthly:
- **web3forms Pro**: $10/month for Google Sheets integration → $120/year
- **Formspree**: $20/month for file uploads + Sheets
- **Formcarry**: $15/month for 5,000 submissions

For a marketing site that gets 20 submissions a month, that's $120-240/year for a feature the client barely uses.

## The Solution

**Form Handler** replaces all of that with a one-time purchase. You paste the script into Google Apps Script (free), deploy it once, and it runs forever on Google's infrastructure (free — 20,000 emails/day, unlimited sheet rows).

## Features

| Feature | form-to-google-sheets (OSS, 4.7k stars) | Form Handler ($25) |
|---|---|---|
| Google Sheets integration | Yes | Yes |
| Email notification | Manual setup | Built-in, one line |
| Spam protection | None | Honeypot + keyword filter |
| Rate limiting | None | Per-IP, configurable |
| Auto-responder | None | Built-in, templated |
| Setup dashboard | None | setup.html included |
| Documentation | README only | Full guide + troubleshooting |
| Client-ready deploy | DIY | 3-minute setup |

## Quick Start

1. Go to [script.google.com](https://script.google.com) and create a new project
2. Copy `form-handler.gs` into the editor
3. Deploy as a **Web app** (Execute as: Me, Access: Anyone)
4. Add the form from `example-form.html` to your static site
5. Replace `YOUR_SCRIPT_URL` with your deployment URL

Submissions now flow into your Google Sheet. Done.

## Buy the Full Version — $25

The open-source `form-handler.gs` in this repo is production-ready. The $25 full version adds:

- **setup.html** — dark-themed dashboard to configure email, spam filters, rate limits, and auto-reply without touching code
- **Spam protection** — honeypot field detection + keyword blocklist with silent rejection (bots can't tell they're filtered)
- **Rate limiting** — per-IP submission cap, configurable per hour
- **Auto-responder** — templated "thanks" email back to every submitter
- **Full documentation** — step-by-step setup, troubleshooting guide, customization docs
- **Free updates** — all future versions included

**Buy the Full Version — $25** *(payment link coming this week — star the repo to get notified)*

### Why $25 one-time?

web3forms Pro charges $10/month for the same Google Sheets integration. After 2.5 months, you've already paid more than our one-time price. And you can use Form Handler on unlimited client sites — deploy it for every freelance project without additional cost.

## The Full Package

When you buy, you get:
```
form-handler.gs          Core Apps Script (same as this repo)
setup.html               Configuration dashboard (no code editing needed)
example-form.html        Copy-paste ready HTML form
README.md                Full setup guide + troubleshooting
landing-page.html        Ready-to-share product page for your clients
```

## License

MIT — you own the code. Use it for unlimited clients, bundle it with your agency projects, modify it however you want.

## Built by

[selfloom](https://selfloom.ai) — we build tools for developers who hate subscriptions.
