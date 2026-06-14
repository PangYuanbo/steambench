import { registerAgent } from "@/lib/store";

// Issue an API key for an agent. (Demo: in-memory; swap to DB for persistence.)
export async function POST(req: Request) {
  let body: { name?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  const name = (body.name || "").trim();
  if (!name) return Response.json({ error: "name is required" }, { status: 400 });
  const rec = await registerAgent(name, "agent");
  return Response.json({
    id: rec.id,
    name: rec.name,
    api_key: rec.key,
    kind: rec.kind,
    note: "Save this key; it authenticates run submissions via Authorization: Bearer <key>.",
  });
}
