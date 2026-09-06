import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Loader2,
  ZoomIn,
  ZoomOut,
  Maximize,
  RefreshCw,
  X,
  Network,
  Quote,
  Plus,
  Minus,
} from 'lucide-react';
import { Document } from '../lib/supabase';

export interface MindMapNode {
  id: string;
  label: string;
  parent: string;
  level: number;
  citation?: string;
  sourceText?: string;
}

export interface MindMapData {
  central: string;
  nodes: MindMapNode[];
}

interface MindMapProps {
  documents: Document[];
  notebookId: string;
}

interface PositionedNode extends MindMapNode {
  x: number;
  y: number;
  width: number;
  height: number;
  collapsed: boolean;
  childCount: number;
}

const NODE_H = 44;
const H_GAP = 60;
const V_GAP = 16;
const MAX_LABEL_CHARS = 40;

function stripCodeFences(raw: string): string {
  let s = raw.trim();
  const fenceMatch = s.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i);
  if (fenceMatch) {
    s = fenceMatch[1].trim();
  } else {
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  }
  return s;
}

function parseMindMap(raw: string): MindMapData | null {
  const cleaned = stripCodeFences(raw);
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && parsed.central && Array.isArray(parsed.nodes)) {
      return parsed;
    }
  } catch {
    // not valid JSON
  }
  return null;
}

function wrapLabel(label: string, maxChars: number): string[] {
  const words = label.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if ((current + ' ' + word).trim().length > maxChars) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = (current + ' ' + word).trim();
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [label];
}

function nodeHeight(label: string): number {
  const lines = wrapLabel(label, MAX_LABEL_CHARS);
  return Math.max(NODE_H, lines.length * 20 + 12);
}

function nodeWidth(label: string): number {
  const lines = wrapLabel(label, MAX_LABEL_CHARS);
  const longest = lines.reduce((max, l) => Math.max(max, l.length), 0);
  return Math.max(120, longest * 8 + 40);
}

// Tree layout: horizontal tree, left-to-right. Root at left, children to the right.
// Uses a simple subtree-height accumulation to avoid overlaps.
function layoutTree(data: MindMapData): Map<string, PositionedNode> {
  const result = new Map<string, PositionedNode>();
  const nodeMap = new Map<string, MindMapNode>();
  data.nodes.forEach((n) => nodeMap.set(n.id, n));

  const root = data.nodes.find((n) => n.parent === 'root');
  if (!root) return result;

  const childrenMap = new Map<string, MindMapNode[]>();
  data.nodes.forEach((n) => {
    if (n.parent !== 'root') {
      const arr = childrenMap.get(n.parent) || [];
      arr.push(n);
      childrenMap.set(n.parent, arr);
    }
  });

  // De-duplicate: remove nodes with identical labels at the same level under the same parent
  const seen = new Set<string>();
  const dedupNodes = new Set<string>();
  data.nodes.forEach((n) => {
    const key = `${n.parent}::${n.label.toLowerCase()}`;
    if (seen.has(key)) {
      dedupNodes.add(n.id);
    } else {
      seen.add(key);
    }
  });

  function getValidChildren(id: string): MindMapNode[] {
    return (childrenMap.get(id) || []).filter((c) => !dedupNodes.has(c.id));
  }

  // First pass: compute subtree heights (sum of child heights + gaps)
  const subtreeHeight = new Map<string, number>();

  function computeHeight(id: string): number {
    const node = nodeMap.get(id);
    if (!node) return 0;
    const h = nodeHeight(node.label);
    const children = getValidChildren(id);
    if (children.length === 0) {
      subtreeHeight.set(id, h);
      return h;
    }
    let total = 0;
    children.forEach((c, i) => {
      total += computeHeight(c.id);
      if (i < children.length - 1) total += V_GAP;
    });
    const result = Math.max(h, total);
    subtreeHeight.set(id, result);
    return result;
  }

  computeHeight(root.id);

  // Second pass: assign positions
  function assignPositions(id: string, x: number, yCenter: number) {
    const node = nodeMap.get(id);
    if (!node) return;
    const w = nodeWidth(node.label);
    const h = nodeHeight(node.label);
    const children = getValidChildren(id);

    result.set(id, {
      ...node,
      x,
      y: yCenter - h / 2,
      width: w,
      height: h,
      collapsed: false,
      childCount: children.length,
    });

    if (children.length === 0) return;

    const totalChildHeight = children.reduce((sum, c) => sum + (subtreeHeight.get(c.id) || 0), 0) +
      (children.length - 1) * V_GAP;
    let currentY = yCenter - totalChildHeight / 2;
    const childX = x + w + H_GAP;

    children.forEach((c) => {
      const childH = subtreeHeight.get(c.id) || 0;
      const childCenter = currentY + childH / 2;
      assignPositions(c.id, childX, childCenter);
      currentY += childH + V_GAP;
    });
  }

  assignPositions(root.id, 0, 0);
  return result;
}

