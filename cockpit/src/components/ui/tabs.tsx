import * as TabsPrimitive from "@radix-ui/react-tabs";
import type * as React from "react";

import { cn } from "@/lib/utils";

// `unstyled` drops the base classes below, so a page that draws its own tab
// strip (the dashboard's activity card) still goes through these wrappers.
function Tabs({
  className,
  unstyled,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root> & { unstyled?: boolean }) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={unstyled ? className : cn("flex flex-col gap-4", className)}
      {...props}
    />
  );
}

function TabsList({
  className,
  unstyled,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> & { unstyled?: boolean }) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={
        unstyled
          ? className
          : cn(
              "inline-flex w-fit flex-wrap items-center gap-1 text-muted-foreground",
              className,
            )
      }
      {...props}
    />
  );
}

function TabsTrigger({
  className,
  unstyled,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger> & { unstyled?: boolean }) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={
        unstyled
          ? className
          : cn(
              "inline-flex items-center justify-center gap-1.5 rounded-full border border-transparent px-3.5 py-1.5 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 data-[state=active]:border-border data-[state=active]:bg-card data-[state=active]:text-foreground",
              className,
            )
      }
      {...props}
    />
  );
}

function TabsContent({
  className,
  unstyled,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content> & { unstyled?: boolean }) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={unstyled ? className : cn("outline-none", className)}
      {...props}
    />
  );
}

export { Tabs, TabsContent, TabsList, TabsTrigger };
