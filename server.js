require("dotenv").config();
const express = require("express");
const { google } = require("googleapis");
const bodyParser = require("body-parser");
const session = require("cookie-session");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();

/* =========================
   MIDDLEWARE
========================= */
app.use(express.static(__dirname + "/public"));
app.use(bodyParser.json({ limit: "10mb" }));

// Security Note: In production, set 'secure: true' if using HTTPS
app.use(
  session({
    name: "gmail_summarizer_session",
    keys: [process.env.SESSION_SECRET || "secure_fallback_key_123"],
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: "lax",
    secure: false, 
  })
);

/* =========================
   OAUTH CONFIG
========================= */
// We create a function to generate a fresh client for every request
// to prevent session bleeding between different users.
function createOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

/* =========================
   AI HELPERS
========================= */
function getGeminiModel() {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  return genAI.getGenerativeModel({ model: "gemini-1.5-flash" }); // Using stable flash model
}

async function generateWithRetry(model, prompt, maxRetries = 3) {
  let delay = 2000;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const result = await model.generateContent(prompt);
      return result;
    } catch (err) {
      const isOverloaded = err.message?.includes("503") || err.message?.includes("overloaded");
      if (isOverloaded && i < maxRetries - 1) {
        console.log(`⚠️ Gemini busy, retrying in ${delay}ms...`);
        await new Promise(res => setTimeout(res, delay));
        delay *= 2;
      } else {
        throw err;
      }
    }
  }
}

/* =========================
   GMAIL HELPERS
========================= */
function getGmailClient(tokens) {
  const client = createOAuthClient();
  client.setCredentials(tokens);
  return google.gmail({ version: "v1", auth: client });
}

function decodeBase64Url(str) {
  if (!str) return "";
  return Buffer.from(
    str.replace(/-/g, "+").replace(/_/g, "/"),
    "base64"
  ).toString("utf-8");
}

function extractBody(msg) {
  function recurse(parts) {
    let text = "";
    for (const part of parts || []) {
      if (part.parts) text += recurse(part.parts);
      else if (part.mimeType === "text/plain" && part.body?.data)
        text += decodeBase64Url(part.body.data);
      else if (part.mimeType === "text/html" && part.body?.data && !text)
        text += decodeBase64Url(part.body.data);
    }
    return text;
  }

  let body = recurse(msg.payload?.parts) || 
             (msg.payload?.body?.data ? decodeBase64Url(msg.payload.body.data) : "") || 
             msg.snippet || "";

  return body
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* =========================
   ROUTES
========================= */

// 1. Generate Auth URL
app.get("/auth-url", (req, res) => {
  const client = createOAuthClient();
  const url = client.generateAuthUrl({
    access_type: "offline", // Critical: allows getting a refresh token
    scope: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "openid",
      "email",
    ],
    prompt: "consent", // Force consent to ensure we get a refresh token
  });
  res.json({ url });
});

// 2. OAuth Callback
app.get("/oauth2callback", async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).send("No code provided");

    const client = createOAuthClient();
    const { tokens } = await client.getToken(code);
    
    // Store tokens in session
    req.session.tokens = tokens;
    
    // Simple landing page that closes itself
    res.send(`
      <html>
        <body style="font-family: sans-serif; text-align: center; padding-top: 50px;">
          <h3>✅ Login Successful</h3>
          <p>You can close this window now.</p>
          <script>setTimeout(() => window.close(), 2000);</script>
        </body>
      </html>
    `);
  } catch (e) {
    console.error("OAuth Error:", e);
    res.status(500).send("Authentication failed.");
  }
});

// 3. Auth Status
app.get("/status", (req, res) => {
  res.json({ authenticated: !!(req.session && req.session.tokens) });
});

// 4. Logout (Corrected)
app.get("/logout", (req, res) => {
  req.session = null; // Clears the cookie-session entirely
  res.json({ message: "Logged out successfully" });
});

// 5. Fetch Inbox
app.post("/fetch-emails", async (req, res) => {
  try {
    if (!req.session?.tokens) return res.status(401).json({ error: "Unauthorized" });

    const gmail = getGmailClient(req.session.tokens);
    const list = await gmail.users.messages.list({
      userId: "me",
      maxResults: 10,
    });

    if (!list.data.messages) return res.json({ emails: [] });

    const emails = [];
    for (const meta of list.data.messages) {
      const msg = await gmail.users.messages.get({ userId: "me", id: meta.id });
      const headers = msg.data.payload.headers.reduce((a, h) => {
        a[h.name.toLowerCase()] = h.value;
        return a;
      }, {});

      emails.push({
        id: msg.data.id,
        from: headers.from || "Unknown",
        subject: headers.subject || "(No Subject)",
        snippet: msg.data.snippet,
        date: headers.date,
        body: extractBody(msg.data).slice(0, 5000), // Increased limit for Gemini
      });
    }

    res.json({ emails });
  } catch (err) {
    console.error("Fetch Error:", err);
    res.status(500).json({ error: "Failed to fetch emails" });
  }
});

// 6. AI Categorization
app.post("/categorize-emails", async (req, res) => {
  try {
    const model = getGeminiModel();
    const prompt = `Return ONLY a valid JSON array of objects: [{"index": number, "category": string}].
      Categories: critical, very-important, important, less-important.
      Emails:
      ${req.body.emails.map((e, i) => `Email ${i}: ${e.subject}`).join("\n")}`;

    const result = await generateWithRetry(model, prompt);
    const text = result.response.text().replace(/```json|```/g, "").trim();
    res.json({ categories: JSON.parse(text) });
  } catch (err) {
    console.error("Categorize Error:", err);
    res.json({
      categories: req.body.emails.map((_, i) => ({ index: i, category: "important" })),
    });
  }
});

// 7. AI Summarize
app.post("/summarize-email", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !email.body) return res.status(400).json({ error: "No email body" });

    const model = getGeminiModel();
    const prompt = `Summarize the following email in 3 concise bullet points. 
      Focus on the action required and the sender's main intent:\n\n${email.body}`;

    const result = await generateWithRetry(model, prompt);
    res.json({ summary: result.response.text() });
  } catch (err) {
    console.error("Summary Error:", err);
    res.status(503).json({ error: "AI service temporarily unavailable" });
  }
});

/* =========================
   SERVER START
========================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});