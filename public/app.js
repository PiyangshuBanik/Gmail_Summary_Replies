document.addEventListener("DOMContentLoaded", () => {
  const authBtn = document.getElementById("authBtn");
  const logoutBtn = document.getElementById("logoutBtn");
  const fetchBtn = document.getElementById("fetchBtn");
  const emailsDiv = document.getElementById("emails");
  const emailsPanel = document.getElementById("emailsPanel");
  const emailCount = document.getElementById("emailCount");
  const themeToggle = document.getElementById("themeToggle");
  const themeIcon = document.getElementById("themeIcon");
  const themeLabel = document.getElementById("themeLabel");

  let cachedEmails = [];
  let emailCategories = {};
  let expandedEmailId = null;

  // Theme Toggle Functionality
  function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.body.setAttribute('data-theme', savedTheme);
    updateThemeButton(savedTheme);
    createParticles();
  }

  function updateThemeButton(theme) {
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
    updateThemeButton(newTheme);
    
    // Recreate particles with new theme
    createParticles();
  });

  // Create animated background particles
  function createParticles() {
    const particlesContainer = document.getElementById('particles');
    particlesContainer.innerHTML = '';
    
    const particleCount = 30;
    for (let i = 0; i < particleCount; i++) {
      const particle = document.createElement('div');
      particle.className = 'particle';
      
      const size = Math.random() * 6 + 2;
      const left = Math.random() * 100;
      const duration = Math.random() * 20 + 15;
      const delay = Math.random() * 5;
      
      particle.style.width = `${size}px`;
      particle.style.height = `${size}px`;
      particle.style.left = `${left}%`;
      particle.style.animationDuration = `${duration}s`;
      particle.style.animationDelay = `${delay}s`;
      
      particlesContainer.appendChild(particle);
    }
  }

  // Authentication
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

  // Google OAuth login
  authBtn.onclick = async () => {
    try {
      const r = await fetch("/auth-url", { credentials: "include" });
      const { url } = await r.json();
      window.open(url, "_blank", "width=600,height=600");

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

  // Logout
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

  // Fetch emails
  fetchBtn.onclick = async () => {
    try {
      emailsDiv.innerHTML = `<div class="loading"><div class="spinner"></div>Fetching emails...</div>`;
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

        if (catData.warning) {
          console.warn(catData.warning);
        }

        if (catData.categories && Array.isArray(catData.categories)) {
          catData.categories.forEach(cat => {
            if (cachedEmails[cat.index]) {
              emailCategories[cachedEmails[cat.index].id] = cat.category;
            }
          });
        }
      } catch (catErr) {
        console.error("Categorization failed:", catErr);
        cachedEmails.forEach(email => {
          emailCategories[email.id] = "important";
        });
      }

      renderEmails();
    } catch (err) {
      console.error("Fetch error:", err);
      emailsDiv.innerHTML = `<div class="error">❌ Failed to fetch emails: ${err.message}</div>`;
    }
  };

  // Render emails
  function renderEmails() {
    if (!cachedEmails.length) {
      emailsDiv.innerHTML = "<p>No emails fetched.</p>";
      return;
    }

    emailCount.textContent = `${cachedEmails.length} emails`;

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
        grouped["important"].push(email);
      }
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
            <div class="category-header" style="border-left: 6px solid ${config.color}">
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

    emailsDiv.innerHTML = html || "<p>No emails to display.</p>";
  }

  // Render email item
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

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // View email
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
        expandedDiv.innerHTML = `<div class="error">❌ Failed to load email: ${err.message}</div>`;
      }
    }
  };

  // Summarize email
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
      expandedDiv.innerHTML = `<div class="loading"><div class="spinner"></div>Generating summary...</div>`;

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
        expandedDiv.innerHTML = `<div class="error">❌ ${err.message}</div>`;
      }
    }
  };

  // Generate reply
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
          <label>Tone:</label>
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

  // Generate reply with tone
  window.generateReplyWithTone = async (id) => {
    try {
      const email = cachedEmails.find((e) => e.id === id);
      if (!email) return;

      const tone = document.getElementById(`replyTone-${id}`).value;
      const outputDiv = document.getElementById(`reply-output-${id}`);

      outputDiv.innerHTML = `<div class="loading"><div class="spinner"></div>Generating reply...</div>`;

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
        outputDiv.innerHTML = `<div class="error">❌ ${err.message}</div>`;
      }
    }
  };

  // Copy reply
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

  // Change category
  window.changeCategory = (id, newCategory) => {
    if (newCategory) {
      emailCategories[id] = newCategory;
      expandedEmailId = null;
      renderEmails();
    }
  };

  // Close expanded
  window.closeExpanded = () => {
    expandedEmailId = null;
    renderEmails();
  };

  // Scroll to email
  function scrollToEmail(id) {
    setTimeout(() => {
      const element = document.getElementById(`email-${id}`);
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }, 100);
  }

  // Initialize
  initTheme();
  checkAuth();
});