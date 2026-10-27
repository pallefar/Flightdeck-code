import type { Graph } from "./graph";

/** An edited/generated DAG must retain all bound steps and unavoidable gates. */
export function preservesWorkflowSteps(graph: Graph, steps: readonly string[], gates: readonly string[]): boolean {
  const roots = graph.nodes.filter(node => node.type === "manual");
  const outputs = graph.nodes.filter(node => node.type === "output" || graph.customBlocks.some(block => block.id === node.type && block.baseType === "output"));
  if (roots.length !== 1 || outputs.length === 0 || steps.some(id => !graph.nodes.some(node => node.id === id)) || gates.some(id => !graph.nodes.some(node => node.id === id && node.type === "approval"))) return false;
  const root = roots[0]!;
  if (graph.edges.some(edge => edge.target === root.id) || outputs.some(node => graph.edges.some(edge => edge.source === node.id))) return false;
  const reachable = (excluded?: string): Set<string> => {
    const seen = new Set<string>();
    const pending = [root.id];
    while (pending.length > 0) {
      const id = pending.pop()!;
      if (id === excluded || seen.has(id)) continue;
      seen.add(id);
      pending.push(...graph.edges.filter(edge => edge.source === id).map(edge => edge.target));
    }
    return seen;
  };
  const all = reachable();
  if (graph.nodes.some(node => !all.has(node.id) || (!outputs.includes(node) && !graph.edges.some(edge => edge.source === node.id)))) return false;
  return gates.every(gate => outputs.every(output => !reachable(gate).has(output.id)));
}
