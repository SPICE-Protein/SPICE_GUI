// Standard bioinformatics file format parsers and serializers.
// GenBank, FASTA, EMBL, FASTQ — pure TypeScript, no dependencies.

import type { SequenceData } from "./clone";
import { tidyUpSequenceData } from "./model";
import { filterSequenceString } from "./sequence";

// ──────────────────────────────── FASTA ────────────────────────────────

export interface FastaRecord {
  id: string;
  description: string;
  sequence: string;
}

export function parseFasta(text: string): FastaRecord[] {
  const records: FastaRecord[] = [];
  let current: FastaRecord | null = null;
  let seqLines: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith(">")) {
      if (current) {
        current.sequence = seqLines.join("");
        records.push(current);
      }
      const header = line.slice(1);
      const spaceIdx = header.indexOf(" ");
      current = {
        id: spaceIdx >= 0 ? header.slice(0, spaceIdx) : header,
        description: spaceIdx >= 0 ? header.slice(spaceIdx + 1) : "",
        sequence: "",
      };
      seqLines = [];
    } else if (line.startsWith(";")) {
      continue;
    } else {
      seqLines.push(line.trim());
    }
  }
  if (current) {
    current.sequence = seqLines.join("");
    records.push(current);
  }
  return records;
}

export function toFasta(records: FastaRecord[]): string {
  return records.map((r) => {
    const header = r.description ? `${r.id} ${r.description}` : r.id;
    const lines: string[] = [`>${header}`];
    for (let i = 0; i < r.sequence.length; i += 60) {
      lines.push(r.sequence.slice(i, i + 60));
    }
    return lines.join("\n");
  }).join("\n");
}

// ──────────────────────────────── FASTQ ────────────────────────────────

export interface FastqRecord {
  id: string;
  description: string;
  sequence: string;
  plus: string;
  quality: string;
}

export function parseFastq(text: string): FastqRecord[] {
  const lines = text.split(/\r?\n/);
  const records: FastqRecord[] = [];
  let i = 0;
  while (i + 3 < lines.length || (i + 3 === lines.length && lines[i + 3] !== undefined)) {
    if (!lines[i] || !lines[i].startsWith("@")) {
      i++;
      continue;
    }
    const header = lines[i].slice(1);
    const spaceIdx = header.indexOf(" ");
    const seq = lines[i + 1] || "";
    const plus = lines[i + 2] || "";
    const qual = lines[i + 3] || "";
    if (plus.startsWith("+") && qual.length === seq.length) {
      records.push({
        id: spaceIdx >= 0 ? header.slice(0, spaceIdx) : header,
        description: spaceIdx >= 0 ? header.slice(spaceIdx + 1) : "",
        sequence: seq,
        plus,
        quality: qual,
      });
      i += 4;
    } else {
      i++;
    }
  }
  return records;
}

export function toFastq(records: FastqRecord[]): string {
  return records.map((r) => {
    const header = r.description ? `${r.id} ${r.description}` : r.id;
    return `@${header}\n${r.sequence}\n+${r.plus || r.id}\n${r.quality}`;
  }).join("\n");
}

// ──────────────────────────────── GenBank ────────────────────────────────

