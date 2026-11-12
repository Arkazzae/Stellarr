import { ConfirmEmailClient } from "./ConfirmEmailClient";

export default async function ConfirmEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { token } = await searchParams;
  // A repeated ?token= arrives as an array, which no mailed link produces.
  return <ConfirmEmailClient token={typeof token === "string" ? token : ""} />;
}
