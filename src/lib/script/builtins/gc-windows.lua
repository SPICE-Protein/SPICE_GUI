-- GC content in fixed windows across the open document.
-- Arguments: { "window": 100 }

local window = tonumber(spice.args.window) or 100
if window < 1 then window = 100 end

local seq = spice.doc.sequence
local rows = {}

for start = 1, #seq, window do
  local finish = math.min(start + window - 1, #seq)
  local slice = spice.seq.sub(seq, start, finish)
  rows[#rows + 1] = {
    start = start,
    finish = finish,
    gc = spice.seq.gc(slice),
  }
end

spice.log(string.format(
  "%s: %d bp, %d window(s) of %d bp",
  spice.doc.name, #seq, #rows, window
))

return {
  name = spice.doc.name,
  length = #seq,
  windows = rows,
}