export function parseGenBank(text: string): SequenceData {
  const lines = text.split(/\r?\n/);
  let seqData: Partial<SequenceData> = {
    sequence: "",
    features: [],
    name: "Imported",
    circular: false,
  };
  let annotations: any[] = [];
  let inOrigin = false;
  let currentFeat: any = null;
  let qualifierBuf = "";
  let qualifierKey = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("LOCUS")) {
      const parts = line.split(/\s+/);
      seqData.name = parts[1] || "Imported";
      if (/circular/i.test(line)) seqData.circular = true;
      if (/RNA/i.test(line) && !/mRNA|tRNA|rRNA|ncRNA/i.test(line)) {
        (seqData as any).isRna = true;
      }
      continue;
    }
    if (line.startsWith("DEFINITION")) {
      const m = line.match(/^DEFINITION\s+(.*)/);
      if (m) (seqData as any).definition = m[1].trim();
      continue;
    }
    if (line.startsWith("FEATURES")) continue;
    if (/^\s{5}\S+/.test(line)) {
      if (currentFeat && qualifierBuf && qualifierKey) {
        currentFeat[qualifierKey] = qualifierBuf;
        qualifierBuf = "";
        qualifierKey = "";
      }
      if (currentFeat) annotations.push(currentFeat);
      const match = line.match(/^\s{5}(\S+)\s+(.*)/);
      currentFeat = {
        type: match ? match[1].toLowerCase() : "misc_feature",
        locations: match ? match[2] : "",
        forward: true,
      };
      qualifierBuf = "";
      qualifierKey = "";
      continue;
    }
    const qualMatch = line.match(/^\s+\/(\w+)="?([^"]*)"?$/);
    if (qualMatch) {
      if (currentFeat && qualifierKey && qualifierBuf) {
        currentFeat[qualifierKey] = qualifierBuf;
      }
      qualifierKey = qualMatch[1];
      qualifierBuf = qualMatch[2] || "";
      continue;
    }
    if (line.startsWith("                     ") && qualifierKey) {
      qualifierBuf += line.trim();
      continue;
    }
    if (line.startsWith("ORIGIN")) {
      if (currentFeat) {
        if (qualifierBuf && qualifierKey) currentFeat[qualifierKey] = qualifierBuf;
        annotations.push(currentFeat);
        currentFeat = null;
      }
      inOrigin = true;
      continue;
    }
    if (inOrigin) {
      if (line.startsWith("//")) {
        inOrigin = false;
        break;
      }
      (seqData as any).sequence += line.replace(/[^a-zA-Z]/g, "");
      continue;
    }
  }
  if (currentFeat) {
    if (qualifierBuf && qualifierKey) currentFeat[qualifierKey] = qualifierBuf;
    annotations.push(currentFeat);
  }

  const features = annotations.map((a, idx) => {
    const locStr = a.locations || "";
    const strand = locStr.startsWith("complement") ? -1 : 1;
    const rangeRegex = /(\d+)\.\.(\d+)/g;
    const positions: { start: number; end: number }[] = [];
    let m;
    while ((m = rangeRegex.exec(locStr)) !== null) {
      positions.push({ start: parseInt(m[1], 10) - 1, end: parseInt(m[2], 10) - 1 });
    }
    if (positions.length === 0) {
      const singleMatch = locStr.match(/(\d+)/);
      if (singleMatch) {
        const p = parseInt(singleMatch[1], 10) - 1;
        positions.push({ start: p, end: p });
      }
    }
    if (positions.length === 0) return null;
    return {
      id: idx + 1,
      name: a.gene || a.label || a.product || a.note || a.type || "Untitled",
      type: a.type,
      start: positions[0].start,
      end: positions[positions.length - 1].end,
      forward: strand === 1,
      strand,
      color: a.apeinfo_fwdcolor || a.apeinfo_graphic_color || a.color || undefined,
      ...(positions.length > 1 ? { locations: positions } : {}),
    };
  }).filter((f) => f !== null);

  (seqData as any).features = features;
  return tidyUpSequenceData(seqData);
}

