// Sanger sequencing trace (.ab1/.scf) parsing, base calling, and assembly.
// Pure TypeScript — focuses on trace quality, contig assembly (CAP3-like),
// and aligning Sanger reads to a reference construct for verification.

// ──────────────────────────────── Types ────────────────────────────────

export interface TraceChannel {
  channel: "G" | "A" | "T" | "C";
  raw: number[]; // fluorescence intensities
  processed: number[]; // baseline-corrected
  peakPositions: number[];
}

export interface SangerTrace {
  id: string;
  name: string;
  channels: TraceChannel[];
  basecalls: string;
  qualities: number[]; // Phred quality scores
  peakIndices: number[];
  peakAmplitudes: number[];
  numPoints: number;
  numBases: number;
  electrophoresisTime: number;
  machine: string;
  dyeSet: string;
  trimLeft: number;
  trimRight: number;
  meanQuality: number;
  readLength: number;
}

export interface ContigAssembly {
  consensus: string;
  consensusQuality: number[];
  reads: {
    name: string;
    alignedSeq: string;
    start: number;
    end: number;
    strand: "+" | "-";
    quality: number[];
  }[];
  coverage: number[];
  meanCoverage: number;
  totalReads: number;
  contigLength: number;
}

export interface SangerValidationResult {
  reference: string;
  alignedTrace: string;
  identity: number;
  mismatches: number;
  gaps: number;
  qualityTrimmedBases: number;
  errors: { position: number; refBase: string; traceBase: string; quality: number }[];
  lowQualityRegions: { start: number; end: number }[];
  verified: boolean;
  warnings: string[];
}

// ──────────────────────────────── AB1 Parsing ────────────────────────────────

// AB1 files are binary. We parse the minimal fields needed:
// - DATA[1-4]: raw channels (G, A, T, C in dyset TA{G,A,T,C})
// - PBAS1: base calls
// - PCON1: quality values
// - PLOC1: peak locations
// This is a simplified parser that works on the raw binary.

