-- Scan the open document for short DNA motifs.
-- Arguments: { "motifs": ["GAATTC", "GGATCC"], "ignoreCase": true }

local motifs = spice.args.motifs or { "GAATTC", "GGATCC" }
local seq = spice.doc.sequence
if spice.args.ignoreCase ~= false then
  seq = string.upper(seq)
end

local hits = {}

for _, motif in ipairs(motifs) do
  local needle = motif
  if spice.args.ignoreCase ~= false then
    needle = string.upper(motif)
  end
  local init = 1
  while true do
    local first, last = string.find(seq, needle, init, true)
    if not first then break end
    hits[#hits + 1] = { motif = motif, start = first, finish = last }
    init = last + 1
  end
end

table.sort(hits, function(a, b) return a.start < b.start end)
spice.log(string.format("%d hit(s) in %s", #hits, spice.doc.name))

return {
  name = spice.doc.name,
  length = #seq,
  motifs = motifs,
  hits = hits,
}
