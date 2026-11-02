// Built-in example: a small mammal phylogeny with branch lengths, support
// values and matching metadata so every color and interaction can be tried.

export const EXAMPLE_NEWICK =
  '((((Homo_sapiens:0.021,Pan_troglodytes:0.024)100:0.041,Gorilla_gorilla:0.068)98:0.052,Pongo_abelii:0.091)100:0.113,((Mus_musculus:0.051,Rattus_norvegicus:0.063)100:0.082,((Canis_lupus:0.071,Felis_catus:0.089)96:0.048,((Bos_taurus:0.061,Sus_scrofa:0.083)94:0.051,Equus_caballus:0.102)89:0.044)92:0.061)99:0.104)100;';

export const EXAMPLE_METADATA = [
  'leaf,group,color',
  'Homo_sapiens,Primates,#4cd6ff',
  'Pan_troglodytes,Primates,#4cd6ff',
  'Gorilla_gorilla,Primates,#4cd6ff',
  'Pongo_abelii,Primates,#4cd6ff',
  'Mus_musculus,Rodents,#ffd23f',
  'Rattus_norvegicus,Rodents,#ffd23f',
  'Canis_lupus,Carnivores,#ff9f1c',
  'Felis_catus,Carnivores,#ff9f1c',
  'Bos_taurus,Artiodactyla,#53d769',
  'Sus_scrofa,Artiodactyla,#53d769',
  'Equus_caballus,Perissodactyla,#b48cff'
].join('\n');