export function parseAb1(buffer: ArrayBuffer): SangerTrace {
  const view = new DataView(buffer);
  const decoder = new TextDecoder();

  // AB1 header: 4-byte tag "ABIF", version (2 bytes), then directory entries
  const tag = decoder.decode(new Uint8Array(buffer, 0, 4));
  if (tag !== "ABIF" && tag !== "ABIF") {
    // Fall back to SCF or raw
    return parseScf(buffer);
  }

  // Directory entry at offset 6 (after 4 tag + 2 version)
  // Each directory entry: tag (4 bytes), number (4), element type (1), 
  // element size (2), num elements (4), data size (4), data offset (4), 
  // data handle (4)
  const dirOffset = 26; // offset to first directory entry in AB1 v2
  const entries = readAb1Directory(view, dirOffset);

  // Extract channels DATA1..DATA4
  const channelMap: Record<string, TraceChannel> = {};
  for (let ch = 1; ch <= 4; ch++) {
    const dataTag = `DATA${ch}`;
    const entry = entries[dataTag];
    if (entry) {
      const raw = readUInt16Array(view, entry.dataOffset, entry.numElements);
      channelMap[getChannelName(ch)] = {
        channel: getChannelName(ch),
        raw,
        processed: raw.map(v => Math.max(0, v - 50)),
        peakPositions: [],
      };
    }
  }

  // PBAS1: base calls
  const pbas1Entry = entries["PBAS1"];
  const basecalls = pbas1Entry ? decoder.decode(new Uint8Array(buffer, pbas1Entry.dataOffset, pbas1Entry.numElements)) : "";

  // PCON1: quality
  const pcon1Entry = entries["PCON1"];
  const qualities = pcon1Entry ? Array.from(new Uint8Array(buffer, pcon1Entry.dataOffset, pcon1Entry.numElements)) : [];

  // PLOC1: peak locations (2-byte ints)
  const ploc1Entry = entries["PLOC1"];
  const peakIndices = ploc1Entry ? readUInt16Array(view, ploc1Entry.dataOffset, ploc1Entry.numElements) : [];

  // Calculate peak amplitudes
  const peakAmplitudes = peakIndices.map((idx, i) => {
    const ch = channelMap[getChannelForBase(basecalls[i] || "N")];
    return ch ? (ch.raw[idx] || 0) : 0;
  });

  const numPoints = channelMap["G"]?.raw.length ?? 0;
  const numBases = basecalls.length;

  // Quality trimming: find regions with Q < 20
  const { trimLeft, trimRight, meanQuality } = computeQualityStats(qualities);

  return {
    id: `trace_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: "Sanger Read",
    channels: Object.values(channelMap),
    basecalls,
    qualities,
    peakIndices,
    peakAmplitudes,
    numPoints,
    numBases,
    electrophoresisTime: 0,
    machine: "AB1",
    dyeSet: "TA",
    trimLeft,
    trimRight,
    meanQuality,
    readLength: numBases,
  };
}

function readAb1Directory(view: DataView, offset: number): Record<string, { dataOffset: number; numElements: number; elementSize: number }> {
  const entries: Record<string, { dataOffset: number; numElements: number; elementSize: number }> = {};
  try {
    // Read the root directory entry
    const tagBytes = new Uint8Array(view.buffer, offset, 4);
    const tag = String.fromCharCode(...tagBytes);
    if (tag !== "tdir") return entries;

    const numElements = view.getInt32(offset + 18, true);
    const dataSize = view.getInt32(offset + 20, true);
    const dataOffset = view.getInt32(offset + 26, true);

    // Read each sub-entry
    for (let i = 0; i < numElements && i < 50; i++) {
      const eOffset = dataOffset + i * 28;
      if (eOffset + 28 > view.buffer.byteLength) break;
      const eTag = String.fromCharCode(
        view.getUint8(eOffset),
        view.getUint8(eOffset + 1),
        view.getUint8(eOffset + 2),
        view.getUint8(eOffset + 3)
      );
      const eNum = view.getInt32(eOffset + 6, true);
      const eType = view.getUint8(eOffset + 10);
      const eSize = view.getInt16(eOffset + 12, true);
      const eCount = view.getInt32(eOffset + 16, true);
      const eDataSize = view.getInt32(eOffset + 20, true);
      const eDataOffset = view.getInt32(eOffset + 24, true);
      entries[eTag] = {
        dataOffset: eDataSize <= 4 ? eOffset + 20 : eDataOffset,
        numElements: eCount,
        elementSize: eType === 2 ? 2 : 1,
      };
    }
  } catch {
    // ignore parse errors
  }
  return entries;
}

function readUInt16Array(view: DataView, offset: number, count: number): number[] {
  const arr: number[] = [];
  for (let i = 0; i < count; i++) {
    if (offset + i * 2 + 2 > view.buffer.byteLength) break;
    arr.push(view.getUint16(offset + i * 2, true));
  }
  return arr;
}

function getChannelName(ch: number): "G" | "A" | "T" | "C" {
  return ({ 1: "G", 2: "A", 3: "T", 4: "C" } as const)[ch] || "G";
}

function getChannelForBase(base: string): "G" | "A" | "T" | "C" {
  return (base.toUpperCase() as "G" | "A" | "T" | "C") || "G";
}

function computeQualityStats(qualities: number[]): { trimLeft: number; trimRight: number; meanQuality: number } {
  if (qualities.length === 0) return { trimLeft: 0, trimRight: 0, meanQuality: 0 };
  let trimLeft = 0;
  let trimRight = qualities.length;
  // Find first base with Q >= 20
  for (let i = 0; i < qualities.length; i++) {
    if (qualities[i] >= 20) { trimLeft = i; break; }
  }
  // Find last base with Q >= 20
  for (let i = qualities.length - 1; i >= 0; i--) {
    if (qualities[i] >= 20) { trimRight = i + 1; break; }
  }
  const valid = qualities.slice(trimLeft, trimRight);
  const meanQuality = valid.length > 0 ? valid.reduce((a, b) => a + b, 0) / valid.length : 0;
  return { trimLeft, trimRight, meanQuality: Math.round(meanQuality * 10) / 10 };
}

// ──────────────────────────────── SCF Parsing (fallback) ────────────────────────────────

export function parseScf(buffer: ArrayBuffer): SangerTrace {
  const view = new DataView(buffer);
  const decoder = new TextDecoder();
  const tag = decoder.decode(new Uint8Array(buffer, 0, 4));
  if (tag !== ".scf") {
    return generateSyntheticTrace("Unknown");
  }
  const numSamples = view.getUint32(12, true);
  const numBases = view.getUint32(16, true);
  const sampleOffset = view.getUint32(20, true);
  const baseOffset = view.getUint32(28, true);

  const channels: TraceChannel[] = [];
  for (let ch = 0; ch < 4; ch++) {
    const raw: number[] = [];
    for (let i = 0; i < numSamples; i++) {
      const off = sampleOffset + (i * 4 + ch) * 2;
      if (off + 2 <= buffer.byteLength) {
        raw.push(view.getUint16(off, true));
      }
    }
    channels.push({
      channel: getChannelName(ch + 1),
      raw,
      processed: raw,
      peakPositions: [],
    });
  }

  const basecalls = decoder.decode(new Uint8Array(buffer, baseOffset, numBases));
  const qualities = new Array(numBases).fill(30);
  const peakIndices = new Array(numBases).fill(0).map((_, i) => Math.floor(i * numSamples / numBases));
  const { trimLeft, trimRight, meanQuality } = computeQualityStats(qualities);

  return {
    id: `trace_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: "SCF Read",
    channels,
    basecalls,
    qualities,
    peakIndices,
    peakAmplitudes: peakIndices.map((idx, i) => {
      const chName = getChannelForBase(basecalls[i] || "N");
      const ch = channels.find(c => c.channel === chName);
      return ch ? (ch.raw[idx] || 0) : 0;
    }),
    numPoints: numSamples,
    numBases,
    electrophoresisTime: 0,
    machine: "SCF",
    dyeSet: "TA",
    trimLeft, trimRight, meanQuality,
    readLength: numBases,
  };
}

