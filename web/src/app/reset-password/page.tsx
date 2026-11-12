import { ResetPasswordClient } from "./ResetPasswordClient";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { token } = await searchParams;
  // A repeated ?token= arrives as an array, which no mailed link produces.
  return <ResetPasswordClient token={typeof token === "string" ? token : ""} />;
}
