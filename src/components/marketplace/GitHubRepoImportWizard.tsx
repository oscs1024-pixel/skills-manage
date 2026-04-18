import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  GitBranch,
  Loader2,
  PartyPopper,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  DuplicateResolution,
  GitHubRepoImportResult,
  GitHubRepoPreview,
  GitHubSkillImportSelection,
  GitHubSkillPreview,
  AgentWithStatus,
  SkillWithLinks,
} from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { isTauriRuntime } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { InstallDialog } from "@/components/central/InstallDialog";

type WizardStep = "input" | "preview" | "confirm" | "result";

type SelectionState = {
  selected: boolean;
  resolution: DuplicateResolution;
  renamedSkillId: string;
};

interface GitHubRepoImportWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repoUrl: string;
  onRepoUrlChange: (value: string) => void;
  preview: GitHubRepoPreview | null;
  previewError: string | null;
  isPreviewLoading: boolean;
  isImporting: boolean;
  importResult: GitHubRepoImportResult | null;
  onPreview: () => Promise<void> | void;
  onImport: (
    selections: GitHubSkillImportSelection[]
  ) => Promise<GitHubRepoImportResult | void> | GitHubRepoImportResult | void;
  onReset: () => void;
  launcherLabel: string;
  availableAgents?: AgentWithStatus[];
  installableSkills?: SkillWithLinks[];
  onInstallImportedSkill?: (
    skillId: string,
    agentIds: string[],
    method: "symlink" | "copy"
  ) => Promise<void>;
  onAfterImportSuccess?: (result: GitHubRepoImportResult) => Promise<void> | void;
  onOpenCentral?: () => void;
}

function buildInitialSelections(preview: GitHubRepoPreview | null): Record<string, SelectionState> {
  if (!preview) return {};
  return Object.fromEntries(
    preview.skills.map((skill) => [
      skill.sourcePath,
      {
        selected: true,
        resolution: skill.conflict ? "skip" : "overwrite",
        renamedSkillId: skill.skillId,
      },
    ])
  );
}

function normalizeMessage(message: string) {
  return message.replace(/^Error:\s*/, "");
}

function looksLikeGitHubAuthGuidance(message: string) {
  return /github|rate limit|personal access token|pat|settings/i.test(message);
}

