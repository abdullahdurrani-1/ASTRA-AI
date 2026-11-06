/**
 * The Astra "neural book" mark: an open book drawn as connected nodes.
 * One geometry feeds the SVG logo, the intro's canvas particles and the favicon.
 * Coordinates are in a 200×200 box; left-page nodes mirror right-page nodes across x=100.
 */

export type NodeRole = "spine" | "left-page" | "right-page" | "core" | "halo";

export interface BookNode {
  id: string;
  x: number;
  y: number;
  r: number;
  role: NodeRole;
}

export interface NeuralBook {
  viewBox: string;
  nodes: BookNode[];
  edges: [string, string][];
  /** Faint page outlines drawn beneath the nodes. */
  pagePaths: string[];
}

// Final geometry: the judged "minimal" design with the panel's fixes applied (shallower bottom
// V, no core starburst, crimson spine column, radius hierarchy core > spine ends > corners > inner).
export const NEURAL_BOOK: NeuralBook = {
  viewBox: "0 0 200 200",
  nodes: [
    { id: "s1", x: 100, y: 78, r: 3.2, role: "spine" },
    { id: "s2", x: 100, y: 94, r: 2.4, role: "spine" },
    { id: "s4", x: 100, y: 130, r: 2.4, role: "spine" },
    { id: "s5", x: 100, y: 146, r: 3.2, role: "spine" },
    { id: "core", x: 100, y: 110, r: 4, role: "core" },
    { id: "r1", x: 164, y: 54, r: 2.8, role: "right-page" },
    { id: "r2", x: 164, y: 124, r: 2.8, role: "right-page" },
    { id: "r3", x: 131, y: 64, r: 2.2, role: "right-page" },
    { id: "r4", x: 128, y: 137, r: 2.2, role: "right-page" },
    { id: "r5", x: 138, y: 98, r: 2.4, role: "right-page" },
    { id: "r6", x: 119, y: 86, r: 1.6, role: "right-page" },
    { id: "r7", x: 119, y: 120, r: 1.6, role: "right-page" },
    { id: "r8", x: 150, y: 88, r: 1.6, role: "right-page" },
    { id: "l1", x: 36, y: 54, r: 2.8, role: "left-page" },
    { id: "l2", x: 36, y: 124, r: 2.8, role: "left-page" },
    { id: "l3", x: 69, y: 64, r: 2.2, role: "left-page" },
    { id: "l4", x: 72, y: 137, r: 2.2, role: "left-page" },
    { id: "l5", x: 62, y: 98, r: 2.4, role: "left-page" },
    { id: "l6", x: 81, y: 86, r: 1.6, role: "left-page" },
    { id: "l7", x: 81, y: 120, r: 1.6, role: "left-page" },
    { id: "l8", x: 50, y: 88, r: 1.6, role: "left-page" },
    { id: "h1", x: 100, y: 34, r: 1.4, role: "halo" },
    { id: "h2", x: 46, y: 36, r: 1.3, role: "halo" },
    { id: "h3", x: 154, y: 36, r: 1.3, role: "halo" },
    { id: "h4", x: 44, y: 168, r: 1.2, role: "halo" },
    { id: "h5", x: 156, y: 168, r: 1.2, role: "halo" },
  ],
  edges: [
    ["s1", "s2"], ["s2", "core"], ["core", "s4"], ["s4", "s5"], ["h1", "s1"],
    ["s1", "r3"], ["r3", "r1"], ["r1", "r8"], ["r8", "r2"], ["r2", "r4"],
    ["r4", "s5"], ["r3", "r6"], ["r6", "r7"], ["r7", "r4"], ["r6", "r5"],
    ["r7", "r5"], ["r5", "r8"], ["core", "r6"], ["core", "r7"], ["h3", "r1"],
    ["s1", "l3"], ["l3", "l1"], ["l1", "l8"], ["l8", "l2"], ["l2", "l4"],
    ["l4", "s5"], ["l3", "l6"], ["l6", "l7"], ["l7", "l4"], ["l6", "l5"],
    ["l7", "l5"], ["l5", "l8"], ["core", "l6"], ["core", "l7"], ["h2", "l1"],
  ],
  pagePaths: [
    "M100 78 Q131 62 164 54 L164 124 Q131 136 100 146 Z",
    "M100 78 Q69 62 36 54 L36 124 Q69 136 100 146 Z",
  ],
};

export function nodeById(book: NeuralBook): Map<string, BookNode> {
  return new Map(book.nodes.map((n) => [n.id, n]));
}
