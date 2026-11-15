// GEARO image creation: Cloudflare Workers AI (FLUX.1 schnell), free daily allowance.
const hits = new Map();
function limited(ip) {
  const now = Date.now(), win = 10 * 60 * 1000, max = 10;
  const a = (hits.get(ip) || []).filter(t => now - t < win);
  a.push(now); hits.set(ip, a);
  if (hits.size > 5000) hits.clear();
  return a.length > max;
}
const SYS = "You write prompts for an AI image generator (FLUX). Rewrite the user's idea as ONE detailed English prompt of 60 to 90 words. Describe only what can be seen: the main subject and how they look, clothing, pose and expression, the setting, lighting, colors, camera angle, and an art style that fits the idea (for example anime illustration, realistic photo, oil painting). Turn abstract or vague terms into concrete visuals. Keep the user's meaning. Do not add text, captions or logos. Reply with the prompt only.";
async function enhance(prompt) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return prompt;
  const end = Date.now() + 6000;
  const models = [process.env.GEMINI_IMAGE_PROMPT_MODEL, "gemini-3.5-flash-lite", "gemini-3.8-flash"].filter(Boolean);
  for (const m of models) {
    const left = end - Date.now();
    if (left < 1500) break;
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), left);
    try {
      const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + m + ":generateContent", {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYS }] },
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 500, temperature: 0.7 }
        }),
        signal: c.signal
      });
      if (!r.ok) continue;
      const j = await r.json();
      const parts = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
      const out = parts.map(x => x.text || "").join("").trim();
      if (out.length > 20) return out.slice(0, 1400);
    } catch (e) { /* try next model */ } finally { clearTimeout(t); }
  }
  return prompt;
}
module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const id = process.env.CLOUDFLARE_ACCOUNT_ID, token = process.env.CLOUDFLARE_API_TOKEN;
  if (!id || !token) return res.status(501).json({ error: "Image service not configured" });
  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (limited(ip)) return res.status(429).json({ error: "Too many images. Please wait a few minutes." });
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const prompt = typeof body.prompt === "string" ? body.prompt.trim().slice(0, 1500) : "";
    if (!prompt) return res.status(400).json({ error: "Missing prompt" });
    const better = await enhance(prompt);
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 50000);
    let r;
    try {
      r = await fetch("https://api.cloudflare.com/client/v4/accounts/" + id + "/ai/run/@cf/black-forest-labs/flux-1-schnell", {
        method: "POST",
        headers: { authorization: "Bearer " + token, "content-type": "application/json" },
        body: JSON.stringify({ prompt: better, steps: 8 }),
        signal: c.signal
      });
    } finally { clearTimeout(t); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.success || !j.result || !j.result.image) {
      const m = (j.errors && j.errors[0] && j.errors[0].message) || "HTTP " + r.status;
      return res.status(r.status === 429 ? 429 : 502).json({ error: "Image service: " + String(m).slice(0, 200) });
    }
    res.status(200).json({ image: "data:image/jpeg;base64," + j.result.image, prompt: better });
  } catch (e) {
    res.status(500).json({ error: "Image error: " + String((e && e.message) || "unknown").slice(0, 200) });
  }
};
