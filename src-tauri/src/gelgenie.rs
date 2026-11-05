//! GelGenie band segmentation for gel / western-blot images.
//!
//! The model is a 1-channel U-Net (Apache-2.0) exported to ONNX by the
//! GelGenie authors. It is downloaded on demand into the app data directory
//! and run locally through the same `ort` runtime that powers the SPICE fold
//! model. Preprocessing mirrors the upstream Python/QuPath pipeline:
//! grayscale, divide by 255, symmetric zero padding to a multiple of 32,
//! NCHW float32. The models expect a dark background, so light-background
//! images (ordinary western blots) are inverted automatically.
//!
//! The frontend still owns lane/band editing; this module only turns the
//! image into a band mask and derives band boxes + lane clusters from it.

use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::spice::DownloadProgress;

pub const MODEL_URL: &str =
    "https://huggingface.co/mattaq/GelGenie-Universal-FineTune-May-2024/resolve/main/onnx_checkpoints/unet_dec_21_finetune_epoch_590.onnx";
/// SHA-256 of the LFS object published on Hugging Face.
pub const MODEL_SHA256: &str = "df9e39157eda6e1d1f034f5ca75fb2b8d0965189c026f00504a80c2743bb6336";

/// A detected band in normalised image coordinates (0..1).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Band {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    pub area: f32,
    /// Mean band signal (1 = fully dark band on a light background, or fully
    /// bright band on a dark background, depending on the detected polarity).
    pub intensity: f32,
    pub lane: usize,
}

