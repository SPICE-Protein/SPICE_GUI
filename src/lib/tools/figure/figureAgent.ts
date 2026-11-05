// Command bus between the Co-Pilot tool registry and a mounted Figure Studio.
//
// Figure Studio is a routed tool, so the agent may call figure tools while the
// editor is closed. The bus stays free of Svelte state and DOM APIs: FigureTool
// registers a handler on mount, queued commands drain in order, and the handler
// is removed on destroy. Everything here is safe to import from Node tests.

export interface FigureChartSpec {
  name: string;
  chartType: 'bar' | 'line' | 'scatter';
  labels: string[];
  series: {
    name: string;
    values: number[];
    errors?: number[];
    color?: string;
  }[];
  xLabel?: string;
  yLabel?: string;
}

export type FigureAgentCommand = { type: 'add-chart'; spec: FigureChartSpec };

export type FigureCommandHandler = (command: FigureAgentCommand) => void;

let activeHandler: FigureCommandHandler | null = null;
const pendingCommands: FigureAgentCommand[] = [];

/**
 * Hand a command to the mounted Figure Studio. Returns false when no editor is
 * mounted; the command is queued and replayed on the next registration.
 */
export function dispatchFigureCommand(command: FigureAgentCommand): boolean {
  if (activeHandler) {
    activeHandler(command);
    return true;
  }
  pendingCommands.push(command);
  return false;
}

/**
 * Register the mounted FigureTool handler and drain any commands queued while
 * the editor was closed. Returns an unsubscribe function for onDestroy.
 */
export function registerFigureCommandHandler(handler: FigureCommandHandler): () => void {
  activeHandler = handler;

  const queued = pendingCommands.splice(0, pendingCommands.length);
  for (const command of queued) handler(command);

  return () => {
    if (activeHandler === handler) activeHandler = null;
  };
}

/** True while a FigureTool instance is mounted and accepting commands. */
export function figureToolActive(): boolean {
  return activeHandler !== null;
}
