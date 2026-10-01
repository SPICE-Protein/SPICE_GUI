// @ts-nocheck
// Ported from TeselaGen tg-oss (MIT License, Copyright (c) 2023 Teselagen Biotechnology, Inc.)
// (lodash invert replaced with native implementation)
import aminoAcidToDegenerateDnaMap from "./aminoAcidToDegenerateDnaMap";

const invert = obj => {
  const out = {};
  Object.keys(obj).forEach(key => {
    out[obj[key]] = key;
  });
  return out;
};

const degenerateDnaToAminoAcidMap = invert(aminoAcidToDegenerateDnaMap);
export default degenerateDnaToAminoAcidMap;