/// A lane cluster derived from band boxes.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Lane {
    /// Left edge in normalised image coordinates.
    pub x: f32,
    pub width: f32,
    pub bands: Vec<usize>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SegmentResult {
    pub width: u32,
    pub height: u32,
    /// Model input dimensions after padding to a multiple of 32.
    pub input_width: u32,
    pub input_height: u32,
    pub bands: Vec<Band>,
    pub lanes: Vec<Lane>,
    pub run_ms: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SegmentRequest {
    /// Base64 of one byte per pixel, row-major 8-bit grayscale.
    pub gray: String,
    pub width: u32,
    pub height: u32,
    /// Minimum component area as a fraction of the image (default 0.00002).
    pub min_area: Option<f32>,
}

pub struct GelGenieSession {
    // ort v2 `Session::run` takes `&mut self`; the mutex serialises access.
    session: Mutex<ort::session::Session>,
    pub model_path: String,
}

impl GelGenieSession {
    pub fn load(path: &std::path::Path) -> Result<Self, String> {
        let session = ort::session::Session::builder()
            .map_err(|e| format!("ort builder: {e}"))?
            .with_optimization_level(ort::session::builder::GraphOptimizationLevel::Level3)
            .map_err(|e| format!("ort opt: {e}"))?
            .commit_from_file(path)
            .map_err(|e| format!("ort load '{}': {e}", path.display()))?;
        Ok(Self {
            session: Mutex::new(session),
            model_path: path.display().to_string(),
        })
    }

    /// Run the U-Net on an 8-bit grayscale plane.
    pub fn segment(
        &self,
        gray: &[u8],
        width: u32,
        height: u32,
        min_area: Option<f32>,
    ) -> Result<SegmentResult, String> {
        let w = width as usize;
        let h = height as usize;
        if w == 0 || h == 0 {
            return Err("empty image".into());
        }
        if gray.len() != w * h {
            return Err(format!("expected {} gray bytes, got {}", w * h, gray.len()));
        }

        // Upstream pads with zeros after scaling; `32 * (dim // 32 + 1)`
        // always adds at least one block, so a 1024px image becomes 1056px.
        // Padding is symmetric, matching `getPadding` in the QuPath extension.
        let in_w = 32 * (w / 32 + 1);
        let in_h = 32 * (h / 32 + 1);
        let left = (in_w - w) / 2;
        let top = (in_h - h) / 2;
        let invert = is_light_background(gray);
        let mut input = vec![0.0f32; in_w * in_h];
        for y in 0..h {
            for x in 0..w {
                let v = gray[y * w + x] as f32 / 255.0;
                input[(top + y) * in_w + left + x] = if invert { 1.0 - v } else { v };
            }
        }

        let tensor = ort::value::Tensor::from_array(([1usize, 1, in_h, in_w], input))
            .map_err(|e| format!("input tensor: {e}"))?;

        let mut guard = self
            .session
            .lock()
            .map_err(|e| format!("gelgenie session lock: {e}"))?;
        let input_name = guard
            .inputs()
            .first()
            .map(|outlet| outlet.name().to_string())
            .ok_or_else(|| "model has no inputs".to_string())?;
        let output_name = guard
            .outputs()
            .first()
            .map(|outlet| outlet.name().to_string())
            .ok_or_else(|| "model has no outputs".to_string())?;

        let start = std::time::Instant::now();
        let outputs = guard
            .run(ort::inputs![input_name.as_str() => tensor])
            .map_err(|e| format!("gelgenie run: {e}"))?;
        let run_ms = start.elapsed().as_secs_f64() * 1000.0;

        let value = outputs
            .get(output_name.as_str())
            .ok_or_else(|| format!("missing output {output_name}"))?;
        let array = value
            .try_extract_array::<f32>()
            .map_err(|e| format!("output {output_name}: {e}"))?;
        let shape = array.shape();
        if shape.len() != 4 || shape[1] < 2 || shape[2] < h || shape[3] < w {
            return Err(format!("unexpected output shape {shape:?}"));
        }
        let plane = shape[2] * shape[3];
        let out_w = shape[3];
        let flat: Vec<f32> = array.iter().copied().collect();

        let mut mask = vec![0u8; w * h];
        for y in 0..h {
            for x in 0..w {
                let idx = (top + y) * out_w + left + x;
                if flat[plane + idx] > flat[idx] {
                    mask[y * w + x] = 1;
                }
            }
        }

        let min_area = ((w * h) as f32 * min_area.unwrap_or(0.00002)).max(12.0);
        let mut components = connected_components(&mask, gray, w, h, min_area, invert);
        // Drop boxes that hug the padded border: they are scanner edges, not bands.
        components.retain(|c| !(c.x0 <= 1 && c.x1 >= w - 2) && !(c.y0 <= 1 && c.y1 >= h - 2));

        let bands: Vec<Band> = components
            .into_iter()
            .map(|c| {
                let area = c.area as f32;
                let intensity = c.signal_sum / area;
                Band {
                    x: c.x0 as f32 / w as f32,
                    y: c.y0 as f32 / h as f32,
                    width: (c.x1 - c.x0 + 1) as f32 / w as f32,
                    height: (c.y1 - c.y0 + 1) as f32 / h as f32,
                    area: area / (w * h) as f32,
                    intensity,
                    lane: 0,
                }
            })
            .collect();

        let (bands, lanes) = assign_lanes(bands);
        Ok(SegmentResult {
            width,
            height,
            input_width: in_w as u32,
            input_height: in_h as u32,
            bands,
            lanes,
            run_ms,
        })
    }
}

/// GelGenie models were trained on dark backgrounds. Use the median pixel to
/// decide whether to invert: ordinary blots are dark bands on a light
/// membrane, while fluorescence scans are already bright-on-dark.
fn is_light_background(gray: &[u8]) -> bool {
    if gray.is_empty() {
        return false;
    }
    let mut histogram = [0usize; 256];
    for &value in gray {
        histogram[value as usize] += 1;
    }
    let middle = gray.len() / 2;
    let mut seen = 0usize;
    for (value, &count) in histogram.iter().enumerate() {
        seen += count;
        if seen > middle {
            return value >= 128;
        }
    }
    false
}

#[derive(Debug, Clone)]
struct Component {
    x0: usize,
    y0: usize,
    x1: usize,
    y1: usize,
    area: usize,
    signal_sum: f32,
}

/// 8-connected components of the band mask, with a signal-intensity sum.
/// `invert` mirrors the model preprocessing: when the source has a light
/// background, dark pixels carry the band signal.
fn connected_components(
    mask: &[u8],
    gray: &[u8],
    w: usize,
    h: usize,
    min_area: f32,
    invert: bool,
) -> Vec<Component> {
    let mut seen = vec![false; mask.len()];
    let mut out = Vec::new();
    let mut stack: Vec<usize> = Vec::new();
    for start in 0..mask.len() {
        if mask[start] == 0 || seen[start] {
            continue;
        }
        seen[start] = true;
        stack.push(start);
        let mut x0 = w;
        let mut y0 = h;
        let mut x1 = 0usize;
        let mut y1 = 0usize;
        let mut area = 0usize;
        let mut signal_sum = 0.0f32;
        while let Some(idx) = stack.pop() {
            let x = idx % w;
            let y = idx / w;
            area += 1;
            x0 = x0.min(x);
            y0 = y0.min(y);
            x1 = x1.max(x);
            y1 = y1.max(y);
            let value = gray[idx] as f32 / 255.0;
            signal_sum += if invert { 1.0 - value } else { value };
            for dy in -1i32..=1 {
                for dx in -1i32..=1 {
                    if dx == 0 && dy == 0 {
                        continue;
                    }
                    let nx = x as i32 + dx;
                    let ny = y as i32 + dy;
                    if nx < 0 || ny < 0 || nx >= w as i32 || ny >= h as i32 {
                        continue;
                    }
                    let nidx = ny as usize * w + nx as usize;
                    if mask[nidx] != 0 && !seen[nidx] {
                        seen[nidx] = true;
                        stack.push(nidx);
                    }
                }
            }
        }
        if area as f32 >= min_area {
            out.push(Component {
                x0,
                y0,
                x1,
                y1,
                area,
                signal_sum,
            });
        }
    }
    out
}

/// Bands belong to the same lane when the next box overlaps the lane's union
/// interval substantially, or its centre is closer than the typical neighbour
/// gap. The union test keeps a smear split into offset fragments together;
/// the centre test covers narrow bands that do not quite touch.
fn same_lane(bands: &[Band], group: &[usize], next: &Band, gap: f32) -> bool {
    let mut left = f32::INFINITY;
    let mut right = f32::NEG_INFINITY;
    for &index in group {
        left = left.min(bands[index].x);
        right = right.max(bands[index].x + bands[index].width);
    }
    let overlap = (right.min(next.x + next.width) - left.max(next.x)).max(0.0);
    let narrowest = (right - left).min(next.width).max(1e-6);
    if overlap / narrowest >= 0.25 {
        return true;
    }
    let last = &bands[*group.last().unwrap()];
    let last_center = last.x + last.width * 0.5;
    let next_center = next.x + next.width * 0.5;
    (next_center - last_center).abs() <= gap
}

/// Group band boxes into lanes. Bands in one lane normally overlap in x;
/// neighbouring lanes are separated by more than a typical band width.
fn assign_lanes(mut bands: Vec<Band>) -> (Vec<Band>, Vec<Lane>) {
    if bands.is_empty() {
        return (bands, Vec::new());
    }
    bands.sort_by(|a, b| {
        let ca = a.x + a.width * 0.5;
        let cb = b.x + b.width * 0.5;
        ca.partial_cmp(&cb).unwrap_or(std::cmp::Ordering::Equal)
    });
    let mut gaps: Vec<f32> = bands
        .windows(2)
        .map(|pair| {
            let a = &pair[0];
            let b = &pair[1];
            (b.x + b.width * 0.5) - (a.x + a.width * 0.5)
        })
        .filter(|gap| *gap > 0.0)
        .collect();
    if gaps.is_empty() {
        gaps.push(0.0);
    }
    gaps.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let middle = gaps.len() / 2;
    let median_gap = if gaps.len() % 2 == 0 && middle < gaps.len() {
        (gaps[middle - 1] + gaps[middle]) * 0.5
    } else {
        gaps[middle.min(gaps.len() - 1)]
    };
    // Adjacent bands closer than a fraction of the typical neighbour gap share
    // a lane. The floor keeps bands stacked in one lane together; the ceiling
    // still splits dense multi-lane gels.
    let gap = (median_gap * 0.8).clamp(0.04, 0.15);

    let mut groups: Vec<Vec<usize>> = Vec::new();
    for (index, band) in bands.iter().enumerate() {
        let join = groups
            .last()
            .map(|group| same_lane(&bands, group, band, gap));
        match join {
            Some(true) => groups.last_mut().unwrap().push(index),
            _ => groups.push(vec![index]),
        }
    }

    let mut lanes = Vec::with_capacity(groups.len());
    for group in &groups {
        let mut left = f32::INFINITY;
        let mut right = f32::NEG_INFINITY;
        for &index in group {
            let band = &bands[index];
            left = left.min(band.x);
            right = right.max(band.x + band.width);
        }
        // `x` is the left edge, matching the lane rectangles used by the tools.
        lanes.push(Lane {
            x: left,
            width: (right - left).max(0.01),
            bands: group.clone(),
        });
    }
    for (lane_index, lane) in lanes.iter().enumerate() {
        for &band_index in &lane.bands {
            bands[band_index].lane = lane_index;
        }
    }
    (bands, lanes)
}

/// Lazy holder for the downloaded GelGenie session.
pub struct GelGenieState {
    session: Mutex<Option<Arc<GelGenieSession>>>,
}

impl GelGenieState {
    pub fn new() -> Self {
        Self {
            session: Mutex::new(None),
        }
    }

    /// `~/Library/Application Support/<bundle-id>/models/gelgenie_unet.onnx`
    pub fn model_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
        use tauri::Manager;
        let dir = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("app data dir: {e}"))?;
        Ok(dir.join("models").join("gelgenie_unet.onnx"))
    }

    pub fn reload(&self, app: &tauri::AppHandle) -> Result<Arc<GelGenieSession>, String> {
        let path = Self::model_path(app)?;
        if !path.exists() {
            return Err("gelgenie model not downloaded".into());
        }
        let session = Arc::new(GelGenieSession::load(&path)?);
        *self.session.lock().map_err(|e| e.to_string())? = Some(session.clone());
        Ok(session)
    }

    pub fn get(&self, app: &tauri::AppHandle) -> Result<Arc<GelGenieSession>, String> {
        if let Some(session) = self.session.lock().map_err(|e| e.to_string())?.as_ref() {
            return Ok(session.clone());
        }
        self.reload(app)
    }
}

