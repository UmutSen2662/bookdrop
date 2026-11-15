//! Native host commands: process spawn, hashing, atomic writes, and (via the
//! sql plugin) the database. The TypeScript pipeline reaches these through the
//! `Host` interface; nothing here knows about books or calibre semantics.

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{BufReader, Read, Write};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// Keep at most this much of a child's output. Calibre can be noisy on failure
/// and the pipeline only keeps the tail anyway.
const OUTPUT_CAP: usize = 1024 * 1024;

/// Covers and lookup JSON are small; this stops a misbehaving server from
/// filling memory or disk.
const HTTP_MAX_BYTES: usize = 10 * 1024 * 1024;

/// After the child exits, wait this long for its pipes to drain. A stray
/// grandchild holding the pipe open must not hang the command forever.
const DRAIN_GRACE: Duration = Duration::from_secs(2);

const POLL_INTERVAL: Duration = Duration::from_millis(25);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessOutput {
    /// `None` when the process was killed (timeout) or died some other way.
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub timed_out: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStat {
    pub size: u64,
    pub mtime_ms: u64,
    pub is_directory: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageSize {
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpResult {
    pub status: u16,
    pub content_type: String,
}

// ---------------------------------------------------------------------------
// process spawning
// ---------------------------------------------------------------------------

/// A byte buffer that keeps only the newest `OUTPUT_CAP` bytes.
struct Tail {
    buf: Vec<u8>,
}

impl Tail {
    fn new() -> Self {
        Self { buf: Vec::new() }
    }

    fn push(&mut self, chunk: &[u8]) {
        self.buf.extend_from_slice(chunk);
        if self.buf.len() > OUTPUT_CAP {
            let excess = self.buf.len() - OUTPUT_CAP;
            self.buf.drain(..excess);
        }
    }
}

fn drain_into(mut pipe: impl Read, tail: Arc<Mutex<Tail>>) {
    let mut chunk = [0u8; 16 * 1024];
    loop {
        match pipe.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => {
                if let Ok(mut tail) = tail.lock() {
                    tail.push(&chunk[..n]);
                }
            }
            Err(_) => break,
        }
    }
}

#[cfg(windows)]
fn hide_window(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    // CREATE_NO_WINDOW: calibre is a console program, and a GUI parent would
    // otherwise flash a console window on every call.
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn hide_window(_cmd: &mut Command) {}

/// Kill the child *and* everything it spawned. calibre's launchers start
/// helper processes, so `Child::kill` alone can leave work running.
#[cfg(windows)]
fn kill_tree(pid: u32) {
    let mut cmd = Command::new("taskkill");
    cmd.args(["/PID", &pid.to_string(), "/T", "/F"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    hide_window(&mut cmd);
    let _ = cmd.status();
}

#[cfg(not(windows))]
fn kill_tree(pid: u32) {
    let _ = Command::new("kill")
        .args(["-9", &pid.to_string()])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

fn take_tail(tail: &Arc<Mutex<Tail>>) -> String {
    match tail.lock() {
        Ok(tail) => String::from_utf8_lossy(&tail.buf).into_owned(),
        Err(_) => String::new(),
    }
}

/// Run a program with an argv array (never a shell string) and collect its
/// output as UTF-8. Returns `Err` only when the process could not be started or
/// waited on; a non-zero exit code is a normal result.
pub fn run_process_impl(
    program: &str,
    args: &[String],
    timeout_ms: u64,
) -> Result<ProcessOutput, String> {
    // Guard against a caller passing 0 and killing calibre immediately.
    let timeout = Duration::from_millis(timeout_ms.max(1_000));
    let started = Instant::now();

    let mut cmd = Command::new(program);
    cmd.args(args)
        // Never let calibre wait on a prompt: with no stdin it fails instead.
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        // calibre is Python. Without this it writes cp1252 and mangles names.
        .env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8");
    hide_window(&mut cmd);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to start {program}: {e}"))?;
    let pid = child.id();

    let out_tail = Arc::new(Mutex::new(Tail::new()));
    let err_tail = Arc::new(Mutex::new(Tail::new()));

    let mut readers = Vec::new();
    if let Some(pipe) = child.stdout.take() {
        let tail = Arc::clone(&out_tail);
        readers.push(std::thread::spawn(move || drain_into(pipe, tail)));
    }
    if let Some(pipe) = child.stderr.take() {
        let tail = Arc::clone(&err_tail);
        readers.push(std::thread::spawn(move || drain_into(pipe, tail)));
    }

    let mut timed_out = false;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) => {}
            Err(e) => {
                kill_tree(pid);
                let _ = child.wait();
                return Err(format!("failed while waiting for {program}: {e}"));
            }
        }

        if started.elapsed() >= timeout {
            timed_out = true;
            kill_tree(pid);
            break child.wait().ok();
        }

        std::thread::sleep(POLL_INTERVAL);
    };

    let drain_deadline = Instant::now() + DRAIN_GRACE;
    while readers.iter().any(|handle| !handle.is_finished()) && Instant::now() < drain_deadline {
        std::thread::sleep(POLL_INTERVAL);
    }
    // Unfinished readers are detached; they end when the pipe closes.
    for handle in readers {
        if handle.is_finished() {
            let _ = handle.join();
        }
    }

    Ok(ProcessOutput {
        // A killed process reports taskkill's own exit code; report no code at
        // all so callers never mistake a timeout for a normal failure.
        code: if timed_out {
            None
        } else {
            status.and_then(|status| status.code())
        },
        stdout: take_tail(&out_tail),
        stderr: take_tail(&err_tail),
        timed_out,
    })
}

// ---------------------------------------------------------------------------
// hashing
// ---------------------------------------------------------------------------

/// SHA-256 of a file, streamed so a large book never lands in memory.
pub fn hash_file_impl(path: &str) -> Result<String, String> {
    let file = File::open(path).map_err(|e| format!("cannot open {path}: {e}"))?;
    let mut reader = BufReader::with_capacity(64 * 1024, file);
    let mut hasher = Sha256::new();
    let mut chunk = vec![0u8; 64 * 1024];

    loop {
        let read = reader
            .read(&mut chunk)
            .map_err(|e| format!("cannot read {path}: {e}"))?;
        if read == 0 {
            break;
        }
        hasher.update(&chunk[..read]);
    }

    Ok(hex_lower(&hasher.finalize()))
}

fn hex_lower(bytes: &[u8]) -> String {
    use std::fmt::Write as _;
    let mut hex = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        let _ = write!(hex, "{byte:02x}");
    }
    hex
}

// ---------------------------------------------------------------------------
// atomic writes
// ---------------------------------------------------------------------------

/// Write `contents` to `path` without ever exposing a partial file: the bytes go
/// to a `.tmp-*` file in the destination directory, are flushed to disk, then
/// renamed over the target. Same directory means same volume, so the rename is
/// atomic.
pub fn write_file_atomic_impl(path: &str, contents: &[u8]) -> Result<(), String> {
    let dest = std::path::Path::new(path);
    let dir = dest
        .parent()
        .ok_or_else(|| format!("{path}: no parent directory"))?;
    let name = dest
        .file_name()
        .ok_or_else(|| format!("{path}: not a file path"))?
        .to_string_lossy();

    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_nanos())
        .unwrap_or(0);
    // `.tmp-*` is the prefix reconcile already ignores.
    let tmp = dir.join(format!(".tmp-{}-{stamp}-{name}", std::process::id()));

    let write = (|| -> std::io::Result<()> {
        let mut file = File::create(&tmp)?;
        file.write_all(contents)?;
        file.sync_all()
    })();

    if let Err(e) = write {
        let _ = fs::remove_file(&tmp);
        return Err(format!("cannot write {}: {e}", tmp.display()));
    }

    if let Err(e) = fs::rename(&tmp, dest) {
        let _ = fs::remove_file(&tmp);
        return Err(format!("cannot replace {path}: {e}"));
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// files and folders
// ---------------------------------------------------------------------------

pub fn copy_file_impl(from: &str, to: &str) -> Result<(), String> {
    if let Some(parent) = Path::new(to).parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("cannot create {}: {e}", parent.display()))?;
    }
    fs::copy(from, to)
        .map(|_| ())
        .map_err(|e| format!("cannot copy {from} to {to}: {e}"))
}

pub fn rename_file_impl(from: &str, to: &str) -> Result<(), String> {
    // Windows' rename is a replace; a library rename must never clobber.
    if Path::new(to).exists() {
        return Err(format!("will not overwrite {to}"));
    }
    if let Some(parent) = Path::new(to).parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("cannot create {}: {e}", parent.display()))?;
    }
    fs::rename(from, to).map_err(|e| format!("cannot rename {from} to {to}: {e}"))
}

