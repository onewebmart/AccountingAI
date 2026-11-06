'use client';

import { useCallback, useEffect, useState } from 'react';

/** Sidebar widths in px: dragged between min and max, a narrow rail when collapsed. */
export const SIDEBAR_WIDTH = { min: 220, max: 380, standard: 260, rail: 72 } as const;

const WIDTH_KEY = 'aibooks.sidebar.width';
const COLLAPSED_KEY = 'aibooks.sidebar.collapsed';

const clamp = (w: number) => Math.min(SIDEBAR_WIDTH.max, Math.max(SIDEBAR_WIDTH.min, Math.round(w)));

/**
 * How wide the sidebar is on a desktop, and whether it is folded to icons.
 * Remembered per browser. The shell sets the result as --sidebar-w, which
 * the sidebar, the topbar, the page and the bottom form bars all read, so
 * they move together. Below lg the sidebar is a drawer and none of this
 * applies.
 */
export function useSidebarLayout() {
  const [width, setWidthState] = useState<number>(SIDEBAR_WIDTH.standard);
  const [collapsed, setCollapsedState] = useState(false);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(WIDTH_KEY));
      if (saved) setWidthState(clamp(saved));
      setCollapsedState(localStorage.getItem(COLLAPSED_KEY) === '1');
    } catch {
      // Storage may be unavailable: the standard width, open.
    }
  }, []);

  /** Set the width; `remember` once the drag ends, not on every pixel. */
  const setWidth = useCallback((w: number, remember = true) => {
    const next = clamp(w);
    setWidthState(next);
    if (remember) {
      try {
        localStorage.setItem(WIDTH_KEY, String(next));
      } catch {
        // Not remembered, but still applied.
      }
    }
  }, []);

  const setCollapsed = useCallback((next: boolean) => {
    setCollapsedState(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0');
    } catch {
      // Not remembered, but still applied.
    }
  }, []);

  return {
    width,
    collapsed,
    dragging,
    setWidth,
    setCollapsed,
    setDragging,
    /** What the page leaves room for on a desktop. */
    current: collapsed ? SIDEBAR_WIDTH.rail : width,
  };
}
