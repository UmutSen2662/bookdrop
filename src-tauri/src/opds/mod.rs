//! The optional LAN catalog.
//!
//! Bookdrop stays the source of truth: the webview hands over a snapshot of the
//! books it may serve, and this module only turns that snapshot into an OPDS
//! feed plus the files and covers behind it. No SQL, no calibre, no writes.
//!
//! The server is off unless the user starts it, dies with the app, and serves
//! only paths from the snapshot, so a request can never name a file.

mod feed;
mod net;

use std::net::Ipv4Addr;
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;

use axum::Router;
use axum::body::Body;
use axum::extract::{Path, Query, State as AxumState};
use axum::http::header::{self, HeaderValue};
use axum::http::{HeaderMap, Request, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use serde::{Deserialize, Serialize};
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use tower::ServiceExt;
use tower_http::services::ServeFile;

use feed::{ACQUISITION_TYPE, FeedQuery, render_feed};
use net::{LanAddress, lan_addresses};

/// calibre's content server owns 8080; this stays out of its way.
const PORT: u16 = 8099;

/// One book the reader may see and download. File paths are absolute and come
/// from the database row, never from a request.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareBook {
    pub id: i64,
    pub title: String,
    pub authors: String,
    #[serde(default)]
    pub title_sort: Option<String>,
    pub updated_at: String,
    #[serde(default)]
    pub language: Option<String>,
    #[serde(default)]
    pub series: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    pub file_path: String,
    pub file_name: String,
    #[serde(default)]
    pub file_size: Option<u64>,
    #[serde(default)]
    pub cover_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase", tag = "state")]
pub enum ShareStatus {
    Stopped,
    Running {
        /// Full origins such as `http://192.168.1.5:8099`, best first, each
        /// with the adapter it belongs to.
        urls: Vec<LanAddress>,
        count: usize,
    },
}

struct Running {
    books: Arc<RwLock<Vec<ShareBook>>>,
    stop: Option<oneshot::Sender<()>>,
}

impl Running {
    fn status(&self) -> ShareStatus {
        let count = self
            .books
            .read()
            .map(|books| books.len())
            .unwrap_or_default();
        ShareStatus::Running {
            // Re-read the adapters: the machine may have moved networks while
            // the server kept listening.
            urls: lan_addresses(PORT),
            count,
        }
    }
}

/// Tauri managed state. A plain mutex: every critical section is a few
/// instructions and none of them await.
#[derive(Default)]
pub struct OpdsState {
    inner: Mutex<Option<Running>>,
}

fn lock(state: &OpdsState) -> std::sync::MutexGuard<'_, Option<Running>> {
    state
        .inner
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[tauri::command]
pub async fn start_sharing(
    state: tauri::State<'_, OpdsState>,
    books: Vec<ShareBook>,
) -> Result<ShareStatus, String> {
    if let Some(running) = lock(&state).as_ref() {
        return Ok(running.status());
    }

    let listener = bind().await?;
    if lan_addresses(PORT).is_empty() {
        return Err(
            "Bookdrop can't find a network connection. Join a Wi-Fi network and try again."
                .to_string(),
        );
    }

    let store = Arc::new(RwLock::new(books));
    let (stop, stopped) = oneshot::channel();
    let app = routes(AppState {
        books: store.clone(),
    });
    tauri::async_runtime::spawn(async move {
        let _ = axum::serve(listener, app)
            .with_graceful_shutdown(async {
                let _ = stopped.await;
            })
            .await;
    });

    let mut guard = lock(&state);
    // A second start that raced past the check above loses: its server is told
    // to stop, and only the winner's state is installed.
    if let Some(running) = guard.as_ref() {
        let _ = stop.send(());
        return Ok(running.status());
    }
    let running = Running {
        books: store,
        stop: Some(stop),
    };
    let status = running.status();
    *guard = Some(running);
    Ok(status)
}

#[tauri::command]
pub fn stop_sharing(state: tauri::State<'_, OpdsState>) -> ShareStatus {
    let mut guard = lock(&state);
    if let Some(mut running) = guard.take()
        && let Some(stop) = running.stop.take()
    {
        let _ = stop.send(());
    }
    ShareStatus::Stopped
}

/// The webview pushes a fresh snapshot whenever the library changes; it is a
/// no-op while sharing is off.
#[tauri::command]
pub fn set_share_books(state: tauri::State<'_, OpdsState>, books: Vec<ShareBook>) {
    let guard = lock(&state);
    if let Some(running) = guard.as_ref()
        && let Ok(mut slot) = running.books.write()
    {
        *slot = books;
    }
}

#[tauri::command]
pub fn share_status(state: tauri::State<'_, OpdsState>) -> ShareStatus {
    match lock(&state).as_ref() {
        Some(running) => running.status(),
        None => ShareStatus::Stopped,
    }
}

/// Called on quit; the process would close the socket anyway, but this lets an
/// in-flight download finish instead of being cut off.
pub fn shutdown(app: &tauri::AppHandle) {
    use tauri::Manager;
    let state = app.state::<OpdsState>();
    let mut guard = lock(&state);
    if let Some(mut running) = guard.take()
        && let Some(stop) = running.stop.take()
    {
        let _ = stop.send(());
    }
}

async fn bind() -> Result<TcpListener, String> {
    let address = (Ipv4Addr::UNSPECIFIED, PORT);
    match TcpListener::bind(address).await {
        Ok(listener) => Ok(listener),
        Err(error) if error.kind() == std::io::ErrorKind::AddrInUse => {
            // A just-stopped server may still be releasing the port.
            for _ in 0..10 {
                tokio::time::sleep(Duration::from_millis(50)).await;
                if let Ok(listener) = TcpListener::bind(address).await {
                    return Ok(listener);
                }
            }
            Err(format!(
                "Port {PORT} is already in use by another app. Close it and try again."
            ))
        }
        Err(error) => Err(format!("Could not start sharing: {error}")),
    }
}

#[derive(Clone)]
struct AppState {
    books: Arc<RwLock<Vec<ShareBook>>>,
}

fn routes(state: AppState) -> Router {
    Router::new()
        .route("/opds", get(catalog))
        .route("/opds/search", get(catalog))
        .route("/book/{id}/file", get(book_file))
        .route("/book/{id}/cover", get(book_cover))
        .with_state(state)
}

async fn catalog(
    AxumState(app): AxumState<AppState>,
    Query(query): Query<FeedQuery>,
    headers: HeaderMap,
) -> Response {
    feed_response(&app, &headers, query.page, query.q.as_deref())
}

fn feed_response(
    app: &AppState,
    headers: &HeaderMap,
    page: Option<usize>,
    query: Option<&str>,
) -> Response {
    let origin = origin(headers);
    let body = {
        let books = app
            .books
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        render_feed(&books, &origin, page.unwrap_or(1), query)
    };
    let mut response = body.into_response();
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static(ACQUISITION_TYPE),
    );
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

/// Absolute links follow the address the reader actually used.
fn origin(headers: &HeaderMap) -> String {
    match headers
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
    {
        Some(host) if !host.is_empty() => format!("http://{host}"),
        _ => String::new(),
    }
}

async fn book_file(
    AxumState(app): AxumState<AppState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> Response {
    let entry = {
        let books = app
            .books
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        books
            .iter()
            .find(|book| book.id == id)
            .map(|book| (book.file_path.clone(), book.file_name.clone()))
    };
    match entry {
        Some((path, name)) => send_file(path, &headers, "application/epub+zip", Some(&name)).await,
        None => not_found(),
    }
}

async fn book_cover(
    AxumState(app): AxumState<AppState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> Response {
    let cover = {
        let books = app
            .books
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        books
            .iter()
            .find(|book| book.id == id)
            .and_then(|book| book.cover_path.clone())
            .filter(|path| !path.is_empty())
    };
    match cover {
        Some(path) => send_file(path, &headers, "image/jpeg", None).await,
        None => not_found(),
    }
}

/// Let `ServeFile` handle ranges, conditional requests, and streaming; only
/// the content type and download name are ours.
async fn send_file(
    path: String,
    headers: &HeaderMap,
    content_type: &'static str,
    download_name: Option<&str>,
) -> Response {
    let mut builder = Request::builder().method("GET").uri("/");
    for name in [
        header::RANGE,
        header::IF_RANGE,
        header::IF_MODIFIED_SINCE,
        header::IF_NONE_MATCH,
    ] {
        if let Some(value) = headers.get(&name) {
            builder = builder.header(name.clone(), value.clone());
        }
    }
    let Ok(request) = builder.body(Body::empty()) else {
        return not_found();
    };

    match ServeFile::new(path).oneshot(request).await {
        Ok(response) => {
            let mut response = response.map(Body::new);
            // A missing file or an unsatisfiable range is already a response;
            // do not dress it up as a book.
            if matches!(
                response.status(),
                StatusCode::OK | StatusCode::PARTIAL_CONTENT
            ) {
                response
                    .headers_mut()
                    .insert(header::CONTENT_TYPE, HeaderValue::from_static(content_type));
                if let Some(name) = download_name
                    && let Ok(value) = HeaderValue::from_str(&content_disposition(name))
                {
                    response
                        .headers_mut()
                        .insert(header::CONTENT_DISPOSITION, value);
                }
            }
            response
        }
        Err(_) => not_found(),
    }
}

fn not_found() -> Response {
    (StatusCode::NOT_FOUND, "Not found").into_response()
}

fn content_disposition(name: &str) -> String {
    let fallback: String = name
        .chars()
        .map(|character| {
            if character.is_ascii()
                && !character.is_ascii_control()
                && character != '"'
                && character != '\\'
            {
                character
            } else {
                '_'
            }
        })
        .collect();
    format!(
        "attachment; filename=\"{fallback}\"; filename*=UTF-8''{}",
        feed::percent_encode(name)
    )
}

#[cfg(test)]
mod tests {
    use super::{LanAddress, ShareStatus, content_disposition};

    #[test]
    fn status_serializes_the_way_the_webview_expects() {
        assert_eq!(
            serde_json::to_string(&ShareStatus::Stopped).unwrap(),
            r#"{"state":"stopped"}"#
        );
        assert_eq!(
            serde_json::to_string(&ShareStatus::Running {
                urls: vec![LanAddress {
                    url: "http://192.168.1.5:8099".to_string(),
                    name: "Wi-Fi".to_string(),
                }],
                count: 3,
            })
            .unwrap(),
            r#"{"state":"running","urls":[{"url":"http://192.168.1.5:8099","name":"Wi-Fi"}],"count":3}"#
        );
    }

    #[test]
    fn keeps_accents_in_the_encoded_filename() {
        let value = content_disposition("Dune - Çöl Gezegeni.epub");
        assert!(value.contains("filename=\"Dune - __l Gezegeni.epub\""));
        assert!(value.contains("filename*=UTF-8''Dune%20-%20%C3%87%C3%B6l%20Gezegeni.epub"));
    }
}

#[cfg(test)]
mod handler_tests {
    use std::sync::{Arc, RwLock};

    use axum::body::Body;
    use axum::http::{Request, StatusCode, header};
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    use super::*;

    fn book(id: i64, file_path: &str, file_name: &str) -> ShareBook {
        ShareBook {
            id,
            title: "Dune".to_string(),
            authors: "Frank Herbert".to_string(),
            title_sort: None,
            updated_at: "2026-11-16T10:00:00.000Z".to_string(),
            language: Some("en".to_string()),
            series: None,
            description: None,
            file_path: file_path.to_string(),
            file_name: file_name.to_string(),
            file_size: Some(10),
            cover_path: None,
        }
    }

    fn app(books: Vec<ShareBook>) -> Router {
        routes(AppState {
            books: Arc::new(RwLock::new(books)),
        })
    }

    async fn body_bytes(response: Response) -> Vec<u8> {
        response
            .into_body()
            .collect()
            .await
            .expect("body")
            .to_bytes()
            .to_vec()
    }

    async fn text(response: Response) -> String {
        String::from_utf8_lossy(&body_bytes(response).await).to_string()
    }

    fn temp_file(extension: &str, contents: &[u8]) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!(
            "bookdrop-opds-{}-{}.{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            extension
        ));
        std::fs::write(&path, contents).unwrap();
        path
    }

    #[tokio::test]
    async fn feeds_absolute_links_for_the_requested_host() {
        let response = app(vec![book(1, "", "Dune.epub")])
            .oneshot(
                Request::builder()
                    .uri("/opds")
                    .header(header::HOST, "192.168.1.5:8099")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers()[header::CONTENT_TYPE],
            "application/atom+xml;profile=opds-catalog;kind=acquisition"
        );
        assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");

        let body = text(response).await;
        assert!(body.contains("href=\"http://192.168.1.5:8099/book/1/file\""));
        assert!(body.contains("<title>Dune</title>"));
    }

    #[tokio::test]
    async fn unknown_books_are_not_found() {
        let response = app(vec![])
            .oneshot(
                Request::builder()
                    .uri("/book/42/file")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);

        let response = app(vec![])
            .oneshot(
                Request::builder()
                    .uri("/book/1/cover")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn streams_the_epub_with_a_download_name_and_ranges() {
        let path = temp_file("epub", b"0123456789");
        let file_path = path.to_string_lossy().into_owned();
        let entry = book(1, &file_path, "Dune - Çöl.epub");

        let response = app(vec![entry.clone()])
            .oneshot(
                Request::builder()
                    .uri("/book/1/file")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers()[header::CONTENT_TYPE],
            "application/epub+zip"
        );
        let disposition = response.headers()[header::CONTENT_DISPOSITION]
            .to_str()
            .unwrap()
            .to_string();
        assert!(disposition.contains("filename*=UTF-8''Dune%20-%20%C3%87%C3%B6l.epub"));
        assert_eq!(text(response).await, "0123456789");

        let response = app(vec![entry])
            .oneshot(
                Request::builder()
                    .uri("/book/1/file")
                    .header(header::RANGE, "bytes=0-3")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(text(response).await, "0123");

        std::fs::remove_file(path).unwrap();
    }

    #[tokio::test]
    async fn serves_a_cached_cover_as_jpeg() {
        let path = temp_file("jpg", b"\xff\xd8\xff\xe0cover");
        let mut entry = book(1, "", "Dune.epub");
        entry.cover_path = Some(path.to_string_lossy().into_owned());

        let response = app(vec![entry])
            .oneshot(
                Request::builder()
                    .uri("/book/1/cover")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[header::CONTENT_TYPE], "image/jpeg");
        assert_eq!(
            body_bytes(response).await.as_slice(),
            b"\xff\xd8\xff\xe0cover"
        );

        std::fs::remove_file(path).unwrap();
    }

    /// Over a real socket, so the HEAD/GET behaviour is hyper's, not ours.
    #[tokio::test]
    async fn answers_head_requests_without_a_body() {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            let _ = axum::serve(listener, app(vec![book(1, "", "Dune.epub")])).await;
        });

        let response = reqwest::Client::new()
            .head(format!("http://127.0.0.1:{port}/opds"))
            .send()
            .await
            .expect("HEAD /opds");

        assert_eq!(response.status().as_u16(), 200);
        assert_eq!(
            response
                .headers()
                .get("content-type")
                .and_then(|value| value.to_str().ok()),
            Some(ACQUISITION_TYPE)
        );
        assert!(response.bytes().await.unwrap().is_empty());
    }
}
