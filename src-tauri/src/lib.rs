use std::{
    env,
    fs,
    io::Cursor,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::UNIX_EPOCH,
};

use base64::Engine;
use image::{codecs::png::PngEncoder, ColorType, GenericImageView, ImageEncoder};
use rayon::prelude::*;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{Emitter, Manager};

const DB_FILE_NAME: &str = "thumbnail_cache.sqlite";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GalleryItem {
    name: String,
    path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LoadGalleryResponse {
    items: Vec<GalleryItem>,
    cancelled: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ThumbnailProgress {
    current: usize,
    total: usize,
    name: String,
}

struct PendingThumbnail {
    image_path: PathBuf,
    cache_key: String,
    modified_unix: i64,
}

struct GeneratedThumbnail {
    cache_key: String,
    source_path: String,
    modified_unix: i64,
    blob: Vec<u8>,
    mime: String,
}

#[derive(Default)]
struct AppState {
    cancel_requested: Arc<AtomicBool>,
}

#[tauri::command]
fn get_initial_folder() -> Option<String> {
    env::args()
        .skip(1)
        .find(|arg| Path::new(arg).is_dir())
        .map(|arg| arg.to_string())
}

#[tauri::command]
async fn load_full_image(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || load_full_image_blocking(path))
        .await
        .map_err(|err| format!("Failed to join full image task: {err}"))?
}

#[tauri::command]
async fn load_thumbnail(
    app: tauri::AppHandle,
    path: String,
    thumbnail_size: u32,
) -> Result<String, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("Failed to resolve app data path: {err}"))?;
    fs::create_dir_all(&data_dir)
        .map_err(|err| format!("Failed to create app data directory: {err}"))?;

    tauri::async_runtime::spawn_blocking(move || {
        load_thumbnail_blocking(data_dir, path, thumbnail_size)
    })
    .await
    .map_err(|err| format!("Failed to join thumbnail task: {err}"))?
}

#[tauri::command]
async fn load_gallery(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    folder_path: String,
    thumbnail_size: u32,
) -> Result<LoadGalleryResponse, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("Failed to resolve app data path: {err}"))?;
    fs::create_dir_all(&data_dir)
        .map_err(|err| format!("Failed to create app data directory: {err}"))?;

    state.cancel_requested.store(false, Ordering::Relaxed);
    let cancel_requested = state.cancel_requested.clone();
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        load_gallery_blocking(
            app_handle,
            cancel_requested,
            data_dir,
            folder_path,
            thumbnail_size,
        )
    })
    .await
    .map_err(|err| format!("Failed to join gallery task: {err}"))?
}

#[tauri::command]
fn cancel_gallery_scan(state: tauri::State<'_, AppState>) {
    state.cancel_requested.store(true, Ordering::Relaxed);
}

fn load_gallery_blocking(
    app: tauri::AppHandle,
    cancel_requested: Arc<AtomicBool>,
    data_dir: PathBuf,
    folder_path: String,
    thumbnail_size: u32,
) -> Result<LoadGalleryResponse, String> {
    let folder = PathBuf::from(folder_path);
    if !folder.is_dir() {
        return Err(format!("{} is not a valid directory.", folder.display()));
    }

    let db_path = data_dir.join(DB_FILE_NAME);
    let mut connection =
        Connection::open(db_path).map_err(|err| format!("Failed to open cache database: {err}"))?;
    init_schema(&connection)?;

    let mut image_paths = collect_supported_images(&folder)?;
    image_paths.sort_unstable();

    let mut results = Vec::new();
    let mut pending = Vec::new();

    let mut skipped_count = 0usize;
    let mut cancelled = false;
    let total = image_paths.len();
    for (index, image_path) in image_paths.into_iter().enumerate() {
        if cancel_requested.load(Ordering::Relaxed) {
            cancelled = true;
            break;
        }
        let progress = ThumbnailProgress {
            current: index + 1,
            total,
            name: image_path
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_else(|| "image".to_string()),
        };
        if let Err(err) = app.emit("thumbnail-progress", &progress) {
            log::warn!("Failed to emit thumbnail progress: {}", err);
        }

        match prepare_single_image(&connection, &image_path) {
            Ok((item, maybe_pending)) => {
                results.push(item);
                if let Some(pending_item) = maybe_pending {
                    pending.push(pending_item);
                }
            }
            Err(err) => {
                skipped_count += 1;
                log::warn!(
                    "Skipping image during gallery scan ({}): {}",
                    image_path.display(),
                    err
                );
            }
        }
    }

    if !cancelled && !pending.is_empty() {
        let generated: Vec<GeneratedThumbnail> = pending
            .into_par_iter()
            .filter_map(|pending_item| {
                if cancel_requested.load(Ordering::Relaxed) {
                    return None;
                }
                match generate_pending_thumbnail(pending_item, thumbnail_size) {
                    Ok(value) => Some(value),
                    Err(err) => {
                        log::warn!("Skipping generated thumbnail due to error: {}", err);
                        None
                    }
                }
            })
            .collect();

        if cancel_requested.load(Ordering::Relaxed) {
            cancelled = true;
        }

        if !generated.is_empty() {
            let tx = connection
                .transaction()
                .map_err(|err| format!("Failed to start cache transaction: {err}"))?;
            for entry in generated {
                tx.execute(
                    "INSERT INTO thumbnails (
                       cache_key,
                       source_path,
                       source_modified_unix,
                       thumbnail_blob,
                       mime_type
                     ) VALUES (?1, ?2, ?3, ?4, ?5)
                     ON CONFLICT(cache_key) DO UPDATE SET
                       source_modified_unix = excluded.source_modified_unix,
                       thumbnail_blob = excluded.thumbnail_blob,
                       mime_type = excluded.mime_type",
                    params![
                        entry.cache_key,
                        entry.source_path,
                        entry.modified_unix,
                        entry.blob,
                        entry.mime
                    ],
                )
                .map_err(|err| format!("Failed to write cache entry: {err}"))?;
            }
            tx.commit()
                .map_err(|err| format!("Failed to commit cache transaction: {err}"))?;
        }
    }

    if skipped_count > 0 {
        log::warn!("Skipped {} image(s) while loading gallery", skipped_count);
    }
    Ok(LoadGalleryResponse {
        items: results,
        cancelled,
    })
}

