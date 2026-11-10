import { defaultAvatarUrl } from "@/lib/identity-art";
import { cn } from "@/lib/utils";

interface UserAvatarProps {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  className?: string;
}

function initialsOf(displayName: string): string {
  return displayName
    .split(" ")
    .slice(0, 2)
    .map((word) => word[0])
    .join("");
}

/** Initials sit underneath the picture, so they show while it loads or if it fails. */
export function UserAvatar({ id, displayName, avatarUrl, className }: UserAvatarProps) {
  return (
    <span
      className={cn(
        "relative grid shrink-0 place-items-center overflow-hidden rounded-full bg-muted text-xs font-semibold",
        className,
      )}
      aria-hidden="true"
    >
      {initialsOf(displayName)}
      <img
        className="absolute inset-0 size-full object-cover"
        src={avatarUrl || defaultAvatarUrl(id)}
        alt=""
        loading="lazy"
      />
    </span>
  );
}
