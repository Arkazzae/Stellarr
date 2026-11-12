import { initialsOf } from "@/lib/initials";
import { cn } from "@/lib/utils";

interface UserAvatarProps {
  displayName: string;
  className?: string;
}

/** The panel shows people by their initials; it never loads a picture. */
export function UserAvatar({ displayName, className }: UserAvatarProps) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-full bg-accent text-xs font-semibold",
        className,
      )}
      aria-hidden="true"
    >
      {initialsOf(displayName)}
    </span>
  );
}
