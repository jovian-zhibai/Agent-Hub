import { cn } from "@/lib/utils";
import { type HTMLAttributes, forwardRef } from "react";

// ── Card ───────────────────────────────────────

const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "rounded-lg border border-slate-800 bg-slate-900/60 backdrop-blur-sm",
        className
      )}
      {...props}
    />
  )
);
Card.displayName = "Card";

// ── Card Header ────────────────────────────────

const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("flex flex-col space-y-1.5 p-5", className)}
      {...props}
    />
  )
);
CardHeader.displayName = "CardHeader";

// ── Card Title ─────────────────────────────────

const CardTitle = forwardRef<
  HTMLHeadingElement,
  HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn("text-sm font-semibold leading-none tracking-tight text-slate-300", className)}
    {...props}
  />
));
CardTitle.displayName = "CardTitle";

// ── Card Description ──────────────────────────

const CardDescription = forwardRef<
  HTMLParagraphElement,
  HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("text-xs text-slate-500", className)}
    {...props}
  />
));
CardDescription.displayName = "CardDescription";

// ── Card Content ──────────────────────────────

const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("p-5 pt-0", className)} {...props} />
  )
);
CardContent.displayName = "CardContent";

export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
};