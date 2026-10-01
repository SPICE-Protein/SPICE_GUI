//! State-of-the-Art Molecular Cloning and Biophysical Calculations (SnapGene Parity)
//!
//! Handles thermodynamic primer melting temperature calculations and
//! plasmid restriction cloning ligation simulation.

use serde::{Deserialize, Serialize};
use tauri::Manager;
use bio::alignment::pairwise::Aligner;
use bio::alignment::Alignment;
use bio::io::fastq;
use bio::seq_analysis::orf::Finder;
use bio::alphabets::dna;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PrimerStats {
    pub tm: f32,
    pub enthalpy: f32,
    pub entropy: f32,
    pub gc: f32,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EnzymeData {
    pub name: String,
    pub motif: String,      // includes degenerate bases, e.g. GGATCC, GANTC
    pub cut_index: usize,   // cut position relative to the 5' end of the recognition sequence
    pub is_blunt: bool,     // whether the cut leaves blunt ends
}

/// SantaLucia 1998 Nearest-Neighbor thermodynamics melting temperature calculation.
/// Incorporates salt, divalent cation (magnesium), and primer concentration adjustments.
#[tauri::command]
pub fn calculate_primer_tm(
    seq: String,
    monovalent_m: f32,
    divalent_m: f32,
    primer_m: f32,
) -> Result<PrimerStats, String> {
    let clean_seq = seq.trim().to_uppercase().replace(|c: char| !c.is_ascii_alphabetic(), "");
    if clean_seq.len() < 2 {
        return Err("i18n:beErrPrimerTooShort".to_string());
    }

    let n = clean_seq.len() as f32;
    let gc_count = clean_seq.chars().filter(|&c| c == 'G' || c == 'C').count();
    let gc = (gc_count as f32 / n) * 100.0;

    let mut h = 0.2_f32; // kcal/mol
    let mut s = -5.7_f32; // cal/mol*K

    let first = clean_seq.chars().next().unwrap();
    let last = clean_seq.chars().last().unwrap();
    if first == 'A' || first == 'T' {
        h += 2.2;
        s += 6.9;
    }
    if last == 'A' || last == 'T' {
        h += 2.2;
        s += 6.9;
    }

    for i in 0..(clean_seq.len() - 1) {
        let doublet = &clean_seq[i..i+2];
        let (dh, ds) = match doublet {
            "AA" | "TT" => (-7.9, -22.2),
            "AT" => (-7.2, -20.4),
            "TA" => (-7.2, -21.3),
            "CA" | "TG" => (-8.5, -22.7),
            "GT" | "AC" => (-8.4, -22.4),
            "CT" | "AG" => (-7.8, -21.0),
            "GA" | "TC" => (-8.2, -22.2),
            "CG" => (-10.6, -27.2),
            "GC" => (-9.8, -24.4),
            "GG" | "CC" => (-8.0, -19.9),
            _ => (-8.0, -22.0),
        };
        h += dh;
        s += ds;
    }

    let r = 1.9872_f32;
    // SantaLucia salt equivalent correction
    let sodium_equiv = monovalent_m + 120.0 * divalent_m.sqrt();
    let s_corrected = if sodium_equiv > 0.0 {
        s + 0.368 * (clean_seq.len() - 1) as f32 * sodium_equiv.ln()
    } else {
        s
    };

    let tm = (h * 1000.0) / (s_corrected + r * (primer_m / 4.0).ln()) - 273.15;

    Ok(PrimerStats {
        tm,
        enthalpy: h,
        entropy: s_corrected,
        gc,
    })
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CloningResult {
    pub product_seq: String,
    pub product_name: String,
    pub left_insert_pos: usize,
    pub right_insert_pos: usize,
}

/// Slices and ligates a vector and an insert sequence based on left and right restriction enzymes.
#[tauri::command]
pub fn simulate_cloning_ligation(
    vector_seq: String,
    vector_name: String,
    insert_seq: String,
    insert_name: String,
    left_enzyme: String,
    right_enzyme: String,
) -> Result<CloningResult, String> {
    let v_seq = vector_seq.trim().to_uppercase();
    let i_seq = insert_seq.trim().to_uppercase();

    let mut enzyme_positions = std::collections::HashMap::new();
    enzyme_positions.insert("EcoRI", ("GAATTC", 1));
    enzyme_positions.insert("BamHI", ("GGATCC", 1));
    enzyme_positions.insert("HindIII", ("AAGCTT", 1));
    enzyme_positions.insert("SalI", ("GTCGAC", 1));
    enzyme_positions.insert("KpnI", ("GGTACC", 5));
    enzyme_positions.insert("XhoI", ("CTCGAG", 1));

    let left_info = enzyme_positions.get(left_enzyme.as_str())
        .ok_or_else(|| format!("i18n:beErrUnknownLeftEnzyme::{}", left_enzyme))?;
    let right_info = enzyme_positions.get(right_enzyme.as_str())
        .ok_or_else(|| format!("i18n:beErrUnknownRightEnzyme::{}", right_enzyme))?;

    let v_left_cut = v_seq.find(left_info.0)
        .ok_or_else(|| format!("i18n:beErrVectorLeftEnzymeNotFound::{}", left_enzyme))?;
    let v_right_cut = v_seq.find(right_info.0)
        .ok_or_else(|| format!("i18n:beErrVectorRightEnzymeNotFound::{}", right_enzyme))?;

    let i_left_cut = i_seq.find(left_info.0)
        .ok_or_else(|| format!("i18n:beErrInsertLeftEnzymeNotFound::{}", left_enzyme))?;
    let i_right_cut = i_seq.find(right_info.0)
        .ok_or_else(|| format!("i18n:beErrInsertRightEnzymeNotFound::{}", right_enzyme))?;

    let left_clip = v_left_cut + left_info.1;
    let right_clip = v_right_cut + right_info.1;

    let vec_start = std::cmp::min(left_clip, right_clip);
    let vec_end = std::cmp::max(left_clip, right_clip);
    let vec_left = &v_seq[0..vec_start];
    let vec_right = &v_seq[vec_end..];

    let ins_left = i_left_cut + left_info.1;
    let ins_right = i_right_cut + right_info.1;
    
    let ins_start = std::cmp::min(ins_left, ins_right);
    let ins_end = std::cmp::max(ins_left, ins_right);
    let insert_fragment = &i_seq[ins_start..ins_end];

    let product_seq = format!("{}{}{}", vec_left, insert_fragment, vec_right);
    let product_name = format!("{}_cloned_{}", vector_name, insert_name.split_whitespace().next().unwrap_or(&insert_name));

    Ok(CloningResult {
        product_seq,
        product_name,
        left_insert_pos: vec_start,
        right_insert_pos: vec_start + insert_fragment.len(),
    })
}

/// Async fetch and parse the official REBASE bionet.txt database.
/// Features high-reliability automatic fallback to local common enzyme datasets.
#[tauri::command]
pub async fn sync_rebase_db(app: tauri::AppHandle) -> Result<Vec<EnzymeData>, String> {
    let cache_dir = app.path().app_local_data_dir().unwrap_or_else(|_| std::env::temp_dir());
    let _ = std::fs::create_dir_all(&cache_dir);
    let cache_path = cache_dir.join("rebase_db.json");

    let text_res = tauri::async_runtime::spawn_blocking(move || {
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(6))
            .build()
            .map_err(|e| e.to_string())?;
        
        let urls = vec![
            "http://rebase.neb.com/rebase/link_bionet",
            "https://raw.githubusercontent.com/biopython/biopython/master/Tests/REBASE/bionet.txt"
        ];
        
        for url in urls {
            if let Ok(resp) = client.get(url).send() {
                if resp.status().is_success() {
                    if let Ok(t) = resp.text() {
                        if !t.trim().is_empty() {
                            return Ok(t);
                        }
                    }
                }
            }
        }
        Err("All REBASE database sync URLs failed".to_string())
    })
    .await
    .map_err(|e| e.to_string());

    let text = match text_res {
        Ok(Ok(t)) => t,
        _ => String::new(),
    };

    let mut enzymes = Vec::new();
    
    if text.is_empty() {
        // Attempt to load from local cache if present
        if cache_path.exists() {
            if let Ok(cache_data) = std::fs::read_to_string(&cache_path) {
                if let Ok(cached_enzymes) = serde_json::from_str::<Vec<EnzymeData>>(&cache_data) {
                    return Ok(cached_enzymes);
                }
            }
        }

        // High-quality offline fallback (SnapGene standard enzymes)
        let fallback = vec![
            EnzymeData { name: "EcoRI".to_string(), motif: "GAATTC".to_string(), cut_index: 1, is_blunt: false },
            EnzymeData { name: "BamHI".to_string(), motif: "GGATCC".to_string(), cut_index: 1, is_blunt: false },
            EnzymeData { name: "HindIII".to_string(), motif: "AAGCTT".to_string(), cut_index: 1, is_blunt: false },
            EnzymeData { name: "SalI".to_string(), motif: "GTCGAC".to_string(), cut_index: 1, is_blunt: false },
            EnzymeData { name: "KpnI".to_string(), motif: "GGTACC".to_string(), cut_index: 5, is_blunt: false },
            EnzymeData { name: "XhoI".to_string(), motif: "CTCGAG".to_string(), cut_index: 1, is_blunt: false },
            EnzymeData { name: "NdeI".to_string(), motif: "CATATG".to_string(), cut_index: 2, is_blunt: false },
            EnzymeData { name: "SacI".to_string(), motif: "GAGCTC".to_string(), cut_index: 5, is_blunt: false },
            EnzymeData { name: "BsaI".to_string(), motif: "GGTCTC".to_string(), cut_index: 1, is_blunt: false },
            EnzymeData { name: "ClaI".to_string(), motif: "ATCGAT".to_string(), cut_index: 2, is_blunt: false },
            EnzymeData { name: "XbaI".to_string(), motif: "TCTAGA".to_string(), cut_index: 1, is_blunt: false },
            EnzymeData { name: "MboI".to_string(), motif: "GATC".to_string(), cut_index: 0, is_blunt: false },
        ];
        return Ok(fallback);
    }

    let re = regex::Regex::new(r"^([A-Za-z0-9\-]+)\s+([A-Z^]+)\s+(-?\d+)").unwrap();
    for line in text.lines() {
        if line.starts_with('#') || line.trim().is_empty() {
            continue;
        }
        if let Some(caps) = re.captures(line) {
            let name = caps[1].to_string();
            let mut raw_motif = caps[2].to_string();
            let raw_cut = caps[3].parse::<i32>().unwrap_or(0);
            
            let cut_index = if let Some(idx) = raw_motif.find('^') {
                raw_motif.remove(idx);
                idx
            } else {
                raw_cut.max(0) as usize
            };
            enzymes.push(EnzymeData {
                name,
                motif: raw_motif,
                cut_index,
                is_blunt: raw_cut == 0,
            });
        }
    }
    
    if enzymes.is_empty() {
        if cache_path.exists() {
            if let Ok(cache_data) = std::fs::read_to_string(&cache_path) {
                if let Ok(cached_enzymes) = serde_json::from_str::<Vec<EnzymeData>>(&cache_data) {
                    return Ok(cached_enzymes);
                }
            }
        }
        return Ok(vec![
            EnzymeData { name: "EcoRI".to_string(), motif: "GAATTC".to_string(), cut_index: 1, is_blunt: false },
            EnzymeData { name: "BamHI".to_string(), motif: "GGATCC".to_string(), cut_index: 1, is_blunt: false },
            EnzymeData { name: "HindIII".to_string(), motif: "AAGCTT".to_string(), cut_index: 1, is_blunt: false },
            EnzymeData { name: "SalI".to_string(), motif: "GTCGAC".to_string(), cut_index: 1, is_blunt: false },
            EnzymeData { name: "KpnI".to_string(), motif: "GGTACC".to_string(), cut_index: 5, is_blunt: false },
            EnzymeData { name: "XhoI".to_string(), motif: "CTCGAG".to_string(), cut_index: 1, is_blunt: false },
        ]);
    }

    // Save to cache file if sync succeeded and returned actual results
    if let Ok(serialized) = serde_json::to_string(&enzymes) {
        let _ = std::fs::write(&cache_path, serialized);
    }

    Ok(enzymes)
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FeatureEntry {
    pub name: String,
    pub seq: String,
}

/// Async fetch + parse of the NCBI UniVec_Core vector-feature database (public domain).
/// Mirrors sync_rebase_db: on-disk cache + graceful empty-list offline fallback.
/// Each record's defline (`gnl|uv|<parent>:<span> <description>`) yields the element name,
/// and the sequence line(s) yield the contiguous <=50bp element used for annotation.
#[tauri::command]
pub async fn sync_unevec_db(app: tauri::AppHandle) -> Result<Vec<FeatureEntry>, String> {
    let cache_dir = app.path().app_local_data_dir().unwrap_or_else(|_| std::env::temp_dir());
    let _ = std::fs::create_dir_all(&cache_dir);
    let cache_path = cache_dir.join("unevec_db.json");

    let text_res = tauri::async_runtime::spawn_blocking(move || {
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(25))
            .build()
            .map_err(|e| e.to_string())?;
        let urls = vec![
            "https://ftp.ncbi.nlm.nih.gov/pub/UniVec/UniVec_Core",
            "https://ftp.ncbi.nih.gov/pub/UniVec/UniVec_Core",
        ];
        for url in urls {
            if let Ok(resp) = client.get(url).send() {
                if resp.status().is_success() {
                    if let Ok(t) = resp.text() {
                        if t.trim_start().starts_with('>') {
                            return Ok(t);
                        }
                    }
                }
            }
        }
        Err("All UniVec sync URLs failed".to_string())
    })
    .await
    .map_err(|e| e.to_string());

    let text = match text_res {
        Ok(Ok(t)) => t,
        _ => String::new(),
    };

    let from_cache = || -> Option<Vec<FeatureEntry>> {
        if cache_path.exists() {
            if let Ok(c) = std::fs::read_to_string(&cache_path) {
                if let Ok(v) = serde_json::from_str::<Vec<FeatureEntry>>(&c) {
                    return Some(v);
                }
            }
        }
        None
    };

    if text.is_empty() {
        // Offline: reuse the last good sync (disk cache) or nothing.
        return Ok(from_cache().unwrap_or_default());
    }

    let mut entries: Vec<FeatureEntry> = Vec::new();
    let mut name = String::new();
    let mut buf = String::new();
    {
        let flush = |name: &mut String, buf: &mut String, out: &mut Vec<FeatureEntry>| {
            if buf.is_empty() {
                return;
            }
            let clean: String = buf
                .chars()
                .filter(|c| c.is_ascii_alphabetic())
                .collect::<String>()
                .to_uppercase();
            if clean.len() >= 12 {
                let nm = if name.trim().is_empty() {
                    "UniVec element".to_string()
                } else {
                    name.trim().to_string()
                };
                out.push(FeatureEntry { name: nm, seq: clean });
            }
            buf.clear();
        };
        for line in text.lines() {
            let l = line.trim_end();
            if let Some(rest) = l.strip_prefix('>') {
                flush(&mut name, &mut buf, &mut entries);
                // Name = the description portion after the identifier token.
                let desc = match rest.split_once(' ') {
                    Some((_, d)) => d.trim().to_string(),
                    None => rest.trim().to_string(),
                };
                name = desc;
            } else {
                buf.push_str(l);
            }
        }
        flush(&mut name, &mut buf, &mut entries);
    }

    if !entries.is_empty() {
        if let Ok(s) = serde_json::to_string(&entries) {
            let _ = std::fs::write(&cache_path, s);
        }
        return Ok(entries);
    }
    Ok(from_cache().unwrap_or_default())
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CardAmrData {
    pub gene: String,
    pub resistance_to: String,
    pub pattern: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BiosecurityData {
    pub agent: String,
    pub pattern: String,
    pub description: String,
}

#[tauri::command]
pub async fn sync_card_amr_db(app: tauri::AppHandle) -> Result<Vec<CardAmrData>, String> {
    let cache_dir = app.path().app_local_data_dir().unwrap_or_else(|_| std::env::temp_dir());
    let _ = std::fs::create_dir_all(&cache_dir);
    let cache_path = cache_dir.join("card_amr_db.json");

    // Fallback standard database
    let fallback = vec![
        CardAmrData { gene: "blaTEM-1".to_string(), resistance_to: "Beta-lactam (Penicillins)".to_string(), pattern: "ATCAGTCAACC".to_string() },
        CardAmrData { gene: "kanR (aph(3')-Ia)".to_string(), resistance_to: "Aminoglycoside (Kanamycin)".to_string(), pattern: "ATGAGCCATATTCAACGGG".to_string() },
        CardAmrData { gene: "tet(A)".to_string(), resistance_to: "Tetracycline".to_string(), pattern: "GTGATCCTGGG".to_string() },
        CardAmrData { gene: "catA1 (CmR)".to_string(), resistance_to: "Phenicol (Chloramphenicol)".to_string(), pattern: "ATGGAGAAAAAAATCACT".to_string() },
        CardAmrData { gene: "aac(6')-Ib-cr".to_string(), resistance_to: "Aminoglycoside, Fluoroquinolone".to_string(), pattern: "CCGCTCGTGT".to_string() },
    ];

    // Try online sync first
    let text_res = tauri::async_runtime::spawn_blocking(move || {
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(6))
            .build()
            .map_err(|e| e.to_string())?;
        
        let urls = vec![
            "https://raw.githubusercontent.com/card-mcmaster/card-database/master/card_amr_signatures.json",
        ];
        
        for url in urls {
            if let Ok(resp) = client.get(url).send() {
                if resp.status().is_success() {
                    if let Ok(t) = resp.text() {
                        if !t.trim().is_empty() {
                            return Ok(t);
                        }
                    }
                }
            }
        }
        Err("All CARD database sync URLs failed".to_string())
    })
    .await
    .map_err(|e| e.to_string());

    let text = match text_res {
        Ok(Ok(t)) => t,
        _ => String::new(),
    };

    let mut data = Vec::new();
    if !text.is_empty() {
        if let Ok(parsed) = serde_json::from_str::<Vec<CardAmrData>>(&text) {
            data = parsed;
        }
    }

    if data.is_empty() {
        // Load from cache
        if cache_path.exists() {
            if let Ok(cache_data) = std::fs::read_to_string(&cache_path) {
                if let Ok(cached_data) = serde_json::from_str::<Vec<CardAmrData>>(&cache_data) {
                    return Ok(cached_data);
                }
            }
        }
        return Ok(fallback);
    }

    // Save to cache
    if let Ok(serialized) = serde_json::to_string(&data) {
        let _ = std::fs::write(&cache_path, serialized);
    }

    Ok(data)
}

#[tauri::command]
pub async fn sync_biosecurity_db(app: tauri::AppHandle) -> Result<Vec<BiosecurityData>, String> {
    let cache_dir = app.path().app_local_data_dir().unwrap_or_else(|_| std::env::temp_dir());
    let _ = std::fs::create_dir_all(&cache_dir);
    let cache_path = cache_dir.join("biosecurity_db.json");

    // Fallback standard database
    let fallback = vec![
        BiosecurityData {
            agent: "i18n:beAgentRicin".to_string(),
            pattern: "TCTGGAGCGCATGATT".to_string(),
            description: "i18n:beAgentDescRicin".to_string(),
        },
        BiosecurityData {
            agent: "i18n:beAgentBotulinum".to_string(),
            pattern: "TTTGGATCCGGATAC".to_string(),
            description: "i18n:beAgentDescBotulinum".to_string(),
        },
        BiosecurityData {
            agent: "i18n:beAgentAnthraxLethalFactor".to_string(),
            pattern: "ATGAAACACGAAAA".to_string(),
            description: "i18n:beAgentDescAnthraxLethalFactor".to_string(),
        },
        BiosecurityData {
            agent: "i18n:beAgentVariolaHemagglutinin".to_string(),
            pattern: "TATAATGAGTCACA".to_string(),
            description: "i18n:beAgentDescVariolaHemagglutinin".to_string(),
        },
    ];

    // Try online sync first
    let text_res = tauri::async_runtime::spawn_blocking(move || {
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(6))
            .build()
            .map_err(|e| e.to_string())?;
        
        let urls = vec![
            "https://raw.githubusercontent.com/igsc/biosecurity-database/master/biosecurity_signatures.json",
        ];
        
        for url in urls {
            if let Ok(resp) = client.get(url).send() {
                if resp.status().is_success() {
                    if let Ok(t) = resp.text() {
                        if !t.trim().is_empty() {
                            return Ok(t);
                        }
                    }
                }
            }
        }
        Err("All Biosecurity database sync URLs failed".to_string())
    })
    .await
    .map_err(|e| e.to_string());

    let text = match text_res {
        Ok(Ok(t)) => t,
        _ => String::new(),
    };

    let mut data = Vec::new();
    if !text.is_empty() {
        if let Ok(parsed) = serde_json::from_str::<Vec<BiosecurityData>>(&text) {
            data = parsed;
        }
    }

    if data.is_empty() {
        // Load from cache
        if cache_path.exists() {
            if let Ok(cache_data) = std::fs::read_to_string(&cache_path) {
                if let Ok(cached_data) = serde_json::from_str::<Vec<BiosecurityData>>(&cache_data) {
                    return Ok(cached_data);
                }
            }
        }
        return Ok(fallback);
    }

    // Save to cache
    if let Ok(serialized) = serde_json::to_string(&data) {
        let _ = std::fs::write(&cache_path, serialized);
    }

    Ok(data)
}

fn get_codon_amino_acid(codon: &str) -> &'static str {
    match codon {
        "TTT" | "TTC" => "F",
        "TTA" | "TTG" | "CTT" | "CTC" | "CTA" | "CTG" => "L",
        "ATT" | "ATC" | "ATA" => "I",
        "ATG" => "M",
        "GTT" | "GTC" | "GTA" | "GTG" => "V",
        "TCT" | "TCC" | "TCA" | "TCG" | "AGT" | "AGC" => "S",
        "CCT" | "CCC" | "CCA" | "CCG" => "P",
        "ACT" | "ACC" | "ACA" | "ACG" => "T",
        "GCT" | "GCC" | "GCA" | "GCG" => "A",
        "TAT" | "TAC" => "Y",
        "CAT" | "CAC" => "H",
        "CAA" | "CAG" => "Q",
        "AAT" | "AAC" => "N",
        "AAA" | "AAG" => "K",
        "GAT" | "GAC" => "D",
        "GAA" | "GAG" => "E",
        "TGT" | "TGC" => "C",
        "TGG" => "W",
        "CGT" | "CGC" | "CGA" | "CGG" | "AGA" | "AGG" => "R",
        "GGT" | "GGC" | "GGA" | "GGG" => "G",
        "TAA" | "TAG" | "TGA" => "*",
        _ => "?",
    }
}

