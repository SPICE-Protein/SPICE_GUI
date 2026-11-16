// GenBank-style feature type -> colour. Shared by the demo loader, the intent
// layer and any caller that adds features so a type always looks the same.

export const FEATURE_TYPE_COLORS: Record<string, string> = {
  cds: '#ef6500',
  gene: '#684e27',
  promoter: '#31b440',
  terminator: '#f51600',
  rep_origin: '#878787',
  origin: '#878787',
  misc_marker: '#8dceb1',
  protein_bind: '#2e2e2e',
  misc_binding: '#006fef',
  rbs: '#bdffcb',
  misc_feature: '#006fef',
  primer_bind: '#53d969',
  tag: '#e419da',
  signal_peptide: '#2fff8d'
};

export const FEATURE_TYPES = Object.keys(FEATURE_TYPE_COLORS);

export function colorForFeatureType(type: string): string {
  return FEATURE_TYPE_COLORS[(type || 'misc_feature').toLowerCase()] || '#4cd6ff';
}
