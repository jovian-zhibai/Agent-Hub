import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number): string {
  if (value < 0) {
    return "-" + formatCurrency(-value);
  }
  if (value < 0.01) return "$0.00";
  if (value < 1000) return `$${value.toFixed(2)}`;
  return `$${(value / 1000).toFixed(1)}k`;
}

export function formatNumber(value: number | undefined | null): string {
  if (value == null || isNaN(value)) return "0";
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return value.toLocaleString();
}

export function timeAgo(date: string | Date | null): string {
  if (!date) return "never";
  const now = Date.now();
  const then = new Date(date).getTime();
  if (isNaN(then)) return "invalid date";
  const diff = now - then;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}