// Compute bounding box of visible nodes
function getBounds(nodes: PositionedNode[]): { minX: number; minY: number; maxX: number; maxY: number } {
  if (nodes.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  nodes.forEach((n) => {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.width);
    maxY = Math.max(maxY, n.y + n.height);
  });
  return { minX, minY, maxX, maxY };
}

const levelStyles = [
  { bg: 'bg-slate-900 dark:bg-slate-100', text: 'text-white dark:text-slate-900', border: 'border-slate-900 dark:border-slate-100', size: 'text-base font-bold' },
  { bg: 'bg-blue-600', text: 'text-white', border: 'border-blue-600', size: 'text-sm font-semibold' },
  { bg: 'bg-cyan-500', text: 'text-white', border: 'border-cyan-500', size: 'text-sm font-medium' },
  { bg: 'bg-white dark:bg-slate-800', text: 'text-slate-700 dark:text-slate-200', border: 'border-slate-300 dark:border-slate-600', size: 'text-xs font-normal' },
];

export default function MindMap({ documents, notebookId }: MindMapProps) {
  const [data, setData] = useState<MindMapData | null>(null);
  const [nodes, setNodes] = useState<Map<string, PositionedNode>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [draggingNode, setDraggingNode] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<PositionedNode | null>(null);
  const [loadedFromCache, setLoadedFromCache] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const hasAutoCentered = useRef(false);

  const docKey = useMemo(
    () => documents.map((d) => d.id).sort().join(','),
    [documents],
  );

  useEffect(() => {
    if (documents.length === 0) {
      setData(null);
      setNodes(new Map());
      return;
    }

    hasAutoCentered.current = false;
    const key = `mindmap-cache-${notebookId}-${docKey}`;
    setLoadedFromCache(false);

    try {
      const cached = localStorage.getItem(key);
      if (cached) {
        const parsed = parseMindMap(cached);
        if (parsed) {
          setData(parsed);
          setNodes(layoutTree(parsed));
          setLoadedFromCache(true);
          return;
        }
      }
    } catch {
      // ignore
    }

    generateMindMap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey, notebookId]);

  const generateMindMap = useCallback(async () => {
    if (documents.length === 0) return;
    setLoading(true);
    setError(null);
    setSelectedNode(null);
    hasAutoCentered.current = false;

    try {
      const sources = documents.map((d) => ({
        name: d.name,
        type: d.type,
        content: d.content,
        file_url: d.file_url,
      }));

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-chat`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({
            question: 'GENERATE_MINDMAP',
            sources,
          }),
        },
      );
      const resData = await res.json();
      const parsed = parseMindMap(resData.answer || '');

      if (!parsed) {
        setError('Could not generate mind map. Please try again.');
        return;
      }

      setData(parsed);
      setNodes(layoutTree(parsed));

      try {
        localStorage.setItem(
          `mindmap-cache-${notebookId}-${docKey}`,
          JSON.stringify(parsed),
        );
      } catch {
        // ignore
      }
    } catch {
      setError('Failed to generate mind map. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [documents, notebookId, docKey]);

  const childrenOf = useCallback(
    (id: string) => Array.from(nodes.values()).filter((n) => n.parent === id),
    [nodes],
  );

  function toggleCollapse(id: string) {
    setNodes((prev) => {
      const next = new Map(prev);
      const node = next.get(id);
      if (node) {
        next.set(id, { ...node, collapsed: !node.collapsed });
      }
      return next;
    });
  }

  // Get visible nodes (respecting collapsed state)
  const visibleNodes = useMemo(() => {
    const result: PositionedNode[] = [];
    const root = Array.from(nodes.values()).find((n) => n.parent === 'root');
    if (!root) return result;

    function walk(id: string) {
      const node = nodes.get(id);
      if (!node) return;
      result.push(node);
      if (node.collapsed) return;
      childrenOf(id).forEach((child) => walk(child.id));
    }

    walk(root.id);
    return result;
  }, [nodes, childrenOf]);

  const visibleIds = useMemo(() => new Set(visibleNodes.map((n) => n.id)), [visibleNodes]);

  // Auto-center on load and when data changes
  useEffect(() => {
    if (visibleNodes.length === 0 || hasAutoCentered.current) return;
    if (!containerRef.current) return;

    const container = containerRef.current.getBoundingClientRect();
    const bounds = getBounds(visibleNodes);
    const contentW = bounds.maxX - bounds.minX;
    const contentH = bounds.maxY - bounds.minY;
    const padding = 60;

    const scaleX = (container.width - padding * 2) / contentW;
    const scaleY = (container.height - padding * 2) / contentH;
    const fitZoom = Math.min(scaleX, scaleY, 1.2);

    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;

    setZoom(fitZoom);
    setPan({
      x: container.width / 2 - centerX * fitZoom,
      y: container.height / 2 - centerY * fitZoom,
    });
    hasAutoCentered.current = true;
  }, [visibleNodes]);

  function fitToScreen() {
    if (visibleNodes.length === 0 || !containerRef.current) return;
    const container = containerRef.current.getBoundingClientRect();
    const bounds = getBounds(visibleNodes);
    const contentW = bounds.maxX - bounds.minX;
    const contentH = bounds.maxY - bounds.minY;
    const padding = 60;

    const scaleX = (container.width - padding * 2) / contentW;
    const scaleY = (container.height - padding * 2) / contentH;
    const fitZoom = Math.min(scaleX, scaleY, 1.2);

    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;

    setZoom(fitZoom);
    setPan({
      x: container.width / 2 - centerX * fitZoom,
      y: container.height / 2 - centerY * fitZoom,
    });
  }

  function handleMouseDown(e: React.MouseEvent, nodeId?: string) {
    e.stopPropagation();
    if (nodeId) {
      setDraggingNode(nodeId);
    } else {
      setIsPanning(true);
    }
    setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (draggingNode) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const newX = (e.clientX - rect.left - pan.x - rect.width / 2) / zoom + rect.width / 2;
      const newY = (e.clientY - rect.top - pan.y - rect.height / 2) / zoom + rect.height / 2;
      setNodes((prev) => {
        const next = new Map(prev);
        const node = next.get(draggingNode);
        if (node) {
          // Adjust so node center maps to cursor
          next.set(draggingNode, { ...node, x: newX - node.width / 2, y: newY - node.height / 2 });
        }
        return next;
      });
    } else if (isPanning) {
      setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
    }
  }

  function handleMouseUp() {
    setDraggingNode(null);
    setIsPanning(false);
  }

  function zoomIn() { setZoom((z) => Math.min(z * 1.2, 3)); }
  function zoomOut() { setZoom((z) => Math.max(z / 1.2, 0.2)); }

  if (documents.length === 0) {
    return (
      <div className="text-center py-20">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center mx-auto mb-4">
          <Network className="w-8 h-8 text-white" />
        </div>
        <h3 className="text-lg font-medium text-slate-900 dark:text-slate-100 mb-2">No sources yet</h3>
        <p className="text-slate-600 dark:text-slate-400">Add sources to generate a mind map.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Loader2 className="w-10 h-10 animate-spin text-blue-600 mb-4" />
        <p className="text-slate-600 dark:text-slate-300 font-medium">Generating mind map...</p>
        <p className="text-sm text-slate-400 mt-1">Analyzing your sources</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="w-16 h-16 rounded-2xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center mx-auto mb-4">
          <X className="w-8 h-8 text-red-500" />
        </div>
        <h3 className="text-lg font-medium text-slate-900 dark:text-slate-100 mb-2">Something went wrong</h3>
        <p className="text-slate-600 dark:text-slate-400 mb-6">{error}</p>
        <button
          onClick={generateMindMap}
          className="inline-flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-xl font-semibold hover:bg-blue-700 transition-colors"
        >
          <RefreshCw className="w-5 h-5" />
          Try Again
        </button>
      </div>
    );
  }

  if (!data || visibleNodes.length === 0) return null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Network className="w-7 h-7 text-blue-600" />
            Mind Map
          </h2>
          <p className="text-slate-600 dark:text-slate-400 text-sm mt-1">
            {loadedFromCache ? 'Loaded from cache' : 'Generated from your sources'}
            {' · '}{data.nodes.length} nodes
          </p>
        </div>
        <button
          onClick={generateMindMap}
          className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-xl font-medium hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors self-start"
        >
          <RefreshCw className="w-4 h-4" />
          Regenerate
        </button>
      </div>

      {/* Map canvas */}
      <div
        ref={containerRef}
        className="relative w-full h-[600px] bg-slate-50 dark:bg-slate-900/50 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden cursor-grab active:cursor-grabbing"
        onMouseDown={(e) => handleMouseDown(e)}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <svg className="w-full h-full" style={{ userSelect: 'none' }}>
          <g
            transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}
            style={{ transition: draggingNode || isPanning ? 'none' : 'transform 0.15s ease-out' }}
          >
            {/* Edges - smooth bezier curves */}
            {visibleNodes.map((node) => {
              if (node.parent === 'root') return null;
              const parent = nodes.get(node.parent);
              if (!parent || !visibleIds.has(parent.id)) return null;
              const x1 = parent.x + parent.width;
              const y1 = parent.y + parent.height / 2;
              const x2 = node.x;
              const y2 = node.y + node.height / 2;
              const midX = (x1 + x2) / 2;
              return (
                <path
                  key={`edge-${node.id}`}
                  d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={Math.max(1, 2.5 - node.level * 0.5)}
                  className="text-slate-300 dark:text-slate-600"
                />
              );
            })}

            {/* Nodes */}
            {visibleNodes.map((node) => {
              const children = childrenOf(node.id);
              const hasChildren = children.length > 0;
              const style = levelStyles[Math.min(node.level, 3)];
              const isSelected = selectedNode?.id === node.id;
              const lines = wrapLabel(node.label, MAX_LABEL_CHARS);

              return (
                <g
                  key={node.id}
                  transform={`translate(${node.x}, ${node.y})`}
                  className="cursor-pointer"
                  onMouseDown={(e) => handleMouseDown(e, node.id)}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!draggingNode) setSelectedNode(node);
                  }}
                >
                  <foreignObject
                    width={node.width}
                    height={node.height}
                    style={{ overflow: 'visible' }}
                  >
                    <div
                      className={`rounded-xl border-2 shadow-sm flex items-center justify-center gap-1.5 px-3 ${style.bg} ${style.text} ${style.border} ${style.size} hover:shadow-md transition-shadow`}
                      style={{
                        width: `${node.width}px`,
                        minHeight: `${node.height}px`,
                        boxShadow: isSelected ? '0 0 0 3px rgba(37, 99, 235, 0.5)' : undefined,
                      }}
                    >
                      {hasChildren && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleCollapse(node.id);
                          }}
                          className="flex-shrink-0 opacity-70 hover:opacity-100"
                        >
                          {node.collapsed ? (
                            <Plus className="w-3.5 h-3.5" />
                          ) : (
                            <Minus className="w-3.5 h-3.5" />
                          )}
                        </button>
                      )}
                      <div className="text-center leading-tight">
                        {lines.map((line, i) => (
                          <div key={i} className="truncate" style={{ maxWidth: `${node.width - 40}px` }}>
                            {line}
                          </div>
                        ))}
                      </div>
                      {hasChildren && node.collapsed && (
                        <span className="flex-shrink-0 text-xs opacity-60 ml-1">
                          {children.length}
                        </span>
                      )}
                    </div>
                  </foreignObject>
                </g>
              );
            })}
          </g>
        </svg>

        {/* Zoom controls */}
        <div className="absolute bottom-4 right-4 flex flex-col gap-1 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-md p-1">
          <button onClick={zoomIn} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors" title="Zoom in">
            <ZoomIn className="w-4 h-4 text-slate-600 dark:text-slate-300" />
          </button>
          <button onClick={zoomOut} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors" title="Zoom out">
            <ZoomOut className="w-4 h-4 text-slate-600 dark:text-slate-300" />
          </button>
          <button onClick={fitToScreen} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors" title="Fit to screen">
            <Maximize className="w-4 h-4 text-slate-600 dark:text-slate-300" />
          </button>
        </div>

        {/* Zoom indicator */}
        <div className="absolute top-4 left-4 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm px-3 py-1.5 text-xs text-slate-500 dark:text-slate-400 font-medium">
          {Math.round(zoom * 100)}%
        </div>
      </div>

      {/* Node detail panel */}
      {selectedNode && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-lg p-6 animate-slide-up">
          <div className="flex items-start justify-between mb-4">
            <div>
              <span className="text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-2.5 py-1 rounded-full mb-2 inline-block">
                Level {selectedNode.level}
              </span>
              <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">{selectedNode.label}</h3>
            </div>
            <button
              onClick={() => setSelectedNode(null)}
              className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-slate-400" />
            </button>
          </div>

          {selectedNode.sourceText && (
            <div className="flex items-start gap-3 bg-slate-50 dark:bg-slate-700/50 rounded-xl p-4 mb-3">
              <Quote className="w-5 h-5 text-slate-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
                {selectedNode.sourceText}
              </p>
            </div>
          )}

          {selectedNode.citation && (
            <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
              <span className="font-medium">Source:</span>
              <span>{selectedNode.citation}</span>
            </div>
          )}

          {!selectedNode.sourceText && !selectedNode.citation && (
            <p className="text-sm text-slate-500 dark:text-slate-400">No additional details for this node.</p>
          )}
        </div>
      )}
    </div>
  );
}
