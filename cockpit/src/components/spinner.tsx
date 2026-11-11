import { LoaderCircle } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The one glyph the web client's set has no shape for. It keeps Lucide's
 * drawing at the set's 1.5 px stroke, so it sits with the other icons.
 */
export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle className={cn("animate-spin", className)} strokeWidth={1.5} aria-hidden="true" />;
}
