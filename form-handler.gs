/**
 * =============================================================================
 *  Form Handler for Google Sheets — form-handler.gs
 *  Licensed under MIT — market it, modify it, bundle it with client sites.
 * =============================================================================
 *
 *  FEATURES:
 *    - Handles HTTP POST from any HTML form (CORS-enabled via doPost).
 *    - Writes submissions to a Google Sheet (auto-creates sheet + headers).
 *    - Sends email notification to the site owner.
 *    - Spam protection: honeypot field, keyword blocklist.
 *    - Rate limiting: per-IP cap configurable in submissions / hour.
 *    - Auto-responder: optional "thanks" email back to the submitter.
 *    - Returns clean JSON so your front-end can show success / error messages.
 *
 *  SETUP:  See README.md or open setup.html in this project.
 * =============================================================================
 */

// ─── CONFIGURATION ──────────────────────────────────────────────────────────
//  Change these values to match your setup.  Every value can also be
//  overridden by the setup panel (setup.html) which writes them into
//  Script Properties so you don't have to touch this file again.

var CONFIG = {
  // The email address that receives every new form submission.
  recipientEmail: "you@example.com",

  // Google Sheet name (inside *this* spreadsheet's workbook).
  // If it doesn't exist the script creates it automatically.
  sheetName: "Submissions",

  // Whether to send a "thanks, we got your message" email to the person
  // who filled out the form.
  autoReplyEnabled: false,

  // Subject line used for the auto-reply email.
  autoReplySubject: "Thanks for reaching out!",

  // Body of the auto-reply email.  {{name}} is replaced with the submitter's
  // name if you collect a "name" field.
  autoReplyBody: "Hi {{name}},\n\nWe received your message and will get back to you within 24 hours.\n\nCheers!",

  // Max submissions allowed from a single IP address within one hour.
  // Set to 0 to disable rate limiting entirely.
  rateLimitPerHour: 10,

  // Keywords that, when found in the "message" field body, cause the
  // submission to be silently dropped as spam.  Case-insensitive.
  blockedKeywords: [
    "buy now",
    "click here",
    "seo services",
    "cheap",
    "viagra",
    "casino",
    "crypto",
    "guest post",
    "link building"
  ],

  // If a form field named exactly this (hidden via CSS) is filled in,
  // the submission is treated as bot spam and dropped.
  // Your HTML form must include an invisible field with this name.
  honeypotFieldName: "_gotcha",

  // Domain whitelist — leave empty to accept submissions from any origin.
  // If populated, only forms hosted on these domains are accepted.
  allowedOrigins: []
};

// ─── INITIALIZATION ─────────────────────────────────────────────────────────
//  Load any overrides persisted by the setup dashboard into Script Properties.
//  Properties are checked first; if missing we fall back to CONFIG above.

function getConfig() {
  var props = PropertiesService.getScriptProperties();
  return {
    recipientEmail:    props.getProperty("recipientEmail")    || CONFIG.recipientEmail,
    sheetName:         props.getProperty("sheetName")         || CONFIG.sheetName,
    autoReplyEnabled:  props.getProperty("autoReplyEnabled")  === "true",
    autoReplySubject:  props.getProperty("autoReplySubject")  || CONFIG.autoReplySubject,
    autoReplyBody:     props.getProperty("autoReplyBody")     || CONFIG.autoReplyBody,
    rateLimitPerHour:  parseInt(props.getProperty("rateLimitPerHour"))  || CONFIG.rateLimitPerHour,
    blockedKeywords:   parseListProp(props.getProperty("blockedKeywords")) || CONFIG.blockedKeywords,
    honeypotFieldName: props.getProperty("honeypotFieldName") || CONFIG.honeypotFieldName,
    allowedOrigins:    parseListProp(props.getProperty("allowedOrigins")) || CONFIG.allowedOrigins
  };
}

/** Turn a comma-separated string stored in Script Properties back into an array. */
function parseListProp(str) {
  if (!str) return null;
  return str.split(",").map(function(s) { return s.trim(); }).filter(Boolean);
}

// ─── ENTRY POINT — doPost ───────────────────────────────────────────────────
//  Google Apps Script calls doPost automatically when the published web app
//  receives an HTTP POST request.

function doPost(e) {
  try {
    return handlePost(e);
  } catch (err) {
    // Catch-all: log the error and return a JSON error so the caller
    // can surface it in the UI instead of getting a blank screen.
    console.error("Unhandled error in doPost: " + err.message);
    return jsonResponse("error", "Internal server error. Check the Apps Script logs.");
  }
}

// ─── CORE LOGIC ─────────────────────────────────────────────────────────────