fn load_full_image_blocking(path: String) -> Result<String, String> {
    let image_path = PathBuf::from(path);
    if !image_path.is_file() {
        return Err(format!("{} is not a file.", image_path.display()));
    }

    let image_bytes = fs::read(&image_path)
        .map_err(|err| format!("Failed to read image {}: {err}", image_path.display()))?;
    let mime_type = mime_type_for_path(&image_path)
        .ok_or_else(|| format!("Unsupported image format: {}", image_path.display()))?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(image_bytes);
    Ok(format!("data:{mime_type};base64,{encoded}"))
}

fn load_thumbnail_blocking(
    data_dir: PathBuf,
    path: String,
    thumbnail_size: u32,
) -> Result<String, String> {
    let image_path = PathBuf::from(path);
    if !image_path.is_file() {
        return Err(format!("{} is not a file.", image_path.display()));
    }
    if !is_supported_image(&image_path) {
        return Err(format!("Unsupported image format: {}", image_path.display()));
    }

    let db_path = data_dir.join(DB_FILE_NAME);
    let connection =
        Connection::open(db_path).map_err(|err| format!("Failed to open cache database: {err}"))?;
    init_schema(&connection)?;

    let modified_unix = last_modified_unix(&image_path)?;
    let cache_key = cache_key_for_path(&image_path);
    let cached: Option<(Vec<u8>, String)> = connection
        .query_row(
            "SELECT thumbnail_blob, mime_type
             FROM thumbnails
             WHERE cache_key = ?1 AND source_modified_unix = ?2",
            params![cache_key, modified_unix],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|err| format!("Failed to read cache entry: {err}"))?;

    let (thumbnail_blob, mime_type) = match cached {
        Some((blob, mime)) => (blob, mime),
        None => {
            let (blob, mime) = generate_thumbnail_blob(&image_path, thumbnail_size)?;
            connection
                .execute(
                    "INSERT INTO thumbnails (
                       cache_key,
                       source_path,
                       source_modified_unix,
                       thumbnail_blob,
                       mime_type
                     ) VALUES (?1, ?2, ?3, ?4, ?5)
                     ON CONFLICT(cache_key) DO UPDATE SET
                       source_modified_unix = excluded.source_modified_unix,
                       thumbnail_blob = excluded.thumbnail_blob,
                       mime_type = excluded.mime_type",
                    params![
                        cache_key,
                        image_path.to_string_lossy().to_string(),
                        modified_unix,
                        blob,
                        mime
                    ],
                )
                .map_err(|err| format!("Failed to write cache entry: {err}"))?;
            (blob, mime)
        }
    };

    let encoded = base64::engine::general_purpose::STANDARD.encode(thumbnail_blob);
    Ok(format!("data:{mime_type};base64,{encoded}"))
}

fn prepare_single_image(
    connection: &Connection,
    image_path: &Path,
) -> Result<(GalleryItem, Option<PendingThumbnail>), String> {
    let modified_unix = last_modified_unix(image_path)?;
    let cache_key = cache_key_for_path(image_path);
    let cached: Option<(Vec<u8>, String)> = connection
        .query_row(
            "SELECT thumbnail_blob, mime_type
             FROM thumbnails
             WHERE cache_key = ?1 AND source_modified_unix = ?2",
            params![cache_key, modified_unix],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|err| format!("Failed to read cache entry: {err}"))?;

    let item = GalleryItem {
        name: image_path
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| "image".to_string()),
        path: image_path.to_string_lossy().to_string(),
    };

    if cached.is_some() {
        return Ok((item, None));
    }

    Ok((
        item,
        Some(PendingThumbnail {
            image_path: image_path.to_path_buf(),
            cache_key,
            modified_unix,
        }),
    ))
}

