use std::{
    env,
    fs,
    io::Cursor,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

use base64::Engine;
use image::{codecs::png::PngEncoder, ColorType, GenericImageView, ImageEncoder};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::Manager;

const DB_FILE_NAME: &str = "thumbnail_cache.sqlite";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GalleryItem {
    name: String,
    path: String,
    thumbnail_data_url: String,
}

#[tauri::command]
fn get_initial_folder() -> Option<String> {
    env::args()
        .skip(1)
        .find(|arg| Path::new(arg).is_dir())
        .map(|arg| arg.to_string())
}

#[tauri::command]
fn load_gallery(
    app: tauri::AppHandle,
    folder_path: String,
    thumbnail_size: u32,
) -> Result<Vec<GalleryItem>, String> {
    let folder = PathBuf::from(folder_path.clone());
    if !folder.is_dir() {
        return Err(format!("{} is not a valid directory.", folder.display()));
    }

    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("Failed to resolve app data path: {err}"))?;
    fs::create_dir_all(&data_dir)
        .map_err(|err| format!("Failed to create app data directory: {err}"))?;
    let db_path = data_dir.join(DB_FILE_NAME);

    let mut connection =
        Connection::open(db_path).map_err(|err| format!("Failed to open cache database: {err}"))?;
    init_schema(&connection)?;

    let mut image_paths = collect_supported_images(&folder)?;
    image_paths.sort_unstable();

    let mut results = Vec::new();
    let tx = connection
        .transaction()
        .map_err(|err| format!("Failed to start cache transaction: {err}"))?;

    let mut skipped_count = 0usize;
    for image_path in image_paths {
        match process_single_image(&tx, &image_path, thumbnail_size) {
            Ok(item) => results.push(item),
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

    tx.commit()
        .map_err(|err| format!("Failed to commit cache transaction: {err}"))?;
    if skipped_count > 0 {
        log::warn!("Skipped {} image(s) while loading gallery", skipped_count);
    }
    Ok(results)
}

fn process_single_image(
    tx: &rusqlite::Transaction<'_>,
    image_path: &Path,
    thumbnail_size: u32,
) -> Result<GalleryItem, String> {
    let modified_unix = last_modified_unix(image_path)?;
    let cache_key = cache_key_for_path(image_path);
    let cached: Option<(Vec<u8>, String)> = tx
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
            let (blob, mime) = generate_thumbnail_blob(image_path, thumbnail_size)?;
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
    let data_url = format!("data:{mime_type};base64,{encoded}");
    Ok(GalleryItem {
        name: image_path
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| "image".to_string()),
        path: image_path.to_string_lossy().to_string(),
        thumbnail_data_url: data_url,
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
    let entries = fs::read_dir(folder)
        .map_err(|err| format!("Failed to list folder {}: {err}", folder.display()))?;

    for entry in entries {
        let entry = entry.map_err(|err| format!("Failed to read folder entry: {err}"))?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if is_supported_image(&path) {
            images.push(path);
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
        .invoke_handler(tauri::generate_handler![get_initial_folder, load_gallery])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
