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
              "inline-flex h-9 w-fit items-center justify-center rounded-lg bg-muted p-[3px] text-muted-foreground",
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
              "inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-3 py-1 text-sm font-medium whitespace-nowrap text-foreground transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 data-[state=active]:border-input data-[state=active]:bg-background data-[state=active]:shadow-sm",
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
