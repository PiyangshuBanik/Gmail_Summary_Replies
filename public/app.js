document.addEventListener("DOMContentLoaded", () => {
  const authBtn = document.getElementById("authBtn");
  const logoutBtn = document.getElementById("logoutBtn");
  const fetchBtn = document.getElementById("fetchBtn");
  const emailsDiv = document.getElementById("emails");
  const emailsPanel = document.getElementById("emailsPanel");
  const emailCount = document.getElementById("emailCount");
  const themeToggle = document.getElementById("themeToggle");

  let cachedEmails = [];
  let emailCategories = {}; // Store categories: {emailId: "critical"}
  let expandedEmailId = null; // Track which email is expanded

  // ============================================
  // THEME MANAGEMENT
  // ============================================
  
  // Initialize theme from localStorage or default to light
  function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
  }

  // Toggle theme
  themeToggle.addEventListener('click', () => {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    
    // Add animation class
    themeToggle.style.transform = 'rotate(360deg)';
    setTimeout(() => {
      themeToggle.style.transform = '';
    }, 300);
  });

  // Initialize theme on load
  initTheme();

  // ============================================
  // AUTHENTICATION
  // ============================================

  // Always send credentials (cookies) with every request
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
        statusText.textContent = "✅ Connected & Ready";
      } else {
        authBtn.style.display = "inline-flex";
        logoutBtn.style.display = "none";
        fetchBtn.disabled = true;
        indicator.classList.remove("authenticated");
        statusText.textContent = "⚠️ Authentication Required";
      }
    } catch (err) {
      console.error("Auth check failed:", err);
    }
  }

  // Google OAuth login
  authBtn.onclick = async () => {
    try {
      const r = await fetch("/auth-url", { credentials: "include" });
      const { url } = await r.json();
      window.open(url, "_blank", "width=600,height=600");
      
      // Poll for auth status
      const interval = setInterval(async () => {
        await checkAuth();
        const res = await fetch("/status", { credentials: "include" });
        const data = await res.json();
        if (data.authenticated) {
          clearInterval(interval);
        }
      }, 2000);
    } catch (err) {
      console.error("Login error:", err);
      alert("Login failed. Please try again.");
    }
  };

  // Proper logout
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

  // ============================================
  // EMAIL FETCHING
  // ============================================

  // Fetch emails and auto-categorize
  fetchBtn.onclick = async () => {
    try {
      emailsDiv.innerHTML = `<div class="loading"><div class="spinner"></div><p>Fetching emails from your inbox...</p></div>`;
      emailsPanel.style.display = "block";
      
      const res = await fetch("/fetch-emails", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxEmails: 50, top: 10 }),
      });

      if (!res.ok) {
        throw new Error(`Failed to fetch emails: ${res.statusText}`);
      }

      const data = await res.json();
      cachedEmails = data.emails || [];

      if (cachedEmails.length === 0) {
        emailsDiv.innerHTML = "<p style='text-align: center; color: var(--text-secondary); padding: 40px;'>No emails found in your inbox.</p>";
        return;
      }

      // Auto-categorize emails (with fallback)
      emailsDiv.innerHTML = `<div class="loading"><div class="spinner"></div><p>Analyzing email priorities with AI...</p></div>`;
      
      try {
        const catRes = await fetch("/categorize-emails", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ emails: cachedEmails }),
        });

        const catData = await catRes.json();
        
        // Show warning if categorization used fallback
        if (catData.warning) {
          console.warn(catData.warning);
        }
        
        // Map categories to email IDs
        if (catData.categories && Array.isArray(catData.categories)) {
          catData.categories.forEach(cat => {
            if (cachedEmails[cat.index]) {
              emailCategories[cachedEmails[cat.index].id] = cat.category;
            }
          });
        }
      } catch (catErr) {
        console.error("Categorization failed:", catErr);
        // Continue with default categories - don't block rendering
        cachedEmails.forEach(email => {
          emailCategories[email.id] = "important";
        });
      }

      renderEmails();
    } catch (err) {
      console.error("Fetch error:", err);
      emailsDiv.innerHTML = `<div class="error">⚠️ Failed to fetch emails: ${err.message}</div>`;
    }
  };

  // ============================================
  // EMAIL RENDERING
  // ============================================

  // Render emails grouped by category
  function renderEmails() {
    if (!cachedEmails.length) {
      emailsDiv.innerHTML = "<p style='text-align: center; color: var(--text-secondary); padding: 40px;'>No emails fetched yet.</p>";
      return;
    }

    emailCount.textContent = `${cachedEmails.length} email${cachedEmails.length !== 1 ? 's' : ''}`;

    // Group emails by category
    const grouped = {
      critical: [],
      "very-important": [],
      important: [],
      "less-important": []
    };

    cachedEmails.forEach(email => {
      const category = emailCategories[email.id] || "important";
      if (grouped[category]) {
        grouped[category].push(email);
      } else {
        grouped["important"].push(email); // Fallback
      }
    });

    // Render grouped emails
    let html = "";
    
    const categoryConfig = {
      critical: { label: "🚨 Critical", color: "#ef4444" },
      "very-important": { label: "⚡ Very Important", color: "#f59e0b" },
      important: { label: "📌 Important", color: "#6366f1" },
      "less-important": { label: "📮 Less Important", color: "#64748b" }
    };

    Object.keys(categoryConfig).forEach(category => {
      const emails = grouped[category];
      if (emails && emails.length > 0) {
        const config = categoryConfig[category];
        html += `
          <div class="category-section">
            <div class="category-header" style="border-left: 4px solid ${config.color}">
              <span class="category-title">${config.label}</span>
              <span class="category-count">${emails.length}</span>
            </div>
            <div class="category-emails">
              ${emails.map(email => renderEmailItem(email, category)).join("")}
            </div>
          </div>
        `;
      }
    });

    emailsDiv.innerHTML = html || "<p style='text-align: center; color: var(--text-secondary); padding: 40px;'>No emails to display.</p>";
  }

  // Render individual email item
  function renderEmailItem(email, category) {
    const isExpanded = expandedEmailId === email.id;
    const categoryClass = `category-${category}`;
    
    return `
      <div class="email-item ${categoryClass}" id="email-${email.id}">
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
      </div>
    `;
  }

  // Escape HTML to prevent XSS
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ============================================
  // EMAIL ACTIONS
  // ============================================

  // View full email (inline expansion)
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
      expandedDiv.innerHTML = `<div class="loading"><div class="spinner"></div><p>Loading email content...</p></div>`;

      const res = await fetch(`/email/${id}`, { credentials: "include" });
      
      if (!res.ok) {
        throw new Error("Failed to load email");
      }
      
      const email = await res.json();

      expandedDiv.innerHTML = `
        <div class="email-view">
          <div class="view-header">
            <h3>📧 Full Email</h3>
            <button class="close-btn" onclick="closeExpanded()">✕</button>
          </div>
          <div class="view-content">
            <p><strong>From:</strong> ${escapeHtml(email.from)}</p>
            <p><strong>Subject:</strong> ${escapeHtml(email.subject)}</p>
            <p><strong>Date:</strong> ${email.date}</p>
            <div class="email-body">${escapeHtml(email.body)}</div>
          </div>
        </div>
      `;

      scrollToEmail(id);
    } catch (err) {
      console.error("View email error:", err);
      const expandedDiv = document.getElementById(`expanded-${id}`);
      if (expandedDiv) {
        expandedDiv.innerHTML = `<div class="error">⚠️ Failed to load email: ${err.message}</div>`;
      }
    }
  };

  // Summarize email (inline expansion)
  window.summarizeEmail = async (id) => {
    try {
      if (expandedEmailId === id) {
        expandedEmailId = null;
        renderEmails();
        return;
      }

      const email = cachedEmails.find((e) => e.id === id);
      if (!email) return;

      expandedEmailId = id;
      renderEmails();

      const expandedDiv = document.getElementById(`expanded-${id}`);
      expandedDiv.innerHTML = `<div class="loading"><div class="spinner"></div><p>Generating AI summary...</p></div>`;

      const res = await fetch("/summarize-email", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to generate summary");
      }

      const data = await res.json();

      expandedDiv.innerHTML = `
        <div class="email-view">
          <div class="view-header">
            <h3>✨ AI Summary</h3>
            <button class="close-btn" onclick="closeExpanded()">✕</button>
          </div>
          <div class="summary-content">${escapeHtml(data.summary).replace(/\n/g, "<br>")}</div>
        </div>
      `;

      scrollToEmail(id);
    } catch (err) {
      console.error("Summary error:", err);
      const expandedDiv = document.getElementById(`expanded-${id}`);
      if (expandedDiv) {
        expandedDiv.innerHTML = `<div class="error">⚠️ ${err.message}</div>`;
      }
    }
  };

  // Generate smart reply (inline expansion)
  window.generateReply = async (id) => {
    const email = cachedEmails.find((e) => e.id === id);
    if (!email) return;

    expandedEmailId = id;
    renderEmails();

    const expandedDiv = document.getElementById(`expanded-${id}`);
    expandedDiv.innerHTML = `
      <div class="email-view">
        <div class="view-header">
          <h3>✉️ Generate Reply</h3>
          <button class="close-btn" onclick="closeExpanded()">✕</button>
        </div>
        <div class="reply-options">
          <label>Select Tone:</label>
          <select id="replyTone-${id}" class="tone-select">
            <option value="professional">Professional</option>
            <option value="friendly">Friendly</option>
            <option value="brief">Brief</option>
            <option value="detailed">Detailed</option>
          </select>
          <button class="email-btn" onclick="generateReplyWithTone('${id}')">Generate</button>
        </div>
        <div id="reply-output-${id}"></div>
      </div>
    `;

    scrollToEmail(id);
  };

  // Generate reply with selected tone
  window.generateReplyWithTone = async (id) => {
    try {
      const email = cachedEmails.find((e) => e.id === id);
      if (!email) return;

      const tone = document.getElementById(`replyTone-${id}`).value;
      const outputDiv = document.getElementById(`reply-output-${id}`);
      
      outputDiv.innerHTML = `<div class="loading"><div class="spinner"></div><p>Crafting ${tone} reply...</p></div>`;

      const res = await fetch("/generate-reply", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, tone }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to generate reply");
      }

      const data = await res.json();

      outputDiv.innerHTML = `
        <div class="reply-content">
          <div class="reply-text">${escapeHtml(data.reply).replace(/\n/g, "<br>")}</div>
          <div class="reply-actions">
            <button class="email-btn" onclick="copyReply('${id}')">📋 Copy</button>
            <button class="email-btn" onclick="generateReplyWithTone('${id}')">🔄 Regenerate</button>
          </div>
        </div>
      `;
    } catch (err) {
      console.error("Reply generation error:", err);
      const outputDiv = document.getElementById(`reply-output-${id}`);
      if (outputDiv) {
        outputDiv.innerHTML = `<div class="error">⚠️ ${err.message}</div>`;
      }
    }
  };

  // Copy reply to clipboard
  window.copyReply = (id) => {
    const replyDiv = document.querySelector(`#reply-output-${id} .reply-text`);
    if (!replyDiv) return;
    
    const replyText = replyDiv.innerText;
    navigator.clipboard.writeText(replyText).then(() => {
      alert("✅ Reply copied to clipboard!");
    }).catch(err => {
      console.error("Copy failed:", err);
      alert("❌ Failed to copy to clipboard");
    });
  };

  // Change email category
  window.changeCategory = (id, newCategory) => {
    if (newCategory) {
      emailCategories[id] = newCategory;
      expandedEmailId = null;
      renderEmails();
    }
  };

  // Close expanded section
  window.closeExpanded = () => {
    expandedEmailId = null;
    renderEmails();
  };

  // Scroll to email smoothly
  function scrollToEmail(id) {
    setTimeout(() => {
      const element = document.getElementById(`email-${id}`);
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }, 100);
  }

  checkAuth();
});