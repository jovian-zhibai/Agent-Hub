import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn, formatCurrency, formatNumber, timeAgo } from "@/lib/utils";
import type { Agent } from "@/lib/api";
import { Bot, Activity, DollarSign, FolderCode } from "lucide-react";

interface AgentGridProps {
  agents: Agent[];
}

interface AgentGridGroupedProps {
  projects: {
    projectName: string;
    agents: Agent[];
  }[];
}

function StatusDot({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    running: "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]",
    idle: "bg-slate-500",
    error: "bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.5)]",
    paused: "bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.5)]",
  };

  return (
    <span
      className={cn(
        "inline-block h-2 w-2 rounded-full",
        colorMap[status] || "bg-slate-500"
      )}
    />
  );
}

function AgentCard({ agent, onClick }: { agent: Agent; onClick: () => void }) {
  return (
    <Card
      className="hover:border-indigo-500 transition-colors group cursor-pointer"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <CardContent className="p-5">
        {/* Header */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-600/10">
              <Bot className="h-4 w-4 text-indigo-400" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-200 truncate">
                {agent.name}
              </p>
              <p className="text-xs text-slate-500 truncate">
                {agent.framework}
              </p>
            </div>
          </div>
          <StatusDot status={agent.status} />
        </div>

        {/* Badges */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          <Badge
            variant={
              agent.status === "running"
                ? "success"
                : agent.status === "error"
                  ? "danger"
                  : "default"
            }
          >
            {agent.status}
          </Badge>
          {agent.currentKey && (
            <Badge variant="info">
              {agent.currentKey.provider.name}
            </Badge>
          )}
        </div>

        {/* Stats */}
        <div className="space-y-1.5 text-xs">
          <div className="flex items-center justify-between text-slate-400">
            <span className="flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5" />
              Today calls
            </span>
            <span className="font-medium text-slate-300">
              {formatNumber(agent.todayCalls ?? 0)}
            </span>
          </div>
          <div className="flex items-center justify-between text-slate-400">
            <span className="flex items-center gap-1.5">
              <DollarSign className="h-3.5 w-3.5" />
              Monthly cost
            </span>
            <span className="font-medium text-slate-300">
              {formatCurrency(agent.monthlyCost)}
            </span>
          </div>
          {agent.lastHeartbeat && (
            <div className="flex items-center justify-between text-slate-500">
              <span>Heartbeat</span>
              <span>{timeAgo(agent.lastHeartbeat)}</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Flat grid — renders agents without project grouping.
 */
function FlatAgentGrid({ agents, router }: { agents: Agent[]; router: ReturnType<typeof useRouter> }) {
  if (!agents.length) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <Bot className="h-10 w-10 text-slate-600 mb-3" />
          <p className="text-sm text-slate-500">No agents configured yet</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {agents.map((agent) => (
        <AgentCard
          key={agent.id}
          agent={agent}
          onClick={() => router.push(`/agents/${agent.id}`)}
        />
      ))}
    </div>
  );
}

/**
 * Grouped grid — renders agents organized by project.
 */
function GroupedAgentGrid({ projects, router }: { projects: { projectName: string; agents: Agent[] }[]; router: ReturnType<typeof useRouter> }) {
  if (!projects.length) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <Bot className="h-10 w-10 text-slate-600 mb-3" />
          <p className="text-sm text-slate-500">No agents configured yet</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-8">
      {projects.map((project) => (
        <div key={project.projectName}>
          <div className="flex items-center gap-2 mb-3">
            <FolderCode className="h-4 w-4 text-slate-500" />
            <h3 className="text-sm font-medium text-slate-400">
              {project.projectName}
            </h3>
            <span className="text-xs text-slate-600 ml-auto">
              {project.agents.length} agent{project.agents.length !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {project.agents.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                onClick={() => router.push(`/agents/${agent.id}`)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * AgentGrid component.
 * If `projects` prop is provided, renders in grouped mode.
 * Otherwise falls back to flat list mode.
 */
export default function AgentGrid(props: AgentGridProps | AgentGridGroupedProps) {
  const router = useRouter();

  // Check if we have projects grouping
  if ("projects" in props && props.projects) {
    return <GroupedAgentGrid projects={props.projects} router={router} />;
  }

  // Fallback: flat list
  const flatProps = props as AgentGridProps;
  return <FlatAgentGrid agents={flatProps.agents} router={router} />;
}
