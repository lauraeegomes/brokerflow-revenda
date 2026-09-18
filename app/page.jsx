import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE, usuarioDoToken } from "@/lib/auth.js";
import BrokerFlowClient from "@/components/BrokerFlowClient";

export const dynamic = "force-dynamic";

export default async function Page() {
  const jar = await cookies();
  const user = await usuarioDoToken(jar.get(COOKIE)?.value);
  if (!user) redirect("/login");
  return <BrokerFlowClient user={user} />;
}
