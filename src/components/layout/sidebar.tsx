"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Key,
  Settings,
  Workflow,
  ChevronLeft,
  ChevronRight,
  ScrollText,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/contexts/auth";

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

const navItems: NavItem[] = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "Keys", href: "/keys", icon: Key },
  { label: "Audit Logs", href: "/audit-logs", icon: ScrollText },
  { label: "Settings", href: "/settings", icon: Settings },
];

export default function Sidebar() {
  const { user } = useAuth();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={cn(
        "flex flex-col border-r border-slate-800 bg-slate-900/80 backdrop-blur-sm transition-all duration-200",
        collapsed ? "w-16" : "w-56"
      )}
    >
      {/* Logo */}
      <div className={cn("flex h-14 items-center border-b border-slate-800", collapsed ? "px-2 justify-center" : "px-4 justify-between")}>
        {!collapsed && (
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-indigo-600">
              <Workflow className="h-4 w-4 text-white" />
            </div>
            <span className="text-sm font-semibold text-slate-100">
              Agent Hub
            </span>
          </Link>
        )}
        {collapsed && (
          <Link href="/">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-indigo-600">
              <Workflow className="h-4 w-4 text-white" />
            </div>
          </Link>
        )}
      </div>

      {/* Nav items */}
      <nav className="flex-1 space-y-1 p-3">
        {navItems.map((item) => {
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg text-sm font-medium transition-colors",
                collapsed ? "px-0 justify-center" : "px-3",
                "py-2",
                isActive
                  ? "bg-indigo-600/15 text-indigo-300"
                  : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
              )}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* User info - expanded */}
      {!collapsed && user && (
        <div className="border-t border-slate-800 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600/20 text-indigo-400 text-sm font-semibold">
              {user.email?.[0]?.toUpperCase() || "?"}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-200">
                {user.email || "未知用户"}
              </p>
              {user.name && (
                <p className="truncate text-xs text-slate-500">{user.name}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* User info - collapsed */}
      {collapsed && user && (
        <div className="border-t border-slate-800 px-3 py-3">
          <div className="flex justify-center">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600/20 text-indigo-400 text-sm font-semibold">
              {user.email?.[0]?.toUpperCase() || "?"}
            </div>
          </div>
        </div>
      )}

      {/* Collapse toggle */}
      <div className="border-t border-slate-800">
        <button
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cn(
            "flex w-full items-center justify-center rounded-none py-3 text-slate-500 hover:bg-slate-800/60 hover:text-slate-300 transition-colors",
            collapsed ? "px-0" : "px-3"
          )}
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </button>
      </div>
    </aside>
  );
}