#[tauri::command]
pub fn gelgenie_status(app: tauri::AppHandle) -> serde_json::Value {
    match GelGenieState::model_path(&app) {
        Ok(path) => {
            let size = std::fs::metadata(&path).ok().map(|m| m.len());
            serde_json::json!({
                "ok": path.exists(),
                "modelPath": path.display().to_string(),
                "sizeBytes": size,
                "modelUrl": MODEL_URL,
                "modelSha256": MODEL_SHA256,
            })
        }
        Err(error) => serde_json::json!({ "ok": false, "error": error }),
    }
}

#[tauri::command]
pub async fn gelgenie_download_model(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::spice::AppState>,
    url: Option<String>,
    proxy: Option<String>,
    channel: tauri::ipc::Channel<DownloadProgress>,
) -> Result<serde_json::Value, String> {
    let path = GelGenieState::model_path(&app)?;
    let url = url.unwrap_or_else(|| MODEL_URL.to_string());
    let proxy = proxy.unwrap_or_default();
    let verify = if url == MODEL_URL {
        Some(MODEL_SHA256.to_string())
    } else {
        None
    };

    let dest = path.clone();
    let dl_url = url.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        // The Hugging Face CDN frequently cancels long HTTP/2 streams; HTTP/1.1
        // with range-free full downloads is the reliable path for this 57 MB file.
        let mut builder = reqwest::blocking::Client::builder()
            .user_agent("SPICE-GUI")
            .http1_only();
        if !proxy.trim().is_empty() {
            builder = builder
                .proxy(reqwest::Proxy::all(proxy.trim()).map_err(|e| format!("proxy: {e}"))?);
        }
        let client = builder
            .build()
            .map_err(|e| format!("reqwest client: {e}"))?;
        let mut resp = client
            .get(&dl_url)
            .send()
            .map_err(|e| format!("GET {dl_url}: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("HTTP {}", resp.status()));
        }
        let total = resp.content_length();
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("mkdir {}: {e}", parent.display()))?;
        }
        let temp = dest.with_extension("part");
        let mut file =
            std::fs::File::create(&temp).map_err(|e| format!("create {}: {e}", temp.display()))?;
        let mut hasher = Sha256::new();
        let mut buf = [0u8; 128 * 1024];
        let mut done = 0u64;
        loop {
            let n = resp.read(&mut buf).map_err(|e| format!("read: {e}"))?;
            if n == 0 {
                break;
            }
            file.write_all(&buf[..n])
                .map_err(|e| format!("write: {e}"))?;
            hasher.update(&buf[..n]);
            done += n as u64;
            let _ = channel.send(DownloadProgress {
                done,
                total,
                stage: "downloading".into(),
            });
        }
        file.flush().map_err(|e| format!("flush: {e}"))?;
        drop(file);

        if let Some(expected) = verify {
            let actual = format!("{:x}", hasher.finalize());
            if actual != expected {
                let _ = std::fs::remove_file(&temp);
                return Err(format!("checksum mismatch: {actual}"));
            }
        }
        std::fs::rename(&temp, &dest).map_err(|e| format!("rename {}: {e}", dest.display()))?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())??;

    let session = state.gelgenie.reload(&app)?;
    Ok(serde_json::json!({
        "ok": true,
        "modelPath": session.model_path,
        "sizeBytes": std::fs::metadata(&path).ok().map(|m| m.len()),
    }))
}