export function GitHubRepoImportWizard({
  open,
  onOpenChange,
  repoUrl,
  onRepoUrlChange,
  preview,
  previewError,
  isPreviewLoading,
  isImporting,
  importResult,
  onPreview,
  onImport,
  onReset,
  launcherLabel,
  availableAgents = [],
  installableSkills = [],
  onInstallImportedSkill,
  onAfterImportSuccess,
  onOpenCentral,
}: GitHubRepoImportWizardProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [step, setStep] = useState<WizardStep>("input");
  const [selectionState, setSelectionState] = useState<Record<string, SelectionState>>({});
  const [postImportTargetSkillId, setPostImportTargetSkillId] = useState<string | null>(null);
  const [selectedSkillPath, setSelectedSkillPath] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<"overview" | "explanation" | "options">("overview");
  const detailScrollRef = useRef<HTMLDivElement | null>(null);
  const browserMode = !isTauriRuntime();

  useEffect(() => {
    if (!open) {
      setStep("input");
      setSelectionState({});
      setPostImportTargetSkillId(null);
      setSelectedSkillPath(null);
      setDetailTab("overview");
      return;
    }
    if (importResult) {
      setStep("result");
      return;
    }
    if (preview) {
      setSelectionState(buildInitialSelections(preview));
      setSelectedSkillPath((current) =>
        current && preview.skills.some((skill) => skill.sourcePath === current)
          ? current
          : preview.skills[0]?.sourcePath ?? null
      );
      setStep("preview");
      return;
    }
    setSelectedSkillPath(null);
    setStep("input");
  }, [open, preview, importResult]);

  const postImportSkill = useMemo(() => {
    if (!postImportTargetSkillId) return null;
    return installableSkills.find((skill) => skill.id === postImportTargetSkillId) ?? null;
  }, [installableSkills, postImportTargetSkillId]);

  const selectedSkills = useMemo(() => {
    if (!preview) return [];
    return preview.skills.filter((skill) => selectionState[skill.sourcePath]?.selected);
  }, [preview, selectionState]);

  const selectedPreviewSkill = useMemo(() => {
    if (!preview) return null;
    if (selectedSkillPath) {
      return preview.skills.find((skill) => skill.sourcePath === selectedSkillPath) ?? null;
    }
    return preview.skills[0] ?? null;
  }, [preview, selectedSkillPath]);
  const previewToolbarRepoHref = useMemo(() => {
    if (!preview) return null;
    return `https://github.com/${preview.repo.owner}/${preview.repo.repo}`;
  }, [preview]);

  const blockingConflict = useMemo(() => {
    return selectedSkills.find((skill) => {
      if (!skill.conflict) return false;
      const state = selectionState[skill.sourcePath];
      if (!state) return true;
      if (state.resolution === "skip") return false;
      if (state.resolution === "rename") {
        return !state.renamedSkillId.trim();
      }
      return false;
    });
  }, [selectedSkills, selectionState]);

  const canConfirm = selectedSkills.length > 0 && !blockingConflict;
  const isInputStep = step === "input" && !preview && !importResult;
  const showPreviewWorkspace = Boolean(preview) && step === "preview";
  const showSharedShellBody = Boolean(preview || importResult);
  const footerMode = step === "result" ? "result" : step === "confirm" ? "confirm" : "preview";
  const dialogContentClassName = cn(
    "flex flex-col overflow-hidden p-0 transition-[width,max-width,height] duration-200 ease-out",
    isInputStep
      ? "h-auto max-h-[min(92vh,32rem)] !w-[min(92vw,48rem)] !max-w-[min(92vw,48rem)]"
      : "h-[min(90vh,760px)] !w-[min(94vw,1180px)] !max-w-[min(94vw,1180px)] xl:!w-[min(95vw,1280px)] xl:!max-w-[min(95vw,1280px)]"
  );

  useEffect(() => {
    if (step === "preview") {
      detailScrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
    }
  }, [selectedSkillPath, step]);

  useEffect(() => {
    if (step === "preview") {
      setDetailTab("overview");
    }
  }, [selectedSkillPath, step]);

  const selectedImportPayload = useMemo<GitHubSkillImportSelection[]>(() => {
    return selectedSkills.map((skill) => {
      const state = selectionState[skill.sourcePath];
      return {
        sourcePath: skill.sourcePath,
        resolution: state?.resolution ?? (skill.conflict ? "skip" : "overwrite"),
        renamedSkillId:
          state?.resolution === "rename" ? state.renamedSkillId.trim() || null : null,
      };
    });
  }, [selectedSkills, selectionState]);

  const skippedPreviewSkills = useMemo(
    () => (preview ? preview.skills.filter((skill) => !selectionState[skill.sourcePath]?.selected) : []),
    [preview, selectionState]
  );

  const decisionCounts = useMemo(() => {
    const counts: Record<DuplicateResolution | "import", number> = {
      import: 0,
      overwrite: 0,
      skip: 0,
      rename: 0,
    };

    selectedSkills.forEach((skill) => {
      counts.import += 1;
      const state = selectionState[skill.sourcePath];
      if (skill.conflict) {
        counts[state?.resolution ?? "skip"] += 1;
      }
    });

    counts.skip += skippedPreviewSkills.length;
    return counts;
  }, [selectedSkills, selectionState, skippedPreviewSkills.length]);

  const renamedSelections = useMemo(
    () =>
      selectedSkills.filter(
        (skill) => selectionState[skill.sourcePath]?.resolution === "rename"
      ),
    [selectedSkills, selectionState]
  );

  const overwriteSelections = useMemo(
    () =>
      selectedSkills.filter(
        (skill) => skill.conflict && selectionState[skill.sourcePath]?.resolution === "overwrite"
      ),
    [selectedSkills, selectionState]
  );

  const skippedConflictSelections = useMemo(
    () =>
      selectedSkills.filter(
        (skill) => skill.conflict && selectionState[skill.sourcePath]?.resolution === "skip"
      ),
    [selectedSkills, selectionState]
  );

  function updateSelection(skill: GitHubSkillPreview, next: Partial<SelectionState>) {
    setSelectionState((current) => ({
      ...current,
      [skill.sourcePath]: {
        ...current[skill.sourcePath],
        ...next,
      },
    }));
  }

  async function handlePreviewSubmit() {
    const nextSelectedSkillPath = selectedSkillPath;
    await onPreview();
    if (!preview) {
      setSelectedSkillPath(nextSelectedSkillPath);
    }
    setStep("preview");
  }

  function handleClose(nextOpen: boolean) {
    if (!nextOpen) {
      setPostImportTargetSkillId(null);
      onReset();
    }
    onOpenChange(nextOpen);
  }

  async function handleImportConfirmClick() {
    const result = await onImport(selectedImportPayload);
    if (result) {
      await onAfterImportSuccess?.(result);
    } else if (importResult) {
      await onAfterImportSuccess?.(importResult);
    }
  }

  function handleInstallImported(skillId: string) {
    setPostImportTargetSkillId(skillId);
  }

  async function handleInstallDialogConfirm(
    skillId: string,
    agentIds: string[],
    method: "symlink" | "copy"
  ) {
    if (!onInstallImportedSkill) return;
    await onInstallImportedSkill(skillId, agentIds, method);
    setPostImportTargetSkillId(null);
  }

  function handleStartAnotherImport() {
    setSelectionState({});
    setPostImportTargetSkillId(null);
    setSelectedSkillPath(null);
    onReset();
    setStep("input");
  }

  function handleOpenCentralClick() {
    onOpenCentral?.();
    handleClose(false);
    navigate("/central");
  }

  function renderUrlInputBlock() {
    return (
      <div className="mt-4 rounded-xl border border-border/70 bg-muted/10 p-4">
        <label className="mb-2 block text-sm font-medium" htmlFor="github-repo-url">
          {t("marketplace.githubRepoUrl")}
        </label>
        <div className="flex gap-2">
          <Input
            id="github-repo-url"
            value={repoUrl}
            onChange={(event) => onRepoUrlChange(event.target.value)}
            placeholder="https://github.com/owner/repo"
            className="flex-1"
          />
          <Button onClick={handlePreviewSubmit} disabled={isPreviewLoading || !repoUrl.trim()}>
            {isPreviewLoading ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            <span>{t("marketplace.previewImport")}</span>
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {browserMode
            ? t("marketplace.githubImportDesktopOnlyHint")
            : t("marketplace.githubImportNoWriteHint")}
        </p>
        {browserMode ? (
          <div className="mt-3 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm text-muted-foreground">
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-primary" />
              <span>{t("marketplace.githubImportDesktopOnlyState")}</span>
            </div>
          </div>
        ) : null}
        {previewError ? (
          <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <div className="space-y-2">
                <span className="block">{normalizeMessage(previewError)}</span>
                {looksLikeGitHubAuthGuidance(previewError) ? (
                  <span className="block text-xs text-destructive/90">
                    {t("marketplace.githubPatSettingsHint")}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  function renderPreviewToolbar(currentPreview: GitHubRepoPreview) {
    return (
      <div
        className="mt-2 rounded-xl border border-border/60 bg-muted/10 px-4 py-2.5"
        data-testid="github-import-repo-toolbar"
      >
        <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
                {t("marketplace.githubImportToolbarLabel")}
              </span>
              <span className="truncate text-sm font-semibold">
                {currentPreview.repo.owner}/{currentPreview.repo.repo}
              </span>
              {currentPreview.repo.branch ? (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                  {currentPreview.repo.branch}
                </span>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              <span>{t("marketplace.githubImportFoundSkills", { count: currentPreview.skills.length })}</span>
              <span>{t("marketplace.githubImportToolbarSelected", { count: selectedSkills.length })}</span>
              <span className="truncate text-muted-foreground/90">{currentPreview.repo.normalizedUrl}</span>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center justify-start gap-2 lg:justify-end">
            <a
              href={previewToolbarRepoHref ?? "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background px-3 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <ExternalLink className="size-3.5" />
              <span>{t("marketplace.previewOpenSource")}</span>
            </a>
            <Button
              variant="outline"
              className="h-7"
              onClick={handlePreviewSubmit}
              disabled={isPreviewLoading || !repoUrl.trim()}
            >
              {isPreviewLoading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              <span>{t("marketplace.githubImportRepreview")}</span>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className={dialogContentClassName}>
        <div
          className="shrink-0 border-b border-border/70 px-6 pb-2.5 pt-4"
          data-testid="github-import-compact-header"
        >
          <DialogHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <DialogTitle className="flex items-center gap-2 text-[1.05rem]">
                  <GitBranch className="size-5" />
                  <span>{t("marketplace.githubImportTitle")}</span>
                </DialogTitle>
                <DialogDescription className="mt-0.5 text-xs leading-5 text-muted-foreground">
                  {t("marketplace.githubImportDesc", { launcher: launcherLabel })}
                </DialogDescription>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="rounded-full border border-border/70 bg-muted/20 px-2.5 py-1 font-medium">
                  {t("marketplace.githubImportHeaderLauncher", { launcher: launcherLabel })}
                </span>
              </div>
            </div>
          </DialogHeader>

          <div
            className="mt-2 flex items-center gap-2 overflow-x-auto pb-1 text-[11px] text-muted-foreground"
            data-testid="github-import-flat-stepper"
          >
            {(["input", "preview", "confirm", "result"] as WizardStep[]).map((item, index) => {
              const isActive = step === item || (item === "preview" && step === "confirm");
              const isComplete = (["input", "preview", "confirm", "result"] as WizardStep[]).indexOf(step) > index;

              return (
                <div key={item} className="flex min-w-[11rem] flex-1 items-center gap-2">
                  <div
                    className={cn(
                      "flex min-w-0 flex-1 items-center gap-2 rounded-full border px-3 py-1 shadow-sm",
                      isActive
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : isComplete
                          ? "border-primary/20 bg-primary/5 text-primary/80"
                          : "border-border/70 bg-muted/20 text-muted-foreground"
                    )}
                  >
                    <span
                      className={cn(
                          "flex size-4.5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
                        isActive || isComplete
                          ? "bg-primary text-primary-foreground"
                          : "bg-background text-muted-foreground"
                      )}
                    >
                      {index + 1}
                    </span>
                    <span className="truncate font-medium">{t(`marketplace.githubImportStep.${item}`)}</span>
                  </div>
                  {index < 3 ? (
                    <div
                      className={cn(
                        "h-px min-w-8 flex-1 bg-border/80",
                        isComplete ? "bg-primary/40" : "bg-border/80"
                      )}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>

          {showPreviewWorkspace && preview ? renderPreviewToolbar(preview) : renderUrlInputBlock()}
        </div>

        <div
          className={cn(
            "px-6 py-4",
            showSharedShellBody ? "min-h-0 flex-1 overflow-hidden" : "overflow-visible"
          )}
        >
          {preview ? (
            step === "confirm" ? (
              <div className="flex h-full min-h-0 flex-col overflow-hidden" data-testid="github-import-confirm-summary">
                <div className="min-h-0 flex-1 overflow-y-auto space-y-5 pr-1">
                <div className="rounded-xl border border-border/70 bg-card/80 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="text-sm font-semibold">
                        {t("marketplace.confirmImportTitle")}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {t("marketplace.confirmImportDesc", { count: selectedSkills.length })}
                      </div>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setStep("preview")}>
                      <ArrowLeft className="size-4" />
                      <span>{t("marketplace.githubImportBackToPreview")}</span>
                    </Button>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    {(
                      [
                        ["import", t("marketplace.githubImportDecision.import"), decisionCounts.import],
                        [
                          "skip",
                          t("marketplace.githubImportDecision.skip"),
                          decisionCounts.skip,
                        ],
                        [
                          "overwrite",
                          t("marketplace.githubImportDecision.overwrite"),
                          decisionCounts.overwrite,
                        ],
                        [
                          "rename",
                          t("marketplace.githubImportDecision.rename"),
                          decisionCounts.rename,
                        ],
                      ] as const
                    ).map(([key, label, value]) => (
                      <div
                        key={key}
                        className="rounded-xl border border-border/70 bg-muted/20 px-4 py-3"
                      >
                        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                          {label}
                        </div>
                        <div className="mt-2 text-2xl font-semibold">{value}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,0.95fr)]">
                  <div className="space-y-4">
                    <div className="rounded-xl border border-border/70 bg-card/80 p-4">
                      <div className="text-sm font-semibold">
                        {t("marketplace.githubImportReadyListTitle")}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {t("marketplace.githubImportReadyListDesc")}
                      </div>
                      <ul className="mt-4 space-y-2 text-sm">
                        {selectedSkills.map((skill) => {
                          const state = selectionState[skill.sourcePath];
                          const resolution = state?.resolution ?? "overwrite";
                          return (
                            <li
                              key={skill.sourcePath}
                              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/80 px-3 py-2"
                            >
                              <div className="min-w-0">
                                <div className="font-medium">{skill.skillName}</div>
                                <div className="mt-1 text-[11px] text-muted-foreground">
                                  {skill.sourcePath}
                                </div>
                              </div>
                              <div className="text-right text-xs text-muted-foreground">
                                <div>{t(`marketplace.duplicateResolution.${resolution}`)}</div>
                                {resolution === "rename" && state?.renamedSkillId ? (
                                  <div className="mt-1 font-medium text-foreground">
                                    → {state.renamedSkillId}
                                  </div>
                                ) : null}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="rounded-xl border border-border/70 bg-card/80 p-4">
                      <div className="text-sm font-semibold">
                        {t("marketplace.githubImportConflictSummaryTitle")}
                      </div>
                      <div className="mt-3 space-y-3 text-sm">
                        <div>
                          <div className="font-medium">
                            {t("marketplace.githubImportDecision.overwrite")}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {overwriteSelections.length > 0
                              ? overwriteSelections.map((skill) => skill.skillName).join(", ")
                              : t("marketplace.githubImportDecisionNone")}
                          </div>
                        </div>
                        <div>
                          <div className="font-medium">
                            {t("marketplace.githubImportDecision.rename")}
                          </div>
                          <div className="mt-1 space-y-1 text-xs text-muted-foreground">
                            {renamedSelections.length > 0 ? (
                              renamedSelections.map((skill) => {
                                const renamedSkillId =
                                  selectionState[skill.sourcePath]?.renamedSkillId;
                                return (
                                  <div key={skill.sourcePath}>
                                    {skill.skillName} → {renamedSkillId}
                                  </div>
                                );
                              })
                            ) : (
                              <div>{t("marketplace.githubImportDecisionNone")}</div>
                            )}
                          </div>
                        </div>
                        <div>
                          <div className="font-medium">
                            {t("marketplace.githubImportDecision.skip")}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {skippedConflictSelections.length > 0 || skippedPreviewSkills.length > 0
                              ? [
                                  ...skippedConflictSelections.map((skill) => skill.skillName),
                                  ...skippedPreviewSkills.map((skill) => skill.skillName),
                                ].join(", ")
                              : t("marketplace.githubImportDecisionNone")}
                          </div>
                        </div>
                      </div>
                    </div>

                    {blockingConflict ? (
                      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                        {t("marketplace.resolveConflictsBeforeImport")}
                      </div>
                    ) : (
                      <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm text-muted-foreground">
                        {t("marketplace.githubImportConfirmCalmHint")}
                      </div>
                    )}
                  </div>
                </div>
                </div>
              </div>
            ) : step === "result" && importResult ? (
              <div className="flex h-full min-h-0 flex-col overflow-hidden" data-testid="github-import-result-hub">
                <div className="min-h-0 flex-1 overflow-y-auto space-y-5 pr-1">
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-5">
                  <div className="flex items-start gap-3">
                    <div className="rounded-full bg-emerald-500/10 p-2 text-emerald-700 dark:text-emerald-300">
                      <PartyPopper className="size-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-emerald-700 dark:text-emerald-300">
                        <div className="text-base font-semibold">
                          {t("marketplace.githubImportSuccessTitle")}
                        </div>
                        <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium">
                          {importResult.repo.owner}/{importResult.repo.repo}
                        </span>
                      </div>
                      <div className="mt-2 text-sm text-muted-foreground">
                        {t("marketplace.githubImportSuccessDesc", {
                          count: importResult.importedSkills.length,
                        })}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  <div className="rounded-xl border border-border/70 bg-card/80 px-4 py-3">
                    <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      {t("marketplace.githubImportDecision.import")}
                    </div>
                    <div className="mt-2 text-2xl font-semibold">
                      {importResult.importedSkills.length}
                    </div>
                  </div>
                  <div className="rounded-xl border border-border/70 bg-card/80 px-4 py-3">
                    <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      {t("marketplace.githubImportDecision.skip")}
                    </div>
                    <div className="mt-2 text-2xl font-semibold">
                      {importResult.skippedSkills.length}
                    </div>
                  </div>
                  <div className="rounded-xl border border-border/70 bg-card/80 px-4 py-3">
                    <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      {t("marketplace.githubImportResultInstalledReady")}
                    </div>
                    <div className="mt-2 text-2xl font-semibold">
                      {importResult.importedSkills.length}
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.95fr)]">
                  <div className="rounded-xl border border-border/70 bg-card/80 p-4">
                    <div className="text-sm font-semibold">
                      {t("marketplace.githubImportResultImportedTitle")}
                    </div>
                    <ul className="mt-4 space-y-2 text-sm">
                      {importResult.importedSkills.map((skill) => (
                        <li
                          key={`${skill.sourcePath}-${skill.importedSkillId}`}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/80 px-3 py-2"
                        >
                          <div className="min-w-0">
                            <div className="font-medium">{skill.skillName}</div>
                            <code className="mt-1 inline-flex rounded bg-muted px-2 py-1 text-[11px] text-muted-foreground">
                              {skill.importedSkillId}
                            </code>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs text-muted-foreground">
                              {t(`marketplace.duplicateResolution.${skill.resolution}`)}
                            </span>
                            {onInstallImportedSkill ? (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleInstallImported(skill.importedSkillId)}
                              >
                                <span>{t("marketplace.githubImportInstallImportedSkill")}</span>
                              </Button>
                            ) : null}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="space-y-4">
                    <div className="rounded-xl border border-border/70 bg-card/80 p-4">
                      <div className="text-sm font-semibold">
                        {t("marketplace.githubImportResultNextTitle")}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {t("marketplace.githubImportResultNextDesc")}
                      </div>
                      <div className="mt-4 flex flex-col gap-2">
                        {importResult.importedSkills.length > 0 && onInstallImportedSkill ? (
                          <Button
                            className="justify-between"
                            onClick={() =>
                              handleInstallImported(importResult.importedSkills[0].importedSkillId)
                            }
                          >
                            <span>{t("marketplace.githubImportResultActionInstall")}</span>
                            <ArrowRight className="size-4" />
                          </Button>
                        ) : null}
                        <Button variant="outline" className="justify-between" onClick={handleOpenCentralClick}>
                          <span>{t("marketplace.githubImportResultActionCentral")}</span>
                          <ArrowRight className="size-4" />
                        </Button>
                        <Button variant="ghost" className="justify-between" onClick={handleStartAnotherImport}>
                          <span>{t("marketplace.githubImportResultActionRestart")}</span>
                          <RefreshCw className="size-4" />
                        </Button>
                      </div>
                    </div>

                    <div className="rounded-xl border border-border/70 bg-card/80 p-4">
                      <div className="text-sm font-semibold">
                        {t("marketplace.githubImportResultSkippedTitle")}
                      </div>
                      <div className="mt-3 text-xs text-muted-foreground">
                        {importResult.skippedSkills.length > 0
                          ? importResult.skippedSkills.join(", ")
                          : t("marketplace.githubImportResultSkippedNone")}
                      </div>
                    </div>
                  </div>
                </div>
                </div>
              </div>
            ) : (
              <div className="flex min-h-full flex-col gap-4 overflow-hidden">
                <div
                  className="grid min-h-0 flex-1 gap-4 overflow-hidden lg:grid-cols-[minmax(320px,0.9fr)_minmax(0,1.45fr)] xl:grid-cols-[minmax(360px,0.88fr)_minmax(0,1.52fr)]"
                  data-testid="github-import-preview-workspace"
                >
                  <div className="flex min-h-[22rem] min-w-0 flex-col overflow-hidden rounded-xl border border-border/70 bg-card/70 shadow-sm">
                    <div className="border-b border-border/60 px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold">
                          {t("marketplace.githubImportSelectionTitle")}
                        </div>
                        <span className="rounded-full border border-border/70 bg-background/80 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          {preview.skills.length}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {t("marketplace.githubImportSelectionDesc", { count: preview.skills.length })}
                      </div>
                    </div>

                    <div
                      className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3"
                      data-testid="github-import-summary-list"
                    >
                      {preview.skills.map((skill) => {
                        const state = selectionState[skill.sourcePath];
                        const selected = state?.selected ?? true;
                        const resolution =
                          state?.resolution ?? (skill.conflict ? "skip" : "overwrite");
                        const isActive = selectedPreviewSkill?.sourcePath === skill.sourcePath;

                        return (
                          <button
                            key={skill.sourcePath}
                            type="button"
                            onClick={() => setSelectedSkillPath(skill.sourcePath)}
                            className={cn(
                              "w-full rounded-xl border p-3 text-left transition-colors",
                              isActive
                                ? "border-primary/40 bg-primary/10 shadow-sm"
                                : "border-border/70 bg-background hover:border-primary/20 hover:bg-muted/30"
                            )}
                          >
                            <div className="flex items-start gap-3">
                              <input
                                aria-label={t("marketplace.selectSkill")}
                                type="checkbox"
                                className="mt-1"
                                checked={selected}
                                onChange={(event) => {
                                  event.stopPropagation();
                                  updateSelection(skill, { selected: event.target.checked });
                                }}
                                onClick={(event) => event.stopPropagation()}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <div className="truncate text-sm font-semibold">
                                    {skill.skillName}
                                  </div>
                                  <code className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                                    {skill.skillId}
                                  </code>
                                </div>
                                <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                                  {skill.description || t("marketplace.githubImportNoDescription")}
                                </div>
                                <div className="mt-2 text-[11px] text-muted-foreground">
                                  {skill.sourcePath}
                                </div>
                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                  {skill.conflict ? (
                                    <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600">
                                      {t("marketplace.conflictDetected")}
                                    </span>
                                  ) : (
                                    <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600">
                                      {t("marketplace.readyToImport")}
                                    </span>
                                  )}
                                  {selected && skill.conflict ? (
                                    <span className="text-[11px] text-muted-foreground">
                                      {t(`marketplace.duplicateResolution.${resolution}`)}
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div
                    className="flex min-h-[22rem] min-w-0 flex-col overflow-hidden rounded-xl border border-border/70 bg-card/80 shadow-sm"
                    data-testid="github-import-detail-pane"
                  >
                    {selectedPreviewSkill ? (
                      <>
                        <div className="border-b border-border/60 bg-background/50 px-5 py-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="text-base font-semibold">
                                  {selectedPreviewSkill.skillName}
                                </div>
                                <code className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                                  {selectedPreviewSkill.skillId}
                                </code>
                                {selectedPreviewSkill.conflict ? (
                                  <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600">
                                    {t("marketplace.conflictDetected")}
                                  </span>
                                ) : (
                                  <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600">
                                    {t("marketplace.readyToImport")}
                                  </span>
                                )}
                              </div>
                              <div className="mt-2 break-all text-xs text-muted-foreground">
                                {selectedPreviewSkill.sourcePath}
                              </div>
                            </div>
                            <div className="rounded-full border border-border/70 bg-background/80 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                              {t("marketplace.githubImportToolbarLabel")}
                            </div>
                          </div>
                          <div
                            className="mt-4 flex flex-wrap gap-2"
                            data-testid="github-import-detail-tabs"
                          >
                            {(
                              [
                                ["overview", t("marketplace.githubImportDetailTabs.overview")],
                                ["explanation", t("marketplace.githubImportDetailTabs.explanation")],
                                ["options", t("marketplace.githubImportDetailTabs.options")],
                              ] as const
                            ).map(([tabId, label]) => (
                              <button
                                key={tabId}
                                type="button"
                                onClick={() => setDetailTab(tabId)}
                                className={cn(
                                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                                  detailTab === tabId
                                    ? "border-primary/40 bg-primary/10 text-primary"
                                    : "border-border/70 bg-muted/20 text-muted-foreground hover:text-foreground"
                                )}
                                data-testid={`github-import-detail-tab-${tabId}`}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div
                          ref={detailScrollRef}
                          className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4"
                          data-testid="github-import-detail-scroll"
                        >
                          {detailTab === "overview" ? (
                            <div
                              className="space-y-5"
                              data-testid="github-import-detail-panel-overview"
                            >
                              <div className="space-y-2">
                                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                  {t("marketplace.githubImportSkillDescription")}
                                </div>
                                <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">
                                  {selectedPreviewSkill.description ||
                                    t("marketplace.githubImportNoDescription")}
                                </p>
                              </div>

                              <div className="grid gap-3 text-sm sm:grid-cols-2">
                                <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
                                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                    {t("marketplace.githubImportSkillFolder")}
                                  </div>
                                  <div className="mt-2 break-all text-sm">
                                    {selectedPreviewSkill.skillDirectoryName}
                                  </div>
                                </div>
                                <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
                                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                    {t("marketplace.githubImportRootDirectory")}
                                  </div>
                                  <div className="mt-2 break-all text-sm">
                                    {selectedPreviewSkill.rootDirectory || "."}
                                  </div>
                                </div>
                              </div>
                            </div>
                          ) : null}

                          {detailTab === "explanation" ? (
                            <div
                              className="space-y-4"
                              data-testid="github-import-detail-panel-explanation"
                            >
                              <div className="rounded-lg border border-border/70 bg-muted/20 p-4">
                                <div className="flex items-center gap-2 text-sm font-medium">
                                  <Sparkles className="size-4 text-primary" />
                                  <span>{t("marketplace.githubImportAiSummaryTitle")}</span>
                                </div>
                                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                                  {selectedPreviewSkill.description
                                    ? t("marketplace.githubImportAiSummaryBody", {
                                        name: selectedPreviewSkill.skillName,
                                        description: selectedPreviewSkill.description,
                                      })
                                    : t("marketplace.githubImportAiSummaryFallback", {
                                        name: selectedPreviewSkill.skillName,
                                      })}
                                </p>
                              </div>
                            </div>
                          ) : null}

                          {detailTab === "options" ? (
                            <div
                              className="space-y-5"
                              data-testid="github-import-detail-panel-options"
                            >
                              <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
                                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                  {t("marketplace.githubImportSelectionToggle")}
                                </div>
                                <label className="mt-3 flex items-center gap-3 text-sm">
                                  <input
                                    aria-label={t("marketplace.selectSkill")}
                                    type="checkbox"
                                    checked={
                                      selectionState[selectedPreviewSkill.sourcePath]?.selected ?? true
                                    }
                                    onChange={(event) =>
                                      updateSelection(selectedPreviewSkill, {
                                        selected: event.target.checked,
                                      })
                                    }
                                  />
                                  <span>
                                    {t("marketplace.githubImportSelectCurrentSkill")}
                                  </span>
                                </label>
                              </div>

                              {(selectionState[selectedPreviewSkill.sourcePath]?.selected ?? true) &&
                              selectedPreviewSkill.conflict ? (
                                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
                                  <div className="text-sm font-medium text-amber-700 dark:text-amber-300">
                                    {t("marketplace.conflictWithExisting", {
                                      name: selectedPreviewSkill.conflict.existingName,
                                    })}
                                  </div>
                                  <div className="mt-3 grid gap-2 md:grid-cols-3">
                                    {(["overwrite", "skip", "rename"] as DuplicateResolution[]).map(
                                      (option) => (
                                        <label
                                          key={option}
                                          className={cn(
                                            "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm",
                                            (selectionState[selectedPreviewSkill.sourcePath]?.resolution ??
                                              "skip") === option
                                              ? "border-primary bg-primary/10"
                                              : "border-border bg-background"
                                          )}
                                        >
                                          <input
                                            type="radio"
                                            name={`resolution-${selectedPreviewSkill.sourcePath}`}
                                            checked={
                                              (selectionState[selectedPreviewSkill.sourcePath]
                                                ?.resolution ?? "skip") === option
                                            }
                                            onChange={() =>
                                              updateSelection(selectedPreviewSkill, {
                                                resolution: option,
                                              })
                                            }
                                          />
                                          <span>
                                            {t(`marketplace.duplicateResolution.${option}`)}
                                          </span>
                                        </label>
                                      )
                                    )}
                                  </div>
                                  {(selectionState[selectedPreviewSkill.sourcePath]?.resolution ??
                                    "skip") === "rename" ? (
                                    <div className="mt-3">
                                      <Input
                                        value={
                                          selectionState[selectedPreviewSkill.sourcePath]
                                            ?.renamedSkillId ?? selectedPreviewSkill.skillId
                                        }
                                        onChange={(event) =>
                                          updateSelection(selectedPreviewSkill, {
                                            renamedSkillId: event.target.value,
                                          })
                                        }
                                        placeholder={t("marketplace.renameSkillIdPlaceholder")}
                                      />
                                    </div>
                                  ) : null}
                                </div>
                              ) : (
                                <div className="rounded-lg border border-border/70 bg-card/60 p-4 text-sm text-muted-foreground">
                                  <div className="flex items-center gap-2 font-medium text-foreground">
                                    <ChevronRight className="size-4 text-primary" />
                                    <span>{t("marketplace.githubImportNoConflictTitle")}</span>
                                  </div>
                                  <p className="mt-2 leading-6">
                                    {t("marketplace.githubImportNoConflictBody")}
                                  </p>
                                </div>
                              )}
                            </div>
                          ) : null}
                        </div>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
            )
          ) : null}
        </div>

        {showSharedShellBody ? (
          <div
            className="shrink-0 border-t border-border/70 px-6 py-4"
            data-testid="github-import-shell-footer"
            data-footer-mode={footerMode}
          >
            {step === "result" ? (
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={handleStartAnotherImport}>
                  <RefreshCw className="size-4" />
                  <span>{t("marketplace.githubImportResultActionRestart")}</span>
                </Button>
                <Button onClick={handleClose.bind(null, false)}>
                  <span>{t("common.close")}</span>
                </Button>
              </div>
            ) : step !== "confirm" ? (
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setStep("input")}>
                  <RefreshCw className="size-4" />
                  <span>{t("common.retry")}</span>
                </Button>
                <Button onClick={() => setStep("confirm")} disabled={!canConfirm}>
                  <span>{t("marketplace.reviewImportSelection")}</span>
                </Button>
              </div>
            ) : (
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setStep("preview")}>
                  <span>{t("marketplace.githubImportBackToPreview")}</span>
                </Button>
                <Button onClick={handleImportConfirmClick} disabled={!canConfirm || isImporting}>
                  {isImporting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="size-4" />
                  )}
                  <span>{t("common.import")}</span>
                </Button>
              </div>
            )}
          </div>
        ) : null}
      </DialogContent>

      <InstallDialog
        open={Boolean(postImportSkill)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setPostImportTargetSkillId(null);
          }
        }}
        skill={postImportSkill}
        agents={availableAgents}
        onInstall={handleInstallDialogConfirm}
      />
    </Dialog>
  );
}
