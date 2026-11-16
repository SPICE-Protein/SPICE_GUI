//! Direct risk-database pulls and the local biorisk screen.
//!
//! Two upstream databases, fetched by the GUI itself:
//!
//! * NCBI AMRFinderPlus reference gene catalogue — exact DNA signatures for
//!   acquired resistance, stored as a local JSON catalogue.
//! * IBBIS Commec biorisk database — curated profile HMMs for toxins,
//!   regulated pathogens and virulence factors. Screening uses `rustyhmmer`, a
//!   pure-Rust port of HMMER 3.4, so no native binary is shipped and every
//!   desktop target runs the same engine.
//!
//! The Commec HMM is 245 MB and is installed on first use, not bundled. The
//! screen runs the biorisk step only; Commec's taxonomy and low-concern steps
//! need the full NCBI nt/nr databases and are outside this application.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::Emitter;
use tauri::Manager;

const AMR_DEFAULT_ENDPOINT: &str =
    "https://ftp.ncbi.nlm.nih.gov/pathogen/Antimicrobial_resistance/AMRFinderPlus/database/latest/";
const COMMEC_REPO: &str = "ibbis-bio/commec-databases";
const COMMEC_PINNED_TAG: &str = "v1.1.0";
const COMMEC_LICENCE: &str = "MIT (IBBIS)";
const AMR_LICENCE: &str = "Public domain (US Government Work)";
const COMMEC_MIN_QUERY: usize = 50;

/// Values published by the Commec screen; kept identical to
/// `commec/config/constants.py` so a verdict here means what it means there.
const BIORISK_SHORT_QUERY_NT_THRESHOLD: f64 = 200.0;
const BIORISK_SHORT_QUERY_EVALUE_EXPONENT: f64 = 2.598;
const BIORISK_LONG_QUERY_EVALUE_THRESHOLD: f64 = 1e-20;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AmrRecord {
    pub gene: String,
    /// The catalogue's own class: AMR, VIRULENCE or STRESS.
    pub kind: String,
    pub allele: String,
    pub description: String,
    pub class: String,
    pub subclass: String,
    pub accession: String,
    pub pattern: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RiskCatalog<T> {
    pub source: String,
    /// "network", "cache" or "builtin".
    pub origin: String,
    pub version: String,
    pub fetched_at: u64,
    pub licence: String,
    pub endpoint: Option<String>,
    pub error: Option<String>,
    pub records: Vec<T>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct CommecStatus {
    pub installed: bool,
    pub version: String,
    pub path: Option<String>,
    pub models: usize,
    pub must_flag_models: usize,
    pub fetched_at: u64,
    pub licence: String,
    pub source_url: String,
    pub sha256: String,
    pub error: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BiosecEnvelope {
    pub amr: RiskCatalog<AmrRecord>,
    pub commec: CommecStatus,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BioriskHit {
    pub model: String,
    pub description: String,
    pub must_flag: bool,
    pub category: String,
    pub evalue: f64,
    pub score: f32,
    pub coverage: f32,
    pub frame: u8,
    pub strand: String,
    pub start: usize,
    pub end: usize,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct InstallProgress {
    phase: String,
    downloaded: u64,
    total: u64,
}

struct CachedAnnotator {
    path: PathBuf,
    modified: u64,
    annotator: rustyhmmer::api::HmmAnnotator,
    last_used: Instant,
}

/// The pressed profile database is 245 MB and costs about 1 GB of memory while
/// it is held, so an unused copy is released instead of staying for the whole
/// session. Reloading takes well under a second.
const ANNOTATOR_IDLE_LIMIT: Duration = Duration::from_secs(600);
const ANNOTATOR_REAP_INTERVAL: Duration = Duration::from_secs(60);

/// Shared HMM cache. Loading the pressed database costs a moment, so it is
/// reused across scans and dropped when it has been idle or replaced.
pub struct BiosecState {
    cache: Arc<Mutex<Option<CachedAnnotator>>>,
}

impl Default for BiosecState {
    fn default() -> Self {
        let cache: Arc<Mutex<Option<CachedAnnotator>>> = Arc::new(Mutex::new(None));
        let watched: Arc<Mutex<Option<CachedAnnotator>>> = cache.clone();
        std::thread::spawn(move || loop {
            std::thread::sleep(ANNOTATOR_REAP_INTERVAL);
            let Ok(mut guard) = watched.lock() else {
                return;
            };
            if guard
                .as_ref()
                .is_some_and(|cached| cached.last_used.elapsed() > ANNOTATOR_IDLE_LIMIT)
            {
                *guard = None;
            }
        });
        Self { cache }
    }
}

fn now_seconds() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn data_dir(app: &tauri::AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_local_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir());
    let _ = std::fs::create_dir_all(&dir);
    dir
}

fn commec_dir(app: &tauri::AppHandle) -> PathBuf {
    let dir = data_dir(app).join("commec");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

fn http_client(timeout: Duration) -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(timeout)
        .user_agent("Lexicase biosecurity database sync")
        .build()
        .map_err(|e| e.to_string())
}

/// Bulk downloads outlive any timeout short enough to catch a stall: 245 MB at
/// 30 KB/s takes over two hours. The total limit is set for that floor, and the
/// progress event is what tells the user whether bytes are still arriving.
fn download_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(30))
        .timeout(Duration::from_secs(4 * 3600))
        .user_agent("Lexicase biosecurity database sync")
        .build()
        .map_err(|e| e.to_string())
}

fn fetch_text(url: &str, timeout: Duration) -> Result<String, String> {
    let response = http_client(timeout)?
        .get(url)
        .send()
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("HTTP {} for {url}", response.status()));
    }
    response.text().map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// AMRFinderPlus
// ---------------------------------------------------------------------------

fn amr_endpoint(value: Option<String>) -> String {
    let raw = value
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| AMR_DEFAULT_ENDPOINT.to_string());
    if raw.ends_with('/') {
        raw
    } else {
        format!("{raw}/")
    }
}

