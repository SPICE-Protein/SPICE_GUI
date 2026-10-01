// Ported from TeselaGen tg-oss `@teselagen/sequence-utils` (MIT License,
// Copyright (c) 2023 Teselagen Biotechnology, Inc.)
import {
  getAminoAcidDataForEachBaseOfDna,
  type AminoAcidDataForBase
} from "./aa";
import { filterSequenceString, getAminoAcidStringFromSequenceString } from "./sequence";
import { annotationTypes, type SequenceData } from "./clone";
import { type Range } from "./range";

import {
  genbankFeatureTypes,
  getFeatureToColorMap,
  getFeatureTypes
} from "./data/featureTypesAndColors";

export { genbankFeatureTypes, getFeatureToColorMap, getFeatureTypes };

let idCounter = 0;
function shortid(): string {
  return `id_${(idCounter++).toString(36)}_${Date.now().toString(36)}`;
}

export interface Annotation {
  id?: string | number;
  name?: string;
  start: number;
  end: number;
  forward?: boolean | string;
  strand?: number | string;
  locations?: Range[];
  annotationTypePlural?: string;
  [key: string]: unknown;
}

/**
 * Coerce/normalize an annotation location (0-based inclusive).
 * Returns false if the annotation should be dropped.
 */
export function tidyUpAnnotation(
  _annotation: Annotation | null | undefined,
  options: {
    sequenceData?: SequenceData;
    annotationType?: string;
    mutative?: boolean;
    doNotProvideIdsForAnnotations?: boolean;
    messages?: string[];
  } = {}
): boolean {
  const { annotationType, mutative, doNotProvideIdsForAnnotations, messages = [] } = options;
  const sequenceData: SequenceData = options.sequenceData ?? ({} as SequenceData);
  const size = (sequenceData.size as number) ?? (sequenceData.sequence as string)?.length ?? 0;
  const circular = !!sequenceData.circular;
  const isProtein = !!sequenceData.isProtein;

  if (!_annotation || typeof _annotation !== "object") {
    messages.push("Invalid annotation detected and removed");
    return false;
  }
  const annotation = mutative ? _annotation : { ..._annotation };
  annotation.annotationTypePlural = annotationType;

  if (!annotation.name || typeof annotation.name !== "string") {
    annotation.name = "Untitled annotation";
  }
  if (!annotation.id && annotation.id !== 0 && !doNotProvideIdsForAnnotations) {
    annotation.id = shortid();
  }

  const coerce = (location: Range) => {
    if (typeof location.start !== "number" || typeof location.end !== "number") return;
    if (isProtein) {
      // protein annotations are in AA space
    }
    // clamp to sequence bounds
    if (size > 0 && !circular) {
      if (location.start > size - 1 || location.end > size - 1) {
        location.start = Math.min(location.start, Math.max(0, size - 1));
        location.end = Math.min(location.end, Math.max(0, size - 1));
      }
    }
  };

  coerce(annotation as unknown as Range);
  annotation.locations?.forEach(coerce);

  if (
    isProtein ||
    annotation.forward === true ||
    annotation.forward === "true" ||
    annotation.strand === 1 ||
    annotation.strand === "1" ||
    annotation.strand === "+"
  ) {
    annotation.forward = true;
    annotation.strand = 1;
  } else if (
    annotation.forward === false ||
    annotation.forward === "false" ||
    annotation.strand === -1 ||
    annotation.strand === "-1" ||
    annotation.strand === "-"
  ) {
    annotation.forward = false;
    annotation.strand = -1;
  }
  return true;
}

/**
 * Normalize a raw sequenceData object: filter invalid chars, compute size,
 * coerce `circular`, and tidy each annotation array.
 */
export function tidyUpSequenceData(
  pSeqData: Partial<SequenceData> | undefined | null,
  options: {
    doNotRemoveInvalidChars?: boolean;
    additionalValidChars?: string;
    noTranslationData?: boolean;
    includeProteinSequence?: boolean;
    doNotProvideIdsForAnnotations?: boolean;
    logMessages?: boolean;
  } = {}
): SequenceData {
  const {
    doNotRemoveInvalidChars,
    additionalValidChars,
    includeProteinSequence,
    doNotProvideIdsForAnnotations
  } = options;
  const seqData: SequenceData = { sequence: "", proteinSequence: "", ...(pSeqData as object) };
  const messages: string[] = [];

  if (!seqData.sequence) seqData.sequence = "";
  if (!seqData.proteinSequence) seqData.proteinSequence = "";

  let needsBackTranslation = false;
  if (seqData.isProtein) {
    seqData.circular = false;
    if (!seqData.proteinSequence && seqData.proteinSequence !== "") {
      seqData.proteinSequence = seqData.sequence;
    }
    if (
      !seqData.sequence ||
      seqData.sequence.length !== seqData.proteinSequence.length * 3
    ) {
      needsBackTranslation = true;
    }
  }
  if (seqData.isRna) {
    seqData.sequence = seqData.sequence.replace(/t/gi, "u");
  }

  if (!doNotRemoveInvalidChars) {
    if (seqData.isProtein) {
      const [newSeq] = filterSequenceString(seqData.proteinSequence, { isProtein: true });
      seqData.proteinSequence = newSeq;
    } else {
      const [newSeq] = filterSequenceString(seqData.sequence, { additionalValidChars });
      seqData.sequence = newSeq;
    }
  }

  if (seqData.isProtein) {
    if (needsBackTranslation) {
      seqData.sequence = getDegenerateDnaStringFromAAString(seqData.proteinSequence);
    }
    seqData.aminoAcidDataForEachBaseOfDNA = getAminoAcidDataForEachBaseOfDna(
      seqData.proteinSequence,
      true,
      undefined,
      true
    );
  } else if (includeProteinSequence) {
    seqData.proteinSequence = getAminoAcidStringFromSequenceString(seqData.sequence);
  }

  seqData.size = seqData.noSequence ? seqData.size : seqData.sequence.length;
  seqData.proteinSize = seqData.noSequence ? seqData.proteinSize : seqData.proteinSequence.length;

  const circularRaw = seqData.circular as boolean | string | number | undefined;
  if (
    circularRaw === "false" ||
    circularRaw === -1 ||
    circularRaw === false ||
    (!circularRaw && (seqData.sequenceTypeCode as string) !== "CIRCULAR_DNA")
  ) {
    seqData.circular = false;
  } else {
    seqData.circular = true;
  }

  annotationTypes.forEach((annotationType) => {
    const raw = seqData[annotationType];
    if (!Array.isArray(raw)) {
      if (raw && typeof raw === "object") {
        seqData[annotationType] = Object.keys(raw).map((key) => (raw as Record<string, unknown>)[key]);
      } else {
        seqData[annotationType] = [];
      }
    }
    seqData[annotationType] = (seqData[annotationType] as Annotation[]).filter((annotation) =>
      tidyUpAnnotation(annotation, {
        sequenceData: seqData,
        mutative: true,
        annotationType,
        doNotProvideIdsForAnnotations
      })
    );
  });

  return seqData;
}

import aminoAcidToDegenerateDnaMap from "./data/aminoAcidToDegenerateDnaMap";

const degenerateDnaMap = aminoAcidToDegenerateDnaMap as Record<string, string>;

/** Back-translate an amino acid string to degenerate DNA. */
export function getDegenerateDnaStringFromAAString(aaString: string): string {
  return aaString
    .split("")
    .map((char) => degenerateDnaMap[char.toLowerCase()] || "nnn")
    .join("");
}
