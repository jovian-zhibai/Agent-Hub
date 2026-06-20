"use client";

import { useAuth } from "@/contexts/auth";
import { LogOut } from "lucide-react";

export default function Header() {
  const { user, logout } = useAuth();

  return (
    <header className="flex h-14 items-center justify-between border-b border-slate-800 bg-slate-900/50 px-6 backdrop-blur-sm">
      <div>
        <h1 className="text-sm font-medium text-slate-200">Agent Hub</h1>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <span>{user?.email || "Unknown"}</span>
        </div>
        <button
          onClick={logout}
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-slate-500 hover:bg-slate-800 hover:text-slate-300 transition-colors"
        >
          <LogOut className="h-3.5 w-3.5" />
          Logout
        </button>
      </div>
    </header>
  );
}