fn amr_builtin() -> Vec<AmrRecord> {
    let rows = [
        ("blaTEM-1", "Beta-lactam (penicillins)", "ATCAGTCAACC"),
        ("aph(3')-Ia (kanR)", "Aminoglycoside (kanamycin)", "ATGAGCCATATTCAACGGG"),
        ("tet(A)", "Tetracycline", "GTGATCCTGGG"),
        ("catA1", "Phenicol (chloramphenicol)", "ATGGAGAAAAAAATCACT"),
        ("aac(6')-Ib-cr", "Aminoglycoside, fluoroquinolone", "CCGCTCGTGT"),
    ];
    rows.iter()
        .map(|(gene, class, pattern)| AmrRecord {
            gene: (*gene).to_string(),
            kind: "AMR".to_string(),
            allele: (*gene).to_string(),
            description: (*class).to_string(),
            class: (*class).to_string(),
            subclass: String::new(),
            accession: format!("sample:{gene}"),
            pattern: (*pattern).to_string(),
        })
        .collect()
}

#[derive(Clone)]
struct GeneRow {
    allele: String,
    product: String,
    kind: String,
    class: String,
    subclass: String,
}

fn column_index(headers: &csv::StringRecord, name: &str) -> Option<usize> {
    headers.iter().position(|h| h == name)
}

fn read_gene_catalog(text: &str) -> HashMap<String, GeneRow> {
    let mut map = HashMap::new();
    let mut reader = csv::ReaderBuilder::new()
        .delimiter(b'\t')
        .flexible(true)
        .from_reader(text.as_bytes());
    let Ok(headers) = reader.headers().cloned() else {
        return map;
    };
    let idx = |name: &str| column_index(&headers, name);
    let (Some(allele_idx), Some(product_idx), Some(class_idx)) = (
        idx("allele"),
        idx("product_name"),
        idx("class"),
    ) else {
        return map;
    };
    let subclass_idx = idx("subclass");
    let kind_idx = idx("type");
    let accession_cols: Vec<usize> = [
        "refseq_protein_accession",
        "genbank_protein_accession",
        "refseq_nucleotide_accession",
        "genbank_nucleotide_accession",
    ]
    .iter()
    .filter_map(|name| idx(name))
    .collect();

    for record in reader.records().flatten() {
        let allele = record.get(allele_idx).unwrap_or("").trim().to_string();
        let product = record.get(product_idx).unwrap_or("").trim().to_string();
        let class = record.get(class_idx).unwrap_or("").trim().to_string();
        let subclass = subclass_idx
            .and_then(|i| record.get(i))
            .unwrap_or("")
            .trim()
            .to_string();
        let kind = kind_idx
            .and_then(|i| record.get(i))
            .unwrap_or("")
            .trim()
            .to_ascii_uppercase();
        let row = GeneRow {
            allele,
            product,
            kind,
            class,
            subclass,
        };
        for col in &accession_cols {
            if let Some(accession) = record.get(*col) {
                let accession = accession.trim();
                if !accession.is_empty() && accession != "NA" && accession != "-" {
                    map.insert(accession.to_string(), row.clone());
                }
            }
        }
    }
    map
}

fn parse_fasta(text: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut header = String::new();
    let mut sequence = String::new();
    for line in text.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix('>') {
            if !header.is_empty() && !sequence.is_empty() {
                out.push((header.clone(), sequence.clone()));
            }
            header = rest.to_string();
            sequence.clear();
        } else if !line.is_empty() {
            sequence.push_str(line);
        }
    }
    if !header.is_empty() && !sequence.is_empty() {
        out.push((header, sequence));
    }
    out
}

fn strip_coordinate_suffix(product: &str) -> String {
    match product.rsplit_once(' ') {
        Some((head, tail))
            if tail.contains(':') && tail.chars().any(|c| c.is_ascii_digit()) =>
        {
            head.to_string()
        }
        _ => product.to_string(),
    }
}

