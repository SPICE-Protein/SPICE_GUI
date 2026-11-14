-- Multi-objective codon optimisation of the open document.
-- Arguments: { "host": "ecoli", "targetGc": 50, "maxHomopolymer": 5,
--              "forbiddenMotifs": ["GGATCC", "GAATTC"] }
-- The result is proposed as a patch; nothing changes until you click Apply.

local protein = spice.seq.translate(spice.doc.sequence)
if protein == "" then
  spice.error("The current sequence does not translate to a protein.")
  return { ok = false }
end

local result = spice.design.codonOptimize(protein, {
  host = spice.args.host or "ecoli",
  targetGc = spice.args.targetGc,
  maxHomopolymer = spice.args.maxHomopolymer,
  forbiddenMotifs = spice.args.forbiddenMotifs,
})

spice.log(string.format(
  "%s: %d aa -> %d bp, CAI %.3f, GC %.1f%%",
  spice.doc.name, #protein, #result.sequence, result.cai, result.gc
))

spice.doc.apply({ sequence = result.sequence })

return {
  ok = true,
  cai = result.cai,
  gc = result.gc,
  iterations = result.iterations,
  violations = result.violations,
}
