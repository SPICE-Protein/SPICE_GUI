// SPICE provider: the bundled local ONNX ensemble exposed through the Tauri
// backend. The current model conditions on pH, temperature and ionic strength
// only, so pressure is deliberately not advertised as a capability.

import { backend } from '$lib/backend/api';
import type { FoldProvider, FoldProviderDescriptor, FoldProviderResult, FoldRequest } from '../types';

export const spiceDescriptor: FoldProviderDescriptor = {
  id: 'spice',
  name: 'SPICE',
  description: 'Local SPICE ONNX ensemble with environment-conditioned folding heads.',
  capabilities: {
    environment: true,
    // The ONNX input currently carries pH, temperature and ionic strength only.
    pressure: false,
    mutantHead: true,
    distogram: true,
    contactMap: true,
    mutationProbabilities: true,
    confidence: true,
    asyncJob: false,
    requiresToken: false,
  },
};

export const spiceFoldProvider: FoldProvider = {
  descriptor: spiceDescriptor,

  async fold(request: FoldRequest, onProgress): Promise<FoldProviderResult> {
    const started = Date.now();
    onProgress?.({ phase: 'submitting', elapsedMs: 0 });

    const result = await backend.fold(request.sequence, request.env);

    onProgress?.({ phase: 'fetching', elapsedMs: Date.now() - started });

    // A backend failure in Tauri mode must surface; demo fallbacks stay usable.
    if (result.error && !result.demo) {
      throw new Error(result.error);
    }

    const output = result.data;
    return {
      output,
      providerId: spiceDescriptor.id,
      providerName: spiceDescriptor.name,
      modelId: output.modelPath,
      note: result.demo ? 'Synthetic demo structure (SPICE backend unavailable).' : undefined,
    };
  },
};
