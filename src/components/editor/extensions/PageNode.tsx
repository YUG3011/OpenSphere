"use client";

import { Node, mergeAttributes } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";

export type PageSizing = {
  pageWidthPx: number;
  pageHeightPx: number;
  sidePaddingPx: number;
  headerReservePx: number;
  footerReservePx: number;
};

type PageNodeOptions = {
  sizing: PageSizing;
};

export const PageNode = Node.create<PageNodeOptions>({
  name: "page",
  group: "block",
  content: "block+",
  isolating: true,
  defining: true,

  addOptions() {
    return {
      sizing: {
        pageWidthPx: 8.5 * 96,
        pageHeightPx: 11 * 96,
        sidePaddingPx: 64,
        headerReservePx: 48,
        footerReservePx: 1.25 * 96 + 32
      }
    };
  },

  parseHTML() {
    return [{ tag: "div[data-page-node]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-page-node": "true"
      }),
      0
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(({ getPos, editor, extension }: { getPos: () => number; editor: Editor; extension: any }) => {
      const s = extension.options.sizing;
      const pos = getPos();
      const $pos = editor.state.doc.resolve(pos);
      const pageIndex = $pos.index(0) + 1;

      return (
        <NodeViewWrapper
          as="div"
          data-page-card
          style={{
            width: `${s.pageWidthPx}px`,
            height: `${s.pageHeightPx}px`,
            margin: "0 auto",
            position: "relative",
            background: "white",
            borderRadius: "18px",
            border: "1px solid rgba(15, 23, 42, 0.08)",
            boxShadow: "0 30px 70px rgba(15, 23, 42, 0.18)",
            overflow: "hidden"
          }}
        >
          <div aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none" }} />

          <div
            aria-hidden
            style={{
              position: "absolute",
              left: `${s.sidePaddingPx}px`,
              right: `${s.sidePaddingPx}px`,
              bottom: `${Math.max(0, s.footerReservePx - 32)}px`,
              height: "1px",
              background: "rgba(15, 23, 42, 0.12)",
              pointerEvents: "none"
            }}
          />
          <div
            aria-hidden
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: "18px",
              textAlign: "center",
              fontSize: "11px",
              letterSpacing: "0.24em",
              textTransform: "uppercase",
              color: "rgba(15, 23, 42, 0.55)",
              pointerEvents: "none",
              userSelect: "none"
            }}
          >
            Page {pageIndex}
          </div>

          <div
            data-page-content-container
            style={{
              position: "absolute",
              left: `${s.sidePaddingPx}px`,
              right: `${s.sidePaddingPx}px`,
              top: `${s.headerReservePx}px`,
              bottom: `${s.footerReservePx}px`,
              overflow: "hidden"
            }}
          >
            <NodeViewContent as="div" />
          </div>
        </NodeViewWrapper>
      );
    });
  }
});
