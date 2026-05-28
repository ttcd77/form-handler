---
title: "How to Build a Contact Form Backend for $0/Month Using Google Sheets"
description: "Stop paying monthly for contact forms. Pipe your HTML form submissions directly into Google Sheets with a free Google Apps Script — email notifications, spam protection, auto-responder, and zero recurring cost."
published: true
tags: webdev, javascript, serverless, tutorial, google-sheets
cover_image: null
---

# How to Build a Contact Form Backend for $0/Month Using Google Sheets

You build a static site for a client. Portfolio, landing page, small business website — the kind of project where a full backend would be overkill. Then the client says the one thing every freelance developer dreads:

*"Can we add a contact form?"*

You now have two options: (1) spin up a server, handle SMTP, and add another item to your maintenance list, or (2) reach for one of the SaaS form backends that popped up over the last five years.

The problem with option 2 is the price. Let me show you what I mean.

## The math that made me look for an alternative

Here's what the popular form backends charge for their Google Sheets integration tier:

| Service | Plan | Monthly | Annual Cost |
|---------|------|---------|-------------|
| **web3forms** | Pro (Sheets + webhooks) | $10/mo | $120/year |
| **Formspree** | Pro (file uploads + Sheets) | $20/mo | $240/year |
| **Formcarry** | Pro (5,000 submissions) | $15/mo | $180/year |
| **FormSubmit** | Pro (custom redirects) | $10/mo | $120/year |
| **getform.io** | Starter (500 submissions) | $14/mo | $168/year |

For a marketing site that receives maybe 20 submissions a month, that's $120–240/year. Per site. If you manage five client sites, you're looking at $600–1,200/year — for the same five lines of HTML `<form>` piped into a spreadsheet. 

There is a free tier on some of these, but it usually strips email notifications, limits submissions, or slaps their branding on your client's UX. Not great.

The open-source community has known about a better way for years. The `form-to-google-sheets` repo has 4,700+ stars for a reason: Google Apps Script can handle form submissions for free, forever, on Google's own infrastructure. The catch? That bare-bones script doesn't include email notifications, spam filtering, rate limiting, or any kind of setup helper. You end up writing glue code anyway.

So I built a replacement that ships with all of that — and the core script is MIT-licensed on GitHub right now. No account needed. No API key. No monthly invoice. Here's how it works.

## How the architecture works (in one diagram)

The flow is embarrassingly simple:

```
[Your static HTML form] → [Google Apps Script web app (doPost)] → [Google Sheet row]
                                           ↓
                                   [Email notification to you]
                                   [Optional auto-reply to submitter]
```

Your HTML form sends a POST request. Google Apps Script receives it via the `doPost` function (the serverless equivalent of a request handler). It validates, filters spam, rate-limits, writes to a sheet, sends you an email, and optionally fires a "thanks for reaching out" email back to the person who submitted. 

All of it runs under Google's free tier: 20,000 outgoing emails per day, unlimited sheet rows, zero server maintenance. If you've ever used an AWS Lambda, this is that — except Google already pays the bill.

## Step 1: Create the Apps Script project