#[tauri::command]
pub async fn gelgenie_segment(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::spice::AppState>,
    request: SegmentRequest,
) -> Result<SegmentResult, String> {
    let gray = base64::engine::general_purpose::STANDARD
        .decode(&request.gray)
        .map_err(|e| format!("base64: {e}"))?;
    let session = state.gelgenie.get(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        session.segment(&gray, request.width, request.height, request.min_area)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn components_ignore_specks_and_track_bbox() {
        let w = 20;
        let h = 20;
        let mut mask = vec![0u8; w * h];
        for y in 5..9 {
            for x in 3..8 {
                mask[y * w + x] = 1;
            }
        }
        mask[15 * w + 15] = 1;
        let gray = vec![128u8; w * h];
        let comps = connected_components(&mask, &gray, w, h, 4.0, true);
        assert_eq!(comps.len(), 1);
        let c = &comps[0];
        assert_eq!((c.x0, c.y0, c.x1, c.y1), (3, 5, 7, 8));
        assert_eq!(c.area, 20);
    }

    #[test]
    fn light_background_is_inverted() {
        assert!(is_light_background(&vec![240u8; 100]));
        assert!(!is_light_background(&vec![24u8; 100]));
        let mut mixed = vec![250u8; 60];
        mixed.extend(vec![10u8; 40]);
        assert!(is_light_background(&mixed));
    }

    /// Manual probe: `GELGENIE_MODEL=... GELGENIE_GRAY=... cargo test -- --ignored`.
    /// The gray file is raw row-major 8-bit data; width/height are passed below.
    #[test]
    #[ignore]
    fn real_western_blot_finds_five_lanes() {
        let model = std::env::var("GELGENIE_MODEL").expect("GELGENIE_MODEL");
        let gray_path = std::env::var("GELGENIE_GRAY").expect("GELGENIE_GRAY");
        let gray = std::fs::read(gray_path).expect("read gray");
        let session = GelGenieSession::load(std::path::Path::new(&model)).expect("load model");
        let result = session
            .segment(&gray, 485, 595, None)
            .expect("segment fixture");
        println!(
            "bands={} lanes={} run_ms={:.0}",
            result.bands.len(),
            result.lanes.len(),
            result.run_ms
        );
        for (index, band) in result.bands.iter().enumerate() {
            println!(
                "band {index}: x={:.3} y={:.3} w={:.3} h={:.3} area={:.5} intensity={:.3} lane={}",
                band.x, band.y, band.width, band.height, band.area, band.intensity, band.lane
            );
        }
        for (index, lane) in result.lanes.iter().enumerate() {
            println!(
                "lane {index}: x={:.3} width={:.3} bands={}",
                lane.x,
                lane.width,
                lane.bands.len()
            );
        }
        assert_eq!(
            result.lanes.len(),
            5,
            "expected five lanes, got {}",
            result.lanes.len()
        );
    }

    #[test]
    fn bands_in_one_lane_cluster_together() {
        let band = |x: f32, width: f32, area: f32| Band {
            x,
            y: 0.5,
            width,
            height: 0.05,
            area,
            intensity: 0.5,
            lane: 0,
        };
        let bands = vec![
            band(0.10, 0.08, 0.01),
            band(0.11, 0.07, 0.01),
            band(0.30, 0.08, 0.01),
            band(0.51, 0.08, 0.01),
            band(0.70, 0.08, 0.01),
            band(0.88, 0.08, 0.01),
        ];
        let (bands, lanes) = assign_lanes(bands);
        assert_eq!(lanes.len(), 5);
        assert_eq!(lanes[0].bands.len(), 2);
        assert_eq!(bands.iter().filter(|b| b.lane == 0).count(), 2);
    }

    /// Band boxes observed on the five-lane western-blot fixture; the wide
    /// lane-1 smear must stay one lane while the four other lanes stay apart.
    #[test]
    fn real_western_blot_band_boxes_form_five_lanes() {
        let boxes: &[(f32, f32)] = &[
            (0.062, 0.035),
            (0.052, 0.157),
            (0.049, 0.175),
            (0.074, 0.130),
            (0.142, 0.064),
            (0.225, 0.192),
            (0.431, 0.192),
            (0.447, 0.159),
            (0.656, 0.058),
            (0.619, 0.171),
            (0.810, 0.169),
        ];
        let bands = boxes
            .iter()
            .map(|&(x, width)| Band {
                x,
                y: 0.5,
                width,
                height: 0.02,
                area: 0.001,
                intensity: 0.5,
                lane: 0,
            })
            .collect();
        let (_, lanes) = assign_lanes(bands);
        assert_eq!(lanes.len(), 5);
        assert!((lanes[0].x - 0.049).abs() < 1e-6);
        assert!((lanes[4].x - 0.810).abs() < 1e-6);
    }
}
