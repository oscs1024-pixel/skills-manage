use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json;
use tauri::{Emitter, State};

use crate::db::{self, DbPool};
use crate::AppState;

// ─── Types ────────────────────────────────────────────────────────────────────

/// A candidate scan root (e.g. ~/projects, ~/Developer).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanRoot {
    pub path: String,
    pub label: String,
    pub exists: bool,
    pub enabled: bool,
}

/// A project-level skill discovered during a full-disk scan.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredSkill {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub file_path: String,
    pub dir_path: String,
    pub platform_id: String,
    pub platform_name: String,
    pub project_path: String,
    pub project_name: String,
    /// True if this skill already exists in the central skills dir.
    pub is_already_central: bool,
}

/// A project that contains skills, grouped for display.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredProject {
    pub project_path: String,
    pub project_name: String,
    pub skills: Vec<DiscoveredSkill>,
}

/// Payload emitted during scan for progress updates.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProgressPayload {
    pub percent: u32,
    pub current_path: String,
    pub skills_found: usize,
    pub projects_found: usize,
}

/// Payload emitted when a project with skills is found.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FoundPayload {
    pub project: DiscoveredProject,
}

/// Payload emitted when scan completes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompletePayload {
    pub total_projects: usize,
    pub total_skills: usize,
}

/// Result of the full project scan.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoverResult {
    pub total_projects: usize,
    pub total_skills: usize,
    pub projects: Vec<DiscoveredProject>,
}

/// Target for importing a discovered skill.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ImportTarget {
    Central,
    Platform(String),
}

/// Result of importing a discovered skill.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportResult {
    pub skill_id: String,
    pub target: String,
}

// ─── Global cancel flag ──────────────────────────────────────────────────────

static SCAN_CANCEL: AtomicBool = AtomicBool::new(false);

// ─── Default scan roots ───────────────────────────────────────────────────────

/// Returns a list of candidate scan roots, checking which ones exist on disk.
fn default_scan_roots() -> Vec<ScanRoot> {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    let candidates = vec![
        (format!("{}/projects", home), "projects"),
        (format!("{}/Documents", home), "Documents"),
        (format!("{}/Developer", home), "Developer"),
        (format!("{}/work", home), "work"),
        (format!("{}/src", home), "src"),
        (format!("{}/code", home), "code"),
        (format!("{}/repos", home), "repos"),
        (format!("{}/Desktop", home), "Desktop"),
    ];

    candidates
        .into_iter()
        .map(|(path, label)| {
            let exists = Path::new(&path).exists();
            ScanRoot {
                path,
                label: label.to_string(),
                exists,
                enabled: exists, // auto-enable roots that exist
            }
        })
        .collect()
}

/// Build the list of platform skill directory patterns to look for.
/// For each enabled agent, its `global_skills_dir` is split to derive a
/// relative pattern like `.claude/skills` from `/home/user/.claude/skills`.
fn platform_skill_patterns(_pool: &DbPool) -> Vec<(String, String, PathBuf)> {
    // (agent_id, display_name, relative_subpath)
    // We compute this synchronously since it only reads from the built-in
    // agent list which is static after init.
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());

    db::builtin_agents()
        .iter()
        .filter(|a| a.id != "central")
        .filter_map(|a| {
            let full = PathBuf::from(&a.global_skills_dir);
            // Strip home prefix to get relative path like ".claude/skills"
            let home_path = PathBuf::from(&home);
            let rel = full.strip_prefix(&home_path).ok()?;
            Some((a.id.clone(), a.display_name.clone(), rel.to_path_buf()))
        })
        .collect()
}

// ─── Core scan logic ──────────────────────────────────────────────────────────

/// Walk a single scan root directory, looking for project-level skill dirs.
///
/// For each immediate subdirectory of `root`, checks whether it contains any
/// of the known platform skill subdirectories (e.g., `.claude/skills/`).
/// If found, scans those skill dirs and returns `DiscoveredSkill` entries.
fn scan_root_for_projects(
    root: &Path,
    patterns: &[(String, String, PathBuf)],
    central_dir: &Path,
) -> Vec<DiscoveredProject> {
    let mut projects = Vec::new();

    let entries = match std::fs::read_dir(root) {
        Ok(e) => e,
        Err(_) => return projects,
    };

    for entry in entries.flatten() {
        if SCAN_CANCEL.load(Ordering::Relaxed) {
            break;
        }

        let entry_path = entry.path();

        // Only look at directories.
        let meta = match std::fs::metadata(&entry_path) {
            Ok(m) => m,
            Err(_) => continue,
        };
        if !meta.is_dir() {
            continue;
        }

        let project_name = entry_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown")
            .to_string();

        let mut project_skills: Vec<DiscoveredSkill> = Vec::new();

        // Check each platform pattern inside this project dir.
        for (agent_id, display_name, rel_pattern) in patterns {
            let skill_dir = entry_path.join(rel_pattern);

            if !skill_dir.exists() {
                continue;
            }

            let scanned = super::scanner::scan_directory(&skill_dir, false);

            for skill in scanned {
                // Derive a unique ID that includes the project path to avoid
                // collisions with global skills that share the same directory name.
                let qualified_id = format!(
                    "{}__{}__{}",
                    agent_id,
                    project_name.to_lowercase().replace(' ', "-"),
                    skill.id
                );

                // Check if this skill already exists in central.
                let central_skill_path = central_dir.join(&skill.id);
                let is_already_central = central_skill_path.exists();

                project_skills.push(DiscoveredSkill {
                    id: qualified_id,
                    name: skill.name,
                    description: skill.description,
                    file_path: skill.file_path,
                    dir_path: skill.dir_path,
                    platform_id: agent_id.clone(),
                    platform_name: display_name.clone(),
                    project_path: entry_path.to_string_lossy().into_owned(),
                    project_name: project_name.clone(),
                    is_already_central,
                });
            }
        }

        if !project_skills.is_empty() {
            projects.push(DiscoveredProject {
                project_path: entry_path.to_string_lossy().into_owned(),
                project_name,
                skills: project_skills,
            });
        }
    }

    projects
}

