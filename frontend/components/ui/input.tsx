"use client";

import { forwardRef, type InputHTMLAttributes, type LabelHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-10 w-full rounded-md border border-chrome-border bg-bg-raised px-3 py-2 font-mono text-[13px] text-ink",
        "placeholder:text-ink-faint",
        "focus:border-prompt/60 focus:outline-none focus:ring-2 focus:ring-prompt/25",
        "disabled:cursor-not-allowed disabled:opacity-60",
        "transition-colors",
        className
      )}
      {...props}
    />
  )
);
Input.displayName = "Input";

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn(
        "mb-1 block font-mono text-[10.5px] uppercase tracking-[0.16em] text-ink-dim",
        className
      )}
      {...props}
    />
  );
}
