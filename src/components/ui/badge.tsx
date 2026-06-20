import { cn } from "@/lib/utils";
import { type HTMLAttributes, forwardRef } from "react";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "success" | "warning" | "danger" | "info";
}

const variants: Record<string, string> = {
  default: "bg-slate-800 text-slate-300 border-slate-700",
  success: "bg-emerald-900/40 text-emerald-300 border-emerald-800/50",
  warning: "bg-amber-900/40 text-amber-300 border-amber-800/50",
  danger: "bg-red-900/40 text-red-300 border-red-800/50",
  info: "bg-indigo-900/40 text-indigo-300 border-indigo-800/50",
};

const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant = "default", ...props }, ref) => (
    <span
      ref={ref}
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
        variants[variant],
        className
      )}
      {...props}
    />
  )
);
Badge.displayName = "Badge";

export { Badge };