fn build_amr_records(fasta: &str, catalog: &HashMap<String, GeneRow>) -> Vec<AmrRecord> {
    let mut records = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for (header, raw_sequence) in parse_fasta(fasta) {
        let fields: Vec<&str> = header.split('|').collect();
        let accession = fields.first().copied().unwrap_or("").trim();
        let gene = fields.get(4).copied().unwrap_or("").trim();
        let header_allele = fields.get(5).copied().unwrap_or("").trim();
        let header_product = fields
            .get(6)
            .copied()
            .unwrap_or("")
            .trim();
        let pattern = raw_sequence.trim().to_ascii_uppercase();
        if pattern.len() < 10 || !pattern.bytes().all(|b| matches!(b, b'A' | b'C' | b'G' | b'T')) {
            continue;
        }
        let row = catalog.get(accession);
        let allele = row
            .map(|r| r.allele.clone())
            .filter(|v| !v.is_empty())
            .unwrap_or_else(|| {
                if header_allele.is_empty() {
                    gene.to_string()
                } else {
                    header_allele.to_string()
                }
            });
        let description = row
            .map(|r| r.product.clone())
            .filter(|v| !v.is_empty())
            .unwrap_or_else(|| strip_coordinate_suffix(header_product));
        let class = row.map(|r| r.class.clone()).unwrap_or_default();
        let subclass = row.map(|r| r.subclass.clone()).unwrap_or_default();
        let key = format!("{accession}:{pattern}");
        if !seen.insert(key) {
            continue;
        }
        records.push(AmrRecord {
            gene: if gene.is_empty() {
                allele.clone()
            } else {
                gene.to_string()
            },
            allele,
            description,
            class,
            subclass,
            kind: row
                .map(|r| r.kind.clone())
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| "AMR".to_string()),
            accession: if accession.is_empty() {
                format!("seq:{}", records.len())
            } else {
                accession.to_string()
            },
            pattern,
        });
    }
    records
}

fn read_amr_catalog(path: &Path) -> Option<RiskCatalog<AmrRecord>> {
    let text = std::fs::read_to_string(path).ok()?;
    let mut catalog: RiskCatalog<AmrRecord> = serde_json::from_str(&text).ok()?;
    if catalog.records.is_empty() {
        return None;
    }
    catalog.origin = "cache".to_string();
    Some(catalog)
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let text = serde_json::to_string(value).map_err(|e| e.to_string())?;
    std::fs::write(path, text).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn biosec_sync_amr(
    app: tauri::AppHandle,
    endpoint: Option<String>,
) -> Result<RiskCatalog<AmrRecord>, String> {
    let cache_path = data_dir(&app).join("amrfinder_catalog.json");
    let endpoint = amr_endpoint(endpoint);
    let cache_path_for_task = cache_path.clone();
    let endpoint_for_task = endpoint.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let version = fetch_text(
            &format!("{endpoint_for_task}version.txt"),
            Duration::from_secs(60),
        )?
        .trim()
        .to_string();
        let catalog_text = fetch_text(
            &format!("{endpoint_for_task}ReferenceGeneCatalog.txt"),
            Duration::from_secs(120),
        )?;
        let fasta = fetch_text(
            &format!("{endpoint_for_task}AMR_CDS.fa"),
            Duration::from_secs(300),
        )?;
        if version.is_empty() {
            return Err("version.txt was empty".to_string());
        }
        let genes = read_gene_catalog(&catalog_text);
        let records = build_amr_records(&fasta, &genes);
        if records.is_empty() {
            return Err("AMR_CDS.fa contained no usable DNA signatures".to_string());
        }
        let catalog = RiskCatalog {
            source: "amrfinder".to_string(),
            origin: "network".to_string(),
            version,
            fetched_at: now_seconds(),
            licence: AMR_LICENCE.to_string(),
            endpoint: Some(endpoint_for_task),
            error: None,
            records,
        };
        write_json(&cache_path_for_task, &catalog)?;
        Ok::<RiskCatalog<AmrRecord>, String>(catalog)
    })
    .await
    .map_err(|e| e.to_string())?;

    match result {
        Ok(catalog) => Ok(catalog),
        Err(error) => {
            if let Some(mut cached) = read_amr_catalog(&cache_path) {
                cached.error = Some(error);
                return Ok(cached);
            }
            Ok(RiskCatalog {
                source: "amrfinder".to_string(),
                origin: "builtin".to_string(),
                version: "builtin".to_string(),
                fetched_at: 0,
                licence: "bundled-sample".to_string(),
                endpoint: Some(endpoint),
                error: Some(error),
                records: amr_builtin(),
            })
        }
    }
}

// ---------------------------------------------------------------------------
// Commec installation
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct GithubRelease {
    tag_name: String,
}

