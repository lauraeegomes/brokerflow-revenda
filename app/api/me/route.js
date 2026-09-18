import { api, exigirUsuario } from "@/lib/auth.js";

export const dynamic = "force-dynamic";

export const GET = api(async (request) => {
  const user = await exigirUsuario(request);
  return Response.json({ user });
});
