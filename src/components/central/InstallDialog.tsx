import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioItem } from "@/components/ui/radio-group";
import { AgentWithStatus, SkillWithLinks } from "@/types";

// ─── Types ────────────────────────────────────────────────────────────────────

export type InstallMethod = "symlink" | "copy";

interface InstallDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  skill: SkillWithLinks | null;
  /** All agents (the 'central' agent will be filtered out). */
  agents: AgentWithStatus[];
  onInstall: (skillId: string, agentIds: string[], method: InstallMethod) => Promise<void>;
}

// ─── InstallDialog ────────────────────────────────────────────────────────────

export function InstallDialog({
  open,
  onOpenChange,
  skill,
  agents,
  onInstall,
}: InstallDialogProps) {
  // Only show non-central agents in the install dialog.
  const targetAgents = agents.filter((a) => a.id !== "central");

  // Track which agents are selected for installation.
  const [selectedAgentIds, setSelectedAgentIds] = useState<Set<string>>(
    new Set()
  );
  const [installMethod, setInstallMethod] = useState<InstallMethod>("symlink");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // When the dialog opens for a skill, pre-select currently unlinked agents.
  // Agents that already have this skill are checked by default too so the
  // user can see the full picture, but they can deselect any.
  useEffect(() => {
    if (open && skill) {
      // Default: select all agents that are NOT yet linked.
      const initialSelection = new Set<string>(
        targetAgents
          .filter((a) => !skill.linked_agents.includes(a.id))
          .map((a) => a.id)
      );
      setSelectedAgentIds(initialSelection);
      setInstallMethod("symlink");
      setError(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, skill?.id]);

  function handleCheckboxChange(agentId: string, checked: boolean) {
    setSelectedAgentIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(agentId);
      } else {
        next.delete(agentId);
      }
      return next;
    });
  }

  async function handleConfirm() {
    if (!skill) return;

    const agentIds = Array.from(selectedAgentIds);
    if (agentIds.length === 0) {
      setError("Please select at least one platform.");
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      await onInstall(skill.id, agentIds, installMethod);
      onOpenChange(false);
    } catch (err) {
      setError(String(err));
    } finally {
      setIsLoading(false);
    }
  }

  if (!skill) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Install {skill.name}</DialogTitle>
          <DialogClose />
        </DialogHeader>

        <DialogBody className="space-y-5">
          <DialogDescription>
            Choose which platforms to install this skill to.
          </DialogDescription>

          {/* Platform checkboxes */}
          <div className="space-y-2.5" role="group" aria-label="Select platforms">
            {targetAgents.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No platforms detected. Add platforms in Settings.
              </p>
            ) : (
              targetAgents.map((agent) => {
                const isLinked = skill.linked_agents.includes(agent.id);
                const isChecked = selectedAgentIds.has(agent.id);

                return (
                  <div
                    key={agent.id}
                    className="flex items-center gap-2.5"
                  >
                    <Checkbox
                      checked={isChecked}
                      onCheckedChange={(checked) =>
                        handleCheckboxChange(agent.id, !!checked)
                      }
                      aria-label={agent.display_name}
                    />
                    {/* Clicking the text also toggles the checkbox */}
                    <span
                      className="text-sm text-foreground flex-1 cursor-pointer select-none"
                      onClick={() =>
                        handleCheckboxChange(agent.id, !isChecked)
                      }
                    >
                      {agent.display_name}
                    </span>
                    {isLinked && (
                      <span className="text-xs text-green-600 dark:text-green-400">
                        already linked
                      </span>
                    )}
                    {!agent.is_detected && (
                      <span className="text-xs text-muted-foreground">
                        (not detected)
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Install method selector */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Install method
            </p>
            <RadioGroup
              value={installMethod}
              onValueChange={(v) => setInstallMethod(v as InstallMethod)}
            >
              <label className="flex items-center gap-2.5 cursor-pointer">
                <RadioItem value="symlink" />
                <span className="text-sm">Symlink</span>
                <span className="text-xs text-muted-foreground">
                  (recommended — linked to Central Skills)
                </span>
              </label>
              <label className="flex items-center gap-2.5 cursor-pointer">
                <RadioItem value="copy" />
                <span className="text-sm">Copy</span>
                <span className="text-xs text-muted-foreground">
                  (independent copy)
                </span>
              </label>
            </RadioGroup>
          </div>

          {/* Error message */}
          {error && (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          )}
        </DialogBody>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={isLoading || selectedAgentIds.size === 0}
          >
            {isLoading ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                Installing...
              </>
            ) : (
              `Install to ${selectedAgentIds.size} platform${selectedAgentIds.size !== 1 ? "s" : ""}`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
