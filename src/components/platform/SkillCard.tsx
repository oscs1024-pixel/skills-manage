import { useNavigate } from "react-router-dom";
import { Link2, FolderOpen, ChevronRight } from "lucide-react";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { ScannedSkill } from "@/types";
import { cn } from "@/lib/utils";

// ─── Source Indicator ─────────────────────────────────────────────────────────

function SourceIndicator({ skill }: { skill: ScannedSkill }) {
  const isSymlink = skill.link_type === "symlink";

  return (
    <div
      className={cn(
        "flex items-center gap-1 text-xs font-medium",
        isSymlink ? "text-primary/80" : "text-muted-foreground"
      )}
    >
      {isSymlink ? (
        <Link2 className="size-3 shrink-0" />
      ) : (
        <FolderOpen className="size-3 shrink-0" />
      )}
      <span>
        {isSymlink ? "Central Skills · symlink" : "独立安装 · copy"}
      </span>
    </div>
  );
}

// ─── SkillCard ────────────────────────────────────────────────────────────────

interface SkillCardProps {
  skill: ScannedSkill;
  className?: string;
}

export function SkillCard({ skill, className }: SkillCardProps) {
  const navigate = useNavigate();

  return (
    <button
      role="button"
      onClick={() => navigate(`/skill/${skill.id}`)}
      className="w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl"
      aria-label={`View skill ${skill.name}`}
    >
      <Card
        size="sm"
        className={cn(
          "transition-all hover:ring-primary/25 hover:bg-accent/30 cursor-pointer",
          className
        )}
      >
        <CardContent className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-1">
            {/* Skill name */}
            <div className="font-medium text-sm text-foreground truncate">
              {skill.name}
            </div>

            {/* Description (truncated to 2 lines) */}
            {skill.description && (
              <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                {skill.description}
              </p>
            )}

            {/* Source indicator */}
            <SourceIndicator skill={skill} />
          </div>

          {/* Arrow icon */}
          <ChevronRight className="size-4 text-muted-foreground shrink-0 mt-0.5" />
        </CardContent>
      </Card>
    </button>
  );
}