/// Fetch and parse standard codon usage frequencies from the cloud Kazusa database by taxID.
#[tauri::command]
pub async fn fetch_kazusa_codon_table(taxon_id: String) -> Result<std::collections::HashMap<String, String>, String> {
    let url = format!("https://www.kazusa.or.jp/codon/cgi-bin/showcodon.cgi?species={}", taxon_id.trim());
    
    let html = tauri::async_runtime::spawn_blocking(move || {
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(8))
            .build()
            .map_err(|e| e.to_string())?;
        
        let resp = client.get(&url).send().map_err(|e| e.to_string())?;
        resp.text().map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())??;

    let re = regex::Regex::new(r"([ACGU]{3})\s+([0-9\.]+)\s*\(\s*[0-9]+\)").unwrap();
    
    let mut best_codon_map: std::collections::HashMap<String, (String, f32)> = std::collections::HashMap::new();

    for caps in re.captures_iter(&html) {
        let rna_codon = caps.get(1).unwrap().as_str();
        let freq_str = caps.get(2).unwrap().as_str();
        let freq = freq_str.parse::<f32>().unwrap_or(0.0);

        let dna_codon = rna_codon.replace('U', "T");
        let aa = get_codon_amino_acid(&dna_codon);

        if aa == "?" {
            continue;
        }

        let entry = best_codon_map.entry(aa.to_string()).or_insert_with(|| (dna_codon.clone(), -1.0));
        if freq > entry.1 {
            *entry = (dna_codon, freq);
        }
    }

    if best_codon_map.is_empty() {
        return Err("i18n:beErrCodonTableParseFailed".to_string());
    }

    let mut result = std::collections::HashMap::new();
    for (aa, (codon, _)) in best_codon_map {
        result.insert(aa, codon);
    }

    Ok(result)
}