fn latest_commec_tag() -> String {
    let url = format!("https://api.github.com/repos/{COMMEC_REPO}/releases/latest");
    fetch_text(&url, Duration::from_secs(20))
        .ok()
        .and_then(|text| serde_json::from_str::<GithubRelease>(&text).ok())
        .map(|release| release.tag_name)
        .filter(|tag| !tag.is_empty())
        .unwrap_or_else(|| COMMEC_PINNED_TAG.to_string())
}

fn parse_lfs_pointer(text: &str) -> Option<(String, u64)> {
    let mut sha = None;
    let mut size = None;
    for line in text.lines() {
        if let Some(value) = line.strip_prefix("oid sha256:") {
            sha = Some(value.trim().to_string());
        } else if let Some(value) = line.strip_prefix("size ") {
            size = value.trim().parse::<u64>().ok();
        }
    }
    Some((sha?, size?))
}

fn download_verified(
    app: &tauri::AppHandle,
    url: &str,
    destination: &Path,
    expected_sha: &str,
    expected_size: u64,
) -> Result<(), String> {
    let mut response = download_client()?
        .get(url)
        .send()
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("HTTP {} for {url}", response.status()));
    }
    let total = response.content_length().unwrap_or(expected_size);
    let temp = destination.with_extension("part");
    let mut file = std::fs::File::create(&temp).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut downloaded = 0u64;
    let mut last_emit = 0u64;
    let mut buffer = vec![0u8; 1 << 16];
    loop {
        let read = response.read(&mut buffer).map_err(|e| e.to_string())?;
        if read == 0 {
            break;
        }
        file.write_all(&buffer[..read]).map_err(|e| e.to_string())?;
        hasher.update(&buffer[..read]);
        downloaded += read as u64;
        if downloaded - last_emit >= 1024 * 1024 {
            last_emit = downloaded;
            let _ = app.emit(
                "biosec-install-progress",
                InstallProgress {
                    phase: "download".to_string(),
                    downloaded,
                    total,
                },
            );
        }
    }
    drop(file);
    if expected_size > 0 && downloaded != expected_size {
        let _ = std::fs::remove_file(&temp);
        return Err(format!(
            "downloaded {downloaded} bytes, expected {expected_size}"
        ));
    }
    let observed = format!("{:x}", hasher.finalize());
    if observed != expected_sha {
        let _ = std::fs::remove_file(&temp);
        return Err(format!(
            "checksum mismatch: expected {expected_sha}, got {observed}"
        ));
    }
    std::fs::rename(&temp, destination).map_err(|e| e.to_string())?;
    Ok(())
}

fn download_plain(app: &tauri::AppHandle, url: &str, destination: &Path) -> Result<(), String> {
    let mut response = download_client()?
        .get(url)
        .send()
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("HTTP {} for {url}", response.status()));
    }
    let total = response.content_length().unwrap_or(0);
    let temp = destination.with_extension("part");
    let mut file = std::fs::File::create(&temp).map_err(|e| e.to_string())?;
    let mut downloaded = 0u64;
    let mut last_emit = 0u64;
    let mut buffer = vec![0u8; 1 << 16];
    loop {
        let read = response.read(&mut buffer).map_err(|e| e.to_string())?;
        if read == 0 {
            break;
        }
        file.write_all(&buffer[..read]).map_err(|e| e.to_string())?;
        downloaded += read as u64;
        if downloaded - last_emit >= 512 * 1024 {
            last_emit = downloaded;
            let _ = app.emit(
                "biosec-install-progress",
                InstallProgress {
                    phase: "annotations".to_string(),
                    downloaded,
                    total,
                },
            );
        }
    }
    drop(file);
    std::fs::rename(&temp, destination).map_err(|e| e.to_string())?;
    Ok(())
}

fn extract_biorisk_from_zip(zip_path: &Path, destination: &Path) -> Result<(), String> {
    let file = std::fs::File::open(zip_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    let mut found_hmm = false;
    let mut found_annotations = false;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|e| e.to_string())?;
        let name = entry.name().to_string();
        let target = if name.ends_with("biorisk/biorisk.hmm.h3m") {
            found_hmm = true;
            Some(destination.join("biorisk.hmm.h3m"))
        } else if name.ends_with("biorisk/biorisk_annotations.csv") {
            found_annotations = true;
            Some(destination.join("biorisk_annotations.csv"))
        } else {
            None
        };
        if let Some(path) = target {
            let mut out = std::fs::File::create(path).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
        }
    }
    if !found_hmm || !found_annotations {
        return Err("the release archive did not contain the biorisk database".to_string());
    }
    Ok(())
}

fn read_annotations(path: &Path) -> Result<Vec<(String, String, bool)>, String> {
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(true)
        .from_path(path)
        .map_err(|e| e.to_string())?;
    let mut rows = Vec::new();
    for record in reader.records() {
        let record = record.map_err(|e| e.to_string())?;
        let id = record.get(0).unwrap_or("").trim().to_string();
        if id.is_empty() {
            continue;
        }
        let description = record.get(1).unwrap_or("").trim().to_string();
        let must_flag = record.get(2).unwrap_or("").trim().eq_ignore_ascii_case("true");
        rows.push((id, description, must_flag));
    }
    Ok(rows)
}

