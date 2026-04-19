import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { GitHubRepoPreview, MarketplaceSkill, SkillRegistry } from "@/types";

type StoreState = {
  registries: SkillRegistry[];
  skills: MarketplaceSkill[];
  selectedRegistryId: string;
  searchQuery: string;
  isLoading: boolean;
  isSyncing: boolean;
  installingIds: Set<string>;
  error: string | null;
  githubImport: {
    isPreviewLoading: boolean;
    isImporting: boolean;
    preview: GitHubRepoPreview | null;
    importResult: unknown | null;
    previewedRepoUrl: string | null;
    error: string | null;
  };
};

const storeState: StoreState = {
  registries: [
    {
      id: "reg-1",
      name: "Repo One",
      source_type: "github",
      url: "https://github.com/acme/repo-one",
      is_builtin: false,
      is_enabled: true,
      last_synced: "2026-04-16T00:00:00Z",
      last_attempted_sync: "2026-04-16T00:10:00Z",
      last_sync_status: "success",
      last_sync_error: null,
      cache_updated_at: "2026-04-16T00:00:00Z",
      cache_expires_at: "2026-04-17T00:00:00Z",
      etag: null,
      last_modified: null,
      created_at: "2026-04-15T00:00:00Z",
    },
  ],
  skills: [
    {
      id: "skill-1",
      registry_id: "reg-1",
      name: "Cached Skill",
      description: "Skill from cache",
      download_url: "https://example.com/skill-1",
      is_installed: false,
      synced_at: "2026-04-16T00:00:00Z",
      cache_updated_at: "2026-04-16T00:00:00Z",
    },
  ],
  selectedRegistryId: "reg-1",
  searchQuery: "",
  isLoading: false,
  isSyncing: false,
  installingIds: new Set<string>(),
  error: null as string | null,
  githubImport: {
    isPreviewLoading: false,
    isImporting: false,
    preview: null,
    importResult: null,
    previewedRepoUrl: null,
    error: null,
  },
};

vi.mock("@/components/skill/UnifiedSkillCard", () => ({
  UnifiedSkillCard: ({
    name,
    description,
    onDetail,
    onInstall,
    isInstalled,
  }: {
    name: string;
    description?: string;
    onDetail?: () => void;
    onInstall?: () => void;
    isInstalled?: boolean;
  }) => (
    <div>
      <button type="button" onClick={onDetail}>
        {name}
      </button>
      {description ? <div>{description}</div> : null}
      {onInstall ? (
        <button type="button" onClick={onInstall}>
          {isInstalled ? "Installed" : "Install"}
        </button>
      ) : null}
    </div>
  ),
}));

vi.mock("@/components/central/InstallDialog", () => ({
  InstallDialog: () => null,
}));

const mockLoadRegistries = vi.fn();
const mockSelectRegistry = vi.fn();
const mockSetSearchQuery = vi.fn();
const mockSyncRegistry = vi.fn();
const mockInstallSkill = vi.fn();
const mockAddRegistry = vi.fn();
const mockRemoveRegistry = vi.fn();
const mockFindDuplicateRegistry = vi.fn();
const mockLoadPreviewSkills = vi.fn();
const mockRescan = vi.fn();
const mockPreviewGitHubRepoImport = vi.fn();
const mockImportGitHubRepoSkills = vi.fn();
const mockResetGitHubImport = vi.fn();
const mockLoadCentralSkills = vi.fn();
const mockInstallCentralSkill = vi.fn();
const mockGetSkillsByAgent = vi.fn();

vi.mock("sonner", async () => {
  const actual = await vi.importActual<typeof import("sonner")>("sonner");
  return {
    ...actual,
    toast: {
      ...actual.toast,
      success: vi.fn(),
      error: vi.fn(),
    },
  };
});

vi.mock("@/stores/marketplaceStore", () => ({
  useMarketplaceStore: (selector: (state: typeof storeState & Record<string, unknown>) => unknown) =>
    selector({
      ...storeState,
      loadRegistries: mockLoadRegistries,
      selectRegistry: mockSelectRegistry,
      setSearchQuery: mockSetSearchQuery,
      syncRegistry: mockSyncRegistry,
      installSkill: mockInstallSkill,
      addRegistry: mockAddRegistry,
      removeRegistry: mockRemoveRegistry,
      findDuplicateRegistry: mockFindDuplicateRegistry,
      loadPreviewSkills: mockLoadPreviewSkills,
      githubImport: storeState.githubImport,
      previewGitHubRepoImport: mockPreviewGitHubRepoImport,
      importGitHubRepoSkills: mockImportGitHubRepoSkills,
      resetGitHubImport: mockResetGitHubImport,
    }),
}));

vi.mock("@/stores/platformStore", () => ({
  usePlatformStore: (selector: (state: { rescan: typeof mockRescan; agents: Array<{ id: string; display_name: string; category: string; global_skills_dir: string; is_detected: boolean; is_builtin: boolean; is_enabled: boolean }> }) => unknown) =>
    selector({
      rescan: mockRescan,
      agents: [
        {
          id: "claude-code",
          display_name: "Claude Code",
          category: "coding",
          global_skills_dir: "~/.claude/skills/",
          is_detected: true,
          is_builtin: true,
          is_enabled: true,
        },
        {
          id: "central",
          display_name: "Central Skills",
          category: "central",
          global_skills_dir: "~/.agents/skills/",
          is_detected: true,
          is_builtin: true,
          is_enabled: true,
        },
      ],
    }),
}));

vi.mock("@/stores/centralSkillsStore", () => ({
  useCentralSkillsStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) =>
      selector({
        skills: [],
        agents: [],
        loadCentralSkills: mockLoadCentralSkills,
        installSkill: mockInstallCentralSkill,
      }),
    {
      getState: () => ({ skills: [] }),
    }
  ),
}));

