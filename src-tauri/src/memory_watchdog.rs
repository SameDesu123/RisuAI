use serde_json::json;
use std::fs::{create_dir_all, read_dir, remove_file, File, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use sysinfo::{get_current_pid, ProcessRefreshKind, ProcessesToUpdate, System};
use tauri::{AppHandle, Manager};

const SAMPLE_INTERVAL: Duration = Duration::from_secs(1);
const LOG_RETENTION: Duration = Duration::from_secs(7 * 24 * 60 * 60);
const LOG_CLEANUP_INTERVAL: Duration = Duration::from_secs(60 * 60);
const MAX_EVENT_LEN: usize = 160;
const MAX_DETAIL_LEN: usize = 32 * 1024;
const TOP_PROCESS_COUNT: usize = 8;

struct MemoryWatchdog {
    path: PathBuf,
    writer: Mutex<BufWriter<File>>,
}

static WATCHDOG: OnceLock<Arc<MemoryWatchdog>> = OnceLock::new();

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn trim_text(value: &str, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
}

fn prune_old_logs(diagnostics_dir: &PathBuf, current_log: Option<&PathBuf>) {
    let Ok(entries) = read_dir(diagnostics_dir) else {
        return;
    };
    let now = SystemTime::now();

    for entry in entries.flatten() {
        let path = entry.path();
        if current_log.is_some_and(|current| current == &path) {
            continue;
        }

        let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if !file_name.starts_with("memory-watchdog-") || !file_name.ends_with(".jsonl") {
            continue;
        }

        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if !metadata.is_file() {
            continue;
        }
        let Ok(modified) = metadata.modified() else {
            continue;
        };
        let Ok(age) = now.duration_since(modified) else {
            continue;
        };

        if age > LOG_RETENTION {
            if let Err(error) = remove_file(&path) {
                eprintln!(
                    "[memory-watchdog] failed to remove expired log {}: {error}",
                    path.display()
                );
            }
        }
    }
}

fn write_value(value: serde_json::Value) {
    let Some(watchdog) = WATCHDOG.get() else {
        return;
    };

    let Ok(mut writer) = watchdog.writer.lock() else {
        return;
    };

    if serde_json::to_writer(&mut *writer, &value).is_ok() {
        let _ = writer.write_all(b"\n");
        // Flush every line so the last samples survive an OOM/process crash.
        let _ = writer.flush();
    }
}

pub fn log_event(source: &str, event: &str, detail: &str) {
    write_value(json!({
        "ts_ms": now_ms(),
        "kind": "event",
        "source": source,
        "event": trim_text(event, MAX_EVENT_LEN),
        "detail": trim_text(detail, MAX_DETAIL_LEN),
    }));
}

fn memory_level(tree_rss_bytes: u64) -> &'static str {
    const GIB: u64 = 1024 * 1024 * 1024;
    match tree_rss_bytes {
        bytes if bytes >= 6 * GIB => "critical",
        bytes if bytes >= 4 * GIB => "high",
        bytes if bytes >= 2 * GIB => "warning",
        _ => "normal",
    }
}

fn belongs_to_process_tree(pid: sysinfo::Pid, root_pid: sysinfo::Pid, system: &System) -> bool {
    let mut current = Some(pid);

    // Protect against malformed/cyclic process parent data.
    for _ in 0..64 {
        let Some(current_pid) = current else {
            return false;
        };
        if current_pid == root_pid {
            return true;
        }
        current = system.process(current_pid).and_then(|process| process.parent());
    }

    false
}

