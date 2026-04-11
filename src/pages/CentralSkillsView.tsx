import { useEffect, useMemo, useState } from "react";
import { Search, RefreshCw, PackageOpen, FolderOpen, Settings } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { useCentralSkillsStore } from "@/stores/centralSkillsStore";
import { usePlatformStore } from "@/stores/platformStore";
import { CentralSkillCard } from "@/components/central/CentralSkillCard";
import { InstallDialog } from "@/components/central/InstallDialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SkillWithLinks } from "@/types";

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

// ─── First Visit Empty State ──────────────────────────────────────────────────

function FirstVisitEmptyState() {
  const navigate = useNavigate();
  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 py-16 text-center px-8">
      <div className="p-5 rounded-full bg-primary/10 ring-1 ring-primary/20">
        <PackageOpen className="size-14 text-primary opacity-70" />
      </div>
      <div className="space-y-2">
        <h2 className="text-xl font-semibold text-foreground">Welcome to skills-manage!</h2>
        <p className="text-sm text-muted-foreground max-w-sm leading-relaxed">
          No skills found in <code className="bg-muted px-1.5 py-0.5 rounded-md text-xs font-mono">~/.agents/skills/</code>.
          Get started by creating a SKILL.md file there, or add custom scan directories in Settings.
        </p>
      </div>
      <div className="flex flex-col gap-3 items-center">
        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 rounded-xl px-4 py-3 max-w-xs text-left border border-border">
          <FolderOpen className="size-4 shrink-0 text-primary/60" />
          <span>
            Create a skill directory at <code className="font-mono">~/.agents/skills/my-skill/SKILL.md</code>
          </span>
        </div>
        <Button
          variant="default"
          size="sm"
          onClick={() => navigate("/settings")}
          className="gap-2"
        >
          <Settings className="size-4" />
          Go to Settings
        </Button>
      </div>
    </div>
  );
}

// ─── CentralSkillsView ────────────────────────────────────────────────────────

export function CentralSkillsView() {
  const skills = useCentralSkillsStore((state) => state.skills);
  const agents = useCentralSkillsStore((state) => state.agents);
  const isLoading = useCentralSkillsStore((state) => state.isLoading);
  const loadCentralSkills = useCentralSkillsStore(
    (state) => state.loadCentralSkills
  );
  const installSkill = useCentralSkillsStore((state) => state.installSkill);

  // Keep the platform sidebar counts in sync after install.
  const rescan = usePlatformStore((state) => state.rescan);

  const [searchQuery, setSearchQuery] = useState("");
  const [installTargetSkill, setInstallTargetSkill] =
    useState<SkillWithLinks | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  // Load central skills on mount.
  useEffect(() => {
    loadCentralSkills();
  }, [loadCentralSkills]);

  // Filter skills by search query.
  const filteredSkills = useMemo(() => {
    if (!searchQuery.trim()) return skills;
    const q = searchQuery.toLowerCase();
    return skills.filter(
      (skill) =>
        skill.name.toLowerCase().includes(q) ||
        skill.description?.toLowerCase().includes(q)
    );
  }, [skills, searchQuery]);

  function handleInstallClick(skill: SkillWithLinks) {
    setInstallTargetSkill(skill);
    setIsDialogOpen(true);
  }

  async function handleInstall(skillId: string, agentIds: string[], method: string) {
    try {
      const result = await installSkill(skillId, agentIds, method);
      // Refresh sidebar counts after install.
      await rescan();
      if (result.failed.length > 0) {
        const failedNames = result.failed.map((f) => f.agent_id).join(", ");
        toast.error(`Install partially failed for: ${failedNames}`);
      }
    } catch (err) {
      toast.error(`Install failed: ${String(err)}`);
    }
  }

  async function handleRefresh() {
    try {
      // Re-scan the filesystem first so new/removed skills are picked up,
      // then reload central skills from the (now-updated) database.
      await rescan();
      await loadCentralSkills();
    } catch (err) {
      toast.error(`Refresh failed: ${String(err)}`);
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-border px-6 py-4 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Central Skills</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            ~/.agents/skills/
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleRefresh}
          disabled={isLoading}
          aria-label="Refresh central skills"
        >
          <RefreshCw className={`size-4 ${isLoading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Search bar */}
      <div className="px-6 py-3 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search central skills..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 bg-muted/40"
            aria-label="Search central skills"
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <EmptyState message="Loading skills..." />
        ) : skills.length === 0 ? (
          <FirstVisitEmptyState />
        ) : filteredSkills.length === 0 ? (
          <EmptyState message={`No skills match "${searchQuery}"`} />
        ) : (
          <div className="space-y-3">
            {filteredSkills.map((skill) => (
              <CentralSkillCard
                key={skill.id}
                skill={skill}
                agents={agents}
                onInstallClick={handleInstallClick}
              />
            ))}
          </div>
        )}
      </div>

      {/* Install Dialog */}
      <InstallDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        skill={installTargetSkill}
        agents={agents}
        onInstall={handleInstall}
      />
    </div>
  );
}
