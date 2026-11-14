// Provider registry: the single place the UI looks up folding backends.

import { demoFold } from '$lib/backend/demo';
import type {
  FoldCapabilities,
  FoldProvider,
  FoldProviderId,
  FoldProviderResult,
  FoldProgress,
  FoldRequest,
} from './types';
import { spiceFoldProvider } from './providers/spice';
import { swissModelFoldProvider } from './providers/swissmodel';

const DEMO_CAPABILITIES: FoldCapabilities = {
  environment: true,
  pressure: false,
  mutantHead: true,
  distogram: true,
  contactMap: true,
  mutationProbabilities: true,
  confidence: true,
  asyncJob: false,
  requiresToken: false,
};

const demoFoldProvider: FoldProvider = {
  descriptor: {
    id: 'demo',
    name: 'Demo',
    description: 'Synthetic browser-only structure for previews and end-to-end tests.',
    capabilities: DEMO_CAPABILITIES,
  },

  async fold(request: FoldRequest, onProgress?: (progress: FoldProgress) => void): Promise<FoldProviderResult> {
    const started = Date.now();
    onProgress?.({ phase: 'submitting', elapsedMs: 0 });
    const output = demoFold(request.sequence, request.env);
    onProgress?.({ phase: 'fetching', elapsedMs: Date.now() - started });
    return {
      output,
      providerId: 'demo',
      providerName: 'Demo',
      modelId: output.modelPath,
      note: 'Synthetic demo structure; not a physical prediction.',
    };
  },
};

export const FOLD_PROVIDERS: Record<FoldProviderId, FoldProvider> = {
  spice: spiceFoldProvider,
  swissmodel: swissModelFoldProvider,
  demo: demoFoldProvider,
};

export const DEFAULT_FOLD_PROVIDER_ID: FoldProviderId = 'spice';

export function getFoldProvider(id: string): FoldProvider {
  const provider = FOLD_PROVIDERS[id as FoldProviderId];
  if (!provider) throw new Error(`Unknown fold provider: ${id}`);
  return provider;
}

export interface FoldWithProviderOptions extends FoldRequest {
  providerId?: FoldProviderId;
  onProgress?: (progress: FoldProgress) => void;
}

export async function foldWithProvider(options: FoldWithProviderOptions): Promise<FoldProviderResult> {
  const { providerId, onProgress, ...request } = options;
  const provider = getFoldProvider(providerId ?? DEFAULT_FOLD_PROVIDER_ID);
  return provider.fold(request, onProgress);
}
