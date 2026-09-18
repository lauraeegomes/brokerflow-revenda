import ConviteForm from "./ConviteForm";

export const dynamic = "force-dynamic";

export default async function ConvitePage({ params }) {
  const { token } = await params;
  return <ConviteForm token={token} />;
}