fn read_commec_status(app: &tauri::AppHandle) -> CommecStatus {
    let dir = commec_dir(app);
    let status_path = dir.join("commec_status.json");
    let mut status: CommecStatus = std::fs::read_to_string(&status_path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default();
    let hmm = dir.join("biorisk.hmm.h3m");
    let annotations = dir.join("biorisk_annotations.csv");
    status.installed = hmm.is_file() && annotations.is_file();
    if !status.installed {
        status.error = Some("biorisk database is not installed".to_string());
    } else {
        status.path = Some(dir.to_string_lossy().to_string());
    }
    status
}

fn write_commec_status(app: &tauri::AppHandle, status: &CommecStatus) -> Result<(), String> {
    write_json(&commec_dir(app).join("commec_status.json"), status)
}

fn install_commec(app: &tauri::AppHandle, cache: &Mutex<Option<CachedAnnotator>>) -> Result<CommecStatus, String> {
    let dir = commec_dir(app);
    let tag = latest_commec_tag();
    let base = format!("https://raw.githubusercontent.com/{COMMEC_REPO}/{tag}/commec-dbs/biorisk");
    let media = format!("https://media.githubusercontent.com/media/{COMMEC_REPO}/{tag}/commec-dbs/biorisk");

    let mut version = tag.trim_start_matches('v').to_string();
    let sha256: String;
    let mut source_url = format!("{media}/biorisk.hmm.h3m");

    // "Check for update" must not re-download 245 MB to confirm the copy that
    // is already on disk is current.
    let existing = read_commec_status(app);
    if existing.installed
        && !version.is_empty()
        && existing.version.eq_ignore_ascii_case(&version)
    {
        return Ok(existing);
    }

    // Preferred path: the LFS object behind the release, 245 MB instead of the
    // 313 MB archive. Its pointer carries the SHA-256, so the transfer is
    // verified before anything replaces the working copy.
    let pointer = fetch_text(&format!("{base}/biorisk.hmm.h3m"), Duration::from_secs(30))
        .ok()
        .and_then(|text| parse_lfs_pointer(&text));
    if let Some((expected_sha, expected_size)) = pointer {
        download_verified(
            app,
            &format!("{media}/biorisk.hmm.h3m"),
            &dir.join("biorisk.hmm.h3m"),
            &expected_sha,
            expected_size,
        )?;
        sha256 = expected_sha;
    } else {
        let archive = dir.join("commec-dbs.zip");
        source_url = format!(
            "https://github.com/{COMMEC_REPO}/releases/download/{tag}/commec-dbs.zip"
        );
        download_plain(app, &source_url, &archive)?;
        extract_biorisk_from_zip(&archive, &dir)?;
        let bytes = std::fs::read(dir.join("biorisk.hmm.h3m")).map_err(|e| e.to_string())?;
        sha256 = format!("{:x}", Sha256::digest(&bytes));
        let _ = std::fs::remove_file(&archive);
    }

    let annotations_path = dir.join("biorisk_annotations.csv");
    download_plain(
        app,
        &format!("{base}/biorisk_annotations.csv"),
        &annotations_path,
    )?;
    let annotations = read_annotations(&annotations_path)?;
    if annotations.is_empty() {
        return Err("biorisk_annotations.csv contained no rows".to_string());
    }
    if version.is_empty() {
        version = COMMEC_PINNED_TAG.trim_start_matches('v').to_string();
    }

    let status = CommecStatus {
        installed: true,
        version,
        path: Some(dir.to_string_lossy().to_string()),
        models: annotations.len(),
        must_flag_models: annotations.iter().filter(|(_, _, flag)| *flag).count(),
        fetched_at: now_seconds(),
        licence: COMMEC_LICENCE.to_string(),
        source_url,
        sha256,
        error: None,
    };
    write_commec_status(app, &status)?;
    if let Ok(mut guard) = cache.lock() {
        *guard = None;
    }
    let _ = app.emit(
        "biosec-install-progress",
        InstallProgress {
            phase: "done".to_string(),
            downloaded: 0,
            total: 0,
        },
    );
    Ok(status)
}

#[tauri::command]
pub async fn biosec_install_commec(
    app: tauri::AppHandle,
    state: tauri::State<'_, BiosecState>,
) -> Result<CommecStatus, String> {
    let app_for_task = app.clone();
    let cache = state.cache.clone();
    tauri::async_runtime::spawn_blocking(move || install_commec(&app_for_task, &cache))
        .await
        .map_err(|e| e.to_string())?
}

// ---------------------------------------------------------------------------
// Load and screen
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn biosec_load(app: tauri::AppHandle) -> BiosecEnvelope {
    let amr_path = data_dir(&app).join("amrfinder_catalog.json");
    let amr = read_amr_catalog(&amr_path).unwrap_or_else(|| RiskCatalog {
        source: "amrfinder".to_string(),
        origin: "builtin".to_string(),
        version: "builtin".to_string(),
        fetched_at: 0,
        licence: "bundled-sample".to_string(),
        endpoint: None,
        error: Some("the AMR catalogue has not been synced".to_string()),
        records: amr_builtin(),
    });
    BiosecEnvelope {
        amr,
        commec: read_commec_status(&app),
    }
}

fn reverse_complement(sequence: &str) -> String {
    sequence
        .bytes()
        .rev()
        .map(|base| match base {
            b'A' => 'T',
            b'C' => 'G',
            b'G' => 'C',
            b'T' => 'A',
            _ => 'N',
        })
        .collect()
}

fn translate_codon(codon: &[u8]) -> char {
    match codon {
        b"TTT" | b"TTC" => 'F',
        b"TTA" | b"TTG" | b"CTT" | b"CTC" | b"CTA" | b"CTG" => 'L',
        b"ATT" | b"ATC" | b"ATA" => 'I',
        b"ATG" => 'M',
        b"GTT" | b"GTC" | b"GTA" | b"GTG" => 'V',
        b"TCT" | b"TCC" | b"TCA" | b"TCG" | b"AGT" | b"AGC" => 'S',
        b"CCT" | b"CCC" | b"CCA" | b"CCG" => 'P',
        b"ACT" | b"ACC" | b"ACA" | b"ACG" => 'T',
        b"GCT" | b"GCC" | b"GCA" | b"GCG" => 'A',
        b"TAT" | b"TAC" => 'Y',
        b"CAT" | b"CAC" => 'H',
        b"CAA" | b"CAG" => 'Q',
        b"AAT" | b"AAC" => 'N',
        b"AAA" | b"AAG" => 'K',
        b"GAT" | b"GAC" => 'D',
        b"GAA" | b"GAG" => 'E',
        b"TGT" | b"TGC" => 'C',
        b"TGG" => 'W',
        b"CGT" | b"CGC" | b"CGA" | b"CGG" | b"AGA" | b"AGG" => 'R',
        b"GGT" | b"GGC" | b"GGA" | b"GGG" => 'G',
        _ => 'X',
    }
}

fn translate(sequence: &str) -> String {
    let bytes = sequence.as_bytes();
    let mut protein = String::with_capacity(bytes.len() / 3);
    for codon in bytes.chunks_exact(3) {
        let residue = translate_codon(codon);
        protein.push(if residue == '*' { 'X' } else { residue });
    }
    protein
}

/// Six-frame translation, identical to Commec's `Query._translate`:
/// frames 1-3 run from offsets 0/1/2 on the forward strand, frames 4-6 from
/// offsets 0/-1/-2 on the reverse complement, full codons only.
fn translate_six_frames(sequence: &str) -> Vec<(u8, String)> {
    let forward = sequence.to_ascii_uppercase();
    let reverse = reverse_complement(&forward);
    let length = forward.len();
    let mut frames = Vec::with_capacity(6);
    for offset in 0..3usize {
        if length < offset + 3 {
            continue;
        }
        let frame_len = 3 * ((length - offset) / 3);
        if frame_len == 0 {
            continue;
        }
        let f_start = offset;
        let f_end = offset + frame_len;
        frames.push((offset as u8 + 1, translate(&forward[f_start..f_end])));
        let r_start = length - offset - frame_len;
        let r_end = length - offset;
        frames.push((offset as u8 + 4, translate(&reverse[r_start..r_end])));
    }
    frames.sort_by_key(|(frame, _)| *frame);
    frames
}

/// Commec's `convert_protein_to_nucleotide_coords`, 1-based.
fn protein_to_nucleotide(frame: u8, start: i64, end: i64, sequence_length: usize) -> (usize, usize) {
    let start0 = start - 1;
    let end0 = end - 1;
    let length = sequence_length as i64;
    if frame <= 3 {
        let offset = frame as i64 - 1;
        (
            (start0 * 3 + offset + 1) as usize,
            (end0 * 3 + 2 + offset + 1) as usize,
        )
    } else {
        let offset = frame as i64 - 4;
        let nucleotide_start = start0 * 3 + offset;
        let nucleotide_end = end0 * 3 + 2 + offset;
        let reverse_offset = (sequence_length % 3) as i64;
        (
            (length - nucleotide_end - 1 + reverse_offset + 1) as usize,
            (length - nucleotide_start - 1 + reverse_offset + 1) as usize,
        )
    }
}

/// Commec's annotations carry one regulatory bit, not a taxonomy: a model is
/// either a must-flag sequence of concern or a lower-concern virulence factor.
/// Everything else about a hit is its description, which the frontend shows.
fn biorisk_category(must_flag: bool) -> &'static str {
    if must_flag {
        "biorisk"
    } else {
        "virulence"
    }
}

