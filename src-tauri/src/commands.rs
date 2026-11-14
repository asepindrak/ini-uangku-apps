use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UpdateCheckResult {
    pub has_update: bool,
    pub current_version: String,
    pub latest_version: String,
    pub release_title: String,
    pub release_notes: String,
    pub release_date: String,
    pub download_url: Option<String>,
    pub asset_name: Option<String>,
    pub asset_size: Option<u64>,
    pub html_url: String,
}

#[derive(Clone, Serialize)]
struct DownloadProgressPayload {
    downloaded: u64,
    total: u64,
    percentage: f64,
}

#[tauri::command]
pub fn get_app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
pub async fn check_app_update(app: AppHandle) -> Result<UpdateCheckResult, String> {
    let current_version = app.package_info().version.to_string();

    let client = reqwest::Client::builder()
        .user_agent("Ini-Uangku-Desktop-App")
        .timeout(std::time::Duration::from_secs(12))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    let res = client
        .get("https://api.github.com/repos/asepindrak/ini-uangku/releases/latest")
        .send()
        .await
        .map_err(|e| format!("Unable to reach GitHub update server: {e}"))?;

    if !res.status().is_success() {
        return Err(format!("Update check returned HTTP {}", res.status()));
    }

    let release_val: serde_json::Value = res
        .json()
        .await
        .map_err(|e| format!("Failed to parse release response: {e}"))?;

    let tag_name = release_val["tag_name"]
        .as_str()
        .unwrap_or("")
        .to_string();
    let release_title = release_val["name"]
        .as_str()
        .unwrap_or(&tag_name)
        .to_string();
    let release_notes = release_val["body"]
        .as_str()
        .unwrap_or("")
        .to_string();
    let release_date = release_val["published_at"]
        .as_str()
        .unwrap_or("")
        .to_string();
    let html_url = release_val["html_url"]
        .as_str()
        .unwrap_or("https://github.com/asepindrak/ini-uangku/releases")
        .to_string();

    let clean_latest = tag_name.trim_start_matches('v').trim_start_matches('V').to_string();
    let has_update = is_newer_version(&clean_latest, &current_version);

    let mut download_url = None;
    let mut asset_name = None;
    let mut asset_size = None;

    if let Some(assets) = release_val["assets"].as_array() {
        #[cfg(target_os = "android")]
        let target_asset = assets.iter().find(|a| {
            let name = a["name"].as_str().unwrap_or("").to_lowercase();
            name.ends_with(".apk")
        });

        #[cfg(target_os = "windows")]
        let target_asset = assets.iter().find(|a| {
            let name = a["name"].as_str().unwrap_or("").to_lowercase();
            name.ends_with(".msi") || name.ends_with(".exe")
        });

        #[cfg(target_os = "macos")]
        let target_asset = assets.iter().find(|a| {
            let name = a["name"].as_str().unwrap_or("").to_lowercase();
            name.ends_with(".dmg")
        });

        #[cfg(target_os = "linux")]
        let target_asset = assets.iter().find(|a| {
            let name = a["name"].as_str().unwrap_or("").to_lowercase();
            name.ends_with(".appimage") || name.ends_with(".deb")
        });

        #[cfg(not(any(target_os = "android", target_os = "windows", target_os = "macos", target_os = "linux")))]
        let target_asset = assets.iter().find(|a| {
            let name = a["name"].as_str().unwrap_or("").to_lowercase();
            name.ends_with(".msi") || name.ends_with(".apk") || name.ends_with(".dmg") || name.ends_with(".appimage")
        });

        if let Some(a) = target_asset {
            download_url = a["browser_download_url"].as_str().map(String::from);
            asset_name = a["name"].as_str().map(String::from);
            asset_size = a["size"].as_u64();
        }
    }

    Ok(UpdateCheckResult {
        has_update,
        current_version,
        latest_version: clean_latest,
        release_title,
        release_notes,
        release_date,
        download_url,
        asset_name,
        asset_size,
        html_url,
    })
}

#[tauri::command]
pub async fn download_and_install_update(
    app: AppHandle,
    download_url: String,
    asset_name: String,
) -> Result<String, String> {
    use futures_util::StreamExt;
    use std::io::Write;

    let temp_dir = std::env::temp_dir();
    let file_path = temp_dir.join(&asset_name);

    let client = reqwest::Client::builder()
        .user_agent("Ini-Uangku-Updater")
        .build()
        .map_err(|e| format!("HTTP Client Error: {e}"))?;

    let res = client
        .get(&download_url)
        .send()
        .await
        .map_err(|e| format!("Download request failed: {e}"))?;

    let total_size = res.content_length().unwrap_or(0);
    let mut file = std::fs::File::create(&file_path)
        .map_err(|e| format!("Failed to create temporary installer file: {e}"))?;

    let mut downloaded: u64 = 0;
    let mut stream = res.bytes_stream();

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|e| format!("Error downloading chunk: {e}"))?;
        file.write_all(&chunk)
            .map_err(|e| format!("Write failed: {e}"))?;
        downloaded += chunk.len() as u64;

        let percentage = if total_size > 0 {
            (downloaded as f64 / total_size as f64) * 100.0
        } else {
            0.0
        };

        let _ = app.emit("update-download-progress", DownloadProgressPayload {
            downloaded,
            total: total_size,
            percentage,
        });
    }

    drop(file);

    // Launch installer
    launch_installer(file_path, &asset_name)?;

    Ok("Unduhan selesai! Membuka installer...".to_string())
}

fn launch_installer(path: PathBuf, asset_name: &str) -> Result<(), String> {
    let lower = asset_name.to_lowercase();
    #[cfg(target_os = "windows")]
    {
        if lower.ends_with(".msi") {
            std::process::Command::new("msiexec")
                .arg("/i")
                .arg(&path)
                .spawn()
                .map_err(|e| format!("Failed to launch MSI installer: {e}"))?;
            std::process::exit(0);
        } else if lower.ends_with(".exe") {
            std::process::Command::new(&path)
                .spawn()
                .map_err(|e| format!("Failed to launch installer executable: {e}"))?;
            std::process::exit(0);
        }
    }

    #[cfg(target_os = "macos")]
    {
        if lower.ends_with(".dmg") {
            std::process::Command::new("open")
                .arg(&path)
                .spawn()
                .map_err(|e| format!("Failed to open DMG: {e}"))?;
        }
    }

    #[cfg(target_os = "linux")]
    {
        if lower.ends_with(".appimage") {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let mut perms = std::fs::metadata(&path).unwrap().permissions();
                perms.set_mode(0o755);
                let _ = std::fs::set_permissions(&path, perms);
            }
            std::process::Command::new(&path)
                .spawn()
                .map_err(|e| format!("Failed to launch AppImage: {e}"))?;
        } else if lower.ends_with(".deb") {
            std::process::Command::new("xdg-open")
                .arg(&path)
                .spawn()
                .map_err(|e| format!("Failed to open DEB: {e}"))?;
        }
    }

    #[cfg(target_os = "android")]
    {
        // On Android, opening an APK triggers standard package installer intent
    }

    Ok(())
}

fn is_newer_version(latest: &str, current: &str) -> bool {
    let parse = |v: &str| -> Vec<u32> {
        v.split('.')
            .filter_map(|p| p.chars().take_while(|c| c.is_ascii_digit()).collect::<String>().parse().ok())
            .collect()
    };

    let lat = parse(latest);
    let cur = parse(current);

    for (l, c) in lat.iter().zip(cur.iter()) {
        if l > c {
            return true;
        }
        if l < c {
            return false;
        }
    }
    lat.len() > cur.len()
}
