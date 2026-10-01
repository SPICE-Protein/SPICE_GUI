import { loadOveDemoPlasmid } from './src/lib/genome/demo';
import { getCutsitesFromSequenceFlat, getEnzymesByNames, defaultEnzymesByName } from './src/lib/genome/enzymes';
const demo = loadOveDemoPlasmid();
const names = Object.keys(defaultEnzymesByName as Record<string, unknown>);
const enzymes = getEnzymesByNames(names);
const cs = getCutsitesFromSequenceFlat(demo.sequence, true, enzymes);
console.log('demo len', demo.sequence.length, 'enzymes', enzymes.length, 'cutsites', cs.length, 'uniq', new Set(cs.map(c=>c.name)).size);