Head to [script.google.com](https://script.google.com), click "New project," and you'll land in a code editor that looks a lot like a lightweight VS Code. This is where the backend lives.

Delete the default `myFunction` placeholder. We'll replace it with something real.

## Step 2: The form handler script

Here's the core of it. The `doPost` function is the entry point — when your HTML form submits, Google calls this automatically.

```javascript
function doPost(e) {
  try {
    return handlePost(e);
  } catch (err) {
    console.error("Unhandled error in doPost: " + err.message);
    return jsonResponse("error", "Internal server error.");
  }
}
```

The real work happens in `handlePost`. Here's the validation pipeline — step by step:

```javascript
function handlePost(e) {
  var cfg = getConfig();

  // Parse incoming data — supports both JSON and form-urlencoded
  var data = parseRequestBody(e);
  if (!data) {
    return jsonResponse("error", "Could not parse request body.");
  }

  // Honeypot check — bots fill invisible fields, humans don't
  if (cfg.honeypotFieldName && data[cfg.honeypotFieldName]) {
    return jsonResponse("success", "Thank you for your message!");
  }

  // Required fields
  var name    = (data.name    || "").trim();
  var email   = (data.email   || "").trim();
  var message = (data.message || "").trim();

  if (!email || !message) {
    return jsonResponse("error", "Email and message are required.");
  }

  // Basic email format check
  if (!isValidEmail(email)) {
    return jsonResponse("error", "Please provide a valid email address.");
  }

  // Keyword-based spam filter — silently rejects with a fake "success"
  var messageLower = message.toLowerCase();
  for (var i = 0; i < cfg.blockedKeywords.length; i++) {
    if (messageLower.indexOf(cfg.blockedKeywords[i].toLowerCase()) !== -1) {
      return jsonResponse("success", "Thank you for your message!");
    }
  }

  // Rate limiting per IP (configurable per hour)
  var ip = getClientIp(e);
  if (!checkRateLimit(ip, cfg.rateLimitPerHour)) {
    return jsonResponse("error", "Too many submissions. Please try again later.");
  }

  // Timestamp + write to Google Sheet (auto-creates sheet if missing)
  var timestamp = new Date();
  ensureSheet(cfg.sheetName);
  appendRow(cfg.sheetName, [timestamp, name, email, message, sourceUrl]);

  // Email notification to site owner
  sendOwnerNotification(cfg, { timestamp: timestamp, name: name, email: email, message: message, source: sourceUrl });

  // Optional auto-reply to the submitter
  if (cfg.autoReplyEnabled) {
    sendAutoReply(cfg, { name: name, email: email });
  }

  return jsonResponse("success", "Thank you for your message!");
}
```

Notice the honeypot trick: any invisible field that gets filled in means a bot touched it. Instead of returning an error (which tells the bot "this filter exists, try again"), the script returns a normal-looking success. The bot thinks it worked and moves on. Your sheet stays clean.

## Step 3: The Google Sheets integration

Writing to a sheet is two functions. The first creates the sheet if it doesn't exist, writes a header row, and freezes it so it stays visible when you scroll:

```javascript
function ensureSheet(sheetName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.appendRow(["Timestamp", "Name", "Email", "Message", "Source URL"]);
    sheet.setFrozenRows(1);
    sheet.getRange("D:D").setWrap(true);
  }
}
```

The second appends a row. That's it. No SQL. No ORM. Google Sheets is your database — and for a contact form, that's genuinely the right tool.

```javascript
function appendRow(sheetName, row) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  sheet.appendRow(row);
}
```

## Step 4: Email notifications (no SMTP setup required)

Apps Script exposes `MailApp.sendEmail()` — a wrapper around Google's mail infrastructure. You don't configure SMTP. You don't worry about relay quotas. You call the function and the email goes out. Here's the owner notification:

```javascript
function sendOwnerNotification(cfg, submission) {
  var subject = "New Contact Form Submission";
  var body = [
    "You received a new message from your website contact form.",
    "",
    "Date:    " + submission.timestamp.toString(),
    "Name:    " + (submission.name || "(not provided)"),
    "Email:   " + submission.email,
    "Source:  " + submission.source,
    "",
    "Message:",
    submission.message,
    "",
    "---",
    "Powered by Form Handler for Google Sheets"
  ].join("\n");

  MailApp.sendEmail({
    to: cfg.recipientEmail,
    subject: subject,
    body: body
  });
}
```

The auto-reply is even simpler — it swaps a `{{name}}` placeholder in your template and fires:

```javascript
function sendAutoReply(cfg, submission) {
  if (!submission.email) return;
  var body = cfg.autoReplyBody.replace("{{name}}", submission.name || "there");
  MailApp.sendEmail({
    to: submission.email,
    subject: cfg.autoReplySubject,
    body: body
  });
}
```

Google's free tier gives you 20,000 outgoing emails per day. For a contact form, you'll never hit that ceiling.

## Step 5: Deploy it

In the Apps Script editor, click **Deploy → New Deployment**. Set the type to "Web app," "Execute as" to "Me," and "Access" to "Anyone." Copy the URL it gives you.

Now wire it up to your HTML form. Here's the relevant JavaScript from the included `example-form.html`:

```javascript
var SCRIPT_URL = 'YOUR_SCRIPT_URL'; // Replace with your deployment URL

form.addEventListener('submit', async function(e) {
  e.preventDefault();

  var res = await fetch(SCRIPT_URL, {
    method: 'POST',
    body: JSON.stringify({
      name:    form.name.value.trim(),
      email:   form.email.value.trim(),
      message: form.message.value.trim(),
      _gotcha: form._gotcha.value   // Bots fill hidden fields
    }),
    headers: { 'Content-Type': 'application/json' }
  });

  var json = await res.json();

  if (json.status === 'success') {
    showMessage('Message sent!', 'success');
    form.reset();
  } else {
    showMessage(json.message || 'Something went wrong.', 'error');
  }
});
```

That's the entire integration surface. No SDK. No npm package. Just a `fetch` call to a URL Google gives you.

Deploy time: about three minutes from scratch. Once deployed, it stays up as long as Google keeps running Apps Script — which, at this point, is a safer bet than most VPS providers.

## What the free version includes vs. what's paid

The script in the GitHub repo is fully functional and MIT-licensed. You can fork it, modify it, bundle it with client projects — no limitations. Here's what you get:

| Feature | Free (GitHub repo) | Paid ($25, one-time) |
|---------|---------------------|------------------------|
| Google Sheets integration | ✅ | ✅ |
| Email notifications to owner | ✅ | ✅ |
| Honeypot spam protection | ✅ | ✅ |
| Keyword-based spam filter | ✅ | ✅ |
| Rate limiting per IP | ✅ | ✅ |
| Auto-responder email | ✅ | ✅ |
| JSON + form-urlencoded parsing | ✅ | ✅ |
| Origin whitelisting | ✅ | ✅ |
| **Setup dashboard** (configure via UI, no code editing) | — | ✅ |
| **Advanced spam rules** (regex patterns, multi-field checks) | — | ✅ |
| **CSV export dashboard** | — | ✅ |
| **Multi-form support** (one script, multiple forms) | — | ✅ |
| **Webhook integrations** (Slack, Discord, Zapier) | — | ✅ |
| **Priority support** | — | ✅ |

The free version is already more feature-complete than most paid form backends. The paid version adds quality-of-life tools for people managing multiple client sites — the setup dashboard alone means you never open the Apps Script editor to change the recipient email or tweak spam keywords.

And unlike the competition, that $25 is a one-time payment. No recurring invoice. No per-site licensing. No usage caps. This is why I built it: I was tired of paying for the same spreadsheet row every month.

## Comparison: Form Handler vs. the popular form backends

| Feature | web3forms Pro | Formspree Pro | Formcarry Pro | **Form Handler** |
|---------|:------------:|:------------:|:------------:|:----------------:|
| Pricing | $10/mo | $20/mo | $15/mo | **$0 (OSS) / $25 one-time** |
| Google Sheets | ✅ | ✅ | ✅ | ✅ |
| Email notifications | ✅ | ✅ | ✅ | ✅ |
| Spam protection | reCAPTCHA only | reCAPTCHA only | reCAPTCHA only | **Honeypot + keyword + origin** |
| Custom domain send | ❌ | ✅ | ❌ | **N/A (uses your Gmail)** |
| File uploads | ❌ | ✅ | ❌ | ❌ |
| Source code access | ❌ | ❌ | ❌ | **✅ MIT license** |
| Unlimited sites | ❌ | ❌ | ❌ | **✅** |
| No branding | $10/mo tier | $20/mo tier | $15/mo tier | **✅ Always** |

The trade-off is clear: if you need file uploads, use Formspree. For everything else — especially static marketing sites, portfolio contact forms, and freelance client projects — a Google Apps Script is the right tool at literally the right price.

## Why I open-sourced it

I built this originally for my own freelance projects. Every new client wanted a contact form, and every time I begrudgingly signed up for another web3forms account. After the fourth one, I did the math:

- 5 client sites × $10/month = $600/year
- Google Apps Script: free. Forever. On Google's own servers.

The script already existed in a rough form. The popular `form-to-google-sheets` repo proves the demand. But that repo hadn't been updated to include email notifications, spam filtering, or a configuration layer — and developers were forking it and adding those features in private. So I wrote a clean, documented, feature-complete version and put it on GitHub.

The MIT license means you can do whatever you want with it. Bundle it with your agency's boilerplate. Ship it to every client. Fork it and add your own features. If it saves you money, great — that's the whole point.

---

*If this saved you money, star the repo at [github.com/ttcd77/form-handler](https://github.com/ttcd77/form-handler) — it helps other developers find it and keeps me shipping improvements.*

---

**More from selfloom:**

- [**Developer's Freelance Contract Kit**](https://github.com/ttcd77/freelance-contract-kit) — 5 lawyer-reviewed contract templates for freelance web developers. Includes scope-of-work, IP assignment, payment terms, and kill-fee clauses. $24 one-time with unlimited reuse. Save $500+ per contract vs. hiring a lawyer to draft from scratch.
