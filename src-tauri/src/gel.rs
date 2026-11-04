// Gel image binarization for lane/band detection. Runs on the native side
// because a full-frame threshold plus morphology is much faster here than in
// the webview, and it keeps the 13 MB OpenCV.js wasm out of the bundle.

use base64::Engine as _;
use image::{GrayImage, Luma};
use imageproc::contrast::adaptive_threshold;
use imageproc::distance_transform::Norm;
use imageproc::morphology::open;
use serde::Deserialize;

/// Tuning passed by a stain preset or the advanced detection panel. Every
/// field is optional so the original three-argument command still works.
#[derive(Debug, Clone, Copy, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BinarizeOptions {
    /// 0 or missing = auto, 1 = bright bands, -1 = dark bands.
    pub polarity: Option<i32>,
    /// Required margin over the local mean. Must stay negative.
    pub delta: Option<i32>,
    /// Morphological opening radius; 0 keeps specks.
    pub open_radius: Option<u32>,
    /// Adaptive window radius; 0 or missing = size-derived default.
    pub radius: Option<u32>,
    /// Border zeroing width; 0 or missing = radius-derived default.
    pub border: Option<u32>,
}

/// Signal polarity from the central region: compare how far the dark and
/// bright tails reach from the median. A gradient background spreads across
/// many histogram bins, so the mode is not a reliable background marker, but
/// the tail that reaches further is always the bands. The central window keeps
/// a black scanner surround out of the vote.
fn bright_signal(gray: &GrayImage) -> bool {
    let (width, height) = gray.dimensions();
    let x0 = width / 10;
    let x1 = (width - width / 10).max(x0 + 1);
    let y0 = height / 10;
    let y1 = (height - height / 10).max(y0 + 1);
    let mut hist = [0u32; 256];
    let mut count = 0u32;
    for y in y0..y1 {
        for x in x0..x1 {
            hist[gray.get_pixel(x, y)[0] as usize] += 1;
            count += 1;
        }
    }
    if count == 0 {
        return true;
    }
    let quantile = |q: f32| -> f32 {
        let target = count as f32 * q;
        let mut acc = 0u32;
        for (i, bucket) in hist.iter().enumerate() {
            acc += bucket;
            if acc as f32 >= target {
                return i as f32 / 255.0;
            }
        }
        1.0
    };
    let low = quantile(0.01);
    let median = quantile(0.5);
    let high = quantile(0.99);
    high - median >= median - low
}

/// Threshold one grayscale plane. `adaptive_threshold` measures against the
/// local mean, so uneven transilluminator glow does not need a separate
/// background model. Returns the mask and the detected polarity.
#[cfg(test)]
pub fn binarize_plane(gray: &GrayImage) -> (GrayImage, bool) {
    binarize_plane_with(gray, None)
}

pub fn binarize_plane_with(gray: &GrayImage, options: Option<BinarizeOptions>) -> (GrayImage, bool) {
    let (width, height) = gray.dimensions();
    let opts = options.unwrap_or_default();
    // The preset can force the polarity when a colour channel makes the bands
    // obvious but the tail test would still guess wrong.
    let bright = match opts.polarity {
        Some(1) => true,
        Some(-1) => false,
        _ => bright_signal(gray),
    };

    let mut work = gray.clone();
    if !bright {
        for pixel in work.pixels_mut() {
            pixel[0] = 255 - pixel[0];
        }
    }

    // The window must be wider than a band, otherwise the band raises its own
    // local mean and disappears from the threshold.
    let side = width.min(height);
    let auto_radius = ((side as f32 / 24.0).round() as u32)
        .max(16)
        .min((side / 2).max(1))
        .max(1);
    let radius = opts
        .radius
        .filter(|r| *r > 0)
        .map(|r| r.clamp(1, (side / 2).max(1)))
        .unwrap_or(auto_radius);
    // Negative delta requires pixels to beat the local mean by a margin; with
    // a positive value a flat background would pass the test wholesale. A more
    // sensitive preset lowers the margin.
    let delta = opts.delta.unwrap_or(-8).clamp(-64, -1);
    let mut mask = adaptive_threshold(&work, radius, delta);
    let open_radius = opts.open_radius.unwrap_or(1).min(4);
    if open_radius > 0 {
        mask = open(&mask, Norm::LInf, open_radius as u8);
    }

    // The adaptive window is truncated at the frame edge, which biases the
    // local mean there and produces a full-height false lane. Drop the same
    // radius on every side.
    let border = opts
        .border
        .filter(|b| *b > 0)
        .map(|b| b.min(side / 3))
        .unwrap_or_else(|| radius.max(2));
    for y in 0..height {
        for x in 0..width {
            if x < border || y < border || x >= width.saturating_sub(border) || y >= height.saturating_sub(border) {
                mask.put_pixel(x, y, Luma([0]));
            }
        }
    }
    (mask, bright)
}

