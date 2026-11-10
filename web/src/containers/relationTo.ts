import type { ProfileRelation } from "@/components/view-models";
import type { FriendsValue } from "@/state/hooks";

type Social = Pick<FriendsValue, "friends" | "requests" | "blocked">;

/**
 * Where you stand with somebody. The roster menu and the profile card both
 * ask, and have to agree: a menu that offers "add to friends" must not open a
 * card that offers "remove".
 */
export function relationTo(
  userId: string,
  selfId: string | undefined,
  { friends, requests, blocked }: Social,
): ProfileRelation {
  if (userId === selfId) return "self";
  if (blocked.some((person) => person.id === userId)) return "blocked";
  if (friends.some((friend) => friend.user.id === userId)) return "friend";
  return requests.find((request) => request.user.id === userId)?.direction ?? "none";
}
