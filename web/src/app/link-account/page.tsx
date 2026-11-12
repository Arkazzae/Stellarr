import { LinkAccountResult, type LinkOutcome } from "./LinkAccountResult";

const OUTCOMES: readonly LinkOutcome[] = ["linked", "taken", "other", "cancelled", "failed"];

export default async function LinkAccountPage({
  searchParams,
}: {
  searchParams: Promise<{ result?: string | string[] }>;
}) {
  const { result } = await searchParams;
  // Anything the server did not send reads as a failure, never as a success.
  const outcome = OUTCOMES.find((candidate) => candidate === result) ?? "failed";
  return <LinkAccountResult outcome={outcome} />;
}