vi.mock("@/stores/skillStore", () => ({
  useSkillStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      skillsByAgent: {},
      loadingByAgent: {},
      error: null,
      getSkillsByAgent: mockGetSkillsByAgent,
    }),
}));

import { MarketplaceView } from "@/pages/MarketplaceView";
import { toast } from "sonner";
import * as tauriBridge from "@/lib/tauri";

const mockedToast = vi.mocked(toast);
const mockToastSuccess = mockedToast.success as unknown as ReturnType<typeof vi.fn>;
const mockToastError = mockedToast.error as unknown as ReturnType<typeof vi.fn>;

describe("MarketplaceView", () => {
  beforeEach(() => {
    mockLoadRegistries.mockReset();
    mockSelectRegistry.mockReset();
    mockSetSearchQuery.mockReset();
    mockSyncRegistry.mockReset();
    mockInstallSkill.mockReset();
    mockAddRegistry.mockReset();
    mockRemoveRegistry.mockReset();
    mockFindDuplicateRegistry.mockReset();
    mockLoadPreviewSkills.mockReset();
    mockRescan.mockReset();
    mockPreviewGitHubRepoImport.mockReset();
    mockImportGitHubRepoSkills.mockReset();
    mockResetGitHubImport.mockReset();
    mockLoadCentralSkills.mockReset();
    mockInstallCentralSkill.mockReset();
    mockGetSkillsByAgent.mockReset();
    mockToastSuccess.mockReset();
    mockToastError.mockReset();

    storeState.registries = [
      {
        id: "reg-1",
        name: "Repo One",
        source_type: "github",
        url: "https://github.com/acme/repo-one",
        is_builtin: false,
        is_enabled: true,
        last_synced: "2026-04-16T00:00:00Z",
        last_attempted_sync: "2026-04-16T00:10:00Z",
        last_sync_status: "success",
        last_sync_error: null,
        cache_updated_at: "2026-04-16T00:00:00Z",
        cache_expires_at: "2026-04-17T00:00:00Z",
        etag: null,
        last_modified: null,
        created_at: "2026-04-15T00:00:00Z",
      },
    ];
    storeState.skills = [
      {
        id: "skill-1",
        registry_id: "reg-1",
        name: "Cached Skill",
        description: "Skill from cache",
        download_url: "https://example.com/skill-1",
        is_installed: false,
        synced_at: "2026-04-16T00:00:00Z",
        cache_updated_at: "2026-04-16T00:00:00Z",
      },
    ];
    storeState.selectedRegistryId = "reg-1";
    storeState.searchQuery = "";
    storeState.isLoading = false;
    storeState.isSyncing = false;
    storeState.installingIds = new Set<string>();
    storeState.error = null as string | null;
    storeState.githubImport = {
      isPreviewLoading: false,
      isImporting: false,
      preview: null,
      importResult: null,
      previewedRepoUrl: null,
      error: null,
    };
    mockFindDuplicateRegistry.mockImplementation(() => null);
    mockLoadPreviewSkills.mockResolvedValue([
      {
        id: "official-skill-1",
        registry_id: "official-1",
        name: "Knowledge Work Plugin",
        description: "Useful repo preview content",
        download_url: "https://example.com/official-skill-1",
        is_installed: false,
        synced_at: "2026-04-16T00:00:00Z",
        cache_updated_at: "2026-04-16T00:00:00Z",
      },
    ]);
  });

  function renderView() {
    return render(
      <MemoryRouter>
        <MarketplaceView />
      </MemoryRouter>
    );
  }

  it("shows cached status for the selected source and keeps cached skills visible", async () => {
    renderView();

    fireEvent.click(screen.getByRole("button", { name: "My Sources" }));

    expect(await screen.findByText("Cached Skill")).toBeInTheDocument();
    expect(screen.getByText(/Cached ·|缓存可用/i)).toBeInTheDocument();
    expect(screen.getByText(/Reopening this source reuses backend cache/i)).toBeInTheDocument();
    expect(screen.getByText(/Cache valid until:/i)).toBeInTheDocument();
  });

  it("uses cached update without forcing a refresh", async () => {
    mockSyncRegistry.mockResolvedValue(undefined);
    renderView();

    fireEvent.click(screen.getByRole("button", { name: "My Sources" }));
    fireEvent.click(screen.getByRole("button", { name: "Update" }));

    await waitFor(() => {
      expect(mockSyncRegistry).toHaveBeenCalledWith("reg-1", false);
    });
    expect(mockToastSuccess).not.toHaveBeenCalledWith("Marketplace cache updated");
  });

  it("force refreshes and reports cached fallback after a failure", async () => {
    mockSyncRegistry.mockRejectedValue(new Error("network down"));
    storeState.error = "Error: network down" as string | null;
    storeState.registries = [
      {
        ...storeState.registries[0],
        last_sync_status: "error",
        last_sync_error: "network down",
      },
    ];

    renderView();

    fireEvent.click(screen.getByRole("button", { name: "My Sources" }));
    fireEvent.click(screen.getByRole("button", { name: "Force Refresh" }));

    await waitFor(() => {
      expect(mockSyncRegistry).toHaveBeenCalledWith("reg-1", true);
    });
    expect(await screen.findByText(/Refresh failed, showing cached data/i)).toBeInTheDocument();
    expect(screen.getByText("Cached Skill")).toBeInTheDocument();
  });

  it("shows persisted source metadata and deletes a source from My Sources", async () => {
    mockRemoveRegistry.mockResolvedValue(undefined);
    renderView();

    fireEvent.click(screen.getByRole("button", { name: "My Sources" }));

    expect(screen.getByText("Repo One")).toBeInTheDocument();
    expect(screen.getByText(/Source identity and sync metadata persist/i)).toBeInTheDocument();
    expect(screen.getByText(/Cache updated:/i)).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);

    await waitFor(() => {
      expect(mockRemoveRegistry).toHaveBeenCalledWith("reg-1");
    });
    expect(mockToastSuccess).toHaveBeenCalledWith("Source deleted");
  });

  it("warns when adding a source that duplicates an official source", async () => {
    mockAddRegistry.mockRejectedValue(
      new Error(
        'DUPLICATE_REGISTRY:{"id":"official-1","name":"Anthropic","url":"https://github.com/anthropics/skills","isBuiltin":true}'
      )
    );

    renderView();

    fireEvent.click(screen.getByRole("button", { name: "Official Directory" }));
    fireEvent.click(screen.getByRole("button", { name: /Anthropic/i }));
    fireEvent.click(screen.getAllByRole("button", { name: /\+ Add to My Sources/i })[0]);

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith(
        "This repo already exists in Official Directory: Anthropic"
      );
    });
  });

  it("loads official directory preview skills from backend cache instead of showing an empty fallback", async () => {
    renderView();

    fireEvent.click(screen.getByRole("button", { name: "Official Directory" }));
    fireEvent.click(screen.getByRole("button", { name: /Anthropic/i }));
    fireEvent.click(screen.getAllByRole("button", { name: /Browse Skills/i })[0]);

    await waitFor(() => {
      expect(mockLoadPreviewSkills).toHaveBeenCalled();
    });

    expect(await screen.findByText("Knowledge Work Plugin")).toBeInTheDocument();
    expect(screen.getByText("Useful repo preview content")).toBeInTheDocument();
    expect(screen.queryByText("No skills found")).not.toBeInTheDocument();
  });

  it("shows stable browser fallback copy when official preview runs without Tauri", async () => {
    const isTauriSpy = vi.spyOn(tauriBridge, "isTauriRuntime").mockReturnValue(false);

    renderView();

    fireEvent.click(screen.getByRole("button", { name: "Official Directory" }));
    fireEvent.click(screen.getByRole("button", { name: /Anthropic/i }));
    fireEvent.click(screen.getAllByRole("button", { name: /Browse Skills/i })[0]);

    expect(await screen.findByText(/Preview unavailable in browser mode/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Open this flow in the desktop app to browse and install repository skills/i)
    ).toBeInTheDocument();
    expect(mockLoadPreviewSkills).not.toHaveBeenCalled();

    isTauriSpy.mockRestore();
  });

  it("opens a marketplace preview drawer without leaving the marketplace route", async () => {
    renderView();

    fireEvent.click(screen.getByRole("button", { name: "My Sources" }));
    fireEvent.click(screen.getByRole("button", { name: "Cached Skill" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText("Cached Skill")).toBeInTheDocument();
    expect(within(dialog).getByText(/Source/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/Repo One/i)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Install" })).toBeInTheDocument();
    expect(within(dialog).getByTestId("skill-detail-right-sidebar")).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: /Open SKILL.md/i })).toHaveAttribute(
      "href",
      "https://example.com/skill-1"
    );
    expect(window.location.pathname).toBe("/");
  });

  it("restores focus to the originating marketplace card when the preview drawer closes", async () => {
    renderView();

    fireEvent.click(screen.getByRole("button", { name: "My Sources" }));
    const trigger = screen.getByRole("button", { name: "Cached Skill" });

    fireEvent.click(trigger);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Cached Skill" })).toHaveFocus();
  });

  it("installs from the preview drawer and refreshes shared state without a manual reload", async () => {
    mockInstallSkill.mockResolvedValue(undefined);
    renderView();

    fireEvent.click(screen.getByRole("button", { name: "My Sources" }));
    fireEvent.click(screen.getByRole("button", { name: "Cached Skill" }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Install" }));

    await waitFor(() => {
      expect(mockInstallSkill).toHaveBeenCalledWith("skill-1");
    });
    await waitFor(() => {
      expect(mockRescan).toHaveBeenCalled();
    });
    expect(mockToastSuccess).toHaveBeenCalledWith("Installed successfully");
  });

  it("opens the shared github import wizard and previews before import", async () => {
    mockPreviewGitHubRepoImport.mockImplementation(async () => {
      storeState.githubImport = {
        isPreviewLoading: false,
        isImporting: false,
        preview: {
          repo: {
            owner: "dorukardahan",
            repo: "twitterapi-io-skill",
            branch: "main",
            normalizedUrl: "https://github.com/dorukardahan/twitterapi-io-skill",
          },
          skills: [
            {
              sourcePath: "twitterapi-io-skill/SKILL.md",
              skillId: "twitterapi-io",
              skillName: "twitterapi-io",
              description: "Twitter API helper",
              rootDirectory: ".",
              skillDirectoryName: "twitterapi-io-skill",
              downloadUrl: "https://example.com/twitterapi-io",
              conflict: null,
            },
          ],
        },
        importResult: null,
        previewedRepoUrl: "https://github.com/dorukardahan/twitterapi-io-skill",
        error: null,
      };
    });

    renderView();

    fireEvent.click(screen.getByRole("button", { name: /Import GitHub repo|导入 GitHub 仓库/i }));
    fireEvent.change(screen.getByLabelText(/GitHub repository URL|GitHub 仓库 URL/i), {
      target: { value: "https://github.com/dorukardahan/twitterapi-io-skill" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Preview import|预览导入/i }));

    await waitFor(() => {
      expect(mockPreviewGitHubRepoImport).toHaveBeenCalledWith(
        "https://github.com/dorukardahan/twitterapi-io-skill"
      );
    });
    expect(await screen.findByText("twitterapi-io")).toBeInTheDocument();
    expect(screen.getByTestId("github-import-compact-header")).toBeInTheDocument();
    expect(screen.getByText(/From Marketplace|来自 Marketplace/i)).toBeInTheDocument();
    expect(screen.getByTestId("github-import-flat-stepper")).toBeInTheDocument();
    expect(screen.getByTestId("github-import-repo-toolbar")).toBeInTheDocument();
    expect(screen.getByTestId("github-import-preview-workspace")).toBeInTheDocument();
    expect(screen.getByTestId("github-import-summary-list")).toBeInTheDocument();
    expect(screen.getByTestId("github-import-detail-pane")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Re-preview|重新预览/i })).toBeInTheDocument();
    expect(mockImportGitHubRepoSkills).not.toHaveBeenCalled();
  });

  it("uses an expanded desktop width for the github preview shell while keeping the split layout", async () => {
    mockPreviewGitHubRepoImport.mockImplementation(async () => {
      storeState.githubImport = {
        isPreviewLoading: false,
        isImporting: false,
        preview: {
          repo: {
            owner: "anthropics",
            repo: "skills",
            branch: "main",
            normalizedUrl: "https://github.com/anthropics/skills",
          },
          skills: [
            {
              sourcePath: "skills/first/SKILL.md",
              skillId: "first-skill",
              skillName: "First Skill",
              description: "First skill full description",
              rootDirectory: "skills",
              skillDirectoryName: "first",
              downloadUrl: "https://example.com/first",
              conflict: null,
            },
            {
              sourcePath: "skills/second/SKILL.md",
              skillId: "second-skill",
              skillName: "Second Skill",
              description: "Second skill full description",
              rootDirectory: "skills",
              skillDirectoryName: "second",
              downloadUrl: "https://example.com/second",
              conflict: null,
            },
          ],
        },
        importResult: null,
        previewedRepoUrl: "https://github.com/anthropics/skills",
        error: null,
      };
    });

    renderView();

    fireEvent.click(screen.getByRole("button", { name: /Import GitHub repo|导入 GitHub 仓库/i }));
    fireEvent.change(screen.getByLabelText(/GitHub repository URL|GitHub 仓库 URL/i), {
      target: { value: "https://github.com/anthropics/skills" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Preview import|预览导入/i }));

    const dialog = await screen.findByRole("dialog");
    const content = dialog.querySelector('[data-slot="dialog-content"]');
    expect(content?.className).toContain("w-[min(94vw,1180px)]");
    expect(content?.className).toContain("xl:w-[min(95vw,1280px)]");

    const splitLayout = screen
      .getByTestId("github-import-summary-list")
      .closest(".grid");
    expect(splitLayout?.className).toContain(
      "lg:grid-cols-[minmax(320px,0.9fr)_minmax(0,1.45fr)]"
    );
    expect(splitLayout?.className).toContain(
      "xl:grid-cols-[minmax(360px,0.88fr)_minmax(0,1.52fr)]"
    );
  });

  it("renders a compact github import header and flatter single-row stepper", async () => {
    mockPreviewGitHubRepoImport.mockImplementation(async () => {
      storeState.githubImport = {
        isPreviewLoading: false,
        isImporting: false,
        preview: {
          repo: {
            owner: "anthropics",
            repo: "skills",
            branch: "main",
            normalizedUrl: "https://github.com/anthropics/skills",
          },
          skills: [
            {
              sourcePath: "skills/first/SKILL.md",
              skillId: "first-skill",
              skillName: "First Skill",
              description: "First skill full description",
              rootDirectory: "skills",
              skillDirectoryName: "first",
              downloadUrl: "https://example.com/first",
              conflict: null,
            },
          ],
        },
        importResult: null,
        previewedRepoUrl: "https://github.com/anthropics/skills",
        error: null,
      };
    });

    renderView();

    fireEvent.click(screen.getByRole("button", { name: /Import GitHub repo|导入 GitHub 仓库/i }));
    fireEvent.change(screen.getByLabelText(/GitHub repository URL|GitHub 仓库 URL/i), {
      target: { value: "https://github.com/anthropics/skills" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Preview import|预览导入/i }));

    const header = await screen.findByTestId("github-import-compact-header");
    const stepper = screen.getByTestId("github-import-flat-stepper");

    expect(header.className).toContain("pb-2.5");
    expect(header.className).toContain("pt-4");
    expect(within(header).getByText(/From Marketplace|来自 Marketplace/i)).toBeInTheDocument();
    expect(stepper.className).toContain("overflow-x-auto");
    expect(stepper.textContent).toContain("Repo URL");
    expect(stepper.textContent).toContain("Preview");
    expect(stepper.textContent).toContain("Confirm");
    expect(stepper.textContent).toContain("Result");
  });

  it("switches detail tabs without disturbing the preview shell state", async () => {
    mockPreviewGitHubRepoImport.mockImplementation(async () => {
      storeState.githubImport = {
        isPreviewLoading: false,
        isImporting: false,
        preview: {
          repo: {
            owner: "anthropics",
            repo: "skills",
            branch: "main",
            normalizedUrl: "https://github.com/anthropics/skills",
          },
          skills: [
            {
              sourcePath: "skills/first/SKILL.md",
              skillId: "first-skill",
              skillName: "First Skill",
              description: "First skill full description",
              rootDirectory: "skills",
              skillDirectoryName: "first",
              downloadUrl: "https://example.com/first",
              conflict: {
                existingSkillId: "first-skill",
                existingName: "First Skill",
                existingCanonicalPath: "/Users/test/.agents/skills/first-skill",
                proposedSkillId: "first-skill",
                proposedName: "First Skill",
              },
            },
          ],
        },
        importResult: null,
        previewedRepoUrl: "https://github.com/anthropics/skills",
        error: null,
      };
    });

    renderView();

    fireEvent.click(screen.getByRole("button", { name: /Import GitHub repo|导入 GitHub 仓库/i }));
    fireEvent.change(screen.getByLabelText(/GitHub repository URL|GitHub 仓库 URL/i), {
      target: { value: "https://github.com/anthropics/skills" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Preview import|预览导入/i }));

    await screen.findByTestId("github-import-preview-workspace");

    const detailTabs = screen.getByTestId("github-import-detail-tabs");
    const overviewTab = screen.getByTestId("github-import-detail-tab-overview");
    const aiTab = screen.getByTestId("github-import-detail-tab-ai");
    const optionsTab = screen.getByTestId("github-import-detail-tab-options");

    expect(detailTabs).toBeInTheDocument();
    expect(overviewTab).toHaveAttribute("aria-pressed", "true");
    expect(aiTab).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("github-import-detail-panel-overview")).toBeInTheDocument();
    expect(screen.getByTestId("github-import-summary-list")).toBeInTheDocument();
    expect(screen.getByTestId("github-import-shell-footer")).toBeInTheDocument();

    fireEvent.click(aiTab);
    expect(screen.getByTestId("github-import-detail-panel-ai")).toBeInTheDocument();
    expect(screen.queryByTestId("github-import-detail-panel-overview")).not.toBeInTheDocument();
    expect(overviewTab).toHaveAttribute("aria-pressed", "false");
    expect(aiTab).toHaveAttribute("aria-pressed", "true");
    expect(optionsTab).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText(/Why this skill matters|为什么值得导入/i)).toBeInTheDocument();
    expect(screen.getByText(/AI import summary|AI 导入摘要/i)).toBeInTheDocument();

    fireEvent.click(optionsTab);
    expect(screen.getByTestId("github-import-detail-panel-options")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Overwrite|覆盖/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Review import|检查导入内容/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /First Skill/i })).toBeInTheDocument();
    expect(screen.getByText(/Conflict options|冲突选项/i)).toBeInTheDocument();
    expect(overviewTab).toHaveAttribute("aria-pressed", "false");
    expect(aiTab).toHaveAttribute("aria-pressed", "false");
    expect(optionsTab).toHaveAttribute("aria-pressed", "true");
  });

  it("slims the github preview repo toolbar into a dense two-row summary", async () => {
    mockPreviewGitHubRepoImport.mockImplementation(async () => {
      storeState.githubImport = {
        isPreviewLoading: false,
        isImporting: false,
        preview: {
          repo: {
            owner: "anthropics",
            repo: "skills",
            branch: "main",
            normalizedUrl: "https://github.com/anthropics/skills",
          },
          skills: [
            {
              sourcePath: "skills/first/SKILL.md",
              skillId: "first-skill",
              skillName: "First Skill",
              description: "First skill full description",
              rootDirectory: "skills",
              skillDirectoryName: "first",
              downloadUrl: "https://example.com/first",
              conflict: null,
            },
          ],
        },
        importResult: null,
        previewedRepoUrl: "https://github.com/anthropics/skills",
        error: null,
      };
    });

    renderView();

    fireEvent.click(screen.getByRole("button", { name: /Import GitHub repo|导入 GitHub 仓库/i }));
    fireEvent.change(screen.getByLabelText(/GitHub repository URL|GitHub 仓库 URL/i), {
      target: { value: "https://github.com/anthropics/skills" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Preview import|预览导入/i }));

    const toolbar = await screen.findByTestId("github-import-repo-toolbar");
    expect(toolbar.className).toContain("px-4");
    expect(toolbar.className).toContain("py-2.5");
    expect(toolbar.firstElementChild?.className).toContain("lg:grid-cols-[minmax(0,1fr)_auto]");
    expect(within(toolbar).getByText(/Preview workspace|预览工作台/i)).toBeInTheDocument();
    expect(within(toolbar).getByText("anthropics/skills")).toBeInTheDocument();
    expect(within(toolbar).getByText("1 discovered skill(s)")).toBeInTheDocument();
    expect(within(toolbar).getByText("1 selected")).toBeInTheDocument();
    expect(within(toolbar).getByRole("link", { name: /Open source repo/i })).toBeInTheDocument();
  });

  it("uses a medium adaptive shell for the initial github import input step", async () => {
    renderView();

    fireEvent.click(screen.getByRole("button", { name: /Import GitHub repo|导入 GitHub 仓库/i }));

    const dialog = await screen.findByRole("dialog");
    const content = dialog.querySelector('[data-slot="dialog-content"]');

    expect(content?.className).toContain("h-auto");
    expect(content?.className).toContain("max-h-[min(92vh,32rem)]");
    expect(content?.className).toContain("w-[min(92vw,48rem)]");
    expect(content?.className).toContain("max-w-[min(92vw,48rem)]");
  });

  it("keeps the shared shell footer visible on preview and disables review when nothing is selected", async () => {
    mockPreviewGitHubRepoImport.mockImplementation(async () => {
      storeState.githubImport = {
        isPreviewLoading: false,
        isImporting: false,
        preview: {
          repo: {
            owner: "anthropics",
            repo: "skills",
            branch: "main",
            normalizedUrl: "https://github.com/anthropics/skills",
          },
          skills: [
            {
              sourcePath: "skills/first/SKILL.md",
              skillId: "first-skill",
              skillName: "First Skill",
              description: "First skill full description",
              rootDirectory: "skills",
              skillDirectoryName: "first",
              downloadUrl: "https://example.com/first",
              conflict: null,
            },
          ],
        },
        importResult: null,
        previewedRepoUrl: "https://github.com/anthropics/skills",
        error: null,
      };
    });

    renderView();

    fireEvent.click(screen.getByRole("button", { name: /Import GitHub repo|导入 GitHub 仓库/i }));
    fireEvent.change(screen.getByLabelText(/GitHub repository URL|GitHub 仓库 URL/i), {
      target: { value: "https://github.com/anthropics/skills" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Preview import|预览导入/i }));

    await screen.findByTestId("github-import-preview-workspace");

    const footerButton = screen.getByRole("button", { name: /Review import|检查导入内容/i });
    expect(footerButton).toBeInTheDocument();
    expect(footerButton.closest(".shrink-0")?.className).toContain("border-t");

    fireEvent.click(screen.getAllByLabelText(/Select skill|选择技能/i)[0]);
    expect(screen.getByRole("button", { name: /Review import|检查导入内容/i })).toBeDisabled();
  });

  it("keeps the selected preview skill after toolbar re-preview succeeds", async () => {
    let previewCallCount = 0;
    mockPreviewGitHubRepoImport.mockImplementation(async () => {
      previewCallCount += 1;
      storeState.githubImport = {
        isPreviewLoading: false,
        isImporting: false,
        preview: {
          repo: {
            owner: "anthropics",
            repo: "skills",
            branch: previewCallCount > 1 ? "refresh-branch" : "main",
            normalizedUrl: "https://github.com/anthropics/skills",
          },
          skills: [
            {
              sourcePath: "skills/first/SKILL.md",
              skillId: "first-skill",
              skillName: "First Skill",
              description: "First skill full description",
              rootDirectory: "skills",
              skillDirectoryName: "first",
              downloadUrl: "https://example.com/first",
              conflict: null,
            },
            {
              sourcePath: "skills/second/SKILL.md",
              skillId: "second-skill",
              skillName: "Second Skill",
              description: previewCallCount > 1 ? "Second skill refreshed description" : "Second skill full description",
              rootDirectory: "skills",
              skillDirectoryName: "second",
              downloadUrl: "https://example.com/second",
              conflict: null,
            },
          ],
        },
        importResult: null,
        previewedRepoUrl: "https://github.com/anthropics/skills",
        error: null,
      };
    });

    renderView();

    fireEvent.click(screen.getByRole("button", { name: /Import GitHub repo|导入 GitHub 仓库/i }));
    fireEvent.change(screen.getByLabelText(/GitHub repository URL|GitHub 仓库 URL/i), {
      target: { value: "https://github.com/anthropics/skills" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Preview import|预览导入/i }));

    await screen.findByTestId("github-import-preview-workspace");
    fireEvent.click(screen.getByRole("button", { name: /Second Skill/i }));

    await waitFor(() => {
      expect(screen.getByText("Second skill full description")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Re-preview|重新预览/i }));

    await waitFor(() => {
      expect(mockPreviewGitHubRepoImport).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(screen.getByText("Second skill refreshed description")).toBeInTheDocument();
    });
    expect(screen.queryByText("First skill full description")).not.toBeInTheDocument();
    expect(screen.getByText("refresh-branch")).toBeInTheDocument();
  });

  it("resets the detail scroll position when switching active preview skills", async () => {
    mockPreviewGitHubRepoImport.mockImplementation(async () => {
      storeState.githubImport = {
        isPreviewLoading: false,
        isImporting: false,
        preview: {
          repo: {
            owner: "anthropics",
            repo: "skills",
            branch: "main",
            normalizedUrl: "https://github.com/anthropics/skills",
          },
          skills: [
            {
              sourcePath: "skills/first/SKILL.md",
              skillId: "first-skill",
              skillName: "First Skill",
              description: "First skill full description",
              rootDirectory: "skills",
              skillDirectoryName: "first",
              downloadUrl: "https://example.com/first",
              conflict: null,
            },
            {
              sourcePath: "skills/second/SKILL.md",
              skillId: "second-skill",
              skillName: "Second Skill",
              description: "Second skill full description",
              rootDirectory: "skills",
              skillDirectoryName: "second",
              downloadUrl: "https://example.com/second",
              conflict: null,
            },
          ],
        },
        importResult: null,
        previewedRepoUrl: "https://github.com/anthropics/skills",
        error: null,
      };
    });

    const scrollTo = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: scrollTo,
    });

    renderView();

    fireEvent.click(screen.getByRole("button", { name: /Import GitHub repo|导入 GitHub 仓库/i }));
    fireEvent.change(screen.getByLabelText(/GitHub repository URL|GitHub 仓库 URL/i), {
      target: { value: "https://github.com/anthropics/skills" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Preview import|预览导入/i }));

    await screen.findByTestId("github-import-preview-workspace");
    scrollTo.mockClear();

    fireEvent.click(screen.getByRole("button", { name: /Second Skill/i }));

    await waitFor(() => {
      expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "auto" });
    });
  });

  it("widens the preview step without returning to the oversized shell", async () => {
    mockPreviewGitHubRepoImport.mockImplementation(async () => {
      storeState.githubImport = {
        isPreviewLoading: false,
        isImporting: false,
        preview: {
          repo: {
            owner: "anthropics",
            repo: "skills",
            branch: "main",
            normalizedUrl: "https://github.com/anthropics/skills",
          },
          skills: [
            {
              sourcePath: "skills/first/SKILL.md",
              skillId: "first-skill",
              skillName: "First Skill",
              description: "First skill full description",
              rootDirectory: "skills",
              skillDirectoryName: "first",
              downloadUrl: "https://example.com/first",
              conflict: null,
            },
          ],
        },
        importResult: null,
        previewedRepoUrl: "https://github.com/anthropics/skills",
        error: null,
      };
    });

    renderView();

    fireEvent.click(screen.getByRole("button", { name: /Import GitHub repo|导入 GitHub 仓库/i }));
    fireEvent.change(screen.getByLabelText(/GitHub repository URL|GitHub 仓库 URL/i), {
      target: { value: "https://github.com/anthropics/skills" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Preview import|预览导入/i }));

    const dialog = await screen.findByRole("dialog");
    const content = dialog.querySelector('[data-slot="dialog-content"]');

    expect(content?.className).toContain("h-[min(90vh,760px)]");
    expect(content?.className).toContain("w-[min(94vw,1180px)]");
    expect(content?.className).toContain("max-w-[min(94vw,1180px)]");
    expect(content?.className).toContain("xl:w-[min(95vw,1280px)]");
    expect(content?.className).toContain("xl:max-w-[min(95vw,1280px)]");
    expect(content?.className).not.toContain("sm:max-w-sm");
  });

  it("shows only the selected github preview skill description in the detail pane", async () => {
    mockPreviewGitHubRepoImport.mockImplementation(async () => {
      storeState.githubImport = {
        isPreviewLoading: false,
        isImporting: false,
        preview: {
          repo: {
            owner: "anthropics",
            repo: "skills",
            branch: "main",
            normalizedUrl: "https://github.com/anthropics/skills",
          },
          skills: [
            {
              sourcePath: "skills/first/SKILL.md",
              skillId: "first-skill",
              skillName: "First Skill",
              description: "First skill full description",
              rootDirectory: "skills",
              skillDirectoryName: "first",
              downloadUrl: "https://example.com/first",
              conflict: null,
            },
            {
              sourcePath: "skills/second/SKILL.md",
              skillId: "second-skill",
              skillName: "Second Skill",
              description: "Second skill full description",
              rootDirectory: "skills",
              skillDirectoryName: "second",
              downloadUrl: "https://example.com/second",
              conflict: null,
            },
          ],
        },
        importResult: null,
        previewedRepoUrl: "https://github.com/anthropics/skills",
        error: null,
      };
    });

    renderView();

    fireEvent.click(screen.getByRole("button", { name: /Import GitHub repo|导入 GitHub 仓库/i }));
    fireEvent.change(screen.getByLabelText(/GitHub repository URL|GitHub 仓库 URL/i), {
      target: { value: "https://github.com/anthropics/skills" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Preview import|预览导入/i }));

    expect(await screen.findByText("First Skill")).toBeInTheDocument();
    const detailPane = screen.getByTestId("github-import-detail-pane");
    expect(within(detailPane).getByText("First skill full description")).toBeInTheDocument();
    expect(within(detailPane).queryByText("Second skill full description")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Second Skill/i }));

    await waitFor(() => {
      expect(within(detailPane).getByText("Second skill full description")).toBeInTheDocument();
    });
    expect(within(detailPane).queryByText("First skill full description")).not.toBeInTheDocument();
  });

  it("keeps preview scrolling owned by the two workspace panes", async () => {
    mockPreviewGitHubRepoImport.mockImplementation(async () => {
      storeState.githubImport = {
        isPreviewLoading: false,
        isImporting: false,
        preview: {
          repo: {
            owner: "anthropics",
            repo: "skills",
            branch: "main",
            normalizedUrl: "https://github.com/anthropics/skills",
          },
          skills: [
            {
              sourcePath: "skills/first/SKILL.md",
              skillId: "first-skill",
              skillName: "First Skill",
              description: "First skill full description",
              rootDirectory: "skills",
              skillDirectoryName: "first",
              downloadUrl: "https://example.com/first",
              conflict: null,
            },
            {
              sourcePath: "skills/second/SKILL.md",
              skillId: "second-skill",
              skillName: "Second Skill",
              description: "Second skill full description",
              rootDirectory: "skills",
              skillDirectoryName: "second",
              downloadUrl: "https://example.com/second",
              conflict: null,
            },
          ],
        },
        importResult: null,
        previewedRepoUrl: "https://github.com/anthropics/skills",
        error: null,
      };
    });

    renderView();

    fireEvent.click(screen.getByRole("button", { name: /Import GitHub repo|导入 GitHub 仓库/i }));
    fireEvent.change(screen.getByLabelText(/GitHub repository URL|GitHub 仓库 URL/i), {
      target: { value: "https://github.com/anthropics/skills" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Preview import|预览导入/i }));

    const summaryList = await screen.findByTestId("github-import-summary-list");
    const detailScroll = screen.getByTestId("github-import-detail-scroll");
    const detailPane = screen.getByTestId("github-import-detail-pane");
    const workspace = screen.getByTestId("github-import-preview-workspace");

    expect(summaryList.className).toContain("overflow-y-auto");
    expect(detailScroll.className).toContain("overflow-y-auto");
    expect(workspace.className).toContain("min-h-0");
    expect(workspace.className).toContain("overflow-hidden");
    expect(detailPane.className).toContain("overflow-hidden");
    expect(detailPane.className).toContain("min-w-0");
  });

  it("offers post-import platform installation for imported github skills", async () => {
    storeState.githubImport = {
      isPreviewLoading: false,
      isImporting: false,
      preview: null,
      importResult: {
        repo: {
          owner: "dorukardahan",
          repo: "twitterapi-io-skill",
          branch: "main",
          normalizedUrl: "https://github.com/dorukardahan/twitterapi-io-skill",
        },
        importedSkills: [
          {
            sourcePath: "twitterapi-io-skill/SKILL.md",
            originalSkillId: "cached-skill",
            importedSkillId: "cached-skill",
            skillName: "Cached Skill",
            targetDirectory: "/Users/test/.agents/skills/cached-skill",
            resolution: "overwrite",
          },
        ],
        skippedSkills: [],
      },
      previewedRepoUrl: "https://github.com/dorukardahan/twitterapi-io-skill",
      error: null,
    };

    renderView();

    fireEvent.click(screen.getByRole("button", { name: /Import GitHub repo|导入 GitHub 仓库/i }));

    expect(await screen.findByRole("button", { name: /Install to platforms/i })).toBeInTheDocument();
  });

  it("turns confirm into a grouped summary with a clear path back to preview", async () => {
    mockPreviewGitHubRepoImport.mockImplementation(async () => {
      storeState.githubImport = {
        isPreviewLoading: false,
        isImporting: false,
        preview: {
          repo: {
            owner: "anthropics",
            repo: "skills",
            branch: "main",
            normalizedUrl: "https://github.com/anthropics/skills",
          },
          skills: [
            {
              sourcePath: "skills/first/SKILL.md",
              skillId: "first-skill",
              skillName: "First Skill",
              description: "First skill description",
              rootDirectory: "skills",
              skillDirectoryName: "first",
              downloadUrl: "https://example.com/first",
              conflict: {
                existingSkillId: "first-skill",
                existingName: "First Skill",
                existingCanonicalPath: "/Users/test/.agents/skills/first-skill",
                proposedSkillId: "first-skill",
                proposedName: "First Skill",
              },
            },
            {
              sourcePath: "skills/second/SKILL.md",
              skillId: "second-skill",
              skillName: "Second Skill",
              description: "Second skill description",
              rootDirectory: "skills",
              skillDirectoryName: "second",
              downloadUrl: "https://example.com/second",
              conflict: null,
            },
          ],
        },
        importResult: null,
        previewedRepoUrl: "https://github.com/anthropics/skills",
        error: null,
      };
    });

    renderView();

    fireEvent.click(screen.getByRole("button", { name: /Import GitHub repo|导入 GitHub 仓库/i }));
    fireEvent.change(screen.getByLabelText(/GitHub repository URL|GitHub 仓库 URL/i), {
      target: { value: "https://github.com/anthropics/skills" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Preview import|预览导入/i }));

    await screen.findByTestId("github-import-preview-workspace");

    fireEvent.click(screen.getByRole("radio", { name: "Rename" }));
    fireEvent.change(screen.getByPlaceholderText("New skill id"), {
      target: { value: "first-skill-renamed" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Review import|检查导入内容/i }));

    const confirmSummary = await screen.findByTestId("github-import-confirm-summary");
    const footer = screen.getByTestId("github-import-shell-footer");
    expect(within(confirmSummary).getByText("Ready to import")).toBeInTheDocument();
    expect(within(confirmSummary).getByText("Decision summary")).toBeInTheDocument();
    expect(within(confirmSummary).getByText("first-skill-renamed")).toBeInTheDocument();
    expect(within(confirmSummary).queryByRole("button", { name: "Back to preview" })).not.toBeInTheDocument();
    expect(footer).toHaveAttribute("data-footer-mode", "confirm");
    expect(within(footer).getByRole("button", { name: "Back to preview" })).toBeInTheDocument();
    expect(within(footer).getByRole("button", { name: "Import" })).toBeInTheDocument();
    expect(screen.queryByTestId("github-import-detail-pane")).not.toBeInTheDocument();
  });

  it("turns result into a completion hub with next-step actions", async () => {
    storeState.githubImport = {
      isPreviewLoading: false,
      isImporting: false,
      preview: null,
      importResult: {
        repo: {
          owner: "dorukardahan",
          repo: "twitterapi-io-skill",
          branch: "main",
          normalizedUrl: "https://github.com/dorukardahan/twitterapi-io-skill",
        },
        importedSkills: [
          {
            sourcePath: "twitterapi-io-skill/SKILL.md",
            originalSkillId: "cached-skill",
            importedSkillId: "cached-skill",
            skillName: "Cached Skill",
            targetDirectory: "/Users/test/.agents/skills/cached-skill",
            resolution: "overwrite",
          },
        ],
        skippedSkills: ["legacy-skill"],
      },
      previewedRepoUrl: "https://github.com/dorukardahan/twitterapi-io-skill",
      error: null,
    };

    renderView();

    fireEvent.click(screen.getByRole("button", { name: /Import GitHub repo|导入 GitHub 仓库/i }));

    const resultHub = await screen.findByTestId("github-import-result-hub");
    const footer = screen.getByTestId("github-import-shell-footer");
    expect(within(resultHub).getByText("Next steps")).toBeInTheDocument();
    expect(
      within(resultHub).getByRole("button", { name: "Install imported skills to platforms" })
    ).toBeInTheDocument();
    expect(within(resultHub).getByRole("button", { name: "Open Central" })).toBeInTheDocument();
    expect(within(resultHub).getByRole("button", { name: "Start another import" })).toBeInTheDocument();
    expect(within(resultHub).getByText("legacy-skill")).toBeInTheDocument();
    expect(footer).toHaveAttribute("data-footer-mode", "result");
    expect(within(footer).getByRole("button", { name: "Start another import" })).toBeInTheDocument();
    expect(within(footer).getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("shows a friendly desktop-only state for the github import wizard in browser mode", async () => {
    const isTauriSpy = vi.spyOn(tauriBridge, "isTauriRuntime").mockReturnValue(false);

    renderView();

    fireEvent.click(screen.getByRole("button", { name: /Import GitHub repo|导入 GitHub 仓库/i }));
    fireEvent.change(screen.getByLabelText(/GitHub repository URL|GitHub 仓库 URL/i), {
      target: { value: "https://github.com/anthropics/skills" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Preview import|预览导入/i }));

    await waitFor(() => {
      expect(mockPreviewGitHubRepoImport).toHaveBeenCalledWith("https://github.com/anthropics/skills");
    });
    expect(
      await screen.findByText(/This shared wizard is available in the browser for guidance/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/Desktop-only feature: GitHub repo preview is available in the Tauri app/i)).toBeInTheDocument();
    expect(mockImportGitHubRepoSkills).not.toHaveBeenCalled();

    isTauriSpy.mockRestore();
  });

  it("adds settings guidance when github preview fails with auth or rate-limit help", async () => {
    storeState.githubImport = {
      isPreviewLoading: false,
      isImporting: false,
      preview: null,
      importResult: null,
      previewedRepoUrl: "https://github.com/anthropics/skills",
      error: "GitHub API rate limit exceeded. Save a Personal Access Token in Settings and retry.",
    };

    renderView();

    fireEvent.click(screen.getByRole("button", { name: /Import GitHub repo|导入 GitHub 仓库/i }));

    expect(
      await screen.findByText(/Open Settings and save a GitHub Personal Access Token/i)
    ).toBeInTheDocument();
  });
});