export function toGenBank(seqData: SequenceData): string {
  const lines: string[] = [];
  const name = (seqData.name || "Untitled").slice(0, 16);
  const size = seqData.sequence.length;
  const molType = seqData.isRna ? "RNA" : "DNA";
  const topology = seqData.circular ? "circular" : "linear";
  const date = new Date().toISOString().slice(0, 10);
  const def = (seqData as any).definition || name;
  lines.push(`LOCUS       ${name.padEnd(16)} ${String(size).padStart(11)} bp    ${molType.padEnd(6)}             ${topology.padEnd(8)} ${date}`);
  lines.push(`DEFINITION  ${def}.`);
  lines.push(`ACCESSION   ${name}`);
  lines.push(`VERSION    ${name}`);
  lines.push("FEATURES             Location/Qualifiers");
  lines.push("     source          1.." + size);
  const features = (seqData.features as any[]) || [];
  for (const feat of features) {
    const fType = (feat.type || "misc_feature").toUpperCase();
    const start1 = (feat.start ?? 0) + 1;
    const end1 = (feat.end ?? 0) + 1;
    let locStr: string;
    if (feat.locations && feat.locations.length > 1) {
      const parts = feat.locations.map((l: any) => `${l.start + 1}..${l.end + 1}`);
      locStr = `join(${parts.join(",")})`;
    } else {
      locStr = `${start1}..${end1}`;
    }
    if (feat.forward === false || feat.strand === -1) {
      locStr = `complement(${locStr})`;
    }
    lines.push(`     ${fType.padEnd(16)} ${locStr}`);
    if (feat.name) lines.push(`                     /gene="${feat.name}"`);
    if (feat.type) lines.push(`                     /note="${feat.type}"`);
  }
  lines.push("ORIGIN");
  const seq = seqData.sequence.toUpperCase();
  for (let i = 0; i < seq.length; i += 60) {
    const chunk = seq.slice(i, i + 60);
    const groups: string[] = [];
    for (let j = 0; j < chunk.length; j += 10) groups.push(chunk.slice(j, j + 10));
    const lineNum = String(i + 1).padStart(9, " ");
    lines.push(`${lineNum} ${groups.join(" ")}`);
  }
  lines.push("//");
  return lines.join("\n");
}

// ──────────────────────────────── EMBL ────────────────────────────────

export function parseEmbl(text: string): SequenceData {
  const lines = text.split(/\r?\n/);
  let seqData: Partial<SequenceData> = {
    sequence: "",
    features: [],
    name: "Imported",
    circular: false,
  };
  let annotations: any[] = [];
  let inSeq = false;
  let currentFeat: any = null;
  let qualifierKey = "";
  let qualifierBuf = "";
  for (const line of lines) {
    if (line.startsWith("ID")) {
      const m = line.match(/^ID\s+(\S+)/);
      if (m) seqData.name = m[1];
      if (/circular/i.test(line)) seqData.circular = true;
      continue;
    }
    if (line.startsWith("DE")) {
      const m = line.match(/^DE\s+(.*)/);
      if (m) (seqData as any).definition = m[1].trim();
      continue;
    }
    if (line.startsWith("FH")) continue;
    if (line.startsWith("FT")) {
      const content = line.slice(2).trim();
      const ftMatch = content.match(/^(\S+)\s+(.*)/);
      if (ftMatch) {
        if (currentFeat) {
          if (qualifierBuf && qualifierKey) currentFeat[qualifierKey] = qualifierBuf;
          annotations.push(currentFeat);
        }
        currentFeat = {
          type: ftMatch[1].toLowerCase(),
          locations: ftMatch[2],
          forward: true,
        };
        qualifierBuf = "";
        qualifierKey = "";
      } else {
        const qualMatch = content.match(/^\/(\w+)="?([^"]*)"?$/);
        if (qualMatch) {
          if (currentFeat && qualifierBuf && qualifierKey) {
            currentFeat[qualifierKey] = qualifierBuf;
          }
          qualifierKey = qualMatch[1];
          qualifierBuf = qualMatch[2] || "";
        } else if (qualifierKey) {
          qualifierBuf += content.replace(/"/g, "");
        }
      }
      continue;
    }
    if (line.startsWith("SQ")) {
      if (currentFeat) {
        if (qualifierBuf && qualifierKey) currentFeat[qualifierKey] = qualifierBuf;
        annotations.push(currentFeat);
        currentFeat = null;
      }
      inSeq = true;
      continue;
    }
    if (line.startsWith("//")) break;
    if (inSeq) {
      (seqData as any).sequence += line.replace(/[^a-zA-Z]/g, "");
      continue;
    }
  }
  const features = annotations.map((a, idx) => {
    const locStr = a.locations || "";
    const strand = locStr.startsWith("complement") ? -1 : 1;
    const rangeRegex = /(\d+)\.\.(\d+)/g;
    const positions: { start: number; end: number }[] = [];
    let m;
    while ((m = rangeRegex.exec(locStr)) !== null) {
      positions.push({ start: parseInt(m[1], 10) - 1, end: parseInt(m[2], 10) - 1 });
    }
    if (positions.length === 0) {
      const singleMatch = locStr.match(/(\d+)/);
      if (singleMatch) {
        const p = parseInt(singleMatch[1], 10) - 1;
        positions.push({ start: p, end: p });
      }
    }
    if (positions.length === 0) return null;
    return {
      id: idx + 1,
      name: a.gene || a.label || a.product || a.note || a.type || "Untitled",
      type: a.type,
      start: positions[0].start,
      end: positions[positions.length - 1].end,
      forward: strand === 1,
      strand,
      ...(positions.length > 1 ? { locations: positions } : {}),
    };
  }).filter((f) => f !== null);
  (seqData as any).features = features;
  return tidyUpSequenceData(seqData);
}