fn sample_loop(diagnostics_dir: PathBuf) {
    let Ok(root_pid) = get_current_pid() else {
        log_event("native", "watchdog.error", "get_current_pid failed");
        return;
    };

    let mut system = System::new();
    let mut last_log_cleanup = Instant::now();

    loop {
        system.refresh_memory();
        system.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            ProcessRefreshKind::nothing().with_memory().without_tasks(),
        );

        let mut tree_rss_bytes = 0u64;
        let mut tree_virtual_bytes = 0u64;
        let mut tree_process_count = 0usize;
        let mut top_processes: Vec<(u64, String)> = Vec::new();

        for (pid, process) in system.processes() {
            if !belongs_to_process_tree(*pid, root_pid, &system) {
                continue;
            }

            let rss = process.memory();
            tree_rss_bytes = tree_rss_bytes.saturating_add(rss);
            tree_virtual_bytes = tree_virtual_bytes.saturating_add(process.virtual_memory());
            tree_process_count += 1;

            top_processes.push((
                rss,
                format!(
                    "{}:{}:{}",
                    pid,
                    process
                        .name()
                        .to_string_lossy()
                        .replace('|', "_")
                        .replace('\n', "_")
                        .replace('\r', "_"),
                    rss
                ),
            ));
        }

        top_processes.sort_unstable_by(|a, b| b.0.cmp(&a.0));
        let top_processes_text = top_processes
            .into_iter()
            .take(TOP_PROCESS_COUNT)
            .map(|(_, line)| line)
            .collect::<Vec<_>>()
            .join("|");

        let (self_rss_bytes, self_virtual_bytes) = system
            .process(root_pid)
            .map(|process| (process.memory(), process.virtual_memory()))
            .unwrap_or((0, 0));

        write_value(json!({
            "ts_ms": now_ms(),
            "kind": "native_sample",
            "level": memory_level(tree_rss_bytes),
            "self_pid": root_pid.as_u32(),
            "self_rss_bytes": self_rss_bytes,
            "self_virtual_bytes": self_virtual_bytes,
            "tree_rss_bytes": tree_rss_bytes,
            "tree_virtual_bytes": tree_virtual_bytes,
            "tree_process_count": tree_process_count,
            "system_total_bytes": system.total_memory(),
            "system_available_bytes": system.available_memory(),
            "system_used_bytes": system.used_memory(),
            "swap_total_bytes": system.total_swap(),
            "swap_used_bytes": system.used_swap(),
            "top_processes": top_processes_text,
        }));

        if last_log_cleanup.elapsed() >= LOG_CLEANUP_INTERVAL {
            let current_log = WATCHDOG.get().map(|watchdog| &watchdog.path);
            prune_old_logs(&diagnostics_dir, current_log);
            last_log_cleanup = Instant::now();
        }

        std::thread::sleep(SAMPLE_INTERVAL);
    }
}

pub fn start(app: &AppHandle) -> Result<(), String> {
    let base_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve app data directory: {error}"))?;
    let diagnostics_dir = base_dir.join("diagnostics");
    create_dir_all(&diagnostics_dir)
        .map_err(|error| format!("failed to create diagnostics directory: {error}"))?;
    prune_old_logs(&diagnostics_dir, None);

    let path = diagnostics_dir.join(format!("memory-watchdog-{}.jsonl", now_ms()));
    let file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|error| format!("failed to open watchdog log: {error}"))?;

    let watchdog = Arc::new(MemoryWatchdog {
        path: path.clone(),
        writer: Mutex::new(BufWriter::new(file)),
    });

    WATCHDOG
        .set(watchdog)
        .map_err(|_| "memory watchdog was already initialized".to_string())?;

    log_event(
        "native",
        "watchdog.start",
        &format!("path={}", path.display()),
    );
    println!("[memory-watchdog] logging to {}", path.display());

    std::thread::Builder::new()
        .name("risu-memory-watchdog".to_string())
        .spawn(move || sample_loop(diagnostics_dir))
        .map_err(|error| format!("failed to spawn memory watchdog: {error}"))?;

    Ok(())
}

#[tauri::command]
pub fn memory_watchdog_event(event: String, detail: String) {
    log_event("frontend", &event, &detail);
}

#[tauri::command]
pub fn memory_watchdog_log_path() -> String {
    WATCHDOG
        .get()
        .map(|watchdog| watchdog.path.to_string_lossy().to_string())
        .unwrap_or_default()
}
