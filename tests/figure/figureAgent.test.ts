import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  dispatchFigureCommand,
  figureToolActive,
  registerFigureCommandHandler,
  type FigureAgentCommand,
  type FigureChartSpec,
} from '$lib/tools/figure/figureAgent';

function spec(name: string): FigureChartSpec {
  return {
    name,
    chartType: 'bar',
    labels: ['Control', 'Treatment'],
    series: [{ name: 'Signal', values: [1, 2], errors: [0.1, 0.2], color: '#2563eb' }],
  };
}

function command(name: string): FigureAgentCommand {
  return { type: 'add-chart', spec: spec(name) };
}

// Drain any command queued by a test that never registered a handler.
afterEach(() => {
  const unregister = registerFigureCommandHandler(() => {});
  unregister();
});

describe('figure command bus', () => {
  it('queues commands while Figure Studio is closed and drains them in order', () => {
    expect(figureToolActive()).toBe(false);
    expect(dispatchFigureCommand(command('first'))).toBe(false);
    expect(dispatchFigureCommand(command('second'))).toBe(false);

    const received: string[] = [];
    const unregister = registerFigureCommandHandler((entry) => received.push(entry.spec.name));

    expect(figureToolActive()).toBe(true);
    expect(received).toEqual(['first', 'second']);

    unregister();
    expect(figureToolActive()).toBe(false);
  });

  it('dispatches immediately to the active handler and stops after unregister', () => {
    const handler = vi.fn();
    const unregister = registerFigureCommandHandler(handler);

    expect(dispatchFigureCommand(command('live'))).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(command('live'));

    unregister();

    expect(figureToolActive()).toBe(false);
    expect(dispatchFigureCommand(command('later'))).toBe(false);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('queues again after the editor is destroyed', () => {
    const first = vi.fn();
    const unregisterFirst = registerFigureCommandHandler(first);
    unregisterFirst();

    expect(dispatchFigureCommand(command('queued'))).toBe(false);
    expect(first).not.toHaveBeenCalled();

    const second = vi.fn();
    const unregisterSecond = registerFigureCommandHandler(second);
    expect(second).toHaveBeenCalledWith(command('queued'));
    unregisterSecond();
  });

  it('does not clear a newer handler when an older unsubscribe runs', () => {
    const first = vi.fn();
    const second = vi.fn();
    const unregisterFirst = registerFigureCommandHandler(first);
    const unregisterSecond = registerFigureCommandHandler(second);

    unregisterFirst();
    expect(figureToolActive()).toBe(true);

    expect(dispatchFigureCommand(command('newer'))).toBe(true);
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();

    unregisterSecond();
    expect(figureToolActive()).toBe(false);
  });
});