export function toEmbl(seqData: SequenceData): string {
  const lines: string[] = [];
  const name = (seqData.name || "Untitled").slice(0, 16);
  const size = seqData.sequence.length;
  const topology = seqData.circular ? "circular" : "linear";
  lines.push(`ID   ${name}; ${topology}; genomic DNA; STD; ${size} BP.`);
  lines.push("XX");
  lines.push(`DE   ${((seqData as any).definition || name)}.`);
  lines.push("XX");
  lines.push("FH   Key             Location/Qualifiers");
  lines.push("FH");
  lines.push(`FT   source          1..${size}`);
  const features = (seqData.features as any[]) || [];
  for (const feat of features) {
    const fType = (feat.type || "misc_feature");
    const start1 = (feat.start ?? 0) + 1;
    const end1 = (feat.end ?? 0) + 1;
    let locStr = `${start1}..${end1}`;
    if (feat.forward === false || feat.strand === -1) {
      locStr = `complement(${locStr})`;
    }
    lines.push(`FT   ${fType.padEnd(16)} ${locStr}`);
    if (feat.name) lines.push(`FT                   /gene="${feat.name}"`);
  }
  lines.push("XX");
  lines.push(`SQ   Sequence ${size} BP;`);
  const seq = seqData.sequence.toUpperCase();
  for (let i = 0; i < seq.length; i += 60) {
    const chunk = seq.slice(i, i + 60);
    const groups: string[] = [];
    for (let j = 0; j < chunk.length; j += 10) groups.push(chunk.slice(j, j + 10));
    const lineNum = String(i + 1).padStart(9, " ");
    lines.push(`     ${lineNum} ${groups.join(" ")}`);
  }
  lines.push("//");
  return lines.join("\n");
}

// ──────────────────────────────── Dispatch ────────────────────────────────

export type SeqFileFormat = "genbank" | "fasta" | "embl" | "fastq" | "spiceg" | "plain";

export function detectFormat(text: string, fileName?: string): SeqFileFormat {
  if (fileName) {
    const ext = fileName.toLowerCase().split(".").pop();
    if (ext === "gb" || ext === "gbk" || ext === "genbank") return "genbank";
    if (ext === "fasta" || ext === "fa" || ext === "fna" || ext === "faa") return "fasta";
    if (ext === "embl" || ext === "ebl") return "embl";
    if (ext === "fastq" || ext === "fq") return "fastq";
    if (ext === "spiceg") return "spiceg";
  }
  const t = text.trim();
  if (t.startsWith("LOCUS")) return "genbank";
  if (t.startsWith("ID   ")) return "embl";
  if (t.startsWith("@")) return "fastq";
  if (t.startsWith(">")) return "fasta";
  if (t.includes('"format": "SPICE_GENE"')) return "spiceg";
  return "plain";
}

