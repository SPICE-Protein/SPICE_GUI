// Marker ladder presets. Band sizes are taken from the manufacturers' product
// pages and manuals (catalogue numbers in the names). DNA ladders are in bp,
// protein ladders in kDa (apparent molecular weight of the prestained bands);
// `ref` lists the brighter indicator bands the datasheet marks.
//
// Prestained protein sizes are calibrated in a Tris-glycine (Laemmli) system
// and shift with gel percentage and buffer, so sizes read from them are
// estimates. Mark the tube actually used as a favourite in the editor.

export type GelKind = 'dna' | 'protein';

export interface LadderDef {
  id: string;
  name: string;
  kind: GelKind;
  /** Largest to smallest. */
  sizes: number[];
  /** Indicator bands, a subset of `sizes`. */
  ref: number[];
  /** True for user-defined ladders stored in the project. */
  custom?: boolean;
}

export const BUILTIN_LADDERS: LadderDef[] = [
  { id: 'gr1kb', name: "Thermo GeneRuler 1 kb (SM0311)", kind: 'dna', sizes: [10000, 8000, 6000, 5000, 4000, 3500, 3000, 2500, 2000, 1500, 1000, 750, 500, 250], ref: [6000, 3000, 1000] },
  { id: 'gr1kbplus', name: "Thermo GeneRuler 1 kb Plus (SM1331)", kind: 'dna', sizes: [20000, 10000, 7000, 5000, 4000, 3000, 2000, 1500, 1000, 700, 500, 400, 300, 200, 75], ref: [5000, 1500, 500] },
  { id: 'gr100plus', name: "Thermo GeneRuler 100 bp Plus (SM0321)", kind: 'dna', sizes: [3000, 2000, 1500, 1200, 1000, 900, 800, 700, 600, 500, 400, 300, 200, 100], ref: [1000, 500] },
  { id: 'gr100', name: "Thermo GeneRuler 100 bp (SM0241)", kind: 'dna', sizes: [1000, 900, 800, 700, 600, 500, 400, 300, 200, 100], ref: [500] },
  { id: 'gr50', name: "Thermo GeneRuler 50 bp (SM0371)", kind: 'dna', sizes: [1000, 900, 800, 700, 600, 500, 400, 300, 250, 200, 150, 100, 50], ref: [500, 250] },
  { id: 'grmix', name: "Thermo GeneRuler DNA Ladder Mix (SM0331)", kind: 'dna', sizes: [10000, 8000, 6000, 5000, 4000, 3500, 3000, 2500, 2000, 1500, 1200, 1000, 900, 800, 700, 600, 500, 400, 300, 200, 100], ref: [3000, 1000, 500] },
  { id: 'grlow', name: "Thermo GeneRuler Low Range (SM1191)", kind: 'dna', sizes: [700, 500, 400, 300, 200, 150, 100, 75, 50, 25], ref: [300, 100] },
  { id: 'grulow', name: "Thermo GeneRuler Ultra Low Range (SM1211)", kind: 'dna', sizes: [300, 200, 150, 100, 75, 50, 35, 25, 20, 15, 10], ref: [50] },
  { id: 'grexpress', name: "Thermo GeneRuler Express (SM1553)", kind: 'dna', sizes: [5000, 3000, 2000, 1500, 1000, 750, 500, 300, 100], ref: [1500, 500] },
  { id: 'neb1kb', name: "NEB 1 kb DNA Ladder (N3232)", kind: 'dna', sizes: [10000, 8000, 6000, 5000, 4000, 3000, 2000, 1500, 1000, 500], ref: [3000] },
  { id: 'neb100', name: "NEB 100 bp DNA Ladder (N3231)", kind: 'dna', sizes: [1517, 1200, 1000, 900, 800, 700, 600, 500, 400, 300, 200, 100], ref: [1000, 500] },
  { id: 'neb1kbplus', name: "NEB 1 kb Plus DNA Ladder (N3200)", kind: 'dna', sizes: [10000, 8000, 6000, 5000, 4000, 3000, 2000, 1500, 1200, 1000, 900, 800, 700, 600, 500, 400, 300, 200, 100], ref: [3000, 1000, 500] },
  { id: 'dl2000', name: "Takara DL2000 (3427A)", kind: 'dna', sizes: [2000, 1000, 750, 500, 250, 100], ref: [750] },
  { id: 'dl5000', name: "Takara DL5000 (3428A)", kind: 'dna', sizes: [5000, 3000, 2000, 1500, 1000, 750, 500, 250, 100], ref: [1000] },
  { id: 'dl15000', name: "Takara DL15000 (3582A)", kind: 'dna', sizes: [15000, 10000, 7500, 5000, 2500, 1000, 250], ref: [] },
  { id: 'trans2k', name: "TransGen Trans2K (BM101)", kind: 'dna', sizes: [2000, 1000, 750, 500, 250, 100], ref: [750] },
  { id: 'trans2kplus', name: "TransGen Trans2K Plus (BM111)", kind: 'dna', sizes: [5000, 3000, 2000, 1000, 750, 500, 250, 100], ref: [750] },
  { id: 'trans2kplus2', name: "TransGen Trans2K Plus II (BM121)", kind: 'dna', sizes: [8000, 5000, 3000, 2000, 1000, 750, 500, 250, 100], ref: [750] },
  { id: 'trans5k', name: "TransGen Trans5K", kind: 'dna', sizes: [5000, 3000, 2000, 1500, 1000, 800, 500, 300], ref: [1500] },
  { id: 'trans15k', name: "TransGen Trans15K (BM161)", kind: 'dna', sizes: [15000, 10000, 7500, 5000, 3000, 1500, 1000, 500], ref: [5000] },
  { id: 'tiangen2000', name: "Tiangen Marker D2000 (MD114)", kind: 'dna', sizes: [2000, 1000, 750, 500, 250, 100], ref: [750] },
  { id: 'yeasen1kb', name: "Yeasen GoldBand 1 kb (10510ES)", kind: 'dna', sizes: [12000, 8000, 6000, 5000, 4000, 3000, 2500, 2000, 1500, 1000, 750, 500, 250], ref: [4000, 1500] },
  { id: 'yeasen100plus', name: "Yeasen GoldBand 100 bp Plus (10516ES)", kind: 'dna', sizes: [3000, 2000, 1500, 1200, 1000, 900, 800, 700, 600, 500, 400, 300, 200, 100], ref: [1200, 500] },
  { id: 'biorad_dual', name: "Bio-Rad Precision Plus Dual Color (161-0374)", kind: 'protein', sizes: [250, 150, 100, 75, 50, 37, 25, 20, 15, 10], ref: [75, 25] },
  { id: 'biorad_allblue', name: "Bio-Rad Precision Plus All Blue (161-0373)", kind: 'protein', sizes: [250, 150, 100, 75, 50, 37, 25, 20, 15, 10], ref: [75, 50, 25] },
  { id: 'biorad_kaleido', name: "Bio-Rad Precision Plus Kaleidoscope (161-0375)", kind: 'protein', sizes: [250, 150, 100, 75, 50, 37, 25, 20, 15, 10], ref: [150, 75, 37, 25, 10] },
  { id: 'biorad_unstained', name: "Bio-Rad Precision Plus Unstained (161-0363)", kind: 'protein', sizes: [250, 150, 100, 75, 50, 37, 25, 20, 15, 10], ref: [75, 50, 25] },
  { id: 'biorad_dualxtra', name: "Bio-Rad Precision Plus Dual Xtra (161-0377)", kind: 'protein', sizes: [250, 150, 100, 75, 50, 37, 25, 20, 15, 10, 5, 2], ref: [75, 25, 2] },
  { id: 'thermo_26616', name: "Thermo PageRuler Prestained 10–180 kDa (26616)", kind: 'protein', sizes: [180, 130, 100, 70, 55, 40, 35, 25, 15, 10], ref: [70, 25, 10] },
  { id: 'thermo_26619', name: "Thermo PageRuler Plus Prestained 10–250 kDa (26619)", kind: 'protein', sizes: [250, 130, 100, 70, 55, 35, 25, 15, 10], ref: [70, 25, 10] },
  { id: 'thermo_26614', name: "Thermo PageRuler Unstained 10–200 kDa (26614)", kind: 'protein', sizes: [200, 150, 120, 100, 85, 70, 60, 50, 40, 30, 25, 20, 15, 10], ref: [50] },
  { id: 'thermo_26610', name: "Thermo Pierce Unstained Protein MW Marker 14.4–116 kDa (26610)", kind: 'protein', sizes: [116, 66.2, 45, 35, 25, 18.4, 14.4], ref: [] },
  { id: 'thermo_26632', name: "Thermo PageRuler Unstained Low Range 3.4–100 kDa (26632, Tricine)", kind: 'protein', sizes: [100, 30, 25, 20, 15, 10, 5, 3.4], ref: [25] },
  { id: 'thermo_26634', name: "Thermo Spectra Multicolor Broad Range (26634)", kind: 'protein', sizes: [260, 140, 100, 70, 50, 40, 35, 25, 15, 10], ref: [260, 70, 50, 40, 10] },
  { id: 'thermo_26625', name: "Thermo Spectra Multicolor High Range (26625)", kind: 'protein', sizes: [300, 250, 180, 130, 100, 70, 50, 40], ref: [300, 70, 50] },
  { id: 'thermo_26628', name: "Thermo Spectra Multicolor Low Range (26628, Tricine)", kind: 'protein', sizes: [40, 25, 15, 10, 4.6, 1.7], ref: [40, 10] },
  { id: 'novex_lc5800', name: "Invitrogen Novex Sharp Pre-stained (LC5800)", kind: 'protein', sizes: [260, 160, 110, 80, 60, 50, 40, 30, 20, 15, 10, 3.5], ref: [] },
  { id: 'seeblue_lc5925', name: "Invitrogen SeeBlue Plus2 (LC5925, Tris-glycine values)", kind: 'protein', sizes: [250, 148, 98, 64, 50, 36, 22, 16, 6, 4], ref: [] },
  { id: 'neb_p7719', name: "NEB Color Prestained Broad Range (P7719)", kind: 'protein', sizes: [250, 180, 130, 95, 72, 55, 43, 34, 26, 17, 10], ref: [72, 26] },
  { id: 'neb_p7717', name: "NEB Unstained Broad Range (P7717)", kind: 'protein', sizes: [200, 150, 100, 85, 70, 60, 50, 40, 30, 25, 20, 15, 10], ref: [] },
  { id: 'abcam_ab116028', name: "Abcam Prestained Broad Range (ab116028, Tris-glycine values)", kind: 'protein', sizes: [245, 180, 135, 100, 75, 63, 48, 35, 25, 20, 17, 11], ref: [75, 25] },
  { id: 'genscript_m00624', name: "GenScript Broad Multi Color (M00624)", kind: 'protein', sizes: [270, 175, 130, 95, 65, 50, 35, 30, 15, 10], ref: [270, 50, 30] },
  { id: 'yeasen_p180', name: "Yeasen GoldBand Plus 3-color 10–180 kDa (26616ES)", kind: 'protein', sizes: [180, 130, 100, 70, 55, 40, 35, 25, 15, 10], ref: [70, 25, 10] },
  { id: 'epizyme_wj101', name: "Epizyme 15–150 kDa (WJ101)", kind: 'protein', sizes: [150, 100, 70, 50, 40, 35, 25, 20, 15], ref: [70, 25] },
  { id: 'epizyme_wj102', name: "Epizyme Two-color 10–250 kDa (WJ102)", kind: 'protein', sizes: [250, 150, 100, 70, 50, 40, 35, 25, 20, 15, 10], ref: [70, 25] },
  { id: 'epizyme_wj103', name: "Epizyme Three-color 10–250 kDa (WJ103)", kind: 'protein', sizes: [250, 150, 100, 70, 50, 40, 35, 25, 20, 15, 10], ref: [70, 25] },
  { id: 'epizyme_wj106', name: "Epizyme NIR 10–250 kDa (WJ106)", kind: 'protein', sizes: [250, 150, 100, 70, 50, 40, 35, 25, 20, 15, 10], ref: [70, 25] },
  { id: 'epizyme_wj107', name: "Epizyme Three-color 10–180 kDa (WJ107)", kind: 'protein', sizes: [180, 130, 100, 70, 55, 40, 35, 25, 15, 10], ref: [70, 10] },
  { id: 'beyotime_p0068', name: "Beyotime Prestained 10–180 kDa (P0068/P0069)", kind: 'protein', sizes: [180, 130, 95, 72, 55, 43, 34, 26, 17, 10], ref: [72, 10] },
  { id: 'beyotime_p0071', name: "Beyotime BeyoColor 6.5–270 kDa (P0071/P0072)", kind: 'protein', sizes: [270, 175, 130, 95, 66, 52, 37, 30, 16, 6.5], ref: [270, 52, 30] },
  { id: 'beyotime_p0075', name: "Beyotime BeyoColor 10–170 kDa (P0075/P0076/P0077)", kind: 'protein', sizes: [170, 130, 100, 70, 55, 45, 35, 25, 15, 10], ref: [70, 15] },
  { id: 'beyotime_p0776', name: "Beyotime BeyoColor 10–250 kDa (P0776)", kind: 'protein', sizes: [250, 130, 100, 70, 50, 40, 30, 25, 20, 15, 10], ref: [70, 25] },
  { id: 'beyotime_p0773', name: "Beyotime BeyoColor 8–180 kDa (P0773)", kind: 'protein', sizes: [180, 130, 100, 70, 55, 43, 33, 25, 17, 8], ref: [70, 8] },
  { id: 'beyotime_p0779', name: "Beyotime BeyoColor 25–300 kDa (P0779)", kind: 'protein', sizes: [300, 250, 200, 160, 130, 100, 70, 45, 25], ref: [70, 25] },
  { id: 'beyotime_p0771', name: "Beyotime BeyoColor 2.7–40 kDa (P0771, Tricine)", kind: 'protein', sizes: [40, 30, 25, 20, 15, 10, 6.5, 4.2, 2.7], ref: [40, 10] },
  { id: 'beyotime_p0060', name: "Beyotime Unstained 10–150 kDa (P0060)", kind: 'protein', sizes: [150, 95, 80, 66, 52, 42, 35, 25, 15, 10], ref: [] },
  { id: 'beyotime_p0063', name: "Beyotime Unstained 10–200 kDa (P0063)", kind: 'protein', sizes: [200, 150, 120, 100, 85, 70, 60, 50, 40, 30, 25, 20, 15, 10], ref: [50] },
  { id: 'transgen_dm111', name: "TransGen Blue Plus II (DM111)", kind: 'protein', sizes: [120, 100, 70, 50, 40, 30, 25, 14], ref: [120, 50, 14] },
  { id: 'transgen_dm141', name: "TransGen Blue Plus V (DM141)", kind: 'protein', sizes: [190, 140, 95, 70, 55, 43, 33, 26, 20, 15, 10], ref: [70, 20] },
  { id: 'transgen_dm151', name: "TransGen Blue Plus VI (DM151)", kind: 'protein', sizes: [250, 130, 100, 72, 50, 40, 30, 25, 20, 15, 10], ref: [72, 25] },
  { id: 'transgen_dr201', name: "TransGen ProteinRuler II unstained (DR201)", kind: 'protein', sizes: [120, 100, 80, 60, 50, 40, 30, 20, 12], ref: [50] },
  { id: 'solarbio_pr1910', name: "Solarbio Rainbow 180 (PR1910)", kind: 'protein', sizes: [180, 135, 100, 75, 63, 48, 35, 25, 17, 11], ref: [75, 25] },
  { id: 'solarbio_pr1920', name: "Solarbio Rainbow 245 (PR1920)", kind: 'protein', sizes: [245, 180, 135, 100, 75, 63, 48, 35, 25, 20, 17, 11], ref: [75, 25] },
  { id: 'sangon_c610110', name: "Sangon RealBand Marker II (C610110)", kind: 'protein', sizes: [180, 130, 95, 72, 52, 41, 31, 25, 17, 10], ref: [72, 10] },
  { id: 'sangon_c610210', name: "Sangon RealBand Two-color 10–250 kDa (C610210)", kind: 'protein', sizes: [250, 150, 100, 70, 50, 40, 35, 25, 20, 15, 10], ref: [70, 25] },
];

const BY_ID = new Map(BUILTIN_LADDERS.map((l) => [l.id, l]));

export function allLadders(custom: LadderDef[] = []): LadderDef[] {
  return [...BUILTIN_LADDERS, ...custom];
}

export function ladderById(id: string, custom: LadderDef[] = []): LadderDef | null {
  if (BY_ID.has(id)) return BY_ID.get(id)!;
  return custom.find((l) => l.id === id) ?? null;
}

export function laddersFor(kind: GelKind, custom: LadderDef[] = []): LadderDef[] {
  return allLadders(custom).filter((l) => l.kind === kind);
}

export function unitForKind(kind: GelKind): 'bp' | 'kDa' {
  return kind === 'protein' ? 'kDa' : 'bp';
}

/** Sort a ladder's sizes largest to smallest, de-duplicated. */
export function normalizeSizes(sizes: number[]): number[] {
  return [...new Set(sizes.filter((n) => Number.isFinite(n) && n > 0))].sort((a, b) => b - a);
}