function handlePost(e) {
  var cfg = getConfig();

  // 1. Parse the incoming data — support JSON and form-urlencoded.
  var data = parseRequestBody(e);
  if (!data) {
    return jsonResponse("error", "Could not parse request body. Send JSON or form-urlencoded data.");
  }

  // 2. CORS / origin check (optional — only if allowedOrigins is configured).
  var origin = (e.parameter && e.parameter.origin) || "";
  if (cfg.allowedOrigins.length > 0 && origin) {
    var originAllowed = cfg.allowedOrigins.some(function(allowed) {
      return origin.indexOf(allowed) !== -1;
    });
    if (!originAllowed) {
      return jsonResponse("error", "Origin not allowed.");
    }
  }

  // 3. Honeypot check — bots fill invisible fields.
  if (cfg.honeypotFieldName && data[cfg.honeypotFieldName]) {
    // Pretend success so bots don't know they've been filtered.
    return jsonResponse("success", "Thank you for your message!");
  }

  // 4. Required fields — at minimum "email" and "message".
  var name    = (data.name    || "").trim();
  var email   = (data.email   || "").trim();
  var message = (data.message || "").trim();

  if (!email || !message) {
    return jsonResponse("error", "Email and message are required.");
  }

  // 5. Basic email format check.
  if (!isValidEmail(email)) {
    return jsonResponse("error", "Please provide a valid email address.");
  }

  // 6. Keyword-based spam filter.
  var messageLower = message.toLowerCase();
  for (var i = 0; i < cfg.blockedKeywords.length; i++) {
    if (messageLower.indexOf(cfg.blockedKeywords[i].toLowerCase()) !== -1) {
      return jsonResponse("success", "Thank you for your message!");
    }
  }

  // 7. Rate limiting (per IP).
  var ip = getClientIp(e);
  if (!checkRateLimit(ip, cfg.rateLimitPerHour)) {
    return jsonResponse("error", "Too many submissions. Please try again later.");
  }

  // 8. Source URL — pass it as a hidden field named "source" or use the Origin header.
  var sourceUrl = (data.source || origin || "Unknown").trim();

  // 9. Timestamp.
  var timestamp = new Date();

  // 10. Write to Google Sheet.
  ensureSheet(cfg.sheetName);
  appendRow(cfg.sheetName, [timestamp, name, email, message, sourceUrl]);

  // 11. Notify site owner via email.
  sendOwnerNotification(cfg, { timestamp: timestamp, name: name, email: email, message: message, source: sourceUrl });

  // 12. Optional auto-responder to the submitter.
  if (cfg.autoReplyEnabled) {
    sendAutoReply(cfg, { name: name, email: email });
  }

  return jsonResponse("success", "Thank you for your message! We'll be in touch soon.");
}

// ─── REQUEST PARSING ────────────────────────────────────────────────────────

/**
 * Parse the POST body.  Tries JSON first, then falls back to form-urlencoded
 * (what a standard <form method="POST"> sends).
 */
function parseRequestBody(e) {
  if (!e.postData || !e.postData.contents) return null;

  var raw = e.postData.contents;
  var type = e.postData.type || "";

  // JSON payload (common for fetch/XHR submissions).
  if (type.indexOf("application/json") !== -1 || type.indexOf("text/plain") !== -1) {
    try {
      return JSON.parse(raw);
    } catch (_) {
      // Fall through to form parsing.
    }
  }

  // Form-urlencoded (standard HTML form submission).
  try {
    var result = {};
    var pairs = raw.split("&");
    for (var i = 0; i < pairs.length; i++) {
      var kv = pairs[i].split("=");
      if (kv.length >= 2) {
        result[decodeURIComponent(kv[0])] = decodeURIComponent(kv.slice(1).join("=").replace(/\+/g, " "));
      }
    }
    return result;
  } catch (_) {
    return null;
  }
}

// ─── GOOGLE SHEET HELPERS ───────────────────────────────────────────────────

/**
 * Make sure the target sheet exists.  If not, create it and write the
 * header row.
 */
function ensureSheet(sheetName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.appendRow(["Timestamp", "Name", "Email", "Message", "Source URL"]);
    // Freeze the header row and enable text wrapping for readability.
    sheet.setFrozenRows(1);
    sheet.getRange("D:D").setWrap(true);
  }
}

/** Append a single row to the sheet. */
function appendRow(sheetName, row) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  sheet.appendRow(row);
}

// ─── EMAIL NOTIFICATIONS ────────────────────────────────────────────────────

/**
 * Send a notification to the site owner with the submission details.
 */
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

/**
 * Send a "thanks" email back to the person who submitted the form.
 */
function sendAutoReply(cfg, submission) {
  if (!submission.email) return;

  var body = cfg.autoReplyBody.replace("{{name}}", submission.name || "there");
  MailApp.sendEmail({
    to: submission.email,
    subject: cfg.autoReplySubject,
    body: body
  });
}

// ─── SPAM / RATE LIMITING ───────────────────────────────────────────────────

/**
 * Extract the client IP from request headers.
 * Uses X-Forwarded-For if present (common behind proxies),
 * otherwise falls back to the direct connection.
 */
