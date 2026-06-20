import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { type LucideIcon } from "lucide-react";

interface MetricCardProps {
  title: string;
  value: string;
  subtitle?: string;
  icon: LucideIcon;
  trend?: { value: string; positive: boolean };
}

export default function MetricCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
}: MetricCardProps) {
  return (
    <Card className="hover:border-slate-700/80 transition-colors">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">
              {title}
            </p>
            <p className="text-2xl font-bold text-slate-100">{value}</p>
            {subtitle && (
              <p className="text-xs text-slate-500">{subtitle}</p>
            )}
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-600/10">
            <Icon className="h-5 w-5 text-indigo-400" />
          </div>
        </div>
        {trend && (
          <div className="mt-3 flex items-center gap-1 text-xs">
            <span
              className={cn(
                "font-medium",
                trend.positive ? "text-emerald-400" : "text-red-400"
              )}
            >
              {trend.value}
            </span>
            <span className="text-slate-500">vs last month</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}