/// Binarize a `width * height` 8-bit grayscale plane. The plane travels as
/// base64 and the mask returns as raw bytes, so neither side pays for a JSON
/// array of a few million numbers.
#[tauri::command]
pub fn binarize_gel(
    gray: String,
    width: u32,
    height: u32,
    options: Option<BinarizeOptions>,
) -> Result<tauri::ipc::Response, String> {
    if width == 0 || height == 0 {
        return Err("empty image".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(gray)
        .map_err(|err| format!("base64: {err}"))?;
    let expected = (width as usize)
        .checked_mul(height as usize)
        .ok_or_else(|| "image dimensions overflow".to_string())?;
    if bytes.len() != expected {
        return Err(format!("expected {expected} gray bytes, got {}", bytes.len()));
    }
    let image = GrayImage::from_raw(width, height, bytes).ok_or_else(|| "invalid gray image".to_string())?;
    let (mask, _) = binarize_plane_with(&image, options);
    Ok(tauri::ipc::Response::new(mask.into_raw()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gel(band: u8, background: (u8, u8), lanes: &[f32]) -> GrayImage {
        let width = 240u32;
        let height = 180u32;
        let mut img = GrayImage::new(width, height);
        for y in 0..height {
            for x in 0..width {
                let t = x as f32 / (width - 1) as f32;
                let value = background.0 as f32 + (background.1 - background.0) as f32 * t;
                img.put_pixel(x, y, Luma([value.round() as u8]));
            }
        }
        for &lane in lanes {
            let x0 = ((lane - 0.04) * width as f32).round() as u32;
            let x1 = ((lane + 0.04) * width as f32).round() as u32;
            for &row in &[0.3f32, 0.5, 0.7] {
                let y0 = ((row - 0.03) * height as f32).round() as u32;
                let y1 = ((row + 0.03) * height as f32).round() as u32;
                for y in y0..y1 {
                    for x in x0..x1 {
                        img.put_pixel(x, y, Luma([band]));
                    }
                }
            }
        }
        img
    }

    fn on_fraction(mask: &GrayImage) -> f32 {
        let on = mask.pixels().filter(|p| p[0] > 0).count() as f32;
        on / (mask.width() * mask.height()) as f32
    }

    #[test]
    fn bright_bands_on_a_dark_gradient() {
        let img = gel(220, (20, 45), &[0.15, 0.38, 0.62, 0.85]);
        let (mask, bright) = binarize_plane(&img);
        assert!(bright);
        let on = on_fraction(&mask);
        // 4 lanes x 3 bands x ~19px wide x ~11px tall = ~2500 px of 43200.
        assert!(on > 0.03 && on < 0.2, "foreground fraction {on}");
    }

    #[test]
    fn dark_bands_on_a_light_gradient() {
        let img = gel(30, (215, 240), &[0.15, 0.38, 0.62, 0.85]);
        let (mask, bright) = binarize_plane(&img);
        assert!(!bright);
        let on = on_fraction(&mask);
        assert!(on > 0.03 && on < 0.2, "foreground fraction {on}");
    }

    #[test]
    fn tiny_planes_do_not_panic() {
        // Crops can be much smaller than the adaptive radius; the radius must
        // collapse without tripping the clamp bounds.
        let image = GrayImage::from_raw(4, 4, vec![0, 255, 255, 0, 255, 0, 0, 255, 255, 0, 0, 255, 0, 255, 255, 0])
            .unwrap();
        let (mask, _) = binarize_plane(&image);
        assert_eq!(mask.dimensions(), (4, 4));
    }

    #[test]
    fn default_options_match_the_original_command() {
        let img = gel(220, (20, 45), &[0.15, 0.38, 0.62, 0.85]);
        let (auto, auto_polarity) = binarize_plane(&img);
        let (explicit, explicit_polarity) = binarize_plane_with(&img, Some(BinarizeOptions::default()));
        assert_eq!(auto_polarity, explicit_polarity);
        assert_eq!(auto.into_raw(), explicit.into_raw());
    }

    #[test]
    fn forced_polarity_overrides_the_tail_vote() {
        let img = gel(220, (20, 45), &[0.15, 0.38, 0.62, 0.85]);
        let (_, bright) = binarize_plane_with(
            &img,
            Some(BinarizeOptions {
                polarity: Some(-1),
                ..BinarizeOptions::default()
            }),
        );
        assert!(!bright);
        let (_, dark) = binarize_plane_with(
            &img,
            Some(BinarizeOptions {
                polarity: Some(1),
                ..BinarizeOptions::default()
            }),
        );
        assert!(dark);
    }

    #[test]
    fn a_stricter_delta_keeps_no_more_signal() {
        let img = gel(220, (20, 45), &[0.15, 0.38, 0.62, 0.85]);
        let (loose, _) = binarize_plane_with(
            &img,
            Some(BinarizeOptions {
                delta: Some(-4),
                ..BinarizeOptions::default()
            }),
        );
        let (strict, _) = binarize_plane_with(
            &img,
            Some(BinarizeOptions {
                delta: Some(-20),
                ..BinarizeOptions::default()
            }),
        );
        assert!(on_fraction(&strict) <= on_fraction(&loose));
    }

    #[test]
    fn an_empty_gradient_has_no_signal() {
        let mut clean = GrayImage::new(240, 180);
        for y in 0..clean.height() {
            for x in 0..clean.width() {
                let value = 40.0 + 160.0 * x as f32 / (clean.width() - 1) as f32;
                clean.put_pixel(x, y, Luma([value.round() as u8]));
            }
        }
        let (mask, _) = binarize_plane(&clean);
        assert!(on_fraction(&mask) < 0.01);
    }
}