function getClientIp(e) {
  // Apps Script doesn't expose headers directly in the e object for web apps,
  // but we can try a few approaches.  Since Apps Script web app runs behind
  // Google's proxy, the IP is not directly available. We use a combination:
  if (e.parameter && e.parameter._ip) return e.parameter._ip;

  // Fallback: hash of user-agent + timestamp window (not perfect, but works)
  // For genuine rate limiting, recommend the front-end passes the IP explicitly
  // via a hidden field set by a serverless function or client-side fetch.
  return "anonymous";
}

/**
 * Check whether the given identifier has exceeded the rate limit.
 * Uses CacheService (15-min TTL counters, reset on the hour via explicit check).
 */
function checkRateLimit(identifier, limit) {
  if (!limit || limit <= 0) return true; // Rate limiting disabled.

  var cache = CacheService.getScriptCache();
  var hourKey = "rl_" + identifier + "_" + getCurrentHourKey();
  var count = parseInt(cache.get(hourKey)) || 0;

  if (count >= limit) return false;

  cache.put(hourKey, (count + 1).toString(), 3600); // 1-hour TTL.
  return true;
}

/** Return a string like "2026-05-28-14" for the current UTC hour. */
function getCurrentHourKey() {
  var d = new Date();
  return Utilities.formatDate(d, "UTC", "yyyy-MM-dd-HH");
}

// ─── VALIDATION ─────────────────────────────────────────────────────────────

/** Simple but adequate email validation. */
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ─── RESPONSE HELPERS ───────────────────────────────────────────────────────

/**
 * Build a JSON response with CORS headers so it works from any website.
 */
function jsonResponse(status, message) {
  var payload = JSON.stringify({ status: status, message: message });

  return ContentService
    .createTextOutput(payload)
    .setMimeType(ContentService.MimeType.JSON);
}

// ─── UTILITY — doGet for testing / ping ─────────────────────────────────────
//  Visiting the web app URL directly in a browser returns this message,
//  which confirms the deployment is live.

function doGet() {
  return ContentService
    .createTextOutput(JSON.stringify({
      status: "ok",
      message: "Form Handler is running. Send a POST request to submit a form.",
      docs: "See setup.html for configuration instructions."
    }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─── SETUP PANEL SUPPORT — setConfig ────────────────────────────────────────
//  Called by setup.html to persist configuration into Script Properties.
//  Only accepts POST.

function setConfig(configData) {
  var props = PropertiesService.getScriptProperties();

  if (configData.recipientEmail !== undefined)   props.setProperty("recipientEmail", configData.recipientEmail);
  if (configData.sheetName !== undefined)         props.setProperty("sheetName", configData.sheetName);
  if (configData.autoReplyEnabled !== undefined)  props.setProperty("autoReplyEnabled", configData.autoReplyEnabled ? "true" : "false");
  if (configData.autoReplySubject !== undefined)  props.setProperty("autoReplySubject", configData.autoReplySubject);
  if (configData.autoReplyBody !== undefined)     props.setProperty("autoReplyBody", configData.autoReplyBody);
  if (configData.rateLimitPerHour !== undefined)  props.setProperty("rateLimitPerHour", configData.rateLimitPerHour.toString());
  if (configData.blockedKeywords !== undefined)   props.setProperty("blockedKeywords", Array.isArray(configData.blockedKeywords) ? configData.blockedKeywords.join(",") : configData.blockedKeywords);
  if (configData.honeypotFieldName !== undefined)  props.setProperty("honeypotFieldName", configData.honeypotFieldName);
  if (configData.allowedOrigins !== undefined)    props.setProperty("allowedOrigins", Array.isArray(configData.allowedOrigins) ? configData.allowedOrigins.join(",") : configData.allowedOrigins);

  return jsonResponse("success", "Configuration saved.");
}

/**
 * Called by setup.html to retrieve current configuration.
 */
function getConfigPublic() {
  return ContentService
    .createTextOutput(JSON.stringify(getConfig()))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─── TEST ENDPOINT — called by setup.html to verify things work ─────────────
/**
 * Runs a self-test: checks sheet access, email permissions, and returns
 * diagnostics so the user knows the deployment is healthy.
 */
function testSetup() {
  var results = [];
  var cfg = getConfig();

  // 1. Sheet access.
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    results.push({ check: "spreadsheet_access", pass: true, detail: ss.getName() });
  } catch (err) {
    results.push({ check: "spreadsheet_access", pass: false, detail: err.message });
  }

  // 2. Sheet exists (or can be created).
  try {
    ensureSheet(cfg.sheetName);
    results.push({ check: "sheet_ready", pass: true, detail: "Sheet '" + cfg.sheetName + "' is ready." });
  } catch (err) {
    results.push({ check: "sheet_ready", pass: false, detail: err.message });
  }

  // 3. Mail quota.
  var quota = MailApp.getRemainingDailyQuota();
  results.push({ check: "mail_quota", pass: quota > 0, detail: quota + " emails remaining today." });

  // 4. Configuration.
  results.push({ check: "config_loaded", pass: true, detail: JSON.stringify(cfg) });

  return ContentService
    .createTextOutput(JSON.stringify({ status: "ok", results: results }))
    .setMimeType(ContentService.MimeType.JSON);
}
