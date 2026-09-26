/* ═══════════════════════════════════════════════════════════════
   YouTube Analyzer — Inline Chat Panel (Content Script)
   Injects into YouTube's secondary column above recommendations.
   Matches YouTube's native "Ask about this video" UX pattern.
   ═══════════════════════════════════════════════════════════════ */

const BACKEND_URL = "http://127.0.0.1:5000";

// ─── State ──────────────────────────────────────────────────────
let ytaState = {
    initialized: false,
    videoId: null,
    geminiFileUri: null,
    transcript: "",
    commentsText: "",
    metadataText: "",
    chatHistory: [],
    isLoading: false,
};

// ─── Get the logo URL from the extension ────────────────────────
const LOGO_URL = chrome.runtime.getURL("images/icon.png");


// ─── Detect YouTube Theme ───────────────────────────────────────
function detectYouTubeTheme() {
    const app = document.querySelector("ytd-app");
    
    // 1. Check YouTube's native CSS variable on ytd-app (most accurate)
    if (app) {
        const bgColor = getComputedStyle(app).getPropertyValue('--yt-spec-base-background').trim();
        if (bgColor === '#fff' || bgColor === '#ffffff') return "light";
        if (bgColor === '#0f0f0f' || bgColor === '#000000' || bgColor === '#000') return "dark";
    }

    // 2. Check html attributes but ignore if they are set to false
    if (document.documentElement.hasAttribute("dark") && document.documentElement.getAttribute("dark") !== "false") {
        return "dark";
    }

    // 3. Check ytd-app attributes but ignore if false
    if (app && app.hasAttribute("is-dark-theme") && app.getAttribute("is-dark-theme") !== "false") {
        return "dark";
    }
    
    // 4. Fallback: check actual background color, but MUST ignore transparent (rgba 0,0,0,0)
    // YouTube usually applies background color to ytd-app or html, not body
    const el = app || document.documentElement;
    const bg = getComputedStyle(el).backgroundColor;
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
        const match = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (match) {
            const brightness = (parseInt(match[1]) + parseInt(match[2]) + parseInt(match[3])) / 3;
            if (brightness > 128) return "light";
            return "dark";
        }
    }

    // If absolutely no dark mode indicators exist, default to light
    return "light";
}

function applyTheme() {
    const container = document.getElementById("yta-container");
    if (container) {
        container.setAttribute("data-yta-theme", detectYouTubeTheme());
    }
}


