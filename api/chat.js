// GEARO free backend: Google Gemini (free tier) for answers + Tavily (free tier) for live web search.
const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const hits = new Map();
let goodModel = null;
function limited(ip) {
  const now = Date.now(), win = 10 * 60 * 1000, max = 30;
  const a = (hits.get(ip) || []).filter(t => now - t < win);
  a.push(now); hits.set(ip, a);
  if (hits.size > 5000) hits.clear();
  return a.length > max;
}
async function fetchT(url, opts, ms) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try { return await fetch(url, { ...opts, signal: c.signal }); } finally { clearTimeout(t); }
}
function modelList() {
  const l = [goodModel, process.env.GEMINI_MODEL, "gemini-3.8-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"].filter(Boolean);
  return [...new Set(l)];
}
async function gemini(key, body, ms) {
  let last = null;
  for (const model of modelList()) {
    try {
      const r = await fetchT("https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent", {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify(body)
      }, ms);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        const e = new Error(model + ": " + ((j.error && j.error.message) || "HTTP " + r.status));
        e.status = r.status; last = e;
        if (r.status === 429 || r.status === 401 || r.status === 403) throw e;
        continue;
      }
      goodModel = model;
      const parts = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
      return parts.map(p => p.text || "").join("");
    } catch (e) {
      if (e.status === 429 || e.status === 401 || e.status === 403) throw e;
      last = e.name === "AbortError" ? new Error(model + ": timed out") : e;
    }
  }
  throw last || new Error("No Gemini model available");
}
async function searchQuery(key, question, today) {
  try {
    const t = await gemini(key, {
      contents: [{ role: "user", parts: [{ text: "Today is " + today + ". Decide if answering the message below needs fresh information from the web (news, prices, scores, weather, recent events, who currently holds a role, latest versions, anything recent). Reply with exactly NO, or SEARCH: followed by a short search query.\n\nMessage: " + question.slice(0, 1000) }] }],
      generationConfig: { maxOutputTokens: 400, temperature: 0 }
    }, 12000);
    const s = t.trim();
    if (/^NO\b/i.test(s)) return null;
    const m = s.match(/SEARCH:\s*(.+)/i);
    return (m ? m[1] : question).slice(0, 200);
  } catch (e) { return question.slice(0, 200); }
}
async function tavily(key, q) {
  try {
    const r = await fetchT("https://api.tavily.com/search", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + key },
      body: JSON.stringify({ query: q, max_results: 5, search_depth: "basic" })
    }, 8000);
    if (!r.ok) return [];
    const j = await r.json();
    return (j.results || []).filter(x => x.url && /^https?:/.test(x.url))
      .map(x => ({ title: x.title || x.url, url: x.url, content: (x.content || "").slice(0, 900) }));
  } catch (e) { return []; }
}
module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const gkey = process.env.GEMINI_API_KEY, tkey = process.env.TAVILY_API_KEY;
  if (!gkey) return res.status(500).json({ error: "Server is missing GEMINI_API_KEY. Add it in Vercel settings and redeploy." });
  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (limited(ip)) return res.status(429).json({ error: "Too many requests. Please wait a few minutes." });
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const raw = Array.isArray(body.messages) ? body.messages.slice(-20) : [];
    const msgs = raw.filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .map(m => ({ role: m.role, text: m.content.slice(0, 30000) }));
    if (!msgs.length || msgs[msgs.length - 1].role !== "user") return res.status(400).json({ error: "Bad request" });
    const imgs = (Array.isArray(body.images) ? body.images : [])
      .filter(i => i && ALLOWED.includes(i.type) && typeof i.data === "string").slice(0, 3);
    const search = body.search !== false;
    const today = new Date().toUTCString().slice(0, 16);
    const question = msgs[msgs.length - 1].text;

    let results = [];
    if (search && tkey) {
      const q = await searchQuery(gkey, question, today);
      if (q) results = await tavily(tkey, q);
    }
    let system = "You are GEARO, a helpful AI companion with a light One Piece pirate-adventure flavour. Be genuinely helpful first. Today's date is " + today + ". Reply in plain text without markdown symbols; use short paragraphs. Keep answers concise.";
    if (results.length) {
      system += "\n\nLive web search results for the latest message. Base your answer on them, name the source in plain words, and say so if they do not answer the question:\n" +
        results.map((r, i) => "[" + (i + 1) + "] " + r.title + " (" + r.url + "): " + r.content).join("\n");
    }
    const contents = msgs.map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.text }] }));
    const lastParts = contents[contents.length - 1].parts;
    imgs.forEach(i => lastParts.unshift({ inline_data: { mime_type: i.type, data: i.data } }));
    const text = await gemini(gkey, {
      system_instruction: { parts: [{ text: system }] },
      contents,
      generationConfig: { maxOutputTokens: search ? 2000 : 8000 }
    }, 45000);
    res.status(200).json({ text: text.trim() || "I could not come up with an answer. Please try rephrasing.", sources: results.map(r => ({ title: r.title, url: r.url })) });
  } catch (e) {
    const msg = (e && e.message) || "Unknown error";
    if (e && e.status === 429) return res.status(429).json({ error: "GEARO has reached the free limit for now. Please try again later." });
    res.status(500).json({ error: "Server error: " + msg.slice(0, 300) });
  }
};