export function parseSequenceFile(text: string, fileName?: string): SequenceData {
  const fmt = detectFormat(text, fileName);
  switch (fmt) {
    case "genbank": return parseGenBank(text);
    case "embl": return parseEmbl(text);
    case "fasta": {
      const recs = parseFasta(text);
      const rec = recs[0] || { id: "Imported", description: "", sequence: "" };
      const [cleanSeq] = filterSequenceString(rec.sequence);
      return tidyUpSequenceData({ sequence: cleanSeq, name: rec.id || "Imported", features: [], circular: false });
    }
    case "fastq": {
      const recs = parseFastq(text);
      const rec = recs[0] || { id: "Imported", sequence: "" };
      const [cleanSeq] = filterSequenceString(rec.sequence);
      return tidyUpSequenceData({ sequence: cleanSeq, name: rec.id || "Imported", features: [], circular: false });
    }
    case "spiceg": {
      const data = JSON.parse(text);
      return tidyUpSequenceData(data);
    }
    default: {
      const [cleanSeq] = filterSequenceString(text);
      return tidyUpSequenceData({
        sequence: cleanSeq,
        name: fileName?.replace(/\.[^.]+$/, "") || "Imported",
        features: [],
        circular: false,
      });
    }
  }
}

export function serializeSequenceData(seqData: SequenceData, format: SeqFileFormat): string {
  switch (format) {
    case "genbank": return toGenBank(seqData);
    case "embl": return toEmbl(seqData);
    case "fasta": return toFasta([{ id: seqData.name || "Untitled", description: "", sequence: seqData.sequence }]);
    case "spiceg": return JSON.stringify(seqData, null, 2);
    default: return seqData.sequence;
  }
}

// ──────────────────────────────── UniProt Importer ────────────────────────────────

export interface UniProtFeature {
  id: string;
  name: string;
  type: string;
  start: number;
  end: number;
  forward: boolean;
  strand: number;
  notes?: string;
  color?: string;
}

/**
 * Parses UniProt GFF3 format text directly into Svelte SequenceData structure,
 * resolving protein features, transmembrane domains, signal peptides, active sites, etc.
 */
export function parseUniProtGff(gffText: string): SequenceData {
  const lines = gffText.split(/\r?\n/);
  const features: UniProtFeature[] = [];
  let seq = "";
  let id = "P12345";
  let proteinName = "UniProt Protein";
  let inFasta = false;
  let fastaLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Handle FASTA sequence section at the bottom if present (typical of GFF3)
    if (trimmed === "##FASTA") {
      inFasta = true;
      continue;
    }
    if (inFasta) {
      if (!trimmed.startsWith(">")) {
        fastaLines.push(trimmed);
      } else {
        const header = trimmed.slice(1);
        proteinName = header.split("|")[2] || header;
      }
      continue;
    }

    if (trimmed.startsWith("#")) {
      continue;
    }

    const parts = trimmed.split("\t");
    if (parts.length >= 9) {
      id = parts[0];
      const type = parts[2];
      const start = parseInt(parts[3], 10) - 1;
      const end = parseInt(parts[4], 10) - 1;
      const strand = parts[6] === "-" ? -1 : 1;

      // Parse GFF attributes
      const attrs: Record<string, string> = {};
      parts[8].split(";").forEach((pair) => {
        const kv = pair.split("=");
        if (kv[0] && kv[1]) {
          attrs[kv[0].trim()] = decodeURIComponent(kv[1].trim());
        }
      });

      const name = attrs["Name"] || attrs["Note"] || attrs["ID"] || type;

      // Map UniProt functional features to standard colors
      let color: string | undefined;
      switch (type.toUpperCase()) {
        case "CHAIN": color = "gold"; break;
        case "TRANSMEM": color = "cyan"; break;
        case "SIGNAL": color = "magenta"; break;
        case "ACTIVE_SITE": color = "red"; break;
        case "DOMAIN": color = "orange"; break;
        case "HELIX": color = "green"; break;
        case "STRAND": color = "blue"; break;
        default: color = undefined;
      }

      features.push({
        id: `uniprot_${features.length + 1}`,
        name,
        type: type.toLowerCase(),
        start,
        end,
        forward: strand !== -1,
        strand,
        notes: attrs["Note"] || attrs["Ontology_term"] || "",
        color
      });
    }
  }

  if (fastaLines.length > 0) {
    seq = fastaLines.join("");
  } else {
    // Fallback if no FASTA block: deduce size from features
    const maxCoord = features.reduce((max, f) => Math.max(max, f.end), 100);
    seq = "M" + "A".repeat(maxCoord);
  }

  return tidyUpSequenceData({
    sequence: seq,
    features,
    name: proteinName || `UniProt_${id}`,
    isProtein: true
  });
}