// ─── Inject Panel into YouTube's Secondary Column ───────────────
function injectPanel() {
    if (document.getElementById("yta-container")) return;

    // Find YouTube's secondary column (recommendation area)
    const secondary = document.querySelector("#secondary-inner, #secondary");
    if (!secondary) {
        setTimeout(injectPanel, 1000);
        return;
    }

    // Create our container
    const container = document.createElement("div");
    container.id = "yta-container";
    container.innerHTML = `
        <!-- Collapsed Tab -->
        <div id="yta-collapsed-tab">
            <img id="yta-tab-logo" src="${LOGO_URL}" alt="YTA">
            <div id="yta-tab-text">Ask about this video</div>
            <div id="yta-tab-arrow">▾</div>
        </div>

        <!-- Expanded Panel -->
        <div id="yta-expanded-panel">
            <!-- Header -->
            <div id="yta-panel-header">
                <div id="yta-panel-header-left">
                    <img id="yta-header-logo" src="${LOGO_URL}" alt="YTA">
                    <span id="yta-panel-title">Ask about this video</span>
                </div>
                <button id="yta-panel-close" aria-label="Minimize">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 15l-6-6-6 6"/></svg>
                </button>
            </div>

            <!-- Messages Area -->
            <div id="yta-messages">
                <!-- Init Content -->
                <div id="yta-init-content">
                    <div id="yta-init-text">
                        Hello! Curious about what you're watching? I'm here to help.<br><br>
                        Click below to initialize Analyzer, then shoot it up!
                    </div>
                    <button id="yta-init-btn">Initialize Analyzer</button>
                </div>

                <!-- Loading -->
                <div id="yta-loading">
                    <div class="yta-loader"></div>
                    <div id="yta-loading-label">Processing video...</div>
                </div>
            </div>

            <!-- Input Area -->
            <div id="yta-input-area">
                <div id="yta-input-wrapper">
                    <textarea id="yta-chat-input" rows="1" placeholder="Ask a question..." disabled></textarea>
                    <button id="yta-send-btn" disabled aria-label="Send">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12L3 20l3.5-8L3 4zM6.5 12H22"/></svg>
                    </button>
                </div>
                <div id="yta-disclaimer">AI can make mistakes, so double-check it.</div>
            </div>

        </div>
    `;

    // Insert as the first child of the secondary column
    secondary.insertBefore(container, secondary.firstChild);

    // Apply theme immediately
    applyTheme();

    // ─── Event Listeners ────────────────────────────────────────
    document.getElementById("yta-collapsed-tab").addEventListener("click", expandPanel);
    document.getElementById("yta-panel-close").addEventListener("click", collapsePanel);
    document.getElementById("yta-init-btn").addEventListener("click", initializeAI);
    document.getElementById("yta-send-btn").addEventListener("click", sendMessage);

    // Timestamp clicks
    document.getElementById("yta-messages").addEventListener("click", (e) => {
        const timestampEl = e.target.closest('.yta-timestamp');
        if (timestampEl) {
            const seconds = timestampEl.getAttribute('data-time');
            if (seconds) {
                const video = document.querySelector('video');
                if (video) {
                    video.currentTime = parseFloat(seconds);
                    video.play();
                }
            }
        }
    });

    // Chat input handlers
    const chatInput = document.getElementById("yta-chat-input");
    chatInput.addEventListener("input", () => {
        chatInput.style.height = "auto";
        chatInput.style.height = Math.min(chatInput.scrollHeight, 100) + "px";
        document.getElementById("yta-send-btn").disabled = !chatInput.value.trim();
    });
    chatInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (chatInput.value.trim() && !ytaState.isLoading) sendMessage();
        }
    });
}




// ─── Expand / Collapse ──────────────────────────────────────────
function expandPanel() {
    const container = document.getElementById("yta-container");
    if (container) container.classList.add("yta-expanded");
}

function collapsePanel() {
    const container = document.getElementById("yta-container");
    if (container) container.classList.remove("yta-expanded");
}


// ─── Initialize AI ──────────────────────────────────────────────
async function initializeAI() {
    const initBtn = document.getElementById("yta-init-btn");
    initBtn.disabled = true;

    // Hide init content, show loading
    document.getElementById("yta-init-content").style.display = "none";
    const loading = document.getElementById("yta-loading");
    loading.classList.add("yta-visible");

    const url = window.location.href;

    try {
        document.getElementById("yta-loading-label").textContent = "Downloading & processing video...";

        const response = await fetch(`${BACKEND_URL}/initialize`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url }),
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || "Server error");
        }

        const data = await response.json();

        // Store in state
        ytaState.initialized = true;
        ytaState.videoId = data.videoId;
        ytaState.geminiFileUri = data.geminiFileUri;
        ytaState.transcript = data.transcript?.plain || "";
        ytaState.metadataText = formatMetadata(data.metadata);
        ytaState.commentsText = formatComments(data.comments);

        // Hide loading
        loading.classList.remove("yta-visible");

        // Enable input
        document.getElementById("yta-chat-input").disabled = false;
        document.getElementById("yta-chat-input").placeholder = "Ask a question...";

        // Show welcome message
        const messages = document.getElementById("yta-messages");


        // Add welcome text
        addMessage("ai", `Hello! Curious about what you're watching? I'm here to help.\n\nNot sure what to ask? Choose something:`);

        // Add suggestion chips
        showSuggestions([
            "Summarize the video",
            "What do the comments say?",
            "List key timestamps",
            "Describe visual highlights",
            "What is this video about?",
        ]);

    } catch (err) {
        console.error("YTA Init Error:", err);
        loading.classList.remove("yta-visible");
        document.getElementById("yta-init-content").style.display = "flex";
        initBtn.disabled = false;
        document.getElementById("yta-init-text").innerHTML = `<span style="color:var(--yta-error-text);">⚠️ ${err.message}</span><br><br>Make sure the backend server is running on port 5000.`;
    }
}