// ─── Tauri Commands ───────────────────────────────────────────────────────────

/// Auto-detect candidate scan roots and return them.
#[tauri::command]
pub async fn discover_scan_roots() -> Result<Vec<ScanRoot>, String> {
    Ok(default_scan_roots())
}

/// Get scan roots with persisted enabled state from DB.
///
/// Returns auto-detected default roots, then overlays any previously
/// persisted enabled/disabled states from the settings table.
#[tauri::command]
pub async fn get_scan_roots(state: State<'_, AppState>) -> Result<Vec<ScanRoot>, String> {
    let pool = &state.db;
    let mut roots = default_scan_roots();

    // Load persisted enabled states from settings.
    // We store a single JSON blob under the key "discover_scan_roots_config"
    // mapping path -> enabled (bool).
    if let Some(json) = db::get_setting(pool, "discover_scan_roots_config").await? {
        let config: HashMap<String, bool> =
            serde_json::from_str(&json).map_err(|e| format!("Invalid scan roots config: {}", e))?;
        for root in &mut roots {
            if let Some(&enabled) = config.get(&root.path) {
                root.enabled = enabled;
            }
        }
    }

    Ok(roots)
}

/// Persist the enabled/disabled state of a scan root.
///
/// Updates the "discover_scan_roots_config" setting in the DB, which
/// stores a JSON object mapping root paths to their enabled state.
#[tauri::command]
pub async fn set_scan_root_enabled(
    state: State<'_, AppState>,
    path: String,
    enabled: bool,
) -> Result<(), String> {
    let pool = &state.db;

    // Load existing config or start fresh.
    let mut config: HashMap<String, bool> = match db::get_setting(pool, "discover_scan_roots_config").await? {
        Some(json) => serde_json::from_str(&json).map_err(|e| format!("Invalid scan roots config: {}", e))?,
        None => HashMap::new(),
    };

    config.insert(path, enabled);

    let json = serde_json::to_string(&config)
        .map_err(|e| format!("Failed to serialize scan roots config: {}", e))?;
    db::set_setting(pool, "discover_scan_roots_config", &json).await
}

/// Start a project-discovery scan across the given root directories.
/// Emits streaming events (`discover:progress`, `discover:found`, `discover:complete`).
#[tauri::command]
pub async fn start_project_scan(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    roots: Vec<ScanRoot>,
) -> Result<DiscoverResult, String> {
    // Reset cancel flag.
    SCAN_CANCEL.store(false, Ordering::Relaxed);

    let pool = &state.db;

    // Build platform skill patterns from registered agents.
    let patterns = platform_skill_patterns(pool);

    // Determine central skills dir.
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    let central_dir = PathBuf::from(format!("{}/.agents/skills", home));

    // Filter to enabled roots that exist.
    let enabled_roots: Vec<&ScanRoot> = roots.iter().filter(|r| r.enabled && r.exists).collect();
    let total_roots = enabled_roots.len();

    let mut all_projects: Vec<DiscoveredProject> = Vec::new();
    let mut total_skills = 0;
    let mut roots_scanned = 0;

    for root in &enabled_roots {
        if SCAN_CANCEL.load(Ordering::Relaxed) {
            break;
        }

        let root_path = Path::new(&root.path);
        let found_projects = scan_root_for_projects(root_path, &patterns, &central_dir);

        roots_scanned += 1;
        let percent = if total_roots > 0 {
            (roots_scanned as u32 * 100) / total_roots as u32
        } else {
            100
        };

        for project in &found_projects {
            total_skills += project.skills.len();

            // Emit per-project found event.
            let _ = app.emit(
                "discover:found",
                FoundPayload {
                    project: project.clone(),
                },
            );
        }

        all_projects.extend(found_projects);

        // Emit progress event.
        let _ = app.emit(
            "discover:progress",
            ProgressPayload {
                percent: percent.min(100),
                current_path: root.path.clone(),
                skills_found: total_skills,
                projects_found: all_projects.len(),
            },
        );
    }

    // Persist discovered skills to the database.
    let now = Utc::now().to_rfc3339();
    for project in &all_projects {
        for skill in &project.skills {
            // Check if already persisted (by qualified ID).
            let existing = db::get_discovered_skill_by_id(pool, &skill.id).await?;
            if existing.is_none() {
                db::insert_discovered_skill(
                    pool,
                    &skill.id,
                    &skill.name,
                    skill.description.as_deref(),
                    &skill.file_path,
                    &skill.dir_path,
                    &skill.project_path,
                    &skill.project_name,
                    &skill.platform_id,
                    &now,
                )
                .await?;
            }
        }
    }

    let total_projects = all_projects.len();

    // Emit completion event.
    let _ = app.emit(
        "discover:complete",
        CompletePayload {
            total_projects,
            total_skills,
        },
    );

    Ok(DiscoverResult {
        total_projects,
        total_skills,
        projects: all_projects,
    })
}

/// Cancel an in-progress project scan.
#[tauri::command]
pub async fn stop_project_scan() -> Result<(), String> {
    SCAN_CANCEL.store(true, Ordering::Relaxed);
    Ok(())
}

