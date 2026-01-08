"use client";

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

type Options = {
  pageContentHeightPx: number;
};

export const paginationPluginKey = new PluginKey("page-pagination");

function getPageContentHeights(view: EditorView): number[] {
  const root = view.dom as HTMLElement;
  if (!root) return [];
  const containers = Array.from(root.querySelectorAll<HTMLElement>("[data-page-content-container]"));
  return containers.map((el) => el.scrollHeight);
}

function getPageStartPos(doc: any, pageIndex: number): number {
  let pos = 0;
  for (let i = 0; i < pageIndex; i += 1) pos += doc.child(i).nodeSize;
  return pos;
}

function childOffsetInside(node: any, childIndex: number): number {
  let offset = 0;
  for (let i = 0; i < childIndex; i += 1) offset += node.child(i).nodeSize;
  return offset;
}

export const PaginationExtension = Extension.create<Options>({
  name: "pagination",

  addOptions() {
    return {
      pageContentHeightPx: 11 * 96 - 48 - (1.25 * 96 + 32)
    };
  },

  addProseMirrorPlugins() {
    const opts = this.options;

    return [
      new Plugin({
        key: paginationPluginKey,
        appendTransaction: (transactions, _oldState, newState) => {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          const pageType = newState.schema.nodes.page;
          if (!pageType) return null;

          const view = (this as any).editor?.view as EditorView | undefined;
          if (!view) return null;
          const root = view.dom as HTMLElement | null;
          if (!root || !root.querySelector("[data-page-content-container]")) return null;

          const maxHeight = opts.pageContentHeightPx;
          let tr = newState.tr;
          let changed = false;

          const maxPasses = 25;
          for (let pass = 0; pass < maxPasses; pass += 1) {
            let didMove = false;
            const doc = tr.doc;

            const heights = getPageContentHeights(view);
            if (!heights.length) break;

            // Overflow: push last block down.
            for (let pageIndex = 0; pageIndex < doc.childCount; pageIndex += 1) {
              const h = heights[pageIndex] ?? 0;
              if (h <= maxHeight) continue;

              const pageNode = doc.child(pageIndex);
              if (pageNode.type !== pageType) continue;
              if (pageNode.childCount <= 1) continue;

              const lastIndex = pageNode.childCount - 1;
              const lastBlock = pageNode.child(lastIndex);

              if (pageIndex === doc.childCount - 1) {
                const emptyPage = pageType.createAndFill();
                if (!emptyPage) break;
                tr = tr.insert(tr.doc.content.size, emptyPage);
              }

              const pageStartPos = getPageStartPos(doc, pageIndex);
              const pageInside = pageStartPos + 1;
              const cutFrom = pageInside + childOffsetInside(pageNode, lastIndex);
              const cutTo = cutFrom + lastBlock.nodeSize;

              const nextPageStartPos = getPageStartPos(tr.doc, pageIndex + 1);
              const nextInsertPosBefore = nextPageStartPos + 1;

              if (cutFrom < 0 || cutTo > tr.doc.content.size + 2) break;

              tr = tr.delete(cutFrom, cutTo);
              const nextInsertPos = tr.mapping.map(nextInsertPosBefore, -1);
              tr = tr.insert(nextInsertPos, lastBlock);

              changed = true;
              didMove = true;
              break;
            }

            if (didMove) continue;

            // Underflow: pull first block up.
            const doc2 = tr.doc;
            const heights2 = getPageContentHeights(view);
            for (let pageIndex = 0; pageIndex < doc2.childCount - 1; pageIndex += 1) {
              const h = heights2[pageIndex] ?? 0;
              if (h >= maxHeight - 24) continue;

              const pageNode = doc2.child(pageIndex);
              const nextPageNode = doc2.child(pageIndex + 1);
              if (pageNode.type !== pageType || nextPageNode.type !== pageType) continue;
              if (nextPageNode.childCount === 0) continue;

              const firstBlock = nextPageNode.child(0);
              const nextPageStartPos = getPageStartPos(doc2, pageIndex + 1);
              const nextInside = nextPageStartPos + 1;
              const nextFrom = nextInside;
              const nextTo = nextFrom + firstBlock.nodeSize;

              const pageStartPos = getPageStartPos(doc2, pageIndex);
              const pageEndInsideBefore = pageStartPos + doc2.child(pageIndex).nodeSize - 1;

              if (nextFrom < 0 || nextTo > tr.doc.content.size + 2) break;

              tr = tr.delete(nextFrom, nextTo);
              const pageEndInside = tr.mapping.map(pageEndInsideBefore, 1);
              tr = tr.insert(pageEndInside, firstBlock);

              changed = true;
              didMove = true;
              break;
            }

            if (!didMove) break;
          }

          return changed ? tr : null;
        }
      })
    ];
  }
});