// ─── Send Chat Message ──────────────────────────────────────────
async function sendMessage() {
    const input = document.getElementById("yta-chat-input");
    const message = input.value.trim();
    if (!message || ytaState.isLoading) return;

    ytaState.isLoading = true;
    input.value = "";
    input.style.height = "auto";
    document.getElementById("yta-send-btn").disabled = true;

    // Remove suggestion chips if present
    removeSuggestions();

    // Show user message
    addMessage("user", message);
    ytaState.chatHistory.push({ role: "user", content: message });

    // Show typing indicator
    showTypingIndicator();

    try {
        const response = await fetch(`${BACKEND_URL}/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                message,
                history: ytaState.chatHistory,
                transcript: ytaState.transcript,
                commentsText: ytaState.commentsText,
                metadataText: ytaState.metadataText,
                geminiFileUri: ytaState.geminiFileUri,
            }),
        });

        removeTypingIndicator();

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || "Failed to get response");
        }

        const data = await response.json();
        const aiResponse = data.response;

        addMessage("ai", aiResponse);
        ytaState.chatHistory.push({ role: "assistant", content: aiResponse });

    } catch (err) {
        removeTypingIndicator();
        addMessage("error", `Error: ${err.message}`);
    }

    ytaState.isLoading = false;
}


// ─── UI Helpers ─────────────────────────────────────────────────
function addMessage(role, text) {
    const container = document.getElementById("yta-messages");
    const div = document.createElement("div");

    if (role === "user") {
        div.className = "yta-msg yta-msg-user";
        div.textContent = text;
    } else if (role === "ai") {
        div.className = "yta-msg yta-msg-ai";
        div.innerHTML = formatAIMessage(text);
    } else if (role === "error") {
        div.className = "yta-msg yta-error-msg";
        div.textContent = text;
    }

    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function formatAIMessage(text) {
    let html = text
        // Bold
        .replace(/\*\*([^\*]+)\*\*/g, "<strong>$1</strong>")
        // Italic (matches *text* only if it's not part of **text**)
        .replace(/(^|[^\*])\*([^\*]+)\*(?=[^\*]|$)/g, "$1<em>$2</em>")
        // Headers
        .replace(/^###\s+(.+)$/gm, "<h4>$1</h4>")
        .replace(/^##\s+(.+)$/gm, "<h3>$1</h3>")
        // Unordered lists
        .replace(/^[\-\*]\s+(.+)$/gm, "<li>$1</li>")
        // Ordered lists
        .replace(/^\d+\.\s+(.+)$/gm, "<li>$1</li>")
        // Newlines to <br>
        .replace(/\n/g, "<br>");

    // Wrap consecutive <li> items in <ul>
    html = html.replace(/((?:<li>.*?<\/li>(?:<br>)?)+)/g, (match) => {
        const cleaned = match.replace(/<br>/g, "");
        return `<ul>${cleaned}</ul>`;
    });

    // Convert timestamp patterns [MM:SS] or [HH:MM:SS] to clickable links
    html = html.replace(/\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g, (match, time) => {
        const seconds = timeToSeconds(time);
        return `<span class="yta-timestamp" data-time="${seconds}">${time}</span>`;
    });

    return html;
}

function timeToSeconds(timeStr) {
    const parts = timeStr.split(":").map(Number);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return 0;
}

function showSuggestions(suggestions) {
    const container = document.getElementById("yta-messages");
    const wrapper = document.createElement("div");
    wrapper.id = "yta-suggestions";

    suggestions.forEach((text) => {
        const chip = document.createElement("button");
        chip.className = "yta-suggestion-chip";
        chip.textContent = text;
        chip.addEventListener("click", () => {
            document.getElementById("yta-chat-input").value = text;
            sendMessage();
        });
        wrapper.appendChild(chip);
    });

    container.appendChild(wrapper);
    container.scrollTop = container.scrollHeight;
}

function removeSuggestions() {
    const el = document.getElementById("yta-suggestions");
    if (el) el.remove();
}

function showTypingIndicator() {
    const container = document.getElementById("yta-messages");
    const div = document.createElement("div");
    div.className = "yta-typing";
    div.id = "yta-typing-indicator";
    div.innerHTML = `<div class="yta-typing-dot"></div><div class="yta-typing-dot"></div><div class="yta-typing-dot"></div>`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function removeTypingIndicator() {
    const el = document.getElementById("yta-typing-indicator");
    if (el) el.remove();
}


// ─── Data Formatters ────────────────────────────────────────────
function formatMetadata(meta) {
    if (!meta) return "";
    return [
        `Title: ${meta.title}`,
        `Channel: ${meta.channel}`,
        `Published: ${meta.publishedAt}`,
        `Duration: ${meta.duration}`,
        `Views: ${Number(meta.viewCount).toLocaleString()}`,
        `Likes: ${Number(meta.likeCount).toLocaleString()}`,
        `Comments: ${Number(meta.commentCount).toLocaleString()}`,
    ].join("\n");
}

function formatComments(comments) {
    if (!comments || !comments.length) return "No comments available.";
    return comments
        .map((c, i) => `[${i + 1}] ${c.author}: "${c.text}" (👍 ${c.likes})`)
        .join("\n");
}

function populateMetaChips(meta) {
    if (!meta) return;
    const container = document.getElementById("yta-meta-bar");

    const chips = [
        { icon: "👁️", text: formatCount(meta.viewCount) + " views" },
        { icon: "👍", text: formatCount(meta.likeCount) },
        { icon: "💬", text: formatCount(meta.commentCount) },
        { icon: "⏱️", text: formatDuration(meta.duration) },
        { icon: "📺", text: meta.channel },
    ];

    container.innerHTML = chips
        .map((c) => `<span class="yta-meta-chip"><span>${c.icon}</span> ${c.text}</span>`)
        .join("");

    container.classList.add("yta-visible");
}

function formatCount(num) {
    const n = parseInt(num);
    if (isNaN(n)) return "N/A";
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
    if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
    return n.toString();
}

function formatDuration(iso) {
    if (!iso) return "N/A";
    const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return iso;
    const h = match[1] ? `${match[1]}h ` : "";
    const m = match[2] ? `${match[2]}m ` : "0m ";
    const s = match[3] ? `${match[3]}s` : "";
    return (h + m + s).trim();
}


// ─── URL Change Detection (YouTube SPA) ─────────────────────────
let lastUrl = "";

function checkForVideoChange() {
    const currentUrl = window.location.href;
    if (currentUrl !== lastUrl) {
        lastUrl = currentUrl;

        if (currentUrl.includes("youtube.com/watch")) {
            // Reset state for new video
            ytaState = {
                initialized: false,
                videoId: null,
                geminiFileUri: null,
                transcript: "",
                commentsText: "",
                metadataText: "",
                chatHistory: [],
                isLoading: false,
            };

            // Remove old panel if exists
            const old = document.getElementById("yta-container");
            if (old) old.remove();

            // Re-inject for the new video
            setTimeout(injectPanel, 1500);
        } else {
            // Not a watch page — remove panel
            const old = document.getElementById("yta-container");
            if (old) old.remove();
        }
    }

    // Continuously sync theme with YouTube
    applyTheme();
}

// YouTube is a SPA — poll for URL changes and theme
setInterval(checkForVideoChange, 1500);

// ─── Initial Injection ──────────────────────────────────────────
if (window.location.href.includes("youtube.com/watch")) {
    if (document.readyState === "complete") {
        setTimeout(injectPanel, 1500);
    } else {
        window.addEventListener("load", () => setTimeout(injectPanel, 1500));
    }
}