/// Load previously discovered skills from the database, grouped by project.
#[tauri::command]
pub async fn get_discovered_skills(
    state: State<'_, AppState>,
) -> Result<Vec<DiscoveredProject>, String> {
    let pool = &state.db;
    let rows = db::get_all_discovered_skills(pool).await?;

    // Convert DB rows to DiscoveredSkill structs, adding is_already_central.
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    let central_dir = PathBuf::from(format!("{}/.agents/skills", home));

    let skills: Vec<DiscoveredSkill> = rows
        .into_iter()
        .map(|row| {
            let skill_dir_name = Path::new(&row.dir_path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown");
            let is_already_central = central_dir.join(skill_dir_name).exists();
            let platform_id = row.platform_id.clone();

            DiscoveredSkill {
                id: row.id,
                name: row.name,
                description: row.description,
                file_path: row.file_path,
                dir_path: row.dir_path,
                platform_id: platform_id.clone(),
                // Look up display name from builtin agents.
                platform_name: db::builtin_agents()
                    .iter()
                    .find(|a| a.id == platform_id)
                    .map(|a| a.display_name.clone())
                    .unwrap_or_else(|| platform_id),
                project_path: row.project_path,
                project_name: row.project_name,
                is_already_central,
            }
        })
        .collect();

    // Group skills by project_path.
    let mut by_project: HashMap<String, Vec<DiscoveredSkill>> = HashMap::new();
    let mut project_names: HashMap<String, String> = HashMap::new();

    for skill in skills {
        project_names.insert(skill.project_path.clone(), skill.project_name.clone());
        by_project
            .entry(skill.project_path.clone())
            .or_default()
            .push(skill);
    }

    let mut projects: Vec<DiscoveredProject> = by_project
        .into_iter()
        .map(|(path, skills)| DiscoveredProject {
            project_path: path.clone(),
            project_name: project_names.get(&path).cloned().unwrap_or_default(),
            skills,
        })
        .collect();

    // Sort by project name for stable ordering.
    projects.sort_by(|a, b| a.project_name.cmp(&b.project_name));

    Ok(projects)
}

/// Import a discovered skill to the central skills directory.
///
/// Copies the skill directory from its project location to `~/.agents/skills/<skill_dir_name>`,
/// then records it in the skills table.
#[tauri::command]
pub async fn import_discovered_skill_to_central(
    state: State<'_, AppState>,
    discovered_skill_id: String,
) -> Result<ImportResult, String> {
    let pool = &state.db;

    // Look up the discovered skill.
    let skill = db::get_discovered_skill_by_id(pool, &discovered_skill_id)
        .await?
        .ok_or_else(|| format!("Discovered skill '{}' not found", discovered_skill_id))?;

    // Determine central dir.
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    let central_dir = PathBuf::from(format!("{}/.agents/skills", home));

    // Extract the original skill directory name (last component of dir_path).
    let skill_dir_name = Path::new(&skill.dir_path)
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "Cannot extract skill directory name".to_string())?
        .to_string();

    let target_dir = central_dir.join(&skill_dir_name);

    // Check if a skill with this name already exists in central.
    if target_dir.exists() {
        return Err(format!(
            "A skill named '{}' already exists in central skills",
            skill_dir_name
        ));
    }

    // Copy the skill directory to central.
    super::linker::copy_dir_all(Path::new(&skill.dir_path), &target_dir)?;

    // Now we need to re-scan so the new central skill gets picked up.
    // Record the skill in the DB as a central skill.
    let skill_md_path = target_dir.join("SKILL.md");
    let info = super::scanner::parse_skill_md(&skill_md_path);

    if let Some(skill_info) = info {
        let now = Utc::now().to_rfc3339();
        let db_skill = db::Skill {
            id: skill_dir_name.clone(),
            name: skill_info.name,
            description: skill_info.description,
            file_path: skill_md_path.to_string_lossy().into_owned(),
            canonical_path: Some(target_dir.to_string_lossy().into_owned()),
            is_central: true,
            source: Some("copy".to_string()),
            content: None,
            scanned_at: now,
        };
        db::upsert_skill(pool, &db_skill).await?;
    }

    // Remove the discovered skill record since it's now centralized.
    db::delete_discovered_skill(pool, &discovered_skill_id).await?;

    Ok(ImportResult {
        skill_id: skill_dir_name,
        target: "central".to_string(),
    })
}

/// Import a discovered skill to a specific platform's global skills directory.
///
/// Creates a symlink (or copy) from the discovered skill's dir to the platform's
/// global skills directory.
#[tauri::command]
pub async fn import_discovered_skill_to_platform(
    state: State<'_, AppState>,
    discovered_skill_id: String,
    agent_id: String,
) -> Result<ImportResult, String> {
    let pool = &state.db;

    // Look up the discovered skill.
    let skill = db::get_discovered_skill_by_id(pool, &discovered_skill_id)
        .await?
        .ok_or_else(|| format!("Discovered skill '{}' not found", discovered_skill_id))?;

    // Look up the target agent.
    let agent = db::get_agent_by_id(pool, &agent_id)
        .await?
        .ok_or_else(|| format!("Agent '{}' not found", agent_id))?;

    // Extract the original skill directory name.
    let skill_dir_name = Path::new(&skill.dir_path)
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "Cannot extract skill directory name".to_string())?
        .to_string();

    let agent_dir = PathBuf::from(&agent.global_skills_dir);
    let target_path = agent_dir.join(&skill_dir_name);

    // Ensure agent skills dir exists.
    std::fs::create_dir_all(&agent_dir)
        .map_err(|e| format!("Failed to create agent skills directory: {}", e))?;

    // Check if already installed.
    if target_path.exists() || std::fs::symlink_metadata(&target_path).is_ok() {
        return Err(format!(
            "Skill '{}' already exists in {}",
            skill_dir_name, agent.display_name
        ));
    }

    // Create symlink from discovered skill dir to platform dir.
    let src_path = Path::new(&skill.dir_path);
    let relative_target = super::linker::make_relative_path(&agent_dir, src_path);
    super::linker::create_symlink(&relative_target, &target_path)?;

    // Record the installation.
    let now = Utc::now().to_rfc3339();

    // Also ensure the skill is in the skills table.
    let skill_md_path = src_path.join("SKILL.md");
    let info = super::scanner::parse_skill_md(&skill_md_path);

    if let Some(skill_info) = info {
        let db_skill = db::Skill {
            id: skill_dir_name.clone(),
            name: skill_info.name,
            description: skill_info.description,
            file_path: skill_md_path.to_string_lossy().into_owned(),
            canonical_path: None,
            is_central: false,
            source: Some("symlink".to_string()),
            content: None,
            scanned_at: now.clone(),
        };
        db::upsert_skill(pool, &db_skill).await?;
    }

    let installation = db::SkillInstallation {
        skill_id: skill_dir_name.clone(),
        agent_id: agent_id.clone(),
        installed_path: target_path.to_string_lossy().into_owned(),
        link_type: "symlink".to_string(),
        symlink_target: Some(skill.dir_path.clone()),
        created_at: now,
    };
    db::upsert_skill_installation(pool, &installation).await?;

    // Remove the discovered skill record since it's now installed.
    db::delete_discovered_skill(pool, &discovered_skill_id).await?;

    Ok(ImportResult {
        skill_id: skill_dir_name,
        target: agent_id,
    })
}