fn generate_pending_thumbnail(
    pending: PendingThumbnail,
    thumbnail_size: u32,
) -> Result<GeneratedThumbnail, String> {
    let (blob, mime) = generate_thumbnail_blob(&pending.image_path, thumbnail_size)?;
    Ok(GeneratedThumbnail {
        cache_key: pending.cache_key,
        source_path: pending.image_path.to_string_lossy().to_string(),
        modified_unix: pending.modified_unix,
        blob,
        mime,
    })
}

fn init_schema(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS thumbnails (
               cache_key TEXT PRIMARY KEY,
               source_path TEXT NOT NULL,
               source_modified_unix INTEGER NOT NULL,
               thumbnail_blob BLOB NOT NULL,
               mime_type TEXT NOT NULL
             );",
        )
        .map_err(|err| format!("Failed to initialize database schema: {err}"))
}

fn collect_supported_images(folder: &Path) -> Result<Vec<PathBuf>, String> {
    let mut images = Vec::new();
    let mut directories = vec![folder.to_path_buf()];

    while let Some(current_dir) = directories.pop() {
        let entries = match fs::read_dir(&current_dir) {
            Ok(value) => value,
            Err(err) => {
                log::warn!(
                    "Skipping unreadable directory while scanning ({}): {}",
                    current_dir.display(),
                    err
                );
                continue;
            }
        };

        for entry in entries {
            let entry = match entry {
                Ok(value) => value,
                Err(err) => {
                    log::warn!("Skipping unreadable folder entry: {}", err);
                    continue;
                }
            };
            let path = entry.path();
            if path.is_dir() {
                directories.push(path);
                continue;
            }
            if path.is_file() && is_supported_image(&path) {
                images.push(path);
            }
        }
    }

    Ok(images)
}

fn is_supported_image(path: &Path) -> bool {
    match path.extension().and_then(|ext| ext.to_str()) {
        Some(ext) => matches!(
            ext.to_ascii_lowercase().as_str(),
            "jpg" | "jpeg" | "png" | "gif" | "bmp" | "webp" | "tif" | "tiff"
        ),
        None => false,
    }
}

fn mime_type_for_path(path: &Path) -> Option<&'static str> {
    match path.extension().and_then(|ext| ext.to_str()) {
        Some(ext) => match ext.to_ascii_lowercase().as_str() {
            "jpg" | "jpeg" => Some("image/jpeg"),
            "png" => Some("image/png"),
            "gif" => Some("image/gif"),
            "bmp" => Some("image/bmp"),
            "webp" => Some("image/webp"),
            "tif" | "tiff" => Some("image/tiff"),
            _ => None,
        },
        None => None,
    }
}

fn last_modified_unix(path: &Path) -> Result<i64, String> {
    let metadata =
        fs::metadata(path).map_err(|err| format!("Failed to read metadata for {}: {err}", path.display()))?;
    let modified = metadata
        .modified()
        .map_err(|err| format!("Failed to read modified time for {}: {err}", path.display()))?;
    let duration = modified
        .duration_since(UNIX_EPOCH)
        .map_err(|err| format!("Invalid modified time for {}: {err}", path.display()))?;
    Ok(duration.as_secs() as i64)
}

fn cache_key_for_path(path: &Path) -> String {
    let mut hasher = Sha256::new();
    hasher.update(path.to_string_lossy().as_bytes());
    format!("{:x}", hasher.finalize())
}

fn generate_thumbnail_blob(path: &Path, thumbnail_size: u32) -> Result<(Vec<u8>, String), String> {
    let image = image::open(path)
        .map_err(|err| format!("Failed to open image {}: {err}", path.display()))?;
    let thumbnail = image.thumbnail(thumbnail_size, thumbnail_size);
    let rgba = thumbnail.to_rgba8();
    let (width, height) = thumbnail.dimensions();
    let mut png_bytes = Vec::new();
    {
        let mut cursor = Cursor::new(&mut png_bytes);
        let encoder = PngEncoder::new(&mut cursor);
        encoder
            .write_image(&rgba, width, height, ColorType::Rgba8.into())
            .map_err(|err| format!("Failed to encode thumbnail {}: {err}", path.display()))?;
    }
    Ok((png_bytes, "image/png".to_string()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_initial_folder,
            load_gallery,
            load_full_image,
            cancel_gallery_scan,
            load_thumbnail
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
