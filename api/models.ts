// Diagnostic: which chat models the configured free keys can use (ids only, no secrets).
export default async function handler(_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) {
  const out: Record<string, unknown> = {};
  const get = async (name: string, url: string, key?: string) => {
    if (!key) { out[name] = 'no key'; return; }
    try {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
      const j = await r.json() as { data?: { id: string }[] };
      out[name] = r.ok ? (j.data ?? []).map((m) => m.id).sort() : `${r.status}`;
    } catch (e) { out[name] = (e as Error).message; }
  };
  await Promise.all([
    get('groq', 'https://api.groq.com/openai/v1/models', process.env.GROQ_API_KEY),
    get('gemini', 'https://generativelanguage.googleapis.com/v1beta/openai/models', process.env.GEMINI_API_KEY),
  ]);
  return res.status(200).json(out);
}