pub fn remove_file_impl(path: &str) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("cannot remove {path}: {e}")),
    }
}

pub fn ensure_dir_impl(path: &str) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|e| format!("cannot create {path}: {e}"))
}

pub fn remove_dir_impl(path: &str) -> Result<(), String> {
    match fs::remove_dir_all(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("cannot remove {path}: {e}")),
    }
}

pub fn list_dir_impl(path: &str) -> Result<Vec<String>, String> {
    let mut names = Vec::new();
    for entry in fs::read_dir(path).map_err(|e| format!("cannot list {path}: {e}"))? {
        let entry = entry.map_err(|e| format!("cannot read an entry in {path}: {e}"))?;
        names.push(entry.file_name().to_string_lossy().into_owned());
    }
    names.sort();
    Ok(names)
}

pub fn stat_path_impl(path: &str) -> Result<Option<FileStat>, String> {
    let metadata = match fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("cannot stat {path}: {e}")),
    };
    let mtime_ms = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0);
    Ok(Some(FileStat {
        size: metadata.len(),
        mtime_ms,
        is_directory: metadata.is_dir(),
    }))
}

/// Resize a cover to at most `max_width` px and write it as a JPEG. Small
/// images are left at their size; the UI's 2:3 box handles the rest.
pub fn make_thumbnail_impl(source: &str, destination: &str, max_width: u32) -> Result<(), String> {
    let image = image::open(source).map_err(|e| format!("cannot read {source}: {e}"))?;
    let max_width = max_width.max(1);
    let output = if image.width() > max_width {
        let height = ((image.height() as f64 * max_width as f64) / image.width() as f64)
            .round()
            .max(1.0) as u32;
        image.resize(max_width, height, image::imageops::FilterType::Lanczos3)
    } else {
        image
    };

    if let Some(parent) = Path::new(destination).parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("cannot create {}: {e}", parent.display()))?;
    }
    output
        .save_with_format(destination, image::ImageFormat::Jpeg)
        .map_err(|e| format!("cannot write {destination}: {e}"))
}