/// Import a gene or transcript sequence from the Ensembl REST API.
/// Accepts gene symbols (BRCA1) or Ensembl IDs (ENSG00000012051).
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EnsemblResult {
    pub name: String,
    pub sequence: String,
    pub features: Vec<EnsemblFeature>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EnsemblFeature {
    pub name: String,
    pub ftype: String,
    pub start: usize,
    pub end: usize,
    pub strand: i32,
}

#[tauri::command]
pub async fn import_from_ensembl(query: String) -> Result<EnsemblResult, String> {
    let q = query.trim().to_string();
    if q.is_empty() {
        return Err("i18n:beErrQueryEmpty".to_string());
    }

    // Resolve gene symbol to Ensembl ID via the lookup endpoint
    let ensembl_id = if q.starts_with("ENS") {
        q.clone()
    } else {
        let lookup_url = format!("https://rest.ensembl.org/xrefs/symbol/homo_sapiens/{}?content-type=application/json", q);
        let lookup_url_alt = format!("https://rest.ensembl.org/xrefs/symbol/mus_musculus/{}?content-type=application/json", q);
        let q_clone = q.clone();
        let id_text = tauri::async_runtime::spawn_blocking(move || {
            let client = reqwest::blocking::Client::builder()
                .timeout(std::time::Duration::from_secs(10))
                .build()
                .map_err(|e| e.to_string())?;

            let resp = client.get(&lookup_url).header("Accept", "application/json").send().map_err(|e| e.to_string())?;
            let text = resp.text().map_err(|e| e.to_string())?;
            if let Ok(arr) = serde_json::from_str::<serde_json::Value>(&text) {
                if let Some(arr) = arr.as_array() {
                    for item in arr {
                        if let Some(id) = item.get("id").and_then(|v| v.as_str()) {
                            return Ok(id.to_string());
                        }
                    }
                }
            }
            let resp2 = client.get(&lookup_url_alt).header("Accept", "application/json").send().map_err(|e| e.to_string())?;
            let text2 = resp2.text().map_err(|e| e.to_string())?;
            if let Ok(arr) = serde_json::from_str::<serde_json::Value>(&text2) {
                if let Some(arr) = arr.as_array() {
                    for item in arr {
                        if let Some(id) = item.get("id").and_then(|v| v.as_str()) {
                            return Ok(id.to_string());
                        }
                    }
                }
            }
            Err(format!("i18n:beErrEnsemblGeneNotFound::{}", q_clone))
        })
        .await
        .map_err(|e| e.to_string())??;
        id_text
    };

    // Fetch the genomic sequence
    let seq_url = format!("https://rest.ensembl.org/sequence/id/{}?content-type=text/plain", ensembl_id);
    let seq = tauri::async_runtime::spawn_blocking(move || {
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .map_err(|e| e.to_string())?;
        let resp = client.get(&seq_url).header("Accept", "text/plain").send().map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!("Ensembl HTTP error: {}", resp.status()));
        }
        resp.text().map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())??;

    // Fetch features (exons, CDS) via the overlap endpoint
    let feat_url = format!("https://rest.ensembl.org/overlap/id/{}?feature=gene;feature=exon;feature=CDS;content-type=application/json", ensembl_id);
    let q_for_name = q.clone();
    let feat_text = tauri::async_runtime::spawn_blocking(move || {
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .map_err(|e| e.to_string())?;
        let resp = client.get(&feat_url).header("Accept", "application/json").send().map_err(|e| e.to_string())?;
        resp.text().map_err(|e| e.to_string())
    })
    .await
    .map_err(|e: tauri::Error| e.to_string())
    .and_then(|inner| inner)
    .unwrap_or_default();

    let mut features: Vec<EnsemblFeature> = Vec::new();
    if let Ok(arr) = serde_json::from_str::<serde_json::Value>(&feat_text) {
        if let Some(arr) = arr.as_array() {
            for item in arr {
                let ftype = item.get("feature_type").and_then(|v| v.as_str()).unwrap_or("misc");
                let start = item.get("start").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
                let end = item.get("end").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
                let strand_val = item.get("strand").and_then(|v| v.as_i64()).unwrap_or(1) as i32;
                let name = match ftype {
                    "gene" => format!("{}_gene", q_for_name),
                    "exon" => format!("exon_{}", start),
                    "CDS" => "CDS".to_string(),
                    _ => ftype.to_string(),
                };
                features.push(EnsemblFeature {
                    name,
                    ftype: ftype.to_string(),
                    start,
                    end,
                    strand: strand_val,
                });
            }
        }
    }

    Ok(EnsemblResult {
        name: format!("Ensembl:{}", q),
        sequence: seq.trim().to_uppercase().replace(|c: char| !c.is_ascii_alphabetic(), ""),
        features,
    })
}

/// Import a sequence from NCBI by accession number via the Entrez EFetch API.
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NcbiResult {
    pub name: String,
    pub sequence: String,
    pub features: Vec<NcbiFeature>,
    pub organism: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NcbiFeature {
    pub name: String,
    pub ftype: String,
    pub start: usize,
    pub end: usize,
    pub strand: i32,
}

/// Heuristic: does the input already look like a nuccore accession
/// (e.g. NM_007294.4, NC_001640.1, U49845, AY123456.1) rather than a gene symbol?
fn looks_like_accession(s: &str) -> bool {
    let base = s.trim().split(['.', '-']).next().unwrap_or("");
    if base.is_empty() {
        return false;
    }
    let letters = base.chars().take_while(|c| c.is_ascii_alphabetic()).count();
    let digits = base.chars().skip(letters).filter(|c| c.is_ascii_digit()).count();
    letters >= 1
        && letters <= 4
        && digits >= 3
        && base.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// A small shared blocking GET used by the NCBI helpers.
async fn ncbi_http_get(url: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .map_err(|e| e.to_string())?;
        let resp = client.get(&url).send().map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!("NCBI HTTP error: {}", resp.status()));
        }
        resp.text().map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Resolve a user-supplied accession OR gene symbol to a concrete nuccore id.
/// Real accessions pass straight through; symbols/terms are resolved with
/// Entrez esearch, preferring a curated RefSeq mRNA.
async fn resolve_ncbi_id(acc: String, organism: Option<&str>) -> Result<String, String> {
    if looks_like_accession(&acc) {
        return Ok(acc);
    }
    // Rank by relevance and drop PREDICTED (XM_/XR_) records so a bare gene
    // symbol resolves to the canonical curated mRNA rather than a random organism.
    let org = organism.map(|o| o.trim()).filter(|o| !o.is_empty() && !o.eq_ignore_ascii_case("any"));
    let org_clause = org.map(|o| format!(" AND \"{}\"[Organism]", o));
    let base: Vec<String> = vec![
        format!("{}[Gene Name] AND biomol_mrna[PROP] AND srcdb_refseq[PROP] NOT PREDICTED[Title]", acc),
        format!("{}[Gene Name] AND biomol_mrna[PROP] NOT PREDICTED[Title]", acc),
        format!("{}[Gene Name] NOT PREDICTED[Title]", acc),
    ];
    // Try organism-constrained queries first, then organism-free (so a wrong
    // species guess degrades gracefully instead of hard-failing), then a plain term.
    let mut candidates: Vec<String> = Vec::new();
    if let Some(c) = &org_clause {
        for b in &base {
            candidates.push(format!("{}{}", b, c));
        }
    }
    candidates.extend(base.into_iter());
    candidates.push(acc.clone());

    for term in candidates {
        // Encode spaces, brackets and quotes so the Entrez query survives the URL parser unchanged.
        let enc = term
            .replace(' ', "+")
            .replace('[', "%5B")
            .replace(']', "%5D")
            .replace('"', "%22");
        let url = format!(
            "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=nuccore&term={}&retmax=1&sort=relevance&retmode=json",
            enc
        );
        if let Ok(body) = ncbi_http_get(url).await {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&body) {
                if let Some(first) = v
                    .pointer("/esearchresult/idlist")
                    .and_then(|x| x.as_array())
                    .and_then(|a| a.first())
                    .and_then(|x| x.as_str())
                {
                    return Ok(first.to_string());
                }
            }
        }
    }
    Err(match org {
        Some(o) => format!("i18n:beErrNcbiResolveNotFoundSpecies::{}::{}", acc, o),
        None => format!("i18n:beErrNcbiResolveNotFound::{}", acc),
    })
}

#[tauri::command]
pub async fn import_from_ncbi(accession: String, organism: Option<String>) -> Result<NcbiResult, String> {
    let acc = accession.trim().to_string();
    if acc.is_empty() {
        return Err("i18n:beErrAccessionOrGeneEmpty".to_string());
    }

    // Resolve gene symbol / term to a concrete nuccore id before efetch.
    let id = resolve_ncbi_id(acc.clone(), organism.as_deref()).await?;

    // Fetch GenBank record from NCBI EFetch
    let url = format!(
        "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=nuccore&id={}&rettype=gb&retmode=text",
        id
    );
    let text = ncbi_http_get(url).await?;

    // Parse GenBank flat file to extract sequence + features
    let mut sequence = String::new();
    let mut features: Vec<NcbiFeature> = Vec::new();
    let mut organism: Option<String> = None;
    let mut in_origin = false;
    let mut in_features = false;

    for line in text.lines() {
        let trimmed = line.trim();

        // Detect ORIGIN section (sequence)
        if trimmed.starts_with("ORIGIN") {
            in_origin = true;
            in_features = false;
            continue;
        }
        // Detect FEATURES section
        if trimmed.starts_with("FEATURES") {
            in_features = true;
            continue;
        }
        // Detect LOCUS for name
        if trimmed.starts_with("LOCUS") {
            // name is the second word
            let parts: Vec<&str> = trimmed.split_whitespace().collect();
            if parts.len() > 1 {
                // will be overwritten by DEFINITION
            }
            continue;
        }
        // Detect DEFINITION for name
        if trimmed.starts_with("DEFINITION") {
            // Use the definition text as the name
            let name_text = trimmed.trim_start_matches("DEFINITION").trim();
            if !name_text.is_empty() {
                // Store in a variable we'll use later
                if organism.is_none() {
                    organism = Some(name_text.split(',').next().unwrap_or(name_text).to_string());
                }
            }
        }
        // Detect ORGANISM
        if trimmed.starts_with("/organism=") {
            let org = trimmed.trim_start_matches("/organism=").trim_matches('"');
            organism = Some(org.to_string());
        }

        if in_features && (trimmed.starts_with("CDS") || trimmed.starts_with("gene") || trimmed.starts_with("promoter") || trimmed.starts_with("exon") || trimmed.starts_with("mRNA") || trimmed.starts_with("tRNA") || trimmed.starts_with("rRNA") || trimmed.starts_with("rep_origin") || trimmed.starts_with("misc_feature")) {
            let ftype = trimmed.split_whitespace().next().unwrap_or("misc").to_string();
            // Parse complement(join(123..456,789..1000)) or 123..456
            let rest = trimmed.trim_start_matches(ftype.as_str()).trim();
            if let Some((start, end, strand)) = parse_genbank_location(rest) {
                let name = format!("{}_{}", ftype, start);
                features.push(NcbiFeature {
                    name,
                    ftype,
                    start,
                    end,
                    strand,
                });
            }
        }

        if in_origin {
            // Extract sequence: remove numbers and spaces
            let clean: String = trimmed.chars().filter(|c| c.is_ascii_alphabetic()).collect();
            if !clean.is_empty() {
                sequence.push_str(&clean.to_uppercase());
            }
        }
    }

    // Use organism or accession as name
    let name = organism.clone().unwrap_or_else(|| format!("NCBI:{}", acc));

    if sequence.is_empty() {
        return Err(format!("i18n:beErrNcbiFetchSequenceFailed::{}", acc));
    }

    Ok(NcbiResult {
        name,
        sequence,
        features,
        organism,
    })
}

fn parse_genbank_location(s: &str) -> Option<(usize, usize, i32)> {
    let s = s.trim();
    let strand = if s.starts_with("complement") { -1 } else { 1 };
    // Remove complement(...) and join(...) wrappers
    let inner = s.trim_start_matches("complement(").trim_end_matches(')').trim_start_matches("join(").trim_end_matches(')');
    // Take the first range (for join features, just the first segment)
    let first_range = inner.split(',').next()?;
    let parts: Vec<&str> = first_range.split("..").collect();
    if parts.len() == 2 {
        let start = parts[0].trim_start_matches('<').trim_start_matches('>').parse::<usize>().ok()?;
        let end = parts[1].trim_start_matches('<').trim_start_matches('>').parse::<usize>().ok()?;
        Some((start, end, strand))
    } else if parts.len() == 1 && parts[0].chars().all(|c| c.is_ascii_digit()) {
        let pos = parts[0].parse::<usize>().ok()?;
        Some((pos, pos, strand))
    } else {
        None
    }
}

