-- Print the scripting API surface available in this build.

local api = {
  apiVersion = spice.apiVersion,
  doc = {
    "spice.doc.name        current document name",
    "spice.doc.sequence    current DNA sequence",
    "spice.doc.length      sequence length in bp",
    "spice.doc.topology    'circular' or 'linear'",
    "spice.doc.features    array of { name, start, end, type, strand }",
    "spice.doc.apply{ sequence=..., name=... }  propose a patch",
  },
  seq = {
    "spice.seq.sub(s, first, last)   1-based, inclusive substring",
    "spice.seq.gc(s)                 GC percent",
    "spice.seq.revcomp(s)            reverse complement",
    "spice.seq.translate(s)          forward translation",
  },
  design = {
    "spice.design.codonOptimize(protein, options) -> { sequence, cai, gc, ... }",
  },
  other = {
    "spice.args            arguments object from the panel",
    "spice.log(msg) / spice.warn(msg) / spice.error(msg)",
    "return a table       displayed as JSON after the run",
  },
}

for _, line in ipairs(api.doc) do spice.log(line) end
for _, line in ipairs(api.seq) do spice.log(line) end

return api