// ──────────────────────────────── SnapGene .dna Binary Parser ────────────────────────────────

export function parseSnapGeneFeaturesXml(xmlText: string): any[] {
  const features: any[] = [];
  if (typeof window === "undefined" || !window.DOMParser) {
    return features;
  }

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, "text/xml");
    const featureNodes = doc.getElementsByTagName("Feature");

    for (let i = 0; i < featureNodes.length; i++) {
      const node = featureNodes[i];
      const name = node.getAttribute("name") || "Untitled";
      const type = node.getAttribute("type") || "misc_feature";
      const color = node.getAttribute("color") || "#5c6bc0";
      
      const directionAttr = node.getAttribute("direction") || "1";
      const forward = directionAttr !== "2"; // 1 = fwd, 2 = rev, 0 = bidirectional

      const segmentNodes = node.getElementsByTagName("Segment");
      for (let j = 0; j < segmentNodes.length; j++) {
        const seg = segmentNodes[j];
        const range = seg.getAttribute("range");
        if (range) {
          const [startStr, endStr] = range.split("-");
          const start = parseInt(startStr, 10);
          const end = parseInt(endStr, 10);

          if (!isNaN(start) && !isNaN(end)) {
            features.push({
              id: features.length + 1,
              name,
              start,
              end,
              type,
              color,
              forward
            });
          }
        }
      }
    }
  } catch (e) {
    console.error("Failed to parse SnapGene XML features", e);
  }

  return features;
}

/**
 * Parses binary SnapGene .dna file format bytes.
 * Layout:
 * - Bytes 0-8: Header (magic byte 0x09 followed by "SnapGene" string)
 * - Bytes 9-10: Flags (endianness and circularity/topology, where flags & 0x01 = circular)
 * - Then blocks repeat:
 *   - 1 byte: Tag (block ID)
 *   - 4 bytes: length (big-endian 32-bit int)
 *   - `length` bytes: block payload
 */
export function parseSnapGeneDna(bytes: Uint8Array): SequenceData {
  const len = bytes.length;
  if (len < 11) {
    throw new Error("Invalid .dna file: file is too short");
  }

  if (bytes[0] !== 0x09) {
    throw new Error("Invalid .dna file: incorrect magic byte");
  }
  const magic = String.fromCharCode(...bytes.slice(1, 9));
  if (magic !== "SnapGene") {
    throw new Error("Invalid .dna file: incorrect magic string: " + magic);
  }

  const flags = bytes[9];
  let isCircular = (flags & 0x01) === 0x01;

  let sequence = "";
  let features: any[] = [];
  let name = "Imported SnapGene";

  let offset = 11;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  while (offset + 5 <= len) {
    const tag = bytes[offset];
    const blockLen = view.getUint32(offset + 1, false); // Big endian
    offset += 5;

    if (offset + blockLen > len) {
      break;
    }

    const payload = bytes.slice(offset, offset + blockLen);
    offset += blockLen;

    if (tag === 0) {
      sequence = String.fromCharCode(...payload).toUpperCase().replace(/[^ATCGN]/g, "");
    } else if (tag === 1) {
      const xmlText = new TextDecoder("utf-8").decode(payload);
      features = parseSnapGeneFeaturesXml(xmlText);
    } else if (tag === 6) {
      const xmlText = new TextDecoder("utf-8").decode(payload);
      if (xmlText.includes('circular="true"') || xmlText.includes('circular="1"')) {
        isCircular = true;
      } else if (xmlText.includes('circular="false"') || xmlText.includes('circular="0"')) {
        isCircular = false;
      }
    }
  }

  return tidyUpSequenceData({
    sequence,
    features,
    name,
    circular: isCircular
  });
}