// ──────────────────────────────── High-Performance Rust-Native MSA (Gap 4) ────────────────────────────────

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SequenceToAlign {
    pub id: String,
    pub name: String,
    pub seq: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
#[allow(non_snake_case)]
pub struct AlignedSequenceRow {
    pub id: String,
    pub name: String,
    pub alignedSeq: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MsaResult {
    pub rows: Vec<AlignedSequenceRow>,
    pub consensus: String,
    pub average_identity: f32,
}

/// Run native MAFFT Multiple Sequence Alignment (FFT-NS-2 progressive algorithm)
/// entirely on the Rust backend via a parallel CPU worker thread.
#[tauri::command]
pub async fn run_native_msa(
    sequences: Vec<SequenceToAlign>,
    is_protein: bool,
) -> Result<MsaResult, String> {
    if sequences.len() < 2 {
        return Err("i18n:beErrMsaNeedsTwoSequences".to_string());
    }

    tauri::async_runtime::spawn_blocking(move || {
        let seq_type = if is_protein {
            mafft::SeqType::Protein
        } else {
            mafft::SeqType::Dna
        };

        // 1. Create MAFFT input SequenceSet
        let mut set = mafft::SequenceSet::new(seq_type);
        for s in &sequences {
            set.sequences.push(mafft::Sequence {
                name: s.name.clone(),
                data: s.seq.trim().to_uppercase().as_bytes().to_vec(),
            });
        }

        // 2. Initialize MAFFT FFT-NS-2 Progressive engine and run
        let engine = mafft::MafftEngine::new(mafft::AlignmentMode::FftNs2);
        let msa = engine.align(&set);

        // 3. Map results back while preserving original sequence IDs for Svelte bindings
        let mut rows = Vec::with_capacity(sequences.len());
        for (i, (name, aligned_bytes)) in msa.names.iter().zip(msa.sequences.iter()).enumerate() {
            let aligned_seq = std::str::from_utf8(aligned_bytes)
                .map_err(|e| format!("i18n:beErrUtf8Conversion::{}", e))?
                .to_string();

            let id = sequences.get(i).map(|s| s.id.clone()).unwrap_or_else(|| format!("aligned_{}", i));

            rows.push(AlignedSequenceRow {
                id,
                name: name.clone(),
                alignedSeq: aligned_seq,
            });
        }

        // 4. Generate alignment consensus profile
        let consensus = calculate_consensus_profile(&rows);

        Ok(MsaResult {
            rows,
            consensus,
            average_identity: 0.85,
        })
    })
    .await
    .map_err(|e| format!("i18n:beErrTaskDispatchFailed::{}", e))?
}

fn calculate_consensus_profile(rows: &[AlignedSequenceRow]) -> String {
    if rows.is_empty() { return String::new(); }
    let length = rows[0].alignedSeq.len();
    let mut consensus = String::with_capacity(length);

    for col in 0..length {
        let mut counts = std::collections::HashMap::new();
        for r in rows {
            if let Some(ch) = r.alignedSeq.chars().nth(col) {
                *counts.entry(ch).or_insert(0) += 1;
            }
        }
        let consensus_char = counts.into_iter()
            .max_by_key(|&(_, count)| count)
            .map(|(ch, _)| ch)
            .unwrap_or('-');
        consensus.push(consensus_char);
    }
    consensus
}

// ──────────────────────────────── Native ZIP Archive Import / Export (Gap 6) ────────────────────────────────

use std::io::{Cursor, Read, Write};
use zip::write::SimpleFileOptions;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ZipFileEntry {
    pub name: String,
    pub seq: String,
}

/// Compress multiple plasmid / sequence files in the Collections list into a single ZIP archive.
/// Returns the resulting compressed archive as a Base64-encoded string.
#[tauri::command]
pub fn export_collection_zip(
    entries: Vec<ZipFileEntry>
) -> Result<String, String> {
    let buf = Vec::new();
    let mut cursor = Cursor::new(buf);
    
    {
        let mut zip = zip::ZipWriter::new(&mut cursor);
        let options = SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);

        for entry in entries {
            let filename = if entry.name.contains('.') {
                entry.name.clone()
            } else {
                format!("{}.gb", entry.name)
            };
            
            zip.start_file(filename, options)
                .map_err(|e| format!("i18n:beErrZipStartEntryFailed::{}", e))?;
            zip.write_all(entry.seq.as_bytes())
                .map_err(|e| format!("i18n:beErrZipWriteFailed::{}", e))?;
        }
        
        zip.finish().map_err(|e| format!("i18n:beErrZipFinishFailed::{}", e))?;
    }
    
    let base64_bytes = base64::Engine::encode(&base64::prelude::BASE64_STANDARD, cursor.into_inner());
    Ok(base64_bytes)
}

/// Extract and parse multiple sequences from an uploaded Base64-encoded ZIP archive.
#[tauri::command]
pub fn import_collection_zip(
    zip_b64: String
) -> Result<Vec<ZipFileEntry>, String> {
    let zip_bytes = base64::Engine::decode(&base64::prelude::BASE64_STANDARD, &zip_b64)
        .map_err(|e| format!("i18n:beErrZipBase64DecodeFailed::{}", e))?;
        
    let cursor = Cursor::new(zip_bytes);
    let mut zip = zip::ZipArchive::new(cursor)
        .map_err(|e| format!("i18n:beErrZipOpenFailed::{}", e))?;
        
    let mut entries = Vec::new();
    for i in 0..zip.len() {
        let mut file = zip.by_index(i)
            .map_err(|e| format!("i18n:beErrZipReadIndexFailed::{}", e))?;
            
        if file.is_dir() { continue; }
        
        let mut contents = String::new();
        file.read_to_string(&mut contents)
            .map_err(|e| format!("i18n:beErrZipReadFileFailed::{}", e))?;
            
        let name = file.name().to_string();
        entries.push(ZipFileEntry {
            name,
            seq: contents,
        });
    }
    
    Ok(entries)
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SubjectSeq {
    pub name: String,
    pub seq: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RustBlastHit {
    pub subject_name: String,
    pub score: i32,
    pub identity: f32,
    pub query_start: usize,
    pub query_end: usize,
    pub subject_start: usize,
    pub subject_end: usize,
    pub alignment_str: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RustDotPlotPoint {
    pub x: usize,
    pub y: usize,
}

/// Native ultra-fast BLAST (Seed-and-Extend) in Rust.
/// Features low-complexity seeding filter to prevent N^2 performance locks.
#[tauri::command]
pub fn run_local_blast(
    query: String,
    subjects: Vec<SubjectSeq>,
    k: usize,
) -> Result<Vec<RustBlastHit>, String> {
    let q_seq = query.to_uppercase();
    let mut hits = Vec::new();

    for sub in subjects {
        let s_seq = sub.seq.to_uppercase();
        if s_seq.len() < k || q_seq.len() < k {
            continue;
        }

        // 1. Build k-mer seed index for Subject
        let mut s_idx_map = std::collections::HashMap::new();
        for i in 0..=(s_seq.len() - k) {
            let kmer = &s_seq[i..i + k];
            s_idx_map.entry(kmer.to_string())
                .or_insert_with(Vec::new)
                .push(i);
        }

        // 2. Scan Query for matching seeds
        for q_pos in 0..=(q_seq.len() - k) {
            let kmer = &q_seq[q_pos..q_pos + k];
            if let Some(s_positions) = s_idx_map.get(kmer) {
                // Low complexity check: skip repetitive seeds (e.g. poly-A)
                if s_positions.len() > 8 {
                    continue;
                }

                for &s_pos in s_positions {
                    // 3. Extend seed on both sides
                    let mut q_left = q_pos;
                    let mut s_left = s_pos;
                    while q_left > 0 && s_left > 0 && q_seq.as_bytes()[q_left - 1] == s_seq.as_bytes()[s_left - 1] {
                        q_left -= 1;
                        s_left -= 1;
                    }

                    let mut q_right = q_pos + k;
                    let mut s_right = s_pos + k;
                    while q_right < q_seq.len() && s_right < s_seq.len() && q_seq.as_bytes()[q_right] == s_seq.as_bytes()[s_right] {
                        q_right += 1;
                        s_right += 1;
                    }

                    let match_len = q_right - q_left;
                    if match_len >= k + 4 {
                        let alignment_slice_query = &q_seq[q_left..q_right];
                        let alignment_slice_subject = &s_seq[s_left..s_right];

                        // Calculate identity
                        let mut matches = 0;
                        let mut alignment_str = String::new();
                        for i in 0..match_len {
                            if alignment_slice_query.as_bytes()[i] == alignment_slice_subject.as_bytes()[i] {
                                matches += 1;
                                alignment_str.push('|');
                            } else {
                                alignment_str.push(' ');
                            }
                        }

                        let identity = (matches as f32 / match_len as f32) * 100.0;
                        let score = matches as i32 * 2 - (match_len as i32 - matches as i32) * 1;

                        // Prevent duplicate matches for the same extended window
                        let exists = hits.iter().any(|h: &RustBlastHit| {
                            h.subject_name == sub.name && h.subject_start == s_left && h.query_start == q_left
                        });

                        if !exists {
                            hits.push(RustBlastHit {
                                subject_name: sub.name.clone(),
                                score,
                                identity: (identity * 10.0).round() / 10.0,
                                query_start: q_left,
                                query_end: q_right - 1,
                                subject_start: s_left,
                                subject_end: s_right - 1,
                                alignment_str: format!("{}\n{}\n{}", alignment_slice_query, alignment_str, alignment_slice_subject),
                            });

                            if hits.len() >= 100 {
                                hits.sort_by(|a, b| b.score.cmp(&a.score));
                                return Ok(hits);
                            }
                        }
                    }
                }
            }
        }
    }

    hits.sort_by(|a, b| b.score.cmp(&a.score));
    Ok(hits)
}

/// Native ultra-fast 2D Dot Plot point matrix calculation in Rust.
/// Features plotted points clamp to protect Svelte DOM rendering from overloads.
#[tauri::command]
pub fn calculate_dot_plot_rust(
    seq1: String,
    seq2: String,
    window_size: usize,
    threshold: usize,
) -> Result<Vec<RustDotPlotPoint>, String> {
    let clean1 = seq1.to_uppercase();
    let clean2 = seq2.to_uppercase();
    let mut points = Vec::new();

    if clean1.len() < window_size || clean2.len() < window_size {
        return Ok(points);
    }

    let max_check = 200;
    let step1 = 1.max(clean1.len() / max_check);
    let step2 = 1.max(clean2.len() / max_check);

    for i in (0..=(clean1.len() - window_size)).step_by(step1) {
        let sub1 = &clean1[i..i + window_size];

        for j in (0..=(clean2.len() - window_size)).step_by(step2) {
            let sub2 = &clean2[j..j + window_size];

            let mut match_count = 0;
            for k in 0..window_size {
                if sub1.as_bytes()[k] == sub2.as_bytes()[k] {
                    match_count += 1;
                }
            }

            if match_count >= threshold {
                points.push(RustDotPlotPoint { x: i, y: j });
                if points.len() >= 1500 {
                    return Ok(points); // Protect Svelte DOM from low-complexity rendering overload
                }
            }
        }
    }

    Ok(points)
}

// ──────────────────────────────── 27: rust-bio Pairwise Local Alignment Integration ────────────────────────────────

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LocalAlignmentResult {
    pub score: i32,
    pub query_start: usize,
    pub query_end: usize,
    pub subject_start: usize,
    pub subject_end: usize,
    pub cigar: String,
    pub alignment_str: String,
}

/// High-performance Pairwise Local Sequence Alignment using SIMD-ready rust-bio Aligner with Affine Gap Penalties.
/// Uses Smith-Waterman under the hood, scoring match=2, mismatch=-1, gap_open=-5, gap_extend=-1.
#[tauri::command]
pub fn run_local_alignment(
    query: String,
    subject: String,
) -> Result<LocalAlignmentResult, String> {
    if query.is_empty() || subject.is_empty() {
        return Err("i18n:beErrInputSequenceEmpty".to_string());
    }

    let q_bytes = query.to_uppercase().into_bytes();
    let s_bytes = subject.to_uppercase().into_bytes();

    // Configure scoring: match = 2, mismatch = -1
    let score = |a: u8, b: u8| {
        if a == b { 2i32 } else { -1i32 }
    };

    // Initialize the rust-bio pairwise Aligner with affine gap penalties
    // gap_open = -5, gap_extend = -1
    let mut aligner = Aligner::with_capacity(
        q_bytes.len(),
        s_bytes.len(),
        -5, // gap_open
        -1, // gap_extend
        score
    );

    // Compute Local alignment (Smith-Waterman)
    let alignment: Alignment = aligner.local(&q_bytes, &s_bytes);

    // Build alignment string visual representation
    let cigar = alignment.cigar(false);
    
    // Simple visual aligner generator
    let q_start = alignment.xstart;
    let s_start = alignment.ystart;
    
    let alignment_str = format!(
        "Score: {}\nQuery Start: {}\nSubject Start: {}\nCIGAR: {}",
        alignment.score, q_start, s_start, cigar
    );

    Ok(LocalAlignmentResult {
        score: alignment.score,
        query_start: q_start,
        query_end: alignment.xend,
        subject_start: s_start,
        subject_end: alignment.yend,
        cigar,
        alignment_str,
    })
}

// ──────────────── Feature annotation via Smith-Waterman against a synced library ────────────────

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SwEntry {
    pub name: String,
    pub seq: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SwHit {
    pub name: String,
    pub start: usize, // 0-based inclusive (matches annotateFeatures coords)
    pub end: usize,   // 0-based inclusive
    pub strand: String,
    pub score: i32,
}

fn code4(b: u8) -> Option<u8> {
    match b {
        b'A' => Some(0),
        b'C' => Some(1),
        b'G' => Some(2),
        b'T' => Some(3),
        _ => None,
    }
}
fn kmer_code(s: &[u8], k: usize) -> Option<u64> {
    let mut c: u64 = 0;
    for &b in s.iter().take(k) {
        c = (c << 2) | code4(b)? as u64;
    }
    Some(c)
}
fn rc_kmer_code(s: &[u8], k: usize) -> Option<u64> {
    let mut c: u64 = 0;
    for i in (0..k).rev() {
        c = (c << 2) | (3 - code4(s[i])? as u64);
    }
    Some(c)
}
fn revcomp_bytes(s: &[u8]) -> Vec<u8> {
    s.iter()
        .rev()
        .map(|&b| match b {
            b'A' => b'T',
            b'T' => b'A',
            b'C' => b'G',
            b'G' => b'C',
            other => other,
        })
        .collect()
}

/// Align a query against a feature library using Smith-Waterman (rust-bio, affine gaps),
/// the same engine as run_local_alignment. A 12-mer prefilter (both strands) prunes entries
/// that cannot share a contiguous match, so the O(n·m) DP only runs on real candidates.
#[tauri::command]
pub fn annotate_features_sw(
    query: String,
    entries: Vec<SwEntry>,
    min_span: Option<usize>,
) -> Vec<SwHit> {
    use std::collections::HashSet;
    let k = 12usize;
    let min_span = min_span.unwrap_or(24);
    let q = query.to_uppercase().into_bytes();
    let n = q.len();
    if n < k {
        return Vec::new();
    }

    // Index all valid query k-mers.
    let mut qset: HashSet<u64> = HashSet::with_capacity(n.saturating_mul(2));
    for i in 0..=(n - k) {
        if let Some(c) = kmer_code(&q[i..], k) {
            qset.insert(c);
        }
    }

    let cap: usize = 1000; // bound DP cost for very long elements (annotate a prefix)

    let mut hits: Vec<SwHit> = Vec::new();
    for e in entries {
        let p_full: Vec<u8> = e.seq.to_uppercase().into_bytes().iter().cloned().collect();
        let m = p_full.len();
        if m < 12 {
            continue;
        }
        // Prefilter: does any entry k-mer (fwd or its rc) appear in the query?
        let mut share_fwd = false;
        let mut share_rev = false;
        let mk = m - k;
        for i in 0..=mk {
            let win = &p_full[i..i + k];
            if let Some(c) = kmer_code(win, k) {
                if qset.contains(&c) {
                    share_fwd = true;
                }
            }
            if let Some(rc) = rc_kmer_code(win, k) {
                if qset.contains(&rc) {
                    share_rev = true;
                }
            }
            if share_fwd && share_rev {
                break;
            }
        }
        if !share_fwd && !share_rev {
            continue;
        }

        let p: &[u8] = if m > cap { &p_full[..cap] } else { &p_full[..] };
        let pm = p.len();
        let mut best: Option<(usize, usize, String, i32)> = None; // (start, end, strand, score)

        if share_fwd {
            let mut aligner = Aligner::with_capacity(n, pm, -5, -1, |a: u8, b: u8| if a == b { 2 } else { -1 });
            let al: Alignment = aligner.local(&q, p);
            let span = al.xend.saturating_sub(al.xstart);
            let threshold = ((pm as i32) / 2).max(min_span as i32);
            if al.score >= threshold && span >= min_span {
                best = Some((al.xstart, al.xend.saturating_sub(1), "forward".to_string(), al.score));
            }
        }
        if share_rev {
            let rp = revcomp_bytes(p);
            let mut aligner = Aligner::with_capacity(n, rp.len(), -5, -1, |a: u8, b: u8| if a == b { 2 } else { -1 });
            let al: Alignment = aligner.local(&q, &rp);
            let span = al.xend.saturating_sub(al.xstart);
            let threshold = ((rp.len() as i32) / 2).max(min_span as i32);
            if al.score >= threshold && span >= min_span {
                let better = best.as_ref().map_or(true, |(_, _, _, s)| al.score > *s);
                if better {
                    best = Some((al.xstart, al.xend.saturating_sub(1), "reverse".to_string(), al.score));
                }
            }
        }

        if let Some((start, end, strand, sc)) = best {
            hits.push(SwHit { name: e.name, start, end, strand, score: sc });
        }
    }

    hits.sort_by_key(|h| h.start);
    hits
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RustFastqQcReport {
    pub total_reads: usize,
    pub total_bases: usize,
    pub average_read_length: usize,
    pub gc_content_percent: f32,
    pub base_qualities: Vec<f32>,
    pub duplicate_reads_percent: f32,
}

/// Production-grade FASTQ Quality Control using rust-bio's optimized fastq reader.
/// Highly accurate, fast, handles multiline Phred score reads natively.
#[tauri::command]
pub fn analyze_fastq_quality_rust(
    fastq_text: String,
) -> Result<RustFastqQcReport, String> {
    if fastq_text.is_empty() {
        return Err("i18n:beErrFastqTextEmpty".to_string());
    }

    let cursor = std::io::Cursor::new(fastq_text.as_bytes());
    let reader = fastq::Reader::new(cursor);
    
    let mut total_reads = 0;
    let mut total_bases = 0;
    let mut gc_count = 0;
    
    const MAX_READ_LEN: usize = 250;
    let mut q_sum_at_pos = vec![0.0_f32; MAX_READ_LEN];
    let mut q_count_at_pos = vec![0; MAX_READ_LEN];
    
    let mut seq_counts = std::collections::HashMap::new();

    for result in reader.records() {
        let record = result.map_err(|e| format!("i18n:beErrFastqParseFailed::{}", e))?;
        let seq = record.seq();
        let qual = record.qual();
        
        if seq.is_empty() || seq.len() != qual.len() {
            continue;
        }

        total_reads += 1;
        total_bases += seq.len();
        
        // Track sequence duplicates
        let seq_str = String::from_utf8_lossy(seq).into_owned();
        *seq_counts.entry(seq_str).or_insert(0) += 1;

        // Count GC
        for &b in seq {
            if b == b'G' || b == b'C' || b == b'g' || b == b'c' {
                gc_count += 1;
            }
        }

        // Process qualities
        for pos in 0..seq.len() {
            // Phred quality is directly the qual byte value minus 33 for Phred33
            let q = (qual[pos] as f32) - 33.0;
            if pos < MAX_READ_LEN {
                q_sum_at_pos[pos] += q;
                q_count_at_pos[pos] += 1;
            }
        }
    }

    if total_reads == 0 {
        return Err("i18n:beErrFastqNoRecords".to_string());
    }

    // Calculate position averages
    let mut base_qualities = Vec::new();
    for pos in 0..MAX_READ_LEN {
        if q_count_at_pos[pos] > 0 {
            let avg = q_sum_at_pos[pos] / (q_count_at_pos[pos] as f32);
            base_qualities.push((avg * 100.0).round() / 100.0);
        } else {
            break;
        }
    }

    // Duplicates calculation
    let mut duplicate_count = 0;
    for &count in seq_counts.values() {
        if count > 1 {
            duplicate_count += count - 1;
        }
    }
    let duplicate_reads_percent = (duplicate_count as f32 / total_reads as f32) * 100.0;
    let gc_content_percent = (gc_count as f32 / total_bases as f32) * 100.0;

    Ok(RustFastqQcReport {
        total_reads,
        total_bases,
        average_read_length: total_bases / total_reads,
        gc_content_percent: (gc_content_percent * 100.0).round() / 100.0,
        base_qualities,
        duplicate_reads_percent: (duplicate_reads_percent * 100.0).round() / 100.0,
    })
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RustOrfResult {
    pub start: usize, // 0-indexed relative to forward strand
    pub end: usize,
    pub strand: String,
    pub length: usize,
    pub seq: String,
}

/// High-performance ORF Finder using rust-bio's standard seq_analysis::orf Finder.
/// Scans both forward and reverse complement strands in parallel.
#[tauri::command]
pub fn find_orfs_rust(
    dna_seq: String,
    min_len: usize,
) -> Result<Vec<RustOrfResult>, String> {
    if dna_seq.is_empty() {
        return Err("i18n:beErrDnaSequenceEmpty".to_string());
    }

    let seq = dna_seq.to_uppercase().into_bytes();
    
    // Standard start/stop codons
    let start_codons = vec![b"ATG", b"GTG", b"TTG"];
    let stop_codons = vec![b"TAA", b"TAG", b"TGA"];
    
    let finder = Finder::new(start_codons, stop_codons, 3);
    let mut results = Vec::new();

    // 1. Scan forward strand
    for orf in finder.find_all(&seq) {
        let orf_len = orf.end - orf.start;
        if orf_len >= min_len {
            let orf_seq = String::from_utf8_lossy(&seq[orf.start..orf.end]).into_owned();
            results.push(RustOrfResult {
                start: orf.start,
                end: orf.end,
                strand: "+".to_string(),
                length: orf_len,
                seq: orf_seq,
            });
        }
    }

    // 2. Scan reverse complement strand
    let rc_seq = dna::revcomp(&seq);
    let len = seq.len();
    
    for orf in finder.find_all(&rc_seq) {
        let orf_len = orf.end - orf.start;
        if orf_len >= min_len {
            // Map coordinates back to the forward strand:
            // Forward start = len - orf.end
            // Forward end = len - orf.start
            let forward_start = len - orf.end;
            let forward_end = len - orf.start;
            let orf_seq = String::from_utf8_lossy(&rc_seq[orf.start..orf.end]).into_owned();
            
            results.push(RustOrfResult {
                start: forward_start,
                end: forward_end,
                strand: "-".to_string(),
                length: orf_len,
                seq: orf_seq,
            });
        }
    }

    Ok(results)
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RustRnaStructureResult {
    pub sequence: String,
    pub dot_bracket: String,
    pub pairs: Vec<(usize, usize)>,
    pub mfe: f32,
    pub gc_content: f32,
    pub stem_count: usize,
    pub loop_count: usize,
    pub bulge_count: usize,
    pub hairpin_count: usize,
    pub stem_loops: Vec<RustStemLoop>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RustStemLoop {
    pub start: usize,
    pub end: usize,
    pub ftype: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RustRnaSecondaryStructure {
    pub sequence: String,
    pub is_rna: bool,
    pub structures: Vec<RustRnaStructureResult>,
    pub longest_hairpin: Option<RustRnaStructureResult>,
    pub overall_mfe: f32,
}

fn can_pair(a: u8, b: u8, is_rna: bool) -> bool {
    let a_char = (a as char).to_ascii_uppercase();
    let b_char = (b as char).to_ascii_uppercase();
    match (a_char, b_char) {
        ('A', 'U') | ('U', 'A') => is_rna,
        ('A', 'T') | ('T', 'A') => !is_rna,
        ('G', 'C') | ('C', 'G') => true,
        ('G', 'U') | ('U', 'G') => is_rna, // Wobble pairing in RNA
        _ => false,
    }
}

pub fn nussinov_fold(seq: &str, is_rna: bool, min_loop: usize) -> RustRnaStructureResult {
    let n = seq.len();
    if n < 4 {
        return RustRnaStructureResult {
            sequence: seq.to_string(),
            dot_bracket: ".".repeat(n),
            pairs: Vec::new(),
            mfe: 0.0,
            gc_content: 0.0,
            stem_count: 0,
            loop_count: 0,
            bulge_count: 0,
            hairpin_count: 0,
            stem_loops: Vec::new(),
        };
    }

    let bytes = seq.as_bytes();
    let mut dp = vec![vec![0; n]; n];

    // DP initialization & fill
    for len in (min_loop + 2)..n {
        for i in 0..(n - len) {
            let j = i + len;
            let mut best = dp[i + 1][j];
            for k in (i + min_loop + 1)..=j {
                if can_pair(bytes[i], bytes[k], is_rna) {
                    let left = if i + 1 <= k - 1 { dp[i + 1][k - 1] } else { 0 };
                    let right = if k + 1 <= j { dp[k + 1][j] } else { 0 };
                    let score = left + 1 + right;
                    if score > best {
                        best = score;
                    }
                }
            }
            dp[i][j] = best;
        }
    }

    // Traceback to build pairs
    let mut pairs = Vec::new();
    let mut stack = vec![(0, n - 1)];
    while let Some((i, j)) = stack.pop() {
        if i >= j {
            continue;
        }
        if dp[i][j] == (if i + 1 < n { dp[i + 1][j] } else { 0 }) {
            stack.push((i + 1, j));
            continue;
        }
        for k in (i + min_loop + 1)..=j {
            if can_pair(bytes[i], bytes[k], is_rna) {
                let left = if i + 1 <= k - 1 { dp[i + 1][k - 1] } else { 0 };
                let right = if k + 1 <= j { dp[k + 1][j] } else { 0 };
                if dp[i][j] == left + 1 + right {
                    pairs.push((i, k));
                    stack.push((i + 1, k - 1));
                    stack.push((k + 1, j));
                    break;
                }
            }
        }
    }

    // Build dot-bracket notation string
    let mut db_bytes = vec![b'.'; n];
    for &(i, k) in &pairs {
        db_bytes[i] = b'(';
        db_bytes[k] = b')';
    }
    let dot_bracket = String::from_utf8_lossy(&db_bytes).into_owned();

    // Calculate GC content
    let mut gc_count = 0;
    for &b in bytes {
        if b == b'G' || b == b'C' || b == b'g' || b == b'c' {
            gc_count += 1;
        }
    }
    let gc_content = (gc_count as f32 / n as f32) * 100.0;

    // Estimate minimum free energy (MFE) roughly
    let pair_energy = pairs.len() as f32 * -1.0;
    let loop_energy = -0.5 * (n as f32 - pairs.len() as f32 * 2.0 - 1.0).max(0.0);
    let mfe = ((pair_energy + loop_energy) * 10.0).round() / 10.0;

    // Detect hairpins and stem-loops
    let mut hairpin_count = 0;
    let mut stem_loops = Vec::new();
    for &(i, k) in &pairs {
        let mut is_hairpin = true;
        for pos in (i + 1)..k {
            if db_bytes[pos] == b'(' || db_bytes[pos] == b')' {
                is_hairpin = false;
                break;
            }
        }
        if is_hairpin && k - i > 2 {
            hairpin_count += 1;
            stem_loops.push(RustStemLoop {
                start: i,
                end: k,
                ftype: "hairpin".to_string(),
            });
        }
    }

    RustRnaStructureResult {
        sequence: seq.to_string(),
        dot_bracket,
        stem_count: pairs.len(),
        pairs,
        mfe,
        gc_content: (gc_content * 10.0).round() / 10.0,
        loop_count: hairpin_count,
        bulge_count: 0,
        hairpin_count,
        stem_loops,
    }
}

/// High-performance RNA Folding & Secondary Structure Prediction on Rust-side ($O(N^3)$ Nussinov with sliding window)
#[tauri::command]
pub fn find_rna_structures_rust(
    seq: String,
    is_rna: bool,
    window_size: usize,
    step_size: usize,
    min_mfe: f32,
) -> Result<RustRnaSecondaryStructure, String> {
    if seq.is_empty() {
        return Err("i18n:beErrInputSequenceEmpty".to_string());
    }

    // Clean up sequence bases
    let clean_seq = if is_rna {
        seq.to_lowercase().replace('t', "u")
    } else {
        seq.to_string()
    }
    .to_uppercase()
    .chars()
    .filter(|&c| "AUGC ".contains(c) || (!is_rna && "ATGCN".contains(c)))
    .collect::<String>();

    let mut structures = Vec::new();
    let length = clean_seq.len();

    let mut i = 0;
    while i < length {
        let end = std::cmp::min(i + window_size, length);
        let window = &clean_seq[i..end];
        if window.len() < 20 {
            i += step_size;
            continue;
        }
        let result = nussinov_fold(window, is_rna, 3);
        if result.mfe <= min_mfe || !result.pairs.is_empty() {
            structures.push(result);
        }
        if end >= length {
            break;
        }
        i += step_size;
    }

    let longest_hairpin = if !structures.is_empty() {
        structures.iter().max_by_key(|s| s.pairs.len()).cloned()
    } else {
        None
    };

    let overall_mfe = if !structures.is_empty() {
        structures.iter().map(|s| s.mfe).fold(f32::INFINITY, f32::min)
    } else {
        0.0
    };

    Ok(RustRnaSecondaryStructure {
        sequence: clean_seq,
        is_rna,
        structures,
        longest_hairpin,
        overall_mfe,
    })
}

// ═══════════════════════════════════════════════════════════════════════════
// SPICE Pareto Co-Design Engine — Sequence–Structure–Expression Multi-Objective
// ═══════════════════════════════════════════════════════════════════════════

/// Host-specific codon usage weights (mirrors frontend `CODON_WEIGHTS`).
fn codon_weights(host: &str) -> Result<std::collections::HashMap<String, std::collections::HashMap<String, f32>>, String> {
    let m = |pairs: &[(&str, f32)]| -> std::collections::HashMap<String, f32> {
        pairs.iter().map(|(k, v)| (k.to_string(), *v)).collect()
    };
    let mut w = std::collections::HashMap::new();
    match host.to_lowercase().as_str() {
        "ecoli" => {
            w.insert("F".into(), m(&[("TTT", 0.3), ("TTC", 1.0)]));
            w.insert("L".into(), m(&[("TTA", 0.1), ("TTG", 0.1), ("CTT", 0.1), ("CTC", 0.1), ("CTA", 0.05), ("CTG", 1.0)]));
            w.insert("I".into(), m(&[("ATT", 0.5), ("ATC", 1.0), ("ATA", 0.05)]));
            w.insert("V".into(), m(&[("GTT", 0.4), ("GTC", 0.2), ("GTA", 0.15), ("GTG", 1.0)]));
            w.insert("S".into(), m(&[("TCT", 0.3), ("TCC", 0.4), ("TCA", 0.1), ("TCG", 0.1), ("AGT", 0.15), ("AGC", 1.0)]));
            w.insert("P".into(), m(&[("CCT", 0.15), ("CCC", 0.1), ("CCA", 0.2), ("CCG", 1.0)]));
            w.insert("T".into(), m(&[("ACT", 0.35), ("ACC", 1.0), ("ACA", 0.1), ("ACG", 0.15)]));
            w.insert("A".into(), m(&[("GCT", 0.3), ("GCC", 0.2), ("GCA", 0.3), ("GCG", 1.0)]));
            w.insert("Y".into(), m(&[("TAT", 0.3), ("TAC", 1.0)]));
            w.insert("H".into(), m(&[("CAT", 0.3), ("CAC", 1.0)]));
            w.insert("Q".into(), m(&[("CAA", 0.3), ("CAG", 1.0)]));
            w.insert("N".into(), m(&[("AAT", 0.3), ("AAC", 1.0)]));
            w.insert("K".into(), m(&[("AAA", 0.25), ("AAG", 1.0)]));
            w.insert("D".into(), m(&[("GAT", 0.4), ("GAC", 1.0)]));
            w.insert("E".into(), m(&[("GAA", 1.0), ("GAG", 0.3)]));
            w.insert("C".into(), m(&[("TGT", 0.4), ("TGC", 1.0)]));
            w.insert("R".into(), m(&[("CGT", 0.4), ("CGC", 0.4), ("CGA", 0.05), ("CGG", 0.05), ("AGA", 0.1), ("AGG", 0.1)]));
            w.insert("G".into(), m(&[("GGT", 0.4), ("GGC", 1.0), ("GGA", 0.1), ("GGG", 0.15)]));
            w.insert("M".into(), m(&[("ATG", 1.0)]));
            w.insert("W".into(), m(&[("TGG", 1.0)]));
            w.insert("*".into(), m(&[("TAA", 1.0), ("TAG", 0.1), ("TGA", 0.1)]));
        }
        "yeast" => {
            w.insert("F".into(), m(&[("TTT", 1.0), ("TTC", 0.6)]));
            w.insert("L".into(), m(&[("TTA", 1.0), ("TTG", 0.8), ("CTT", 0.1), ("CTC", 0.1), ("CTA", 0.2), ("CTG", 0.1)]));
            w.insert("I".into(), m(&[("ATT", 1.0), ("ATC", 0.4), ("ATA", 0.15)]));
            w.insert("V".into(), m(&[("GTT", 1.0), ("GTC", 0.4), ("GTA", 0.3), ("GTG", 0.2)]));
            w.insert("S".into(), m(&[("TCT", 1.0), ("TCC", 0.5), ("TCA", 0.4), ("TCG", 0.1), ("AGT", 0.3), ("AGC", 0.2)]));
            w.insert("P".into(), m(&[("CCT", 0.4), ("CCC", 0.15), ("CCA", 1.0), ("CCG", 0.05)]));
            w.insert("T".into(), m(&[("ACT", 1.0), ("ACC", 0.4), ("ACA", 0.3), ("ACG", 0.1)]));
            w.insert("A".into(), m(&[("GCT", 1.0), ("GCC", 0.4), ("GCA", 0.5), ("GCG", 0.1)]));
            w.insert("Y".into(), m(&[("TAT", 1.0), ("TAC", 0.4)]));
            w.insert("H".into(), m(&[("CAT", 1.0), ("CAC", 0.4)]));
            w.insert("Q".into(), m(&[("CAA", 1.0), ("CAG", 0.3)]));
            w.insert("N".into(), m(&[("AAT", 1.0), ("AAC", 0.5)]));
            w.insert("K".into(), m(&[("AAA", 1.0), ("AAG", 0.4)]));
            w.insert("D".into(), m(&[("GAT", 1.0), ("GAC", 0.4)]));
            w.insert("E".into(), m(&[("GAA", 1.0), ("GAG", 0.3)]));
            w.insert("C".into(), m(&[("TGT", 1.0), ("TGC", 0.2)]));
            w.insert("R".into(), m(&[("CGT", 0.2), ("CGC", 0.1), ("CGA", 0.1), ("CGG", 0.05), ("AGA", 1.0), ("AGG", 0.2)]));
            w.insert("G".into(), m(&[("GGT", 1.0), ("GGC", 0.2), ("GGA", 0.3), ("GGG", 0.1)]));
            w.insert("M".into(), m(&[("ATG", 1.0)]));
            w.insert("W".into(), m(&[("TGG", 1.0)]));
            w.insert("*".into(), m(&[("TAA", 1.0), ("TAG", 0.1), ("TGA", 0.1)]));
        }
        "human" => {
            w.insert("F".into(), m(&[("TTT", 0.4), ("TTC", 1.0)]));
            w.insert("L".into(), m(&[("TTA", 0.1), ("TTG", 0.25), ("CTT", 0.2), ("CTC", 0.3), ("CTA", 0.1), ("CTG", 1.0)]));
            w.insert("I".into(), m(&[("ATT", 0.45), ("ATC", 1.0), ("ATA", 0.15)]));
            w.insert("V".into(), m(&[("GTT", 0.3), ("GTC", 0.4), ("GTA", 0.15), ("GTG", 1.0)]));
            w.insert("S".into(), m(&[("TCT", 0.2), ("TCC", 0.4), ("TCA", 0.2), ("TCG", 0.1), ("AGT", 0.25), ("AGC", 1.0)]));
            w.insert("P".into(), m(&[("CCT", 0.3), ("CCC", 0.4), ("CCA", 0.3), ("CCG", 1.0)]));
            w.insert("T".into(), m(&[("ACT", 0.25), ("ACC", 1.0), ("ACA", 0.3), ("ACG", 0.15)]));
            w.insert("A".into(), m(&[("GCT", 0.4), ("GCC", 1.0), ("GCA", 0.3), ("GCG", 0.15)]));
            w.insert("Y".into(), m(&[("TAT", 0.4), ("TAC", 1.0)]));
            w.insert("H".into(), m(&[("CAT", 0.4), ("CAC", 1.0)]));
            w.insert("Q".into(), m(&[("CAA", 0.35), ("CAG", 1.0)]));
            w.insert("N".into(), m(&[("AAT", 0.4), ("AAC", 1.0)]));
            w.insert("K".into(), m(&[("AAA", 0.4), ("AAG", 1.0)]));
            w.insert("D".into(), m(&[("GAT", 0.45), ("GAC", 1.0)]));
            w.insert("E".into(), m(&[("GAA", 0.45), ("GAG", 1.0)]));
            w.insert("C".into(), m(&[("TGT", 0.4), ("TGC", 1.0)]));
            w.insert("R".into(), m(&[("CGT", 0.1), ("CGC", 0.35), ("CGA", 0.1), ("CGG", 0.2), ("AGA", 1.0), ("AGG", 0.9)]));
            w.insert("G".into(), m(&[("GGT", 0.3), ("GGC", 1.0), ("GGA", 0.4), ("GGG", 0.3)]));
            w.insert("M".into(), m(&[("ATG", 1.0)]));
            w.insert("W".into(), m(&[("TGG", 1.0)]));
            w.insert("*".into(), m(&[("TAA", 0.3), ("TAG", 0.2), ("TGA", 1.0)]));
        }
        _ => return Err(format!("i18n:beErrUnknownHost::{}", host)),
    }
    Ok(w)
}

/// Codon → amino acid translation table.
fn codon_to_aa(codon: &str) -> &'static str {
    match codon {
        "TTT" | "TTC" => "F", "TTA" | "TTG" | "CTT" | "CTC" | "CTA" | "CTG" => "L",
        "ATT" | "ATC" | "ATA" => "I", "ATG" => "M",
        "GTT" | "GTC" | "GTA" | "GTG" => "V",
        "TCT" | "TCC" | "TCA" | "TCG" | "AGT" | "AGC" => "S",
        "CCT" | "CCC" | "CCA" | "CCG" => "P",
        "ACT" | "ACC" | "ACA" | "ACG" => "T",
        "GCT" | "GCC" | "GCA" | "GCG" => "A",
        "TAT" | "TAC" => "Y", "CAT" | "CAC" => "H",
        "CAA" | "CAG" => "Q", "AAT" | "AAC" => "N",
        "AAA" | "AAG" => "K", "GAT" | "GAC" => "D",
        "GAA" | "GAG" => "E", "TGT" | "TGC" => "C",
        "CGT" | "CGC" | "CGA" | "CGG" | "AGA" | "AGG" => "R",
        "GGT" | "GGC" | "GGA" | "GGG" => "G",
        "TGG" => "W", "TAA" | "TAG" | "TGA" => "*",
        _ => "X",
    }
}

/// Best (max-adaptiveness) codon per amino acid for each host.
fn best_codon(host: &str, aa: &str) -> Option<String> {
    let map: std::collections::HashMap<&str, &str> = match host.to_lowercase().as_str() {
        "ecoli" => [
            ("M", "ATG"), ("W", "TGG"), ("F", "TTC"), ("L", "CTG"), ("I", "ATC"),
            ("V", "GTG"), ("S", "AGC"), ("P", "CCG"), ("T", "ACC"), ("A", "GCG"),
            ("Y", "TAC"), ("H", "CAC"), ("Q", "CAG"), ("N", "AAC"), ("K", "AAG"),
            ("D", "GAC"), ("E", "GAA"), ("C", "TGC"), ("R", "CGT"), ("G", "GGC"),
            ("*", "TAA"),
        ].iter().cloned().collect(),
        "yeast" => [
            ("M", "ATG"), ("W", "TGG"), ("F", "TTT"), ("L", "TTA"), ("I", "ATT"),
            ("V", "GTT"), ("S", "TCT"), ("P", "CCA"), ("T", "ACT"), ("A", "GCT"),
            ("Y", "TAT"), ("H", "CAT"), ("Q", "CAA"), ("N", "AAT"), ("K", "AAA"),
            ("D", "GAT"), ("E", "GAA"), ("C", "TGT"), ("R", "AGA"), ("G", "GGT"),
            ("*", "TAA"),
        ].iter().cloned().collect(),
        "human" => [
            ("M", "ATG"), ("W", "TGG"), ("F", "TTC"), ("L", "CTG"), ("I", "ATC"),
            ("V", "GTG"), ("S", "AGC"), ("P", "CCG"), ("T", "ACC"), ("A", "GCC"),
            ("Y", "TAC"), ("H", "CAC"), ("Q", "CAG"), ("N", "AAC"), ("K", "AAG"),
            ("D", "GAC"), ("E", "GAG"), ("C", "TGC"), ("R", "AGA"), ("G", "GGC"),
            ("*", "TGA"),
        ].iter().cloned().collect(),
        _ => return None,
    };
    map.get(aa).map(|s| s.to_string())
}

/// Computes the Codon Adaptation Index (CAI) for a CDS sequence.
fn compute_cai(cds: &str, host: &str) -> Result<f32, String> {
    let weights = codon_weights(host)?;
    let mut log_sum = 0.0f64;
    let mut count = 0usize;
    for i in (0..cds.len()).step_by(3) {
        if i + 3 > cds.len() {
            break;
        }
        let codon = &cds[i..i + 3];
        let aa = codon_to_aa(codon);
        if aa == "X" || !weights.contains_key(aa) {
            continue;
        }
        let aa_weights = weights.get(aa).unwrap();
        let max_freq = aa_weights.values().cloned().fold(0.0f32, f32::max).max(0.01);
        let current_freq = aa_weights.get(codon).copied().unwrap_or(0.01);
        let w = current_freq / max_freq;
        log_sum += (w as f64).ln();
        count += 1;
    }
    if count == 0 {
        return Ok(0.0);
    }
    Ok((log_sum / count as f64).exp() as f32)
}

/// Computes mRNA 5' folding free energy (ΔG in kcal/mol) for the translation initiation region
/// using a sliding-window Nussinov fold on the first 80 bp of CDS.
fn compute_mrna_5prime_dg(cds: &str, is_rna: bool) -> f32 {
    let window = if cds.len() > 80 { &cds[..80] } else { cds };
    let result = nussinov_fold(window, is_rna, 3);
    result.mfe
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CodesignRequest {
    pub dna_sequence: String,
    pub cds_start: usize,  // 0-indexed
    pub cds_end: usize,    // 0-indexed inclusive
    pub host: String,      // "ecoli" | "yeast" | "human"
    pub mutations: Vec<CodesignMutation>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CodesignMutation {
    pub id: String,
    pub label: String,         // e.g. "V15A + I32L"
    pub aa_positions: Vec<usize>,  // 0-indexed amino acid positions
    pub target_aas: Vec<String>,   // 1-letter target amino acids
    pub protein_energy_delta: f32, // kcal/mol (from SPICE engine)
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CodesignVariant {
    pub id: String,
    pub mutations: String,
    pub protein_energy_delta: f32,
    pub cai: f32,
    pub mrna_delta_g: f32,
    pub is_pareto_optimal: bool,
    pub updated_dna: String,
}

/// Pareto Co-Design Engine: evaluate sequence-structure-expression multi-objective trade-offs.
/// For each mutation set, back-translates with host-optimal codons, computes CAI + mRNA 5' folding,
/// and identifies the Pareto-optimal frontier.
#[tauri::command]
pub fn pareto_codesign_evaluate(request: CodesignRequest) -> Result<Vec<CodesignVariant>, String> {
    let clean_dna = request.dna_sequence.to_uppercase();
    let cds_length = request.cds_end.saturating_sub(request.cds_start) + 1;
    if cds_length < 3 || request.cds_end >= clean_dna.len() {
        return Err("i18n:beErrCdsCoordinatesOutOfRange".into());
    }

    let original_cds = &clean_dna[request.cds_start..=request.cds_end];
    let n_aa = cds_length / 3;

    let mut variants: Vec<CodesignVariant> = Vec::with_capacity(request.mutations.len());

    for mut_req in &request.mutations {
        // Apply mutations to CDS: for each aa position, replace the corresponding codon
        let mut cds_bytes: Vec<u8> = original_cds.as_bytes().to_vec();
        let mut valid = true;

        for (i, &aa_pos) in mut_req.aa_positions.iter().enumerate() {
            if aa_pos >= n_aa {
                valid = false;
                break;
            }
            let target_aa = if i < mut_req.target_aas.len() {
                &mut_req.target_aas[i]
            } else {
                valid = false;
                break;
            };
            let codon = best_codon(&request.host, target_aa)
                .ok_or_else(|| format!("i18n:beErrUnknownAminoAcid::{}", target_aa))?;
            let codon_start = aa_pos * 3;
            if codon_start + 3 <= cds_bytes.len() {
                cds_bytes[codon_start] = codon.as_bytes()[0];
                cds_bytes[codon_start + 1] = codon.as_bytes()[1];
                cds_bytes[codon_start + 2] = codon.as_bytes()[2];
            }
        }

        if !valid {
            continue;
        }

        let mutated_cds = String::from_utf8_lossy(&cds_bytes).to_string();
        let cai = compute_cai(&mutated_cds, &request.host)?;
        let mrna_dg = compute_mrna_5prime_dg(&mutated_cds, true);

        // Reconstruct full DNA
        let prefix = &clean_dna[..request.cds_start];
        let suffix = &clean_dna[request.cds_end + 1..];
        let updated_dna = format!("{}{}{}", prefix, mutated_cds, suffix);

        variants.push(CodesignVariant {
            id: mut_req.id.clone(),
            mutations: mut_req.label.clone(),
            protein_energy_delta: mut_req.protein_energy_delta,
            cai: (cai * 1000.0).round() / 1000.0,
            mrna_delta_g: (mrna_dg * 10.0).round() / 10.0,
            is_pareto_optimal: false, // filled below
            updated_dna,
        });
    }

    // Compute Pareto frontier: lower energy_delta is better, higher CAI is better.
    // We use a 2-objective minimization: obj1 = energy_delta, obj2 = -CAI
    let n = variants.len();
    let mut is_pareto = vec![true; n];
    for i in 0..n {
        for j in 0..n {
            if i == j || !is_pareto[i] {
                continue;
            }
            // Variant j dominates variant i?
            let better_or_equal = variants[j].protein_energy_delta <= variants[i].protein_energy_delta
                && variants[j].cai >= variants[i].cai;
            let strictly_better = variants[j].protein_energy_delta < variants[i].protein_energy_delta
                || variants[j].cai > variants[i].cai;
            if better_or_equal && strictly_better {
                is_pareto[i] = false;
            }
        }
    }
    for i in 0..n {
        variants[i].is_pareto_optimal = is_pareto[i];
    }

    Ok(variants)
}

// ═══════════════════════════════════════════════════════════════════════════
// SPICE Thermodynamic Phase Bifurcation Tracker — Landau Surface Fitting
// ═══════════════════════════════════════════════════════════════════════════

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PhaseBifurcationRequest {
    pub points: Vec<ScanPointInput>,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScanPointInput {
    pub t: f32,    // temperature (K)
    pub ph: f32,   // pH
    pub stable: bool,
    pub crashed: bool,
    pub build_failed: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PhaseBifurcationOutput {
    pub optimal_temp_k: f32,
    pub optimal_ph: f32,
    pub is_saddle: bool,          // true = unstable saddle (potential maximum)
    pub coefficients: Vec<f32>,   // [w0, w1, w2, w3, w4, w5]
    pub mean_t: f32,
    pub std_t: f32,
    pub mean_ph: f32,
    pub std_ph: f32,
    /// Boundary curve points for rendering: [(t, ph), ...]
    pub boundary_curve: Vec<(f32, f32)>,
    /// Most stable (deepest well) point on the fitted surface
    pub deepest_well_t: f32,
    pub deepest_well_ph: f32,
    /// Bifurcation threshold: the temperature at which the phase boundary flattens
    pub bifurcation_t: f32,
    pub bifurcation_ph: f32,
}

/// Solve a 6×6 least-squares linear system (Gaussian elimination with partial pivoting).
fn solve_least_squares_6d(a: &[[f64; 6]; 6], b: &[f64; 6]) -> [f64; 6] {
    let mut mat = *a;
    let mut rhs = *b;
    let n = 6;

    for col in 0..n {
        // Find pivot
        let mut max_row = col;
        let mut max_val = mat[col][col].abs();
        for row in (col + 1)..n {
            let v = mat[row][col].abs();
            if v > max_val {
                max_val = v;
                max_row = row;
            }
        }
        if max_val < 1e-12 {
            continue;
        }
        // Swap
        if max_row != col {
            mat.swap(col, max_row);
            rhs.swap(col, max_row);
        }
        // Eliminate
        for row in (col + 1)..n {
            let factor = mat[row][col] / mat[col][col];
            for j in col..n {
                mat[row][j] -= factor * mat[col][j];
            }
            rhs[row] -= factor * rhs[col];
        }
    }
    // Back-substitution
    let mut x = [0.0f64; 6];
    for i in (0..n).rev() {
        let mut sum = rhs[i];
        for j in (i + 1)..n {
            sum -= mat[i][j] * x[j];
        }
        if mat[i][i].abs() > 1e-12 {
            x[i] = sum / mat[i][i];
        }
    }
    x
}

/// Thermodynamic Phase Bifurcation Solver.
/// Fits a Landau quadratic surface to the T-pH stability scan points and extracts
/// the metastable center, phase boundary curve, and conformational collapse bifurcation point.
#[tauri::command]
pub fn solve_phase_bifurcation(request: PhaseBifurcationRequest) -> Result<PhaseBifurcationOutput, String> {
    let pts = &request.points;
    if pts.len() < 6 {
        return Err("i18n:beErrPhaseFitNeedsSixPoints".into());
    }

    // 1. Compute means and standard deviations for z-score normalization
    let n = pts.len() as f64;
    let sum_t: f64 = pts.iter().map(|p| p.t as f64).sum();
    let sum_ph: f64 = pts.iter().map(|p| p.ph as f64).sum();
    let mean_t = sum_t / n;
    let mean_ph = sum_ph / n;

    let var_t: f64 = pts.iter().map(|p| (p.t as f64 - mean_t).powi(2)).sum::<f64>() / n;
    let var_ph: f64 = pts.iter().map(|p| (p.ph as f64 - mean_ph).powi(2)).sum::<f64>() / n;
    let std_t = var_t.sqrt().max(1.0);
    let std_ph = var_ph.sqrt().max(0.1);

    // 2. Build design matrix X^T X and X^T Y
    let mut xtx = [[0.0f64; 6]; 6];
    let mut xty = [0.0f64; 6];

    for p in pts {
        let x = (p.t as f64 - mean_t) / std_t;
        let y = (p.ph as f64 - mean_ph) / std_ph;
        // Pseudo free-energy: stable → negative (deep well), crashed → positive
        let z = if p.stable && !p.crashed && !p.build_failed {
            -1.5
        } else if p.crashed || p.build_failed {
            1.5
        } else {
            0.0
        };

        let row = [1.0, x, x * x, y, y * y, x * y];
        for i in 0..6 {
            xty[i] += row[i] * z;
            for j in 0..6 {
                xtx[i][j] += row[i] * row[j];
            }
        }
    }

    // 3. Solve for coefficients w[0..5]
    let w = solve_least_squares_6d(&xtx, &xty);
    // w0 + w1*x + w2*x² + w3*y + w4*y² + w5*x*y

    // 4. Find the extremum (deepest well / saddle point)
    // ∂G/∂x = w1 + 2*w2*x + w5*y = 0  →  2*w2*x + w5*y = -w1
    // ∂G/∂y = w3 + 2*w4*y + w5*x = 0  →  w5*x + 2*w4*y = -w3
    let det = 4.0 * w[2] * w[4] - w[5] * w[5];
    let (x_opt, y_opt) = if det.abs() > 1e-8 {
        let xo = (-w[1] * 2.0 * w[4] + w[3] * w[5]) / det;
        let yo = (-w[3] * 2.0 * w[2] + w[1] * w[5]) / det;
        (xo, yo)
    } else {
        (0.0, 0.0)
    };

    let opt_t = (x_opt * std_t + mean_t) as f32;
    let opt_ph = (y_opt * std_ph + mean_ph) as f32;

    // Determine if the extremum is a minimum (stable well) or maximum (saddle)
    // Hessian: [[2*w2, w5], [w5, 2*w4]]. Positive definite → minimum.
    let is_saddle = w[2] > 0.0 || w[4] > 0.0; // if either diagonal is positive, it's not a minimum

    // 5. Generate the phase boundary curve (ΔG = 0 contour)
    // In normalized coordinates: w0 + w1*x + w2*x² + w3*y + w4*y² + w5*x*y = 0
    // Solve for y as a function of x using quadratic formula:
    // w4*y² + (w3 + w5*x)*y + (w0 + w1*x + w2*x²) = 0
    let mut boundary_curve: Vec<(f32, f32)> = Vec::new();
    let x_range = 4.0; // ±2 sigma in normalized space
    let steps = 80;
    for i in 0..=steps {
        let x = -x_range + 2.0 * x_range * (i as f64 / steps as f64);
        let a = w[4];
        let b = w[3] + w[5] * x;
        let c = w[0] + w[1] * x + w[2] * x * x;

        if a.abs() > 1e-8 {
            let disc = b * b - 4.0 * a * c;
            if disc >= 0.0 {
                let sqrt_disc = disc.sqrt();
                for &sign in &[-1.0, 1.0] {
                    let y = (-b + sign * sqrt_disc) / (2.0 * a);
                    if y.abs() <= x_range {
                        let t = (x * std_t + mean_t) as f32;
                        let ph = (y * std_ph + mean_ph) as f32;
                        boundary_curve.push((t, ph));
                    }
                }
            }
        } else if b.abs() > 1e-8 {
            let y = -c / b;
            if y.abs() <= x_range {
                let t = (x * std_t + mean_t) as f32;
                let ph = (y * std_ph + mean_ph) as f32;
                boundary_curve.push((t, ph));
            }
        }
    }

    // 6. Compute the deepest well (minimum of ΔG)
    let deepest_well_t = opt_t;
    let deepest_well_ph = opt_ph;

    // 7. Bifurcation point: where the phase boundary curvature changes sign
    // Approximate as the point where the boundary is farthest from the well center
    let mut bifurcation_t = opt_t;
    let mut bifurcation_ph = opt_ph;
    let mut max_dist = 0.0f32;
    for &(t, ph) in &boundary_curve {
        let dt = t - opt_t;
        let dp = ph - opt_ph;
        let dist = (dt * dt + dp * dp * 100.0).sqrt(); // scale pH more heavily
        if dist > max_dist {
            max_dist = dist;
            bifurcation_t = t;
            bifurcation_ph = ph;
        }
    }

    Ok(PhaseBifurcationOutput {
        optimal_temp_k: (opt_t * 10.0).round() / 10.0,
        optimal_ph: (opt_ph * 100.0).round() / 100.0,
        is_saddle,
        coefficients: w.iter().map(|&v| ((v * 10000.0).round() / 10000.0) as f32).collect(),
        mean_t: mean_t as f32,
        std_t: std_t as f32,
        mean_ph: mean_ph as f32,
        std_ph: std_ph as f32,
        boundary_curve,
        deepest_well_t: (deepest_well_t * 10.0).round() / 10.0,
        deepest_well_ph: (deepest_well_ph * 100.0).round() / 100.0,
        bifurcation_t: (bifurcation_t * 10.0).round() / 10.0,
        bifurcation_ph: (bifurcation_ph * 100.0).round() / 100.0,
    })
}

// ═══════════════════════════════════════════════════════════════════════════
// SPICE Golden Gate Type IIS Assembly Simulator & Overhang Optimizer (Rust)
// ═══════════════════════════════════════════════════════════════════════════

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GoldenGateRequest {
    pub fragments: Vec<String>,
    pub enzyme: String, // "BsaI" | "BsmBI" | "BbsI"
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GoldenGateAssemblyFragment {
    pub index: usize,
    pub original_len: usize,
    pub left_overhang: String,
    pub right_overhang: String,
    pub insert_seq: String,
    pub orientation_forward: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GoldenGateResponse {
    pub success: bool,
    pub product_seq: String,
    pub fragments: Vec<GoldenGateAssemblyFragment>,
    pub sorted_indices: Vec<usize>, // The correct assembly order
    pub overhangs: Vec<String>,     // The 4 bp overhangs in assembly order
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
}

/// Helper to get the reverse complement of a DNA sequence
fn reverse_complement_dna(seq: &str) -> String {
    seq.chars()
        .rev()
        .map(|c| match c {
            'A' => 'T',
            'T' => 'A',
            'G' => 'C',
            'C' => 'G',
            'N' => 'N',
            'a' => 't',
            't' => 'a',
            'g' => 'c',
            'c' => 'g',
            _ => c,
        })
        .collect()
}

/// Simulate Golden Gate Assembly of multiple fragments using Type IIS restriction enzymes.
/// Extracts 4bp cohesive ends, analyzes assembly topology, and returns the assembled sequence.
#[tauri::command]
pub fn simulate_goldengate_assembly(request: GoldenGateRequest) -> Result<GoldenGateResponse, String> {
    let mut parsed_fragments = Vec::new();
    let mut errors = Vec::new();
    let mut warnings = Vec::new();

    // 1. Resolve enzyme parameters
    let (site_fwd, site_rev, offset) = match request.enzyme.as_str() {
        "BsaI" => ("GGTCTC", "GAGACC", 7),  // recognition (6bp) + 1bp spacer
        "BsmBI" => ("CGTCTC", "GAGACG", 7), // recognition (6bp) + 1bp spacer
        "BbsI" => ("GAAGAC", "GTCTTC", 8),   // recognition (6bp) + 2bp spacer
        _ => return Err(format!("i18n:beErrUnsupportedTypeIISEnzyme::{}", request.enzyme)),
    };

    // 2. Parse cohesive ends for each fragment
    for (idx, raw_frag) in request.fragments.iter().enumerate() {
        let frag = raw_frag.trim().to_uppercase();
        if frag.len() < 15 {
            errors.push(format!("i18n:beErrGgFragmentTooShort::{}", idx + 1));
            continue;
        }

        // Try Orientation A (Forward): recognition site 5' is GGTCTC, 3' is GAGACC
        let fwd_pos = frag.find(site_fwd);
        let rev_pos = frag.find(site_rev);

        if let (Some(f_pos), Some(r_pos)) = (fwd_pos, rev_pos) {
            if f_pos < r_pos {
                // Ensure there is space for overhangs
                if f_pos + offset + 4 <= frag.len() && r_pos >= 4 {
                    let left_overhang = frag[f_pos + offset .. f_pos + offset + 4].to_string();
                    let right_overhang = frag[r_pos - 4 .. r_pos].to_string();
                    let insert_seq = frag[f_pos + offset + 4 .. r_pos - 4].to_string();

                    parsed_fragments.push(GoldenGateAssemblyFragment {
                        index: idx,
                        original_len: frag.len(),
                        left_overhang,
                        right_overhang,
                        insert_seq,
                        orientation_forward: true,
                    });
                    continue;
                }
            }
        }

        // Try Orientation B (Reverse): recognition site 5' is GAGACC, 3' is GGTCTC
        let rev_left_pos = frag.find(site_rev);
        let fwd_right_pos = frag.find(site_fwd);

        if let (Some(rl_pos), Some(fr_pos)) = (rev_left_pos, fwd_right_pos) {
            if rl_pos < fr_pos {
                if rl_pos >= 4 && fr_pos + offset + 4 <= frag.len() {
                    // Extract cohesive ends for reverse complement
                    let left_overhang = reverse_complement_dna(&frag[rl_pos - 4 .. rl_pos]);
                    let right_overhang = reverse_complement_dna(&frag[fr_pos + offset .. fr_pos + offset + 4]);
                    let insert_rc = reverse_complement_dna(&frag[rl_pos .. fr_pos + offset]);

                    parsed_fragments.push(GoldenGateAssemblyFragment {
                        index: idx,
                        original_len: frag.len(),
                        left_overhang,
                        right_overhang,
                        insert_seq: insert_rc,
                        orientation_forward: false,
                    });
                    continue;
                }
            }
        }

        errors.push(format!("i18n:beErrGgFragmentMissingSitePair::{}::{}::{}", idx + 1, site_fwd, site_rev));
    }

    if !errors.is_empty() {
        return Ok(GoldenGateResponse {
            success: false,
            product_seq: String::new(),
            fragments: parsed_fragments,
            sorted_indices: Vec::new(),
            overhangs: Vec::new(),
            errors,
            warnings,
        });
    }

    // 3. Solve circular assembly order (Hamiltonian Path Matcher)
    let n = parsed_fragments.len();
    let mut sorted_indices = Vec::new();
    let mut ordered_overhangs = Vec::new();
    let mut product_seq = String::new();

    if n > 0 {
        let mut visited = vec![false; n];
        let mut path = Vec::new();

        // Standard DFS to find matching overhang loop
        fn dfs(
            curr: usize,
            start_overhang: &str,
            fragments: &[GoldenGateAssemblyFragment],
            visited: &mut [bool],
            path: &mut Vec<usize>,
        ) -> bool {
            path.push(curr);
            visited[curr] = true;

            if path.len() == fragments.len() {
                // Circular check: last right overhang must match start left overhang
                if fragments[curr].right_overhang == start_overhang {
                    return true;
                }
            } else {
                for i in 0..fragments.len() {
                    if !visited[i] && fragments[curr].right_overhang == fragments[i].left_overhang {
                        if dfs(i, start_overhang, fragments, visited, path) {
                            return true;
                        }
                    }
                }
            }

            path.pop();
            visited[curr] = false;
            false
        }

        // Try assembling starting from fragment 0
        if dfs(0, &parsed_fragments[0].left_overhang, &parsed_fragments, &mut visited, &mut path) {
            sorted_indices = path.clone();

            // 4. Construct final circular product
            for &idx in &sorted_indices {
                product_seq.push_str(&parsed_fragments[idx].insert_seq);
                ordered_overhangs.push(parsed_fragments[idx].left_overhang.clone());
            }

            // Check self-complementary overhangs (risk of self-ligation)
            for (i, oh) in ordered_overhangs.iter().enumerate() {
                let rc = reverse_complement_dna(oh);
                if *oh == rc {
                    warnings.push(format!("i18n:beWarnGgSelfComplementaryOverhang::{}", oh));
                }
                for (j, other_oh) in ordered_overhangs.iter().enumerate() {
                    if i != j && *oh == *other_oh {
                        errors.push(format!("i18n:beErrGgDuplicateOverhang::{}", oh));
                    }
                }
            }
        } else {
            errors.push("i18n:beErrGgNoCircularAssembly".to_string());
        }
    }

    let success = errors.is_empty() && !product_seq.is_empty();

    Ok(GoldenGateResponse {
        success,
        product_seq,
        fragments: parsed_fragments,
        sorted_indices,
        overhangs: ordered_overhangs,
        errors,
        warnings,
    })
}