/// Read an image's pixel dimensions from its header, without decoding it.
pub fn image_size_impl(path: &str) -> Result<Option<ImageSize>, String> {
    match image::image_dimensions(path) {
        Ok((width, height)) => Ok(Some(ImageSize { width, height })),
        Err(e) => Err(format!("cannot read {path}: {e}")),
    }
}

// ---------------------------------------------------------------------------
// commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn run_process(
    program: String,
    args: Vec<String>,
    timeout_ms: u64,
) -> Result<ProcessOutput, String> {
    tauri::async_runtime::spawn_blocking(move || run_process_impl(&program, &args, timeout_ms))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn hash_file(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || hash_file_impl(&path))
        .await
        .map_err(|e| e.to_string())?
}

/// Bytes cross the IPC as base64: a `Vec<u8>` argument would arrive as a JSON
/// array of numbers, several times the size and expensive to deserialize.
#[tauri::command]
pub async fn write_file_atomic(path: String, data: String) -> Result<(), String> {
    let bytes = STANDARD
        .decode(data)
        .map_err(|e| format!("invalid base64 payload: {e}"))?;
    tauri::async_runtime::spawn_blocking(move || write_file_atomic_impl(&path, &bytes))
        .await
        .map_err(|e| e.to_string())?
}

/// Raw bytes are usable on a response, unlike an argument, so a file never
/// crosses the IPC as base64. The webview receives an ArrayBuffer.
#[tauri::command]
pub fn read_file(path: String) -> Result<tauri::ipc::Response, String> {
    let bytes = fs::read(&path).map_err(|e| format!("cannot read {path}: {e}"))?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub async fn copy_file(from: String, to: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || copy_file_impl(&from, &to))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn rename_file(from: String, to: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || rename_file_impl(&from, &to))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn remove_file(path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || remove_file_impl(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn ensure_dir(path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || ensure_dir_impl(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn remove_dir(path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || remove_dir_impl(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn list_dir(path: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || list_dir_impl(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn stat_path(path: String) -> Result<Option<FileStat>, String> {
    tauri::async_runtime::spawn_blocking(move || stat_path_impl(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn make_thumbnail(
    source: String,
    destination: String,
    max_width: u32,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        make_thumbnail_impl(&source, &destination, max_width)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn image_size(path: String) -> Result<Option<ImageSize>, String> {
    tauri::async_runtime::spawn_blocking(move || image_size_impl(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn env_var(name: String) -> Option<String> {
    std::env::var(name).ok()
}

/// Open a path the user already chose: a folder in Explorer, or a book in its
/// default reader. The JS opener plugin's path command is scope-gated; this
/// does not need a second permission surface. URL opening still goes through
/// the plugin.
#[tauri::command]
pub async fn open_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|error| error.to_string())
}

/// `reqwest` with rustls: no OpenSSL on Windows. Covers and lookup JSON are
/// downloaded straight to a file; the body never crosses the IPC.
#[tauri::command]
pub async fn http_get(
    url: String,
    destination: String,
    timeout_ms: u64,
) -> Result<HttpResult, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(timeout_ms.max(1_000)))
        .user_agent("bookdrop/1.0 (personal library tool)")
        .build()
        .map_err(|e| format!("cannot build the HTTP client: {e}"))?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("cannot fetch {url}: {e}"))?;
    let status = response.status().as_u16();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_string();

    if let Some(length) = response.content_length() {
        if length > HTTP_MAX_BYTES as u64 {
            return Err(format!("{url} is larger than 10 MB"));
        }
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("cannot read the response from {url}: {e}"))?;
    if bytes.len() > HTTP_MAX_BYTES {
        return Err(format!("{url} is larger than 10 MB"));
    }

    tauri::async_runtime::spawn_blocking(move || {
        if let Some(parent) = Path::new(&destination).parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("cannot create {}: {e}", parent.display()))?;
        }
        fs::write(&destination, bytes.as_ref())
            .map_err(|e| format!("cannot write {destination}: {e}"))
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(HttpResult {
        status,
        content_type,
    })
}

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch_dir(tag: &str) -> std::path::PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("bookdrop-{tag}-{stamp}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn cmd() -> &'static str {
        r"C:\Windows\System32\cmd.exe"
    }

    #[test]
    fn runs_a_program_and_captures_stdout() {
        let out = run_process_impl(cmd(), &["/C".into(), "echo hello".into()], 30_000).unwrap();
        assert_eq!(out.code, Some(0));
        assert_eq!(out.stdout.trim(), "hello");
        assert!(!out.timed_out);
    }

    #[test]
    fn captures_stderr_and_exit_code() {
        let out = run_process_impl(
            cmd(),
            &["/C".into(), "echo oops 1>&2 & exit /b 3".into()],
            30_000,
        )
        .unwrap();
        assert_eq!(out.code, Some(3));
        assert_eq!(out.stderr.trim(), "oops");
    }

    #[test]
    fn forces_a_utf8_environment() {
        let out = run_process_impl(
            cmd(),
            &["/C".into(), "echo %PYTHONUTF8% %PYTHONIOENCODING%".into()],
            30_000,
        )
        .unwrap();
        assert_eq!(out.stdout.trim(), "1 utf-8");
    }

    #[test]
    fn missing_program_is_an_error_not_a_panic() {
        let err = run_process_impl(r"C:\nope\nothing.exe", &[], 5_000).unwrap_err();
        assert!(err.contains("failed to start"), "{err}");
    }

    #[test]
    fn kills_the_process_tree_on_timeout() {
        // cmd -> ping: the timeout only returns promptly if the whole tree dies.
        let started = Instant::now();
        let out = run_process_impl(
            cmd(),
            &["/C".into(), "ping -n 10 127.0.0.1 & echo DONE".into()],
            1_500,
        )
        .unwrap();
        let elapsed = started.elapsed();

        assert!(out.timed_out);
        assert_eq!(out.code, None);
        assert!(
            elapsed < Duration::from_secs(4),
            "took {elapsed:?}; the child tree probably survived"
        );
        assert!(!out.stdout.contains("DONE"));
    }

    #[test]
    fn hashes_a_file() {
        let dir = scratch_dir("hash");
        let file = dir.join("book.bin");
        fs::write(&file, b"hello").unwrap();

        let hash = hash_file_impl(file.to_str().unwrap()).unwrap();
        assert_eq!(
            hash,
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn hash_matches_a_streamed_read_of_a_bigger_file() {
        let dir = scratch_dir("hash-big");
        let file = dir.join("big.bin");
        let bytes: Vec<u8> = (0..200_000u32).map(|i| (i % 251) as u8).collect();
        fs::write(&file, &bytes).unwrap();

        // Cross-check against the one-shot hasher: the streaming loop must not
        // miss or repeat a chunk boundary.
        let expected = hex_lower(&Sha256::digest(&bytes));
        assert_eq!(hash_file_impl(file.to_str().unwrap()).unwrap(), expected);

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn reads_image_dimensions_from_a_png() {
        let dir = scratch_dir("image-size");
        let path = dir.join("cover.png");
        let image = image::RgbaImage::from_pixel(120, 180, image::Rgba([0, 0, 0, 0]));
        image.save(&path).unwrap();

        let size = image_size_impl(path.to_str().unwrap()).unwrap().unwrap();
        assert_eq!((size.width, size.height), (120, 180));

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn writes_atomically_and_leaves_no_temp_file() {
        let dir = scratch_dir("atomic");
        let path = dir.join("out.epub");
        let path = path.to_str().unwrap();

        write_file_atomic_impl(path, b"first").unwrap();
        assert_eq!(fs::read(path).unwrap(), b"first");

        // Overwrite an existing file; the old content must not survive.
        write_file_atomic_impl(path, b"second, longer").unwrap();
        assert_eq!(fs::read(path).unwrap(), b"second, longer");

        let leftovers: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|name| name.starts_with(".tmp-"))
            .collect();
        assert!(leftovers.is_empty(), "leftover temp files: {leftovers:?}");

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn atomic_write_to_a_missing_directory_fails_cleanly() {
        let dir = scratch_dir("atomic-missing");
        let path = dir.join("nope").join("out.epub");
        let err = write_file_atomic_impl(path.to_str().unwrap(), b"x").unwrap_err();
        assert!(err.contains("cannot write"), "{err}");
        fs::remove_dir_all(&dir).unwrap();
    }

    /// calibre is the only external program the app depends on. Skip (with a
    /// note) when it is not installed in the default location.
    #[test]
    fn runs_calibre_when_it_is_installed() {
        let program = r"C:\Program Files\Calibre2\ebook-convert.exe";
        if !std::path::Path::new(program).exists() {
            eprintln!("skipping: {program} not found");
            return;
        }

        let out = run_process_impl(program, &["--version".into()], 30_000).unwrap();
        assert_eq!(out.code, Some(0), "stderr: {}", out.stderr);
        assert!(!out.stdout.trim().is_empty());
        assert!(!out.timed_out);
    }

    #[test]
    fn copies_lists_stats_and_removes() {
        let dir = scratch_dir("files");
        let source = dir.join("source.bin");
        fs::write(&source, b"hello").unwrap();
        let copy = dir.join("nested").join("copy.bin");

        copy_file_impl(source.to_str().unwrap(), copy.to_str().unwrap()).unwrap();
        assert_eq!(fs::read(&copy).unwrap(), b"hello");

        let moved = dir.join("moved.bin");
        rename_file_impl(copy.to_str().unwrap(), moved.to_str().unwrap()).unwrap();
        assert_eq!(fs::read(&moved).unwrap(), b"hello");
        assert!(!copy.exists());
        // A missing source is an error, never a silent no-op.
        assert!(rename_file_impl(copy.to_str().unwrap(), moved.to_str().unwrap()).is_err());
        // So is an occupied destination: a library rename must never clobber.
        let occupied = dir.join("occupied.bin");
        fs::write(&occupied, b"keep").unwrap();
        assert!(rename_file_impl(source.to_str().unwrap(), occupied.to_str().unwrap()).is_err());
        assert_eq!(fs::read(&occupied).unwrap(), b"keep");

        let names = list_dir_impl(dir.to_str().unwrap()).unwrap();
        assert!(names.contains(&"source.bin".to_string()), "{names:?}");
        assert!(names.contains(&"moved.bin".to_string()), "{names:?}");

        let stat = stat_path_impl(moved.to_str().unwrap()).unwrap().unwrap();
        assert_eq!(stat.size, 5);
        assert!(!stat.is_directory);

        let missing = dir.join("nope");
        assert!(stat_path_impl(missing.to_str().unwrap()).unwrap().is_none());

        remove_file_impl(moved.to_str().unwrap()).unwrap();
        assert!(!moved.exists());
        // Removing something already gone is not an error.
        remove_file_impl(moved.to_str().unwrap()).unwrap();

        remove_dir_impl(dir.to_str().unwrap()).unwrap();
        assert!(!dir.exists());
    }

    #[test]
    fn makes_a_jpeg_thumbnail_with_the_right_width() {
        let dir = scratch_dir("thumb");
        let source = dir.join("cover.png");
        image::RgbImage::from_pixel(800, 1200, image::Rgb([20, 40, 60]))
            .save(&source)
            .unwrap();

        let destination = dir.join("thumb.jpg");
        make_thumbnail_impl(source.to_str().unwrap(), destination.to_str().unwrap(), 400).unwrap();

        let thumbnail = image::open(&destination).unwrap();
        assert_eq!(thumbnail.width(), 400);
        assert_eq!(thumbnail.height(), 600);

        fs::remove_dir_all(&dir).unwrap();
    }
}