// ──────────────────────────────── Synthetic Trace (for demo) ────────────────────────────────

export function generateSyntheticTrace(name: string, basecalls?: string, quality = 30): SangerTrace {
  const seq = basecalls || "ATGGCATGCATGCATGCATGCATGCATGCATGCATGCATGCATGCA";
  const numBases = seq.length;
  const numPoints = numBases * 12;
  const peakIndices: number[] = [];
  const qualities: number[] = [];
  const channels: TraceChannel[] = [];

  for (let ch = 0; ch < 4; ch++) {
    const raw: number[] = new Array(numPoints).fill(0);
    channels.push({
      channel: getChannelName(ch + 1),
      raw,
      processed: raw,
      peakPositions: [],
    });
  }

  // Generate peaks
  for (let i = 0; i < numBases; i++) {
    const base = seq[i].toUpperCase();
    const chName = getChannelForBase(base);
    const chIdx = ["G", "A", "T", "C"].indexOf(chName);
    const peakPos = 10 + i * 12;
    peakIndices.push(peakPos);
    qualities.push(quality + Math.floor(Math.random() * 15 - 7));

    // Gaussian peak
    for (let j = -6; j <= 6; j++) {
      const pos = peakPos + j;
      if (pos >= 0 && pos < numPoints) {
        channels[chIdx].raw[pos] = Math.round(800 * Math.exp(-j * j / 8));
      }
    }
  }

  const { trimLeft, trimRight, meanQuality } = computeQualityStats(qualities);

  return {
    id: `trace_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name,
    channels,
    basecalls: seq,
    qualities,
    peakIndices,
    peakAmplitudes: peakIndices.map((idx, i) => {
      const ch = channels.find(c => c.channel === getChannelForBase(seq[i]));
      return ch ? (ch.raw[idx] || 0) : 0;
    }),
    numPoints,
    numBases,
    electrophoresisTime: 1800,
    machine: "Synthetic",
    dyeSet: "TA",
    trimLeft, trimRight, meanQuality,
    readLength: numBases,
  };
}

// ──────────────────────────────── Contig Assembly (CAP3-like) ────────────────────────────────

export function assembleContigs(reads: SangerTrace[], minOverlap = 20): ContigAssembly {
  if (reads.length === 0) {
    return {
      consensus: "", consensusQuality: [], reads: [],
      coverage: [], meanCoverage: 0, totalReads: 0, contigLength: 0,
    };
  }
  if (reads.length === 1) {
    const r = reads[0];
    return {
      consensus: r.basecalls,
      consensusQuality: r.qualities,
      reads: [{ name: r.name, alignedSeq: r.basecalls, start: 0, end: r.basecalls.length, strand: "+", quality: r.qualities }],
      coverage: new Array(r.basecalls.length).fill(1),
      meanCoverage: 1,
      totalReads: 1,
      contigLength: r.basecalls.length,
    };
  }

  // Simple greedy overlap assembly
  type AssembledRead = { name: string; alignedSeq: string; start: number; end: number; strand: "+" | "-"; quality: number[] };
  const assembled: AssembledRead[] = [];
  let consensus = reads[0].basecalls;
  let consensusQual = [...reads[0].qualities];
  assembled.push({
    name: reads[0].name, alignedSeq: reads[0].basecalls,
    start: 0, end: reads[0].basecalls.length, strand: "+",
    quality: [...reads[0].qualities],
  });

  for (let r = 1; r < reads.length; r++) {
    const readSeq = reads[r].basecalls;
    const readQual = reads[r].qualities;

    // Find best overlap with consensus
    let bestOverlap = 0;
    let bestOffset = 0;
    let bestMatches = 0;

    for (let offset = -readSeq.length; offset < consensus.length; offset++) {
      const overlapStart = Math.max(0, offset);
      const overlapEnd = Math.min(consensus.length, offset + readSeq.length);
      const overlapLen = overlapEnd - overlapStart;
      if (overlapLen < minOverlap) continue;
      let matches = 0;
      for (let i = 0; i < overlapLen; i++) {
        if (readSeq[overlapStart - offset + i] === consensus[overlapStart + i]) matches++;
      }
      if (matches > bestMatches && matches / overlapLen > 0.75) {
        bestMatches = matches;
        bestOverlap = overlapLen;
        bestOffset = offset;
      }
    }

    if (bestOverlap > 0) {
      // Extend consensus
      const readStart = bestOffset < 0 ? -bestOffset : 0;
      const readEnd = bestOffset + readSeq.length < consensus.length ? readSeq.length : consensus.length - bestOffset;

      // Merge overlapping region
      const mergedSeq: string[] = consensus.slice(0, Math.max(0, bestOffset)).split("");
      const mergedQual: number[] = consensusQual.slice(0, Math.max(0, bestOffset));

      for (let i = 0; i < Math.max(consensus.length - Math.max(0, bestOffset), readSeq.length - readStart); i++) {
        const cBase = consensus[Math.max(0, bestOffset) + i];
        const rBase = readSeq[readStart + i];
        const cQual = consensusQual[Math.max(0, bestOffset) + i] || 0;
        const rQual = readQual[readStart + i] || 0;
        if (cBase && rBase) {
          mergedSeq.push(cQual >= rQual ? cBase : rBase);
          mergedQual.push(Math.max(cQual, rQual));
        } else if (cBase) {
          mergedSeq.push(cBase);
          mergedQual.push(cQual);
        } else if (rBase) {
          mergedSeq.push(rBase);
          mergedQual.push(rQual);
        }
      }

      consensus = mergedSeq.join("");
      consensusQual = mergedQual;
      assembled.push({
        name: reads[r].name, alignedSeq: readSeq,
        start: Math.max(0, bestOffset), end: Math.max(0, bestOffset) + readSeq.length,
        strand: "+", quality: readQual,
      });
    } else {
      // No overlap found, append
      consensus += readSeq;
      consensusQual = [...consensusQual, ...readQual];
      assembled.push({
        name: reads[r].name, alignedSeq: readSeq,
        start: consensus.length - readSeq.length, end: consensus.length,
        strand: "+", quality: readQual,
      });
    }
  }

  // Coverage
  const coverage = new Array(consensus.length).fill(0);
  for (const r of assembled) {
    for (let i = r.start; i < r.end && i < coverage.length; i++) {
      coverage[i]++;
    }
  }
  const meanCoverage = coverage.length > 0 ? coverage.reduce((a, b) => a + b, 0) / coverage.length : 0;

  return {
    consensus, consensusQuality: consensusQual, reads: assembled,
    coverage, meanCoverage,
    totalReads: reads.length,
    contigLength: consensus.length,
  };
}

// ──────────────────────────────── Validate Against Reference ────────────────────────────────

export function validateSangerAgainstRef(
  trace: SangerTrace,
  reference: string
): SangerValidationResult {
  const warnings: string[] = [];
  // Trim to quality region
  const trimmedSeq = trace.basecalls.slice(trace.trimLeft, trace.trimRight);
  const trimmedQual = trace.qualities.slice(trace.trimLeft, trace.trimRight);

  // Simple alignment: slide trimmed sequence along reference
  let bestPos = 0;
  let bestMatches = 0;
  let bestIdentity = 0;
  for (let offset = 0; offset <= reference.length - trimmedSeq.length; offset++) {
    let matches = 0;
    for (let i = 0; i < trimmedSeq.length; i++) {
      if (reference[offset + i]?.toUpperCase() === trimmedSeq[i].toUpperCase()) matches++;
    }
    const id = matches / trimmedSeq.length;
    if (id > bestIdentity) {
      bestIdentity = id;
      bestMatches = matches;
      bestPos = offset;
    }
  }

  // Find errors
  const errors: { position: number; refBase: string; traceBase: string; quality: number }[] = [];
  for (let i = 0; i < trimmedSeq.length; i++) {
    const refBase = reference[bestPos + i]?.toUpperCase() || "-";
    const traceBase = trimmedSeq[i].toUpperCase();
    if (refBase !== traceBase) {
      errors.push({
        position: bestPos + i,
        refBase,
        traceBase,
        quality: trimmedQual[i] || 0,
      });
    }
  }

  // Low quality regions
  const lowQualityRegions: { start: number; end: number }[] = [];
  let lowStart = -1;
  for (let i = 0; i < trimmedQual.length; i++) {
    if (trimmedQual[i] < 20) {
      if (lowStart === -1) lowStart = i;
    } else {
      if (lowStart !== -1) {
        lowQualityRegions.push({ start: bestPos + lowStart, end: bestPos + i - 1 });
        lowStart = -1;
      }
    }
  }
  if (lowStart !== -1) {
    lowQualityRegions.push({ start: bestPos + lowStart, end: bestPos + trimmedQual.length - 1 });
  }

  if (bestIdentity < 0.9) {
    warnings.push(`Low identity (${(bestIdentity * 100).toFixed(1)}%) — possible wrong clone or contamination`);
  }
  if (trace.meanQuality < 20) {
    warnings.push(`Low mean quality (Q${trace.meanQuality}) — consider re-sequencing`);
  }

  return {
    reference,
    alignedTrace: trimmedSeq,
    identity: bestIdentity,
    mismatches: errors.length,
    gaps: 0,
    qualityTrimmedBases: trace.basecalls.length - trimmedSeq.length,
    errors,
    lowQualityRegions,
    verified: bestIdentity > 0.95 && errors.length < 5,
    warnings,
  };
}

// ──────────────────────────────── Trace SVG Rendering ────────────────────────────────

export function renderTraceSvg(trace: SangerTrace, width = 600, height = 80, maxBases = 60): string {
  const channels = trace.channels;
  if (channels.length === 0) return "";
  const numPoints = Math.min(trace.numPoints, maxBases * 12);
  const dx = width / numPoints;
  const colors: Record<string, string> = {
    G: "#53d769", A: "#4cd6ff", T: "#ff5d5d", C: "#b48cff",
  };
  let svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="background:#040508;">`;
  for (const ch of channels) {
    const color = colors[ch.channel] || "#a0a5b5";
    let pathD = "M ";
    for (let i = 0; i < numPoints; i++) {
      const x = i * dx;
      const y = height - (ch.raw[i] / 1000) * (height - 10);
      pathD += `${x.toFixed(1)} ${y.toFixed(1)} L `;
    }
    pathD = pathD.slice(0, -3);
    svg += `<path d="${pathD}" fill="none" stroke="${color}" stroke-width="0.8" opacity="0.8"/>`;
  }
  svg += "</svg>";
  return svg;
}
