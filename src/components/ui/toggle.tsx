"use client";

import { cn } from "@/lib/utils";
import { type ButtonHTMLAttributes, forwardRef } from "react";

interface ToggleProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  pressed?: boolean;
}

const Toggle = forwardRef<HTMLButtonElement, ToggleProps>(
  ({ className, pressed, ...props }, ref) => (
    <button
      ref={ref}
      role="switch"
      aria-checked={pressed}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border transition-colors",
        "border-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900",
        pressed
          ? "bg-indigo-600 hover:bg-indigo-500"
          : "bg-slate-800 hover:bg-slate-700",
        className
      )}
      {...props}
    >
      <span
        className={cn(
          "pointer-events-none inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform",
          pressed ? "translate-x-4" : "translate-x-0.5"
        )}
      />
    </button>
  )
);
Toggle.displayName = "Toggle";

export { Toggle };