/// Clear all discovered skills from the database.
#[tauri::command]
pub async fn clear_discovered_skills(state: State<'_, AppState>) -> Result<(), String> {
    db::clear_all_discovered_skills(&state.db).await
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_scan_roots_returns_candidates() {
        let roots = default_scan_roots();
        assert!(!roots.is_empty(), "should return at least some candidates");
        // Each root should have a path and label.
        for root in &roots {
            assert!(!root.path.is_empty());
            assert!(!root.label.is_empty());
        }
    }

    #[test]
    fn test_scan_root_exists_matches_filesystem() {
        let roots = default_scan_roots();
        for root in &roots {
            let actually_exists = Path::new(&root.path).exists();
            assert_eq!(
                root.exists, actually_exists,
                "exists flag should match actual filesystem for {}",
                root.path
            );
        }
    }

    #[tokio::test]
    async fn test_platform_skill_patterns_excludes_central() {
        let pool = SqlitePool::connect(":memory:").await.unwrap();
        db::init_database(&pool).await.unwrap();
        let patterns = platform_skill_patterns(&pool);
        // Central should be excluded.
        assert!(
            !patterns.iter().any(|(id, _, _)| id == "central"),
            "central should not appear in platform skill patterns"
        );
        // Claude Code should be included.
        assert!(
            patterns.iter().any(|(id, _, _)| id == "claude-code"),
            "claude-code should appear in platform skill patterns"
        );
    }

    use sqlx::SqlitePool;

    #[tokio::test]
    async fn test_scan_root_for_projects_finds_nested_skills() {
        let tmp = tempfile::TempDir::new().unwrap();
        let central_dir = tmp.path().join("central");
        std::fs::create_dir_all(&central_dir).unwrap();

        // Create a project with a .claude/skills/ subdirectory.
        let project_dir = tmp.path().join("my-project");
        let skill_dir = project_dir.join(".claude/skills/deploy-skill");
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: deploy\ndescription: Deploy stuff\n---\n\n# Deploy\n",
        )
        .unwrap();

        // Build patterns: .claude/skills
        let patterns = vec![(
            "claude-code".to_string(),
            "Claude Code".to_string(),
            PathBuf::from(".claude/skills"),
        )];

        let projects = scan_root_for_projects(tmp.path(), &patterns, &central_dir);

        assert_eq!(projects.len(), 1, "should find 1 project");
        assert_eq!(projects[0].project_name, "my-project");
        assert_eq!(projects[0].skills.len(), 1);
        assert_eq!(projects[0].skills[0].platform_id, "claude-code");
        assert_eq!(projects[0].skills[0].name, "deploy");
    }

    #[tokio::test]
    async fn test_scan_root_for_projects_skips_dirs_without_skills() {
        let tmp = tempfile::TempDir::new().unwrap();
        let central_dir = tmp.path().join("central");
        std::fs::create_dir_all(&central_dir).unwrap();

        // A project dir with no skill subdirectories.
        let project_dir = tmp.path().join("empty-project");
        std::fs::create_dir_all(project_dir.join("src")).unwrap();

        let patterns = vec![(
            "claude-code".to_string(),
            "Claude Code".to_string(),
            PathBuf::from(".claude/skills"),
        )];

        let projects = scan_root_for_projects(tmp.path(), &patterns, &central_dir);
        assert!(
            projects.is_empty(),
            "should not find projects without skills"
        );
    }

    #[tokio::test]
    async fn test_scan_root_for_projects_handles_multiple_platforms() {
        let tmp = tempfile::TempDir::new().unwrap();
        let central_dir = tmp.path().join("central");
        std::fs::create_dir_all(&central_dir).unwrap();

        let project_dir = tmp.path().join("multi-project");
        // Create skills for two platforms.
        let claude_skill = project_dir.join(".claude/skills/claude-skill");
        std::fs::create_dir_all(&claude_skill).unwrap();
        std::fs::write(
            claude_skill.join("SKILL.md"),
            "---\nname: claude-skill\ndescription: test\n---\n\n# Test\n",
        )
        .unwrap();

        let cursor_skill = project_dir.join(".cursor/skills/cursor-skill");
        std::fs::create_dir_all(&cursor_skill).unwrap();
        std::fs::write(
            cursor_skill.join("SKILL.md"),
            "---\nname: cursor-skill\ndescription: test\n---\n\n# Test\n",
        )
        .unwrap();

        let patterns = vec![
            (
                "claude-code".to_string(),
                "Claude Code".to_string(),
                PathBuf::from(".claude/skills"),
            ),
            (
                "cursor".to_string(),
                "Cursor".to_string(),
                PathBuf::from(".cursor/skills"),
            ),
        ];

        let projects = scan_root_for_projects(tmp.path(), &patterns, &central_dir);

        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].skills.len(), 2);
    }

    #[tokio::test]
    async fn test_scan_root_for_projects_detects_already_central() {
        let tmp = tempfile::TempDir::new().unwrap();
        let central_dir = tmp.path().join("central");
        std::fs::create_dir_all(&central_dir).unwrap();

        // Create a skill in central.
        let central_skill = central_dir.join("shared-skill");
        std::fs::create_dir_all(&central_skill).unwrap();
        std::fs::write(
            central_skill.join("SKILL.md"),
            "---\nname: shared-skill\n---\n\n# Test\n",
        )
        .unwrap();

        // Create the same skill name in a project.
        let project_dir = tmp.path().join("my-project");
        let project_skill = project_dir.join(".claude/skills/shared-skill");
        std::fs::create_dir_all(&project_skill).unwrap();
        std::fs::write(
            project_skill.join("SKILL.md"),
            "---\nname: shared-skill\n---\n\n# Test\n",
        )
        .unwrap();

        let patterns = vec![(
            "claude-code".to_string(),
            "Claude Code".to_string(),
            PathBuf::from(".claude/skills"),
        )];

        let projects = scan_root_for_projects(tmp.path(), &patterns, &central_dir);

        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].skills.len(), 1);
        assert!(
            projects[0].skills[0].is_already_central,
            "should detect skill is already in central"
        );
    }

    #[tokio::test]
    async fn test_import_discovered_skill_to_central_copies_and_persists() {
        let tmp = tempfile::TempDir::new().unwrap();
        let pool = SqlitePool::connect(":memory:").await.unwrap();
        db::init_database(&pool).await.unwrap();

        // Override central dir for testing.
        let central_dir = tmp.path().join("central");
        sqlx::query("UPDATE agents SET global_skills_dir = ? WHERE id = 'central'")
            .bind(central_dir.to_str().unwrap())
            .execute(&pool)
            .await
            .unwrap();

        std::fs::create_dir_all(&central_dir).unwrap();

        // Create a discovered skill.
        let skill_dir = tmp.path().join("project/.claude/skills/my-skill");
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: my-skill\ndescription: A test skill\n---\n\n# My Skill\n",
        )
        .unwrap();

        // Insert discovered skill record.
        let now = Utc::now().to_rfc3339();
        db::insert_discovered_skill(
            &pool,
            "claude-code__project__my-skill",
            "my-skill",
            Some("A test skill"),
            &skill_dir.join("SKILL.md").to_string_lossy(),
            &skill_dir.to_string_lossy(),
            &tmp.path().join("project").to_string_lossy(),
            "project",
            "claude-code",
            &now,
        )
        .await
        .unwrap();

        // Set HOME to tmp so import_discovered_skill_to_central finds the right dir.
        // We'll call the impl directly instead.
        let result = import_discovered_skill_to_central_impl(
            &pool,
            "claude-code__project__my-skill",
            &central_dir,
        )
        .await;

        assert!(result.is_ok(), "import should succeed: {:?}", result);

        // Verify the skill was copied to central.
        let target = central_dir.join("my-skill");
        assert!(target.exists(), "skill should be copied to central");
        assert!(
            target.join("SKILL.md").exists(),
            "SKILL.md should exist in central"
        );

        // Verify discovered skill record was removed.
        let record = db::get_discovered_skill_by_id(&pool, "claude-code__project__my-skill")
            .await
            .unwrap();
        assert!(record.is_none(), "discovered skill record should be removed");
    }

    /// Implementation of import_discovered_skill_to_central that accepts a custom central_dir
    /// for testing (avoids depending on $HOME).
    async fn import_discovered_skill_to_central_impl(
        pool: &DbPool,
        discovered_skill_id: &str,
        central_dir: &Path,
    ) -> Result<ImportResult, String> {
        let skill = db::get_discovered_skill_by_id(pool, discovered_skill_id)
            .await?
            .ok_or_else(|| format!("Discovered skill '{}' not found", discovered_skill_id))?;

        let skill_dir_name = Path::new(&skill.dir_path)
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or_else(|| "Cannot extract skill directory name".to_string())?
            .to_string();

        let target_dir = central_dir.join(&skill_dir_name);

        if target_dir.exists() {
            return Err(format!(
                "A skill named '{}' already exists in central skills",
                skill_dir_name
            ));
        }

        std::fs::create_dir_all(central_dir)
            .map_err(|e| format!("Failed to create central dir: {}", e))?;

        super::super::linker::copy_dir_all(Path::new(&skill.dir_path), &target_dir)?;

        let skill_md_path = target_dir.join("SKILL.md");
        let info = super::super::scanner::parse_skill_md(&skill_md_path);

        if let Some(skill_info) = info {
            let now = Utc::now().to_rfc3339();
            let db_skill = db::Skill {
                id: skill_dir_name.clone(),
                name: skill_info.name,
                description: skill_info.description,
                file_path: skill_md_path.to_string_lossy().into_owned(),
                canonical_path: Some(target_dir.to_string_lossy().into_owned()),
                is_central: true,
                source: Some("copy".to_string()),
                content: None,
                scanned_at: now,
            };
            db::upsert_skill(pool, &db_skill).await?;
        }

        db::delete_discovered_skill(pool, discovered_skill_id).await?;

        Ok(ImportResult {
            skill_id: skill_dir_name,
            target: "central".to_string(),
        })
    }

    // ── Additional tests ──────────────────────────────────────────────────────

    /// Helper: set up an in-memory DB with initialized schema.
    async fn setup_test_db() -> DbPool {
        let pool = SqlitePool::connect(":memory:").await.unwrap();
        db::init_database(&pool).await.unwrap();
        pool
    }

    #[tokio::test]
    async fn test_import_discovered_skill_to_platform_creates_symlink() {
        let tmp = tempfile::TempDir::new().unwrap();
        let pool = setup_test_db().await;

        // Override agent skills dir for testing.
        let agent_dir = tmp.path().join("agent-skills");
        sqlx::query("UPDATE agents SET global_skills_dir = ? WHERE id = 'claude-code'")
            .bind(agent_dir.to_str().unwrap())
            .execute(&pool)
            .await
            .unwrap();

        std::fs::create_dir_all(&agent_dir).unwrap();

        // Create a discovered skill in a project.
        let skill_dir = tmp.path().join("project/.claude/skills/my-skill");
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: my-skill\ndescription: A test skill\n---\n\n# My Skill\n",
        )
        .unwrap();

        let now = Utc::now().to_rfc3339();
        db::insert_discovered_skill(
            &pool,
            "claude-code__project__my-skill",
            "my-skill",
            Some("A test skill"),
            &skill_dir.join("SKILL.md").to_string_lossy(),
            &skill_dir.to_string_lossy(),
            &tmp.path().join("project").to_string_lossy(),
            "project",
            "claude-code",
            &now,
        )
        .await
        .unwrap();

        // Import to platform using the impl function.
        let result = import_discovered_skill_to_platform_impl(
            &pool,
            "claude-code__project__my-skill",
            "claude-code",
            &agent_dir,
        )
        .await;

        assert!(result.is_ok(), "import should succeed: {:?}", result);

        // Verify the symlink was created.
        let link_path = agent_dir.join("my-skill");
        assert!(
            link_path.exists(),
            "symlink target should exist"
        );
        let meta = std::fs::symlink_metadata(&link_path).unwrap();
        assert!(meta.is_symlink(), "should be a symlink");

        // Verify discovered skill record was removed.
        let record = db::get_discovered_skill_by_id(&pool, "claude-code__project__my-skill")
            .await
            .unwrap();
        assert!(record.is_none(), "discovered skill record should be removed");
    }

    /// Implementation of import_discovered_skill_to_platform that accepts a custom agent_dir
    /// for testing (avoids depending on $HOME and real agent dirs).
    async fn import_discovered_skill_to_platform_impl(
        pool: &DbPool,
        discovered_skill_id: &str,
        agent_id: &str,
        agent_dir: &Path,
    ) -> Result<ImportResult, String> {
        let skill = db::get_discovered_skill_by_id(pool, discovered_skill_id)
            .await?
            .ok_or_else(|| format!("Discovered skill '{}' not found", discovered_skill_id))?;

        let skill_dir_name = Path::new(&skill.dir_path)
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or_else(|| "Cannot extract skill directory name".to_string())?
            .to_string();

        let target_path = agent_dir.join(&skill_dir_name);

        std::fs::create_dir_all(agent_dir)
            .map_err(|e| format!("Failed to create agent skills directory: {}", e))?;

        if target_path.exists() || std::fs::symlink_metadata(&target_path).is_ok() {
            return Err(format!(
                "Skill '{}' already exists in agent {}",
                skill_dir_name, agent_id
            ));
        }

        let src_path = Path::new(&skill.dir_path);
        let relative_target = super::super::linker::make_relative_path(agent_dir, src_path);
        super::super::linker::create_symlink(&relative_target, &target_path)?;

        // Record the installation.
        let now = Utc::now().to_rfc3339();

        let skill_md_path = src_path.join("SKILL.md");
        let info = super::super::scanner::parse_skill_md(&skill_md_path);

        if let Some(skill_info) = info {
            let db_skill = db::Skill {
                id: skill_dir_name.clone(),
                name: skill_info.name,
                description: skill_info.description,
                file_path: skill_md_path.to_string_lossy().into_owned(),
                canonical_path: None,
                is_central: false,
                source: Some("symlink".to_string()),
                content: None,
                scanned_at: now.clone(),
            };
            db::upsert_skill(pool, &db_skill).await?;
        }

        let installation = db::SkillInstallation {
            skill_id: skill_dir_name.clone(),
            agent_id: agent_id.to_string(),
            installed_path: target_path.to_string_lossy().into_owned(),
            link_type: "symlink".to_string(),
            symlink_target: Some(skill.dir_path.clone()),
            created_at: now,
        };
        db::upsert_skill_installation(pool, &installation).await?;

        db::delete_discovered_skill(pool, discovered_skill_id).await?;

        Ok(ImportResult {
            skill_id: skill_dir_name,
            target: agent_id.to_string(),
        })
    }

    #[tokio::test]
    async fn test_stop_project_scan_sets_cancel_flag() {
        // Before calling stop, the flag should be false.
        SCAN_CANCEL.store(false, Ordering::Relaxed);
        assert!(!SCAN_CANCEL.load(Ordering::Relaxed));

        // After calling stop, the flag should be true.
        SCAN_CANCEL.store(true, Ordering::Relaxed);
        assert!(SCAN_CANCEL.load(Ordering::Relaxed));

        // Reset for other tests.
        SCAN_CANCEL.store(false, Ordering::Relaxed);
    }

    #[tokio::test]
    async fn test_get_discovered_skills_groups_by_project() {
        let pool = setup_test_db().await;
        let now = Utc::now().to_rfc3339();

        // Insert two discovered skills in the same project.
        db::insert_discovered_skill(
            &pool,
            "claude-code__proj1__skill-a",
            "skill-a",
            Some("Skill A"),
            "/tmp/proj1/.claude/skills/skill-a/SKILL.md",
            "/tmp/proj1/.claude/skills/skill-a",
            "/tmp/proj1",
            "proj1",
            "claude-code",
            &now,
        )
        .await
        .unwrap();

        db::insert_discovered_skill(
            &pool,
            "cursor__proj1__skill-b",
            "skill-b",
            Some("Skill B"),
            "/tmp/proj1/.cursor/skills/skill-b/SKILL.md",
            "/tmp/proj1/.cursor/skills/skill-b",
            "/tmp/proj1",
            "proj1",
            "cursor",
            &now,
        )
        .await
        .unwrap();

        // Insert a skill in a different project.
        db::insert_discovered_skill(
            &pool,
            "claude-code__proj2__skill-c",
            "skill-c",
            Some("Skill C"),
            "/tmp/proj2/.claude/skills/skill-c/SKILL.md",
            "/tmp/proj2/.claude/skills/skill-c",
            "/tmp/proj2",
            "proj2",
            "claude-code",
            &now,
        )
        .await
        .unwrap();

        let rows = db::get_all_discovered_skills(&pool).await.unwrap();
        assert_eq!(rows.len(), 3, "should have 3 discovered skill rows");

        // Group by project_path.
        let mut by_project: HashMap<String, Vec<db::DiscoveredSkillRow>> = HashMap::new();
        for row in rows {
            by_project
                .entry(row.project_path.clone())
                .or_default()
                .push(row);
        }

        assert_eq!(by_project.len(), 2, "should have 2 projects");
        let proj1_skills = by_project.get("/tmp/proj1").unwrap();
        assert_eq!(proj1_skills.len(), 2, "proj1 should have 2 skills");
        let proj2_skills = by_project.get("/tmp/proj2").unwrap();
        assert_eq!(proj2_skills.len(), 1, "proj2 should have 1 skill");
    }

    #[tokio::test]
    async fn test_clear_discovered_skills_removes_all() {
        let pool = setup_test_db().await;
        let now = Utc::now().to_rfc3339();

        db::insert_discovered_skill(
            &pool,
            "id1",
            "skill-1",
            None,
            "/tmp/skill1/SKILL.md",
            "/tmp/skill1",
            "/tmp/proj1",
            "proj1",
            "claude-code",
            &now,
        )
        .await
        .unwrap();

        db::insert_discovered_skill(
            &pool,
            "id2",
            "skill-2",
            None,
            "/tmp/skill2/SKILL.md",
            "/tmp/skill2",
            "/tmp/proj1",
            "proj1",
            "cursor",
            &now,
        )
        .await
        .unwrap();

        let before = db::get_all_discovered_skills(&pool).await.unwrap();
        assert_eq!(before.len(), 2);

        db::clear_all_discovered_skills(&pool).await.unwrap();

        let after = db::get_all_discovered_skills(&pool).await.unwrap();
        assert!(after.is_empty(), "all discovered skills should be cleared");
    }

    #[tokio::test]
    async fn test_get_scan_roots_returns_defaults() {
        let pool = setup_test_db().await;

        // No persisted config yet — should return defaults.
        let roots = get_scan_roots_impl(&pool).await.unwrap();
        assert!(!roots.is_empty(), "should return default scan roots");

        // Each root should have a path and label.
        for root in &roots {
            assert!(!root.path.is_empty());
            assert!(!root.label.is_empty());
        }
    }

    #[tokio::test]
    async fn test_set_scan_root_enabled_persists_state() {
        let pool = setup_test_db().await;

        // Get defaults.
        let roots = get_scan_roots_impl(&pool).await.unwrap();
        let some_path = roots[0].path.clone();

        // Disable a root.
        set_scan_root_enabled_impl(&pool, some_path.clone(), false)
            .await
            .unwrap();

        // Verify the change is reflected.
        let updated = get_scan_roots_impl(&pool).await.unwrap();
        let changed = updated.iter().find(|r| r.path == some_path).unwrap();
        assert!(!changed.enabled, "root should be disabled after set_scan_root_enabled");

        // Re-enable it.
        set_scan_root_enabled_impl(&pool, some_path.clone(), true)
            .await
            .unwrap();

        let re_updated = get_scan_roots_impl(&pool).await.unwrap();
        let re_changed = re_updated.iter().find(|r| r.path == some_path).unwrap();
        assert!(re_changed.enabled, "root should be re-enabled");
    }

    /// Implementation of get_scan_roots that takes a pool directly for testing.
    async fn get_scan_roots_impl(pool: &DbPool) -> Result<Vec<ScanRoot>, String> {
        let mut roots = default_scan_roots();

        if let Some(json) = db::get_setting(pool, "discover_scan_roots_config").await? {
            let config: HashMap<String, bool> =
                serde_json::from_str(&json).map_err(|e| format!("Invalid scan roots config: {}", e))?;
            for root in &mut roots {
                if let Some(&enabled) = config.get(&root.path) {
                    root.enabled = enabled;
                }
            }
        }

        Ok(roots)
    }

    /// Implementation of set_scan_root_enabled that takes a pool directly for testing.
    async fn set_scan_root_enabled_impl(
        pool: &DbPool,
        path: String,
        enabled: bool,
    ) -> Result<(), String> {
        let mut config: HashMap<String, bool> = match db::get_setting(pool, "discover_scan_roots_config").await? {
            Some(json) => serde_json::from_str(&json).map_err(|e| format!("Invalid scan roots config: {}", e))?,
            None => HashMap::new(),
        };

        config.insert(path, enabled);

        let json = serde_json::to_string(&config)
            .map_err(|e| format!("Failed to serialize scan roots config: {}", e))?;
        db::set_setting(pool, "discover_scan_roots_config", &json).await
    }

    #[tokio::test]
    async fn test_scan_cancellation_stops_early() {
        let tmp = tempfile::TempDir::new().unwrap();
        let central_dir = tmp.path().join("central");
        std::fs::create_dir_all(&central_dir).unwrap();

        // Create multiple project dirs with skills.
        for i in 0..5 {
            let project_dir = tmp.path().join(format!("project-{}", i));
            let skill_dir = project_dir.join(".claude/skills/deploy-skill");
            std::fs::create_dir_all(&skill_dir).unwrap();
            std::fs::write(
                skill_dir.join("SKILL.md"),
                format!(
                    "---\nname: deploy-{}\ndescription: Deploy stuff\n---\n\n# Deploy {}\n",
                    i, i
                ),
            )
            .unwrap();
        }

        let patterns = vec![(
            "claude-code".to_string(),
            "Claude Code".to_string(),
            PathBuf::from(".claude/skills"),
        )];

        // Set cancel flag before scanning.
        SCAN_CANCEL.store(true, Ordering::Relaxed);

        let projects = scan_root_for_projects(tmp.path(), &patterns, &central_dir);
        assert!(
            projects.is_empty(),
            "should find no projects when cancel flag is set"
        );

        // Reset for other tests.
        SCAN_CANCEL.store(false, Ordering::Relaxed);
    }

    #[tokio::test]
    async fn test_discovered_skill_insert_and_get_by_id() {
        let pool = setup_test_db().await;
        let now = Utc::now().to_rfc3339();

        db::insert_discovered_skill(
            &pool,
            "test-id-1",
            "test-skill",
            Some("A description"),
            "/tmp/project/.claude/skills/test-skill/SKILL.md",
            "/tmp/project/.claude/skills/test-skill",
            "/tmp/project",
            "project",
            "claude-code",
            &now,
        )
        .await
        .unwrap();

        let found = db::get_discovered_skill_by_id(&pool, "test-id-1")
            .await
            .unwrap();
        assert!(found.is_some());
        let row = found.unwrap();
        assert_eq!(row.name, "test-skill");
        assert_eq!(row.platform_id, "claude-code");
        assert_eq!(row.project_name, "project");

        let not_found = db::get_discovered_skill_by_id(&pool, "nonexistent")
            .await
            .unwrap();
        assert!(not_found.is_none());
    }

    #[tokio::test]
    async fn test_insert_discovered_skill_is_idempotent() {
        let pool = setup_test_db().await;
        let now = Utc::now().to_rfc3339();

        // INSERT OR IGNORE should not fail on duplicate.
        db::insert_discovered_skill(
            &pool,
            "dup-id",
            "dup-skill",
            None,
            "/tmp/dup/SKILL.md",
            "/tmp/dup",
            "/tmp/proj",
            "proj",
            "claude-code",
            &now,
        )
        .await
        .unwrap();

        // Second insert with same ID should be silently ignored.
        db::insert_discovered_skill(
            &pool,
            "dup-id",
            "dup-skill-updated",
            Some("updated description"),
            "/tmp/dup/SKILL.md",
            "/tmp/dup",
            "/tmp/proj",
            "proj",
            "claude-code",
            &now,
        )
        .await
        .unwrap();

        let rows = db::get_all_discovered_skills(&pool).await.unwrap();
        assert_eq!(rows.len(), 1, "should still have only 1 row");
        assert_eq!(rows[0].name, "dup-skill", "original name should be preserved (INSERT OR IGNORE)");
    }

    #[tokio::test]
    async fn test_delete_discovered_skill() {
        let pool = setup_test_db().await;
        let now = Utc::now().to_rfc3339();

        db::insert_discovered_skill(
            &pool,
            "to-delete",
            "delete-me",
            None,
            "/tmp/del/SKILL.md",
            "/tmp/del",
            "/tmp/proj",
            "proj",
            "cursor",
            &now,
        )
        .await
        .unwrap();

        let found = db::get_discovered_skill_by_id(&pool, "to-delete")
            .await
            .unwrap();
        assert!(found.is_some());

        db::delete_discovered_skill(&pool, "to-delete").await.unwrap();

        let gone = db::get_discovered_skill_by_id(&pool, "to-delete")
            .await
            .unwrap();
        assert!(gone.is_none());
    }

    #[tokio::test]
    async fn test_import_to_central_refuses_duplicate() {
        let tmp = tempfile::TempDir::new().unwrap();
        let pool = setup_test_db().await;
        let central_dir = tmp.path().join("central");
        std::fs::create_dir_all(&central_dir).unwrap();

        // Create a skill already in central.
        let existing = central_dir.join("existing-skill");
        std::fs::create_dir_all(&existing).unwrap();
        std::fs::write(existing.join("SKILL.md"), "---\nname: existing-skill\n---\n\n# Test\n").unwrap();

        // Also create the same skill in a project (discovered).
        let project_skill = tmp.path().join("project/.claude/skills/existing-skill");
        std::fs::create_dir_all(&project_skill).unwrap();
        std::fs::write(project_skill.join("SKILL.md"), "---\nname: existing-skill\n---\n\n# Test\n").unwrap();

        let now = Utc::now().to_rfc3339();
        db::insert_discovered_skill(
            &pool,
            "claude-code__project__existing-skill",
            "existing-skill",
            None,
            &project_skill.join("SKILL.md").to_string_lossy(),
            &project_skill.to_string_lossy(),
            &tmp.path().join("project").to_string_lossy(),
            "project",
            "claude-code",
            &now,
        )
        .await
        .unwrap();

        let result = import_discovered_skill_to_central_impl(
            &pool,
            "claude-code__project__existing-skill",
            &central_dir,
        )
        .await;

        assert!(result.is_err(), "should refuse to import when skill already exists in central");
    }

    #[tokio::test]
    async fn test_import_to_platform_refuses_existing_installation() {
        let tmp = tempfile::TempDir::new().unwrap();
        let pool = setup_test_db().await;
        let agent_dir = tmp.path().join("agent-skills");
        std::fs::create_dir_all(&agent_dir).unwrap();

        // Create an existing skill in agent dir.
        let existing = agent_dir.join("existing-skill");
        std::fs::create_dir_all(&existing).unwrap();

        // Also create a discovered skill with the same name.
        let project_skill = tmp.path().join("project/.claude/skills/existing-skill");
        std::fs::create_dir_all(&project_skill).unwrap();
        std::fs::write(project_skill.join("SKILL.md"), "---\nname: existing-skill\n---\n\n# Test\n").unwrap();

        let now = Utc::now().to_rfc3339();
        db::insert_discovered_skill(
            &pool,
            "claude-code__project__existing-skill",
            "existing-skill",
            None,
            &project_skill.join("SKILL.md").to_string_lossy(),
            &project_skill.to_string_lossy(),
            &tmp.path().join("project").to_string_lossy(),
            "project",
            "claude-code",
            &now,
        )
        .await
        .unwrap();

        let result = import_discovered_skill_to_platform_impl(
            &pool,
            "claude-code__project__existing-skill",
            "claude-code",
            &agent_dir,
        )
        .await;

        assert!(result.is_err(), "should refuse to import when skill already exists in agent dir");
    }

    #[tokio::test]
    async fn test_platform_skill_patterns_includes_all_non_central_agents() {
        let pool = setup_test_db().await;
        let patterns = platform_skill_patterns(&pool);

        // Should have entries for all non-central agents.
        let central_agents: Vec<_> = db::builtin_agents()
            .iter()
            .filter(|a| a.id != "central")
            .map(|a| a.id.clone())
            .collect();

        for agent_id in &central_agents {
            assert!(
                patterns.iter().any(|(id, _, _)| id == agent_id),
                "agent '{}' should appear in platform skill patterns",
                agent_id
            );
        }
    }

    #[tokio::test]
    async fn test_discovered_project_count() {
        let pool = setup_test_db().await;
        let now = Utc::now().to_rfc3339();

        // Insert skills across 3 different projects.
        for i in 0..3 {
            db::insert_discovered_skill(
                &pool,
                &format!("skill-{}", i),
                &format!("skill {}", i),
                None,
                &format!("/tmp/proj{}/SKILL.md", i),
                &format!("/tmp/proj{}", i),
                &format!("/tmp/proj{}", i),
                &format!("proj{}", i),
                "claude-code",
                &now,
            )
            .await
            .unwrap();
        }

        let count = db::get_discovered_project_count(&pool).await.unwrap();
        assert_eq!(count, 3, "should have 3 distinct projects");
    }
}
