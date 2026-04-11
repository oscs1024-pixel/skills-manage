import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Search, PackageOpen } from "lucide-react";
import { usePlatformStore } from "@/stores/platformStore";
import { useSkillStore } from "@/stores/skillStore";
import { Input } from "@/components/ui/input";
import { SkillCard } from "@/components/platform/SkillCard";

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 py-20">
      <div className="p-4 rounded-full bg-muted/60">
        <PackageOpen className="size-12 text-muted-foreground opacity-60" />
      </div>
      <p className="text-sm text-muted-foreground font-medium">{message}</p>
    </div>
  );
}

// ─── PlatformView ─────────────────────────────────────────────────────────────

export function PlatformView() {
  const { agentId } = useParams<{ agentId: string }>();
  const agents = usePlatformStore((state) => state.agents);

  const skillsByAgent = useSkillStore((state) => state.skillsByAgent);
  const loadingByAgent = useSkillStore((state) => state.loadingByAgent);
  const getSkillsByAgent = useSkillStore((state) => state.getSkillsByAgent);

  const [searchQuery, setSearchQuery] = useState("");

  // Load skills for this agent when agentId changes
  useEffect(() => {
    if (agentId) {
      getSkillsByAgent(agentId);
    }
  }, [agentId, getSkillsByAgent]);

  const agent = agents.find((a) => a.id === agentId);
  const isLoading = agentId ? (loadingByAgent[agentId] ?? false) : false;

  // Memoize skills to avoid changing dependency reference on every render
  const skills = useMemo(
    () => (agentId ? (skillsByAgent[agentId] ?? []) : []),
    [agentId, skillsByAgent]
  );

  // Filter skills by search query using useMemo
  const filteredSkills = useMemo(() => {
    if (!searchQuery.trim()) return skills;
    const q = searchQuery.toLowerCase();
    return skills.filter(
      (skill) =>
        skill.name.toLowerCase().includes(q) ||
        skill.description?.toLowerCase().includes(q)
    );
  }, [skills, searchQuery]);

  if (!agent) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Platform not found
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-border px-6 py-4">
        <h1 className="text-xl font-semibold">{agent.display_name}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {agent.global_skills_dir}
        </p>
      </div>

      {/* Search bar */}
      <div className="px-6 py-3 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search skills..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 bg-muted/40"
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <EmptyState message="Loading skills..." />
        ) : skills.length === 0 ? (
          <EmptyState
            message={`No skills installed for ${agent.display_name}`}
          />
        ) : filteredSkills.length === 0 ? (
          <EmptyState
            message={`No skills match "${searchQuery}"`}
          />
        ) : (
          <div className="space-y-3">
            {filteredSkills.map((skill) => (
              <SkillCard key={skill.id} skill={skill} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
