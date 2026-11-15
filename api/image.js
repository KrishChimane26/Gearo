// GEARO image creation: Cloudflare Workers AI (FLUX.1 schnell), free daily allowance.
const hits = new Map();
function limited(ip) {
  const now = Date.now(), win = 10 * 60 * 1000, max = 10;
  const a = (hits.get(ip) || []).filter(t => now - t < win);
  a.push(now); hits.set(ip, a);
  if (hits.size > 5000) hits.clear();
  return a.length > max;
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
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 50000);
    let r;
    try {
      r = await fetch("https://api.cloudflare.com/client/v4/accounts/" + id + "/ai/run/@cf/black-forest-labs/flux-1-schnell", {
        method: "POST",
        headers: { authorization: "Bearer " + token, "content-type": "application/json" },
        body: JSON.stringify({ prompt, steps: 6 }),
        signal: c.signal
      });
    } finally { clearTimeout(t); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.success || !j.result || !j.result.image) {
      const m = (j.errors && j.errors[0] && j.errors[0].message) || "HTTP " + r.status;
      return res.status(r.status === 429 ? 429 : 502).json({ error: "Image service: " + String(m).slice(0, 200) });
    }
    res.status(200).json({ image: "data:image/jpeg;base64," + j.result.image });
  } catch (e) {
    res.status(500).json({ error: "Image error: " + String((e && e.message) || "unknown").slice(0, 200) });
  }
};
