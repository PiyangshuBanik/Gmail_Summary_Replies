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
app.use(
  session({
    name: "gmail_summarizer_session",
    keys: [process.env.SESSION_SECRET || "secure_fallback"],
    maxAge: 24 * 60 * 60 * 1000,
    sameSite: "lax",
    secure: false,
  })
);

/* =========================
   OAUTH SETUP
========================= */
const oAuth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

/* =========================
   AI HELPERS
========================= */
function getGeminiModel() {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  return genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });
}

// Retry handler for Gemini overload
async function generateWithRetry(model, prompt, maxRetries = 3) {
  let delay = 2000;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await model.generateContent(prompt);
    } catch (err) {
      if (
        (err.message.includes("503") || err.message.includes("overloaded")) &&
        i < maxRetries - 1
      ) {
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
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  client.setCredentials(tokens);
  return google.gmail({ version: "v1", auth: client });
}

function decodeBase64Url(str) {
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

  let body =
    recurse(msg.payload?.parts) ||
    (msg.payload?.body?.data
      ? decodeBase64Url(msg.payload.body.data)
      : "") ||
    msg.snippet ||
    "";

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

// Auth URL
app.get("/auth-url", (req, res) => {
  const url = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "openid",
      "email",
    ],
    prompt: "consent",
  });
  res.json({ url });
});

// OAuth callback
app.get("/oauth2callback", async (req, res) => {
  try {
    const { code } = req.query;
    const { tokens } = await oAuth2Client.getToken(code);
    req.session.tokens = tokens;
    res.send(`<script>window.close();</script><h3>✅ Login successful</h3>`);
  } catch (e) {
    res.status(500).send(e.message);
  }
});

// Auth status
app.get("/status", (req, res) =>
  res.json({ authenticated: !!req.session.tokens })
);

// Logout
app.get("/logout", (req, res) => {
  req.session.tokens = null;
  res.json({ message: "Logged out" });
});

// Fetch single email
app.get("/email/:id", async (req, res) => {
  try {
    const gmail = getGmailClient(req.session.tokens);
    const msg = await gmail.users.messages.get({
      userId: "me",
      id: req.params.id,
    });
    const headers = msg.data.payload.headers.reduce(
      (a, h) => ((a[h.name] = h.value), a),
      {}
    );
    res.json({
      from: headers.From,
      subject: headers.Subject,
      date: headers.Date,
      body: extractBody(msg.data),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fetch inbox emails
app.post("/fetch-emails", async (req, res) => {
  try {
    if (!req.session.tokens)
      return res.status(401).json({ error: "Unauthorized" });

    const gmail = getGmailClient(req.session.tokens);
    const list = await gmail.users.messages.list({
      userId: "me",
      maxResults: 10,
    });

    const emails = [];
    for (const meta of list.data.messages || []) {
      const msg = await gmail.users.messages.get({
        userId: "me",
        id: meta.id,
      });
      const headers = msg.data.payload.headers.reduce(
        (a, h) => ((a[h.name] = h.value), a),
        {}
      );

      emails.push({
        id: msg.data.id,
        from: headers.From,
        subject: headers.Subject,
        snippet: msg.data.snippet,
        date: headers.Date,
        body: extractBody(msg.data).slice(0, 3000),
      });
    }

    res.json({ emails });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Categorize emails
app.post("/categorize-emails", async (req, res) => {
  try {
    const model = getGeminiModel();
    const prompt = `Return ONLY JSON array: [{"index": number, "category": string}].
Use categories: critical, very-important, important, less-important.
Emails:
${req.body.emails.map((e, i) => `Email ${i}: ${e.subject}`).join("\n")}`;

    const result = await generateWithRetry(model, prompt);
    const text = result.response.text().replace(/```json|```/g, "").trim();
    res.json({ categories: JSON.parse(text) });
  } catch (err) {
    res.json({
      categories: req.body.emails.map((_, i) => ({
        index: i,
        category: "important",
      })),
    });
  }
});

/* =========================
   ✅ FIXED SUMMARIZE ROUTE
========================= */
app.post("/summarize-email", async (req, res) => {
  try {
    const model = getGeminiModel();

    const result = await generateWithRetry(
      model,
      `Summarize the following email in 3 concise bullet points:\n\n${req.body.email.body}`
    );

    const summaryText = result.response.text();

    // 🔥 DEBUG LOG
    console.log("SUMMARY FROM GEMINI:\n", summaryText);

    res.json({ summary: summaryText });
  } catch (err) {
    console.error("SUMMARY ERROR:", err.message);
    res.status(503).json({ error: "AI Busy" });
  }
});

// Generate reply
app.post("/generate-reply", async (req, res) => {
  try {
    const model = getGeminiModel();
    const result = await generateWithRetry(
      model,
      `Draft a ${req.body.tone} reply to the following email:\n\n${req.body.email.body}`
    );
    res.json({ reply: result.response.text() });
  } catch (err) {
    res.status(503).json({ error: "AI Busy" });
  }
});

/* =========================
   SERVER START
========================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`🚀 Server running at http://localhost:${PORT}`)
);