fn biorisk_evalue_threshold(nt_length: usize) -> f64 {
    if (nt_length as f64) < BIORISK_SHORT_QUERY_NT_THRESHOLD {
        1.0 / (1.0 + (nt_length as f64).powf(BIORISK_SHORT_QUERY_EVALUE_EXPONENT))
    } else {
        BIORISK_LONG_QUERY_EVALUE_THRESHOLD
    }
}

fn screen_impl(
    app: &tauri::AppHandle,
    cache: &Mutex<Option<CachedAnnotator>>,
    sequence: &str,
    // Commec screens each record exactly as written, so circularity is not
    // modelled here either: a gene crossing the origin can be missed. Rotating
    // the query would invent coordinates the document does not have.
    _circular: bool,
) -> Result<Vec<BioriskHit>, String> {
    screen_with_dir(cache, &commec_dir(app), sequence)
}

fn screen_with_dir(
    cache: &Mutex<Option<CachedAnnotator>>,
    dir: &Path,
    sequence: &str,
) -> Result<Vec<BioriskHit>, String> {
    let sequence = sequence.to_ascii_uppercase();
    if sequence.len() < COMMEC_MIN_QUERY {
        return Ok(Vec::new());
    }
    let hmm_path = dir.join("biorisk.hmm.h3m");
    let annotations_path = dir.join("biorisk_annotations.csv");
    if !hmm_path.is_file() || !annotations_path.is_file() {
        return Err("biorisk database is not installed".to_string());
    }
    let annotations: HashMap<String, (String, bool)> = read_annotations(&annotations_path)?
        .into_iter()
        .map(|(id, description, must_flag)| (id, (description, must_flag)))
        .collect();

    let frames = translate_six_frames(&sequence);
    if frames.is_empty() {
        return Ok(Vec::new());
    }
    let seqs: Vec<rustyhmmer::seqio::Seq> = frames
        .iter()
        .map(|(frame, protein)| {
            rustyhmmer::seqio::Seq::from_amino(
                format!("frame_{frame}"),
                String::new(),
                protein,
            )
        })
        .collect();

    let modified = std::fs::metadata(&hmm_path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|m| m.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let mut guard = cache
        .lock()
        .map_err(|_| "biorisk cache is poisoned".to_string())?;
    let needs_reload = guard
        .as_ref()
        .map(|cached| cached.path != hmm_path || cached.modified != modified)
        .unwrap_or(true);
    if needs_reload {
        let annotator = rustyhmmer::api::HmmAnnotator::from_hmm_file(
            hmm_path.to_str().unwrap_or_default(),
        )?
        .with_cutoff(rustyhmmer::api::Cutoff::Evalue(1e-3));
        *guard = Some(CachedAnnotator {
            path: hmm_path.clone(),
            modified,
            annotator,
            last_used: Instant::now(),
        });
    }
    let cached = guard.as_mut().expect("annotator was just loaded");
    cached.last_used = Instant::now();
    let model_count = cached.annotator.len() as f64;
    let search_space = seqs.len() as f64;
    // `search` is hmmsearch-shaped: profiles are queries and the target database
    // is the six frames, so its E-value uses Z = 6. Commec runs hmmscan, where
    // Z is the number of models. Convert before applying its thresholds.
    let evalue_scale = model_count / search_space;
    let threshold = biorisk_evalue_threshold(sequence.len());

    let hits = cached.annotator.search(&seqs);
    let mut results: Vec<BioriskHit> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for hit in hits {
        let evalue = hit.seq_evalue * evalue_scale;
        if !(evalue < threshold) {
            continue;
        }
        let frame = hit
            .target_name
            .rsplit('_')
            .next()
            .and_then(|value| value.parse::<u8>().ok())
            .unwrap_or(0);
        if frame == 0 {
            continue;
        }
        let (description, must_flag) = annotations
            .get(&hit.query_name)
            .cloned()
            .unwrap_or_else(|| (hit.query_name.clone(), false));
        let category = biorisk_category(must_flag);
        for domain in &hit.domains {
            if domain.c_evalue > 10.0 || domain.ali_from < 1 || domain.ali_to < domain.ali_from {
                continue;
            }
            let (start, end) =
                protein_to_nucleotide(frame, domain.ali_from, domain.ali_to, sequence.len());
            if start == 0 || end == 0 || start > end || end > sequence.len() {
                continue;
            }
            let key = format!("{}:{frame}:{start}:{end}", hit.query_name);
            if !seen.insert(key) {
                continue;
            }
            let coverage = if hit.model_len > 0 {
                (domain.hmm_to - domain.hmm_from + 1) as f32 / hit.model_len as f32
            } else {
                0.0
            };
            results.push(BioriskHit {
                model: hit.query_name.clone(),
                description: description.clone(),
                must_flag,
                category: category.to_string(),
                evalue,
                score: domain.score,
                coverage,
                frame,
                strand: if frame <= 3 { "+".to_string() } else { "-".to_string() },
                start,
                end,
            });
        }
    }

    // Commec's remove_overlaps: a hit fully contained in a stronger hit on the
    // same frame is dropped. Models are not merged; only the weaker span goes.
    let mut keep = vec![true; results.len()];
    for i in 0..results.len() {
        for j in 0..results.len() {
            if i == j || !keep[i] {
                continue;
            }
            if results[i].frame == results[j].frame
                && results[i].start <= results[j].start
                && results[i].end >= results[j].end
                && results[i].score > results[j].score
            {
                keep[j] = false;
            }
        }
    }
    Ok(results
        .into_iter()
        .zip(keep)
        .filter_map(|(hit, keep)| if keep { Some(hit) } else { None })
        .collect())
}

#[tauri::command]
pub async fn biosec_screen(
    app: tauri::AppHandle,
    state: tauri::State<'_, BiosecState>,
    sequence: String,
    circular: Option<bool>,
) -> Result<Vec<BioriskHit>, String> {
    let cache = state.cache.clone();
    tauri::async_runtime::spawn_blocking(move || {
        screen_impl(&app, &cache, &sequence, circular.unwrap_or(false))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn amr_fixture_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/amr")
    }

    fn fixture_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/biorisk")
    }

    #[test]
    fn nucleotide_coordinates_follow_the_translation_frame() {
        assert_eq!(protein_to_nucleotide(1, 1, 1, 9), (1, 3));
        assert_eq!(protein_to_nucleotide(2, 1, 1, 9), (2, 4));
        assert_eq!(protein_to_nucleotide(3, 1, 1, 9), (3, 5));
        assert_eq!(protein_to_nucleotide(1, 2, 2, 9), (4, 6));
        // Reverse frames count from the end of the sequence, and the phase
        // offset of the reverse complement shifts where codon one sits.
        assert_eq!(protein_to_nucleotide(4, 1, 1, 9), (7, 9));
        assert_eq!(protein_to_nucleotide(5, 1, 1, 9), (6, 8));
        assert_eq!(protein_to_nucleotide(6, 1, 1, 9), (5, 7));
    }

    #[test]
    fn evalue_threshold_tightens_for_short_queries() {
        assert!(biorisk_evalue_threshold(60) < 1e-4);
        assert_eq!(biorisk_evalue_threshold(2000), BIORISK_LONG_QUERY_EVALUE_THRESHOLD);
    }

    #[test]
    fn screening_reports_a_curated_profile_match() {
        let dir = fixture_dir();
        let sequence = std::fs::read_to_string(dir.join("probe_sequence.txt")).unwrap();
        let cache = Mutex::new(None);
        let hits = screen_with_dir(&cache, &dir, sequence.trim()).unwrap();
        assert_eq!(hits.len(), 1, "unexpected hits: {hits:?}");
        let hit = &hits[0];
        assert_eq!(hit.model, "Q9BPJ4");
        assert_eq!(hit.description, "Conotoxin TxMMSK-06");
        assert!(hit.must_flag);
        assert_eq!(hit.category, "biorisk");
        assert_eq!(hit.strand, "+");
        assert_eq!((hit.start, hit.end), (7, 276));
    }

    #[test]
    fn screening_skips_queries_under_the_minimum_length() {
        let dir = fixture_dir();
        let cache = Mutex::new(None);
        let hits = screen_with_dir(&cache, &dir, &"ATG".repeat(10)).unwrap();
        assert!(hits.is_empty());
    }

    #[test]
    fn screening_refuses_without_an_installed_database() {
        let cache = Mutex::new(None);
        let empty = std::env::temp_dir().join("spice-biorisk-missing");
        let error = screen_with_dir(&cache, &empty, &"ATG".repeat(40)).unwrap_err();
        assert_eq!(error, "biorisk database is not installed");
    }

    #[test]
    fn amr_catalogue_joins_annotations_and_keeps_the_entry_class() {
        let dir = amr_fixture_dir();
        let catalog =
            read_gene_catalog(&std::fs::read_to_string(dir.join("ReferenceGeneCatalog.txt")).unwrap());
        let records =
            build_amr_records(&std::fs::read_to_string(dir.join("AMR_CDS.fa")).unwrap(), &catalog);
        assert_eq!(records.len(), 2);

        let shiga = records.iter().find(|r| r.gene == "stxA2b").expect("shiga record");
        assert_eq!(shiga.kind, "VIRULENCE");
        assert_eq!(shiga.class, "STX2");
        assert_eq!(shiga.description, "Shiga toxin Stx2b subunit A");
        assert_eq!(shiga.accession, "AAA16360.1");

        let acetyl = records
            .iter()
            .find(|r| r.accession == "WP_025297907.1")
            .expect("aminoglycoside record");
        assert_eq!(acetyl.kind, "AMR");
        assert_eq!(acetyl.class, "AMINOGLYCOSIDE");
        assert_eq!(acetyl.subclass, "GENTAMICIN/TOBRAMYCIN");
        assert!(acetyl.pattern.len() > 10 && acetyl.pattern.bytes().all(|b| b"ACGT".contains(&b)));
    }
}
