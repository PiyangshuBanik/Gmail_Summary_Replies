document.addEventListener("DOMContentLoaded", () => {
  const authBtn = document.getElementById("authBtn");
  const logoutBtn = document.getElementById("logoutBtn");
  const fetchBtn = document.getElementById("fetchBtn");
  const emailsDiv = document.getElementById("emails");
  const emailsPanel = document.getElementById("emailsPanel");
  const emailCount = document.getElementById("emailCount");
  
  // Theme Toggle Elements
  const themeToggle = document.getElementById("themeToggle");
  const themeIcon = document.getElementById("themeIcon");
  const themeLabel = document.getElementById("themeLabel");

  let cachedEmails = [];
  let emailCategories = {}; 
  let expandedEmailId = null;

  /* =========================
     THEME LOGIC
  ========================= */
  function initTheme() {
    // Check for saved theme or default to 'dark'
    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.body.setAttribute('data-theme', savedTheme);
    updateThemeUI(savedTheme);
  }

  function updateThemeUI(theme) {
    if (theme === 'light') {
      themeIcon.textContent = '☀️';
      themeLabel.textContent = 'Light';
    } else {
      themeIcon.textContent = '🌙';
      themeLabel.textContent = 'Dark';
    }
  }

  themeToggle.addEventListener('click', () => {
    const currentTheme = document.body.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    
    document.body.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    updateThemeUI(newTheme);
  });

  /* =========================
     AUTHENTICATION
  ========================= */
  async function checkAuth() {
    try {
      const res = await fetch("/status", { credentials: "include" });
      const data = await res.json();
      const indicator = document.querySelector(".status-indicator");
      const statusText = document.getElementById("authStatus");

      if (data.authenticated) {
        authBtn.style.display = "none";
        logoutBtn.style.display = "inline-flex";
        fetchBtn.disabled = false;
        indicator.classList.add("authenticated");
        statusText.textContent = "✅ Authenticated";
      } else {
        authBtn.style.display = "inline-flex";
        logoutBtn.style.display = "none";
        fetchBtn.disabled = true;
        indicator.classList.remove("authenticated");
        statusText.textContent = "❌ Not signed in";
      }
    } catch (err) {
      console.error("Auth check failed:", err);
    }
  }

  authBtn.onclick = async () => {
    try {
      const r = await fetch("/auth-url", { credentials: "include" });
      const { url } = await r.json();
      const authWindow = window.open(url, "_blank", "width=600,height=600");
      
      const interval = setInterval(async () => {
        if (authWindow.closed) {
          clearInterval(interval);
          checkAuth();
          return;
        }
        const res = await fetch("/status", { credentials: "include" });
        const data = await res.json();
        if (data.authenticated) {
          clearInterval(interval);
          checkAuth();
        }
      }, 2000);
    } catch (err) {
      console.error("Login error:", err);
      alert("Login failed. Please try again.");
    }
  };

  logoutBtn.onclick = async () => {
    try {
      await fetch("/logout", { credentials: "include" });
      cachedEmails = [];
      emailCategories = {};
      expandedEmailId = null;
      emailsDiv.innerHTML = "";
      emailsPanel.style.display = "none";
      await checkAuth();
    } catch (err) {
      console.error("Logout error:", err);
    }
  };

  /* =========================
     EMAIL ACTIONS
  ========================= */
  fetchBtn.onclick = async () => {
    try {
      emailsDiv.innerHTML = `<div class="loading"><div class="spinner"></div>Fetching emails...</div>`;
      emailsPanel.style.display = "block";
      
      // Get limit from HTML input
      const maxEmailsInput = document.getElementById("maxEmails");
      let limit = parseInt(maxEmailsInput?.value) || 10;

      const res = await fetch("/fetch-emails", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxResults: limit }),
      });

      if (!res.ok) throw new Error(`Failed to fetch emails: ${res.statusText}`);

      const data = await res.json();
      cachedEmails = data.emails || [];

      if (cachedEmails.length === 0) {
        emailsDiv.innerHTML = "<p>No emails found in your inbox.</p>";
        return;
      }

      emailsDiv.innerHTML = `<div class="loading"><div class="spinner"></div>Analyzing email priorities...</div>`;
      
      try {
        const catRes = await fetch("/categorize-emails", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ emails: cachedEmails }),
        });

        const catData = await catRes.json();
        if (catData.categories && Array.isArray(catData.categories)) {
          catData.categories.forEach(cat => {
            if (cachedEmails[cat.index]) {
              emailCategories[cachedEmails[cat.index].id] = cat.category;
            }
          });
        }
      } catch (catErr) {
        console.error("Categorization failed:", catErr);
        cachedEmails.forEach(email => emailCategories[email.id] = "important");
      }

      renderEmails();
    } catch (err) {
      console.error("Fetch error:", err);
      emailsDiv.innerHTML = `<div class="error">Failed to fetch emails: ${err.message}</div>`;
    }
  };

  function renderEmails() {
    if (!cachedEmails.length) {
      emailsDiv.innerHTML = "<p>No emails fetched.</p>";
      return;
    }

    emailCount.textContent = `${cachedEmails.length} emails`;

    const grouped = { critical: [], "very-important": [], important: [], "less-important": [] };

    cachedEmails.forEach(email => {
      const category = emailCategories[email.id] || "important";
      if (grouped[category]) grouped[category].push(email);
      else grouped["important"].push(email);
    });

    let html = "";
    const categoryConfig = {
      critical: { label: "🚨 Critical", color: "#dc2626" },
      "very-important": { label: "⚡ Very Important", color: "#ea580c" },
      important: { label: "📌 Important", color: "#2563eb" },
      "less-important": { label: "📮 Less Important", color: "#6b7280" }
    };

    Object.keys(categoryConfig).forEach(category => {
      const emails = grouped[category];
      if (emails && emails.length > 0) {
        const config = categoryConfig[category];
        html += `
          <div class="category-section">
            <div class="category-header">
              <span class="category-title">${config.label}</span>
              <span class="category-count">${emails.length}</span>
            </div>
            <div class="category-emails">
              ${emails.map(email => renderEmailItem(email, category)).join("")}
            </div>
          </div>`;
      }
    });

    emailsDiv.innerHTML = html || "<p>No emails to display.</p>";
  }

  function renderEmailItem(email, category) {
    const isExpanded = expandedEmailId === email.id;
    return `
      <div class="email-item category-${category}" id="email-${email.id}">
        <div class="email-header">
          <div class="email-subject">${escapeHtml(email.subject)}</div>
          <div class="email-date">${new Date(email.date).toLocaleString()}</div>
        </div>
        <div class="email-from">From: ${escapeHtml(email.from)}</div>
        <div class="email-snippet">${escapeHtml(email.snippet)}</div>
        <div class="email-actions">
          <button class="email-btn" onclick="viewEmail('${email.id}')">👁️ View</button>
          <button class="email-btn" onclick="summarizeEmail('${email.id}')">🧠 Summary</button>
          <button class="email-btn" onclick="generateReply('${email.id}')">✉️ Reply</button>
          <select class="category-select" onchange="changeCategory('${email.id}', this.value)">
            <option value="">Move to...</option>
            <option value="critical">🚨 Critical</option>
            <option value="very-important">⚡ Very Important</option>
            <option value="important">📌 Important</option>
            <option value="less-important">📮 Less Important</option>
          </select>
        </div>
        ${isExpanded ? `<div class="email-expanded" id="expanded-${email.id}"></div>` : ""}
      </div>`;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /* =========================
     WINDOW HELPER FUNCTIONS
  ========================= */
  window.viewEmail = async (id) => {
    try {
      if (expandedEmailId === id) {
        expandedEmailId = null;
        renderEmails();
        return;
      }
      expandedEmailId = id;
      renderEmails();
      const expandedDiv = document.getElementById(`expanded-${id}`);
      expandedDiv.innerHTML = `<div class="loading"><div class="spinner"></div>Loading email...</div>`;
      const res = await fetch(`/email/${id}`, { credentials: "include" });
      const email = await res.json();
      expandedDiv.innerHTML = `
        <div class="email-view">
          <div class="view-header"><h3>📧 Full Email</h3><button class="close-btn" onclick="closeExpanded()">✕</button></div>
          <div class="view-content">
            <p><strong>From:</strong> ${escapeHtml(email.from)}</p>
            <p><strong>Subject:</strong> ${escapeHtml(email.subject)}</p>
            <div class="email-body">${escapeHtml(email.body)}</div>
          </div>
        </div>`;
      scrollToEmail(id);
    } catch (err) {
      document.getElementById(`expanded-${id}`).innerHTML = `<div class="error">Failed to load email.</div>`;
    }
  };

  window.summarizeEmail = async (id) => {
    try {
      if (expandedEmailId === id) { expandedEmailId = null; renderEmails(); return; }
      const email = cachedEmails.find((e) => e.id === id);
      expandedEmailId = id;
      renderEmails();
      const expandedDiv = document.getElementById(`expanded-${id}`);
      expandedDiv.innerHTML = `<div class="loading"><div class="spinner"></div>Generating summary...</div>`;
      const res = await fetch("/summarize-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      expandedDiv.innerHTML = `
        <div class="email-view">
          <div class="view-header"><h3>✨ AI Summary</h3><button class="close-btn" onclick="closeExpanded()">✕</button></div>
          <div class="summary-content">${escapeHtml(data.summary).replace(/\n/g, "<br>")}</div>
        </div>`;
      scrollToEmail(id);
    } catch (err) {
      document.getElementById(`expanded-${id}`).innerHTML = `<div class="error">Summary failed.</div>`;
    }
  };

  window.generateReply = (id) => {
    expandedEmailId = id;
    renderEmails();
    document.getElementById(`expanded-${id}`).innerHTML = `
      <div class="email-view">
        <div class="view-header"><h3>✉️ Generate Reply</h3><button class="close-btn" onclick="closeExpanded()">✕</button></div>
        <div class="reply-options">
          <select id="replyTone-${id}" class="tone-select">
            <option value="professional">Professional</option>
            <option value="friendly">Friendly</option>
          </select>
          <button class="email-btn" onclick="generateReplyWithTone('${id}')">Generate</button>
        </div>
        <div id="reply-output-${id}"></div>
      </div>`;
  };

  window.generateReplyWithTone = async (id) => {
    const tone = document.getElementById(`replyTone-${id}`).value;
    const outputDiv = document.getElementById(`reply-output-${id}`);
    outputDiv.innerHTML = `<div class="spinner"></div>`;
    const res = await fetch("/generate-reply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: cachedEmails.find(e => e.id === id), tone }),
    });
    const data = await res.json();
    outputDiv.innerHTML = `<div class="reply-text">${escapeHtml(data.reply).replace(/\n/g, "<br>")}</div>
    <button class="email-btn" onclick="copyReply('${id}')">📋 Copy</button>`;
  };

  window.copyReply = (id) => {
    const text = document.querySelector(`#reply-output-${id} .reply-text`).innerText;
    navigator.clipboard.writeText(text).then(() => alert("Copied!"));
  };

  window.changeCategory = (id, newCategory) => {
    if (newCategory) { emailCategories[id] = newCategory; expandedEmailId = null; renderEmails(); }
  };

  window.closeExpanded = () => { expandedEmailId = null; renderEmails(); };

  function scrollToEmail(id) {
    setTimeout(() => document.getElementById(`email-${id}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 100);
  }

  // Initializations
  initTheme();
  checkAuth();
});