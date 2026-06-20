import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { KeyOverviewItem } from "@/lib/api";
import { KeyRound, Activity, Coins } from "lucide-react";

interface KeyOverviewProps {
  keys: KeyOverviewItem[];
}

function HealthBadge({ health }: { health: string }) {
  const variantMap: Record<string, "success" | "warning" | "danger" | "default"> = {
    normal: "success",
    warning: "warning",
    error: "danger",
    expired: "danger",
  };

  return (
    <Badge variant={variantMap[health] || "default"} className="capitalize">
      {health}
    </Badge>
  );
}

export default function KeyOverview({ keys }: KeyOverviewProps) {
  if (!keys.length) {
    return (
      <Card>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-12">
            <KeyRound className="h-10 w-10 text-slate-600 mb-3" />
            <p className="text-sm text-slate-500">No keys configured</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-2.5">
      {keys.slice(0, 8).map((key) => (
        <Card
          key={key.id}
          className="hover:border-slate-700/80 transition-colors"
        >
          <CardContent className="flex items-center justify-between p-3.5">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-800">
                <KeyRound className="h-4 w-4 text-slate-400" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-200 truncate">
                  {key.keyLabel}
                </p>
                <p className="text-xs text-slate-500">{key.provider.name}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="flex items-center gap-1.5 text-xs text-slate-400">
                <Coins className="h-3.5 w-3.5" />
                <span>
                  {key.remaining != null
                    ? `$${key.remaining.toFixed(2)}`
                    : "Unlimited"}
                </span>
              </div>
              {key.burnRate != null && (
                <div className="flex items-center gap-1 text-xs text-slate-500">
                  <Activity className="h-3 w-3" />
                  <span>${key.burnRate.toFixed(2)}/d</span>
                </div>
              )}
              <HealthBadge health={key.health} />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}