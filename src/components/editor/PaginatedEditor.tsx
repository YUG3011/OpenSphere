"use client";

import type { ChangeEvent, ComponentType } from "react";
import type { Editor } from "@tiptap/core";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet, EditorView } from "@tiptap/pm/view";
import { useCallback, useEffect, useRef, useState } from "react";
import dayjs from "dayjs";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import TextStyle from "@tiptap/extension-text-style";
import TextAlign from "@tiptap/extension-text-align";
import Color from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import Superscript from "@tiptap/extension-superscript";
import Subscript from "@tiptap/extension-subscript";
import CharacterCount from "@tiptap/extension-character-count";
import {
    AlignCenter,
    AlignJustify,
    AlignLeft,
    AlignRight,
    ArrowDownAZ,
    ArrowUpAZ,
    Bold,
    Building2,
    CalendarDays,
    Code,
    CornerDownLeft,
    Eraser,
    ListChecks,
    FileSignature,
    Heading1,
    Heading2,
    Heading3,
    Highlighter,
    Italic,
    List,
    ListOrdered,
    Mail,
    Minus,
    NotebookPen,
    Palette,
    Search,
    Printer,
    Quote,
    Redo,
    ScrollText,
    Sparkles,
    Strikethrough,
    Stamp,
    ArrowLeftRight,
    Subscript as SubscriptIcon,
    Superscript as SuperscriptIcon,
    Underline as UnderlineIcon,
    Undo,
    UserRound,
    Edit3,
    Save,
} from "lucide-react";

import { cn } from "@/lib/utils";

const INCH_IN_PX = 96;
const PAGE_HEIGHT = 11 * INCH_IN_PX;
const PAGE_MARGIN = 0;
const PAGE_HEADER_HEIGHT = 32;
const PAGE_SIDE_PADDING = 64;

// Reserve page height percentages for header/footer overlays.
const HEADER_RESERVED_PERCENT = 0.08;
const FOOTER_RESERVED_PERCENT = 0.08;
const PAGE_TOP_PADDING = Math.round(PAGE_HEIGHT * HEADER_RESERVED_PERCENT);
const PAGE_FOOTER_HEIGHT = Math.round(PAGE_HEIGHT * FOOTER_RESERVED_PERCENT);
const PAGE_FOOTER_BORDER_HEIGHT = PAGE_FOOTER_HEIGHT;
const PAGE_FOOTER_BORDER_OFFSET = 0;
const PAGE_GAP = 56;
const PAGE_STRIDE = PAGE_HEIGHT + PAGE_GAP;
// Bottom padding (space reserved at bottom of page content).
const PAGE_BOTTOM_PADDING = PAGE_FOOTER_HEIGHT;
const PAGE_CONTENT_HEIGHT = PAGE_HEIGHT - PAGE_TOP_PADDING - PAGE_BOTTOM_PADDING;
const PAGE_WIDTH_IN = 8.5;
const PAGE_HEIGHT_IN = 11;
const PRINT_PAGE_MARGIN_IN = 0;
const PAGE_SIDE_PADDING_IN = PAGE_SIDE_PADDING / INCH_IN_PX;
const PAGE_TOP_PADDING_IN = PAGE_TOP_PADDING / INCH_IN_PX;
const PAGE_BOTTOM_PADDING_IN = PAGE_BOTTOM_PADDING / INCH_IN_PX;
const DRAFT_STORAGE_KEY = "legalbridge.paginatedEditorDraft";
const FONT_PRESETS = {
    default: "",
    serif: "\"Merriweather\", \"Times New Roman\", serif",
    sans: "\"Inter\", \"Helvetica Neue\", Arial, sans-serif",
    mono: "\"IBM Plex Mono\", \"SFMono-Regular\", Menlo, monospace",
} as const;
type FontChoice = keyof typeof FONT_PRESETS;
const LINE_SPACING_OPTIONS = [
    { label: "1", value: 1 },
    { label: "1.5", value: 1.5 },
    { label: "2", value: 2 },
];

const footerReservePluginKey = new PluginKey<DecorationSet>("footer-reserve");

const createSpacerDecoration = (pos: number, height: number, key: string) =>
    Decoration.widget(
        pos,
        () => {
            const el = document.createElement("div");
            el.className = "page-break-filler block h-full w-full";
            el.style.cssText = `display:block;width:100%;height:${Math.max(0, height)}px;pointer-events:none;background:transparent;`;
            el.setAttribute("data-page-filler", "true");
            el.setAttribute("data-filler-key", key);
            el.setAttribute("data-print-break", key.includes("tail") ? "false" : "true");
            return el;
        },
        { side: -1, key },
    );

const areDecorationSetsEqual = (a: DecorationSet, b: DecorationSet, docSize: number) => {
    if (a === b) return true;
    const aList = a.find(0, docSize);
    const bList = b.find(0, docSize);
    if (aList.length !== bList.length) return false;
    for (let i = 0; i < aList.length; i += 1) {
        const aDeco = aList[i];
        const bDeco = bList[i];
        if (aDeco.from !== bDeco.from || aDeco.to !== bDeco.to) {
            return false;
        }
        const aKey = (aDeco.spec as Record<string, unknown>)?.key;
        const bKey = (bDeco.spec as Record<string, unknown>)?.key;
        if (aKey !== bKey) {
            return false;
        }
    }
    return true;
};

type BlockRect = {
    pos: number;
    height: number;
    nodeSize: number;
};

const collectBlockRects = (view: EditorView): BlockRect[] => {
    const blocks: BlockRect[] = [];

    view.state.doc.descendants((node, pos) => {
        if (!node.isTextblock) {
            return true;
        }

        const element = view.nodeDOM(pos) as HTMLElement | null;
        if (!element) {
            return true;
        }

        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        const marginTop = Number.parseFloat(style.marginTop) || 0;
        const marginBottom = Number.parseFloat(style.marginBottom) || 0;
        const height = Math.max(1, Math.ceil(rect.height + marginTop + marginBottom));

        blocks.push({
            pos,
            height,
            nodeSize: node.nodeSize,
        });

        return true;
    });

    return blocks;
};

const asHtml = (value: string) => ({ __html: value && value.trim().length ? value : "&nbsp;" });

const buildFooterDecorations = (view: EditorView) => {
    const decorations: Decoration[] = [];
    const { doc } = view.state;
    const dom = view.dom as HTMLElement;

    if (!dom) {
        return DecorationSet.empty;
    }

    const blockRects = collectBlockRects(view);
    if (!blockRects.length) {
        return DecorationSet.empty;
    }

    const footerCarryHeight = PAGE_BOTTOM_PADDING + PAGE_GAP + PAGE_TOP_PADDING;
    let remainingOnPage = PAGE_CONTENT_HEIGHT;
    let fillerIndex = 0;

    for (const block of blockRects) {
        const blockHeight = Math.max(1, Math.round(block.height));
        let blockRemaining = Math.min(blockHeight, PAGE_HEIGHT * 2);

        if (remainingOnPage <= 0) {
            const pos = Math.max(1, Math.min(block.pos, doc.content.size));
            decorations.push(createSpacerDecoration(pos, footerCarryHeight, `page-filler-carry-${pos}-${fillerIndex}`));
            fillerIndex += 1;
            remainingOnPage = PAGE_CONTENT_HEIGHT;
        }

        while (blockRemaining > remainingOnPage && remainingOnPage > 0) {
            const filler = remainingOnPage + footerCarryHeight;
            const pos = Math.max(1, Math.min(block.pos, doc.content.size));
            decorations.push(createSpacerDecoration(pos, filler, `page-filler-${pos}-${fillerIndex}`));
            fillerIndex += 1;
            blockRemaining -= remainingOnPage;
            remainingOnPage = PAGE_CONTENT_HEIGHT;
        }

        const consumed = Math.min(blockRemaining, remainingOnPage);
        remainingOnPage -= consumed;
        remainingOnPage = Math.max(0, Math.round(remainingOnPage));
    }

    if (remainingOnPage < PAGE_CONTENT_HEIGHT) {
        const trailingFiller = remainingOnPage + PAGE_BOTTOM_PADDING;
        decorations.push(createSpacerDecoration(doc.content.size, trailingFiller, `page-filler-tail-${fillerIndex}`));
    }

    return decorations.length ? DecorationSet.create(doc, decorations) : DecorationSet.empty;
};

const createFooterReservePlugin = () =>
    new Plugin({
        key: footerReservePluginKey,
        state: {
            init: () => DecorationSet.empty,
            apply(tr, old) {
                const meta = tr.getMeta(footerReservePluginKey);
                if (meta) {
                    return meta;
                }
                if (tr.docChanged) {
                    return old.map(tr.mapping, tr.doc);
                }
                return old;
            },
        },
        props: {
            decorations(state) {
                return this.getState(state);
            },
        },
        view(editorView) {
            let frame: number | null = null;

            const schedule = () => {
                if (frame !== null) return;
                frame = requestAnimationFrame(() => {
                    frame = null;
                    const nextDecorations = buildFooterDecorations(editorView);
                    const current = footerReservePluginKey.getState(editorView.state) ?? DecorationSet.empty;
                    const docSize = editorView.state.doc.content.size;
                    if (!areDecorationSetsEqual(current, nextDecorations, docSize)) {
                        editorView.dispatch(
                            editorView.state.tr.setMeta(footerReservePluginKey, nextDecorations),
                        );
                    }
                });
            };

            schedule();

            const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
            if (observer) {
                observer.observe(editorView.dom);
            }

            return {
                update: (view, prevState) => {
                    if (view.state.doc.eq(prevState.doc) && view.state.selection.eq(prevState.selection)) {
                        return;
                    }
                    schedule();
                },
                destroy: () => {
                    if (frame !== null) {
                        cancelAnimationFrame(frame);
                    }
                    observer?.disconnect();
                },
            };
        },
    });

const FooterReserveExtension = Extension.create({
    name: "footerReserve",
    addProseMirrorPlugins() {
        return [createFooterReservePlugin()];
    },
});

const selectionGuardPluginKey = new PluginKey("selection-guard");
const HEADER_GUARD_BUFFER_PX = 8;
const HEADER_GUARD_MARGIN_PX = 4;
const HEADER_TARGET_OFFSET_PX = 4;
let selectionGuardPointerDown = false;

const createSelectionGuardPlugin = () =>
    new Plugin({
        key: selectionGuardPluginKey,
        props: {
            handleDOMEvents: {
                mousedown() {
                    selectionGuardPointerDown = true;
                    return false;
                },
                mouseup() {
                    selectionGuardPointerDown = false;
                    return false;
                },
            },
        },
        view(editorView) {
            selectionGuardPointerDown = false;
            return {
                update: (view, prevState) => {
                    try {
                        if (selectionGuardPointerDown) return;
                        if (view.state.selection.eq(prevState.selection)) return;
                        if (!view.state.doc.eq(prevState.doc)) return;

                        const selection = view.state.selection;

                        // Only handle caret selections; leave ranges alone
                        if (!selection.empty) return;

                        // Never override clicks that already landed inside a textblock
                        const resolved = view.state.doc.resolve(selection.from);
                        if (resolved.parent?.isTextblock) {
                            return;
                        }

                        const sel = selection;
                        const dom = view.dom as HTMLElement;
                        const domRect = dom.getBoundingClientRect();

                        const pos = sel.from;
                        const coords = view.coordsAtPos(pos);
                        if (!coords) return;

                        const relativeTop = coords.top - domRect.top;
                        const relativeBottom = coords.bottom - domRect.top;
                        const stride = PAGE_HEIGHT + PAGE_GAP;
                        const pageIndex = Math.max(0, Math.floor(relativeTop / stride));
                        const pageTop = pageIndex * stride;

                        // Allow clicks just below the header divider, only guard obvious header hits
                        const bodyStart = pageTop + PAGE_TOP_PADDING;
                        const guardCeiling = bodyStart - HEADER_GUARD_BUFFER_PX;
                        if (relativeBottom >= guardCeiling) {
                            return;
                        }

                        if (relativeTop <= guardCeiling - HEADER_GUARD_MARGIN_PX) {
                            let blockStartPos: number | null = null;
                            let blockContentTop: number | null = null;
                            let blockElementTop: number | null = null;
                            try {
                                const $resolved = view.state.doc.resolve(pos);
                                for (let depth = $resolved.depth; depth >= 0; depth -= 1) {
                                    const node = $resolved.node(depth);
                                    if (node?.isTextblock) {
                                        blockStartPos = $resolved.start(depth);
                                        break;
                                    }
                                }
                                if (blockStartPos !== null) {
                                    const blockDom = view.nodeDOM(blockStartPos);
                                    if (blockDom instanceof HTMLElement) {
                                        blockElementTop = blockDom.getBoundingClientRect().top - domRect.top;
                                    }
                                    try {
                                        const anchorPos = Math.min(blockStartPos + 1, view.state.doc.content.size);
                                        const blockCoords = view.coordsAtPos(anchorPos);
                                        blockContentTop = blockCoords.top - domRect.top;
                                    } catch {
                                        blockContentTop = null;
                                    }
                                }
                            } catch {
                                blockStartPos = null;
                            }

                            const candidateTop =
                                blockElementTop !== null ? blockElementTop : blockContentTop;
                            if (candidateTop !== null && candidateTop >= guardCeiling - HEADER_GUARD_MARGIN_PX) {
                                return;
                            }

                            const targetTop = domRect.top + bodyStart + HEADER_TARGET_OFFSET_PX;
                            const target = view.posAtCoords({ left: domRect.left + 12, top: targetTop });
                            let targetPos = blockStartPos ?? target?.pos ?? view.state.doc.content.size;
                            if (targetPos < 1) targetPos = 1;
                            const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, targetPos));
                            view.dispatch(tr);
                            return;
                        }

                        // If caret is inside footer reserved area, move it to next page body start
                        const footerTop = pageTop + PAGE_HEIGHT - PAGE_FOOTER_HEIGHT + PAGE_FOOTER_BORDER_OFFSET;
                        if (relativeTop >= footerTop) {
                            const nextPageIndex = pageIndex + 1;
                            const nextPageTop = nextPageIndex * stride;
                            const targetTop = domRect.top + nextPageTop + PAGE_TOP_PADDING + 2;
                            const target = view.posAtCoords({ left: domRect.left + 12, top: targetTop });
                            let targetPos = target?.pos ?? view.state.doc.content.size;
                            if (targetPos < 1) targetPos = view.state.doc.content.size;
                            const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, targetPos));
                            view.dispatch(tr);
                            return;
                        }
                    } catch (e) {
                        // Fail silently to avoid breaking the editor if DOM measurements misbehave.
                        // eslint-disable-next-line no-console
                        console.warn("selection-guard plugin error:", e);
                    }
                },
                destroy: () => {
                    selectionGuardPointerDown = false;
                },
            };
        },
    });

const SelectionGuardExtension = Extension.create({
    name: "selectionGuard",
    addProseMirrorPlugins() {
        return [createSelectionGuardPlugin()];
    },
});

const searchHighlightPluginKey = new PluginKey<DecorationSet>("search-highlight");

const createSearchHighlightPlugin = () =>
    new Plugin({
        key: searchHighlightPluginKey,
        state: {
            init: () => DecorationSet.empty,
            apply(tr, old) {
                const meta = tr.getMeta(searchHighlightPluginKey);
                if (meta !== undefined) {
                    return meta;
                }
                if (tr.docChanged) {
                    return old.map(tr.mapping, tr.doc);
                }
                return old;
            },
        },
        props: {
            decorations(state) {
                return this.getState(state);
            },
        },
    });

const SearchHighlightExtension = Extension.create({
    name: "searchHighlight",
    addProseMirrorPlugins() {
        return [createSearchHighlightPlugin()];
    },
});

const COLOR_SWATCHES = [
    { label: "Slate", value: "#0f172a" },
    { label: "Indigo", value: "#4338ca" },
    { label: "Brand", value: "#5741f5" },
    { label: "Emerald", value: "#059669" },
    { label: "Rose", value: "#be123c" },
    { label: "Amber", value: "#b45309" },
];

const DARK_MODE_STYLES = `
html.theme-dark,
body.theme-dark,
.theme-dark {
    background-color: #020617 !important;
    color: #f8fafc !important;
}

html.theme-dark .theme-icon-button,
body.theme-dark .theme-icon-button,
.theme-dark .theme-icon-button {
    background-color: rgba(2,6,23,0.9) !important;
    border-color: rgba(255,255,255,0.22) !important;
    color: #f8fafc !important;
    box-shadow: inset 0 -2px 4px rgba(0,0,0,0.35);
}

html.theme-dark .theme-swatch,
body.theme-dark .theme-swatch,
.theme-dark .theme-swatch {
    border-color: rgba(255,255,255,0.4);
}

html.theme-dark .theme-panel,
body.theme-dark .theme-panel,
.theme-dark .theme-panel {
    background-color: rgba(15,23,42,0.92) !important;
    border-color: rgba(255,255,255,0.18) !important;
    box-shadow: 0 20px 50px rgba(0,0,0,0.65) !important;
}

html.theme-dark .theme-surface,
body.theme-dark .theme-surface,
.theme-dark .theme-surface {
    background-color: #0f172a !important;
    border-color: rgba(255,255,255,0.18) !important;
    box-shadow: 0 12px 30px rgba(0,0,0,0.55) !important;
}

html.theme-dark .theme-canvas,
body.theme-dark .theme-canvas,
.theme-dark .theme-canvas {
    background-color: rgba(2,6,23,0.85) !important;
}

html.theme-dark .theme-shell,
body.theme-dark .theme-shell,
.theme-dark .theme-shell {
    background-color: #030712 !important;
    border-color: rgba(255,255,255,0.18) !important;
    box-shadow: 0 25px 70px rgba(0,0,0,0.7) !important;
}

html.theme-dark .theme-page,
body.theme-dark .theme-page,
.theme-dark .theme-page,
html.theme-dark .theme-page-surface,
body.theme-dark .theme-page-surface,
.theme-dark .theme-page-surface {
    background-color: #070b17 !important;
    color: #f8fafc !important;
    border-color: rgba(255,255,255,0.08) !important;
    box-shadow: 0 30px 70px rgba(0,0,0,0.7) !important;
}

html.theme-dark .theme-gap,
body.theme-dark .theme-gap,
.theme-dark .theme-gap {
    background-color: rgba(2,6,23,0.85) !important;
}

html.theme-dark .theme-overlay,
body.theme-dark .theme-overlay,
.theme-dark .theme-overlay {
    background-color: rgba(15,23,42,0.8) !important;
    color: #f8fafc !important;
    border-color: rgba(255,255,255,0.2) !important;
}

html.theme-dark .theme-pill,
body.theme-dark .theme-pill,
.theme-dark .theme-pill {
    background-color: rgba(15,23,42,0.7) !important;
    color: #f8fafc !important;
    border-color: rgba(255,255,255,0.25) !important;
}

html.theme-dark .theme-muted,
body.theme-dark .theme-muted,
.theme-dark .theme-muted,
html.theme-dark .text-slate-400,
body.theme-dark .text-slate-400,
.theme-dark .text-slate-400,
html.theme-dark .text-slate-500,
body.theme-dark .text-slate-500,
.theme-dark .text-slate-500,
html.theme-dark .text-slate-600,
body.theme-dark .text-slate-600,
.theme-dark .text-slate-600,
html.theme-dark .text-slate-700,
body.theme-dark .text-slate-700,
.theme-dark .text-slate-700,
html.theme-dark .text-slate-800,
body.theme-dark .text-slate-800,
.theme-dark .text-slate-800,
html.theme-dark .text-slate-900,
body.theme-dark .text-slate-900,
.theme-dark .text-slate-900 {
    color: #f8fafc !important;
}

html.theme-dark .theme-modal-overlay,
body.theme-dark .theme-modal-overlay,
.theme-dark .theme-modal-overlay {
    background-color: rgba(2,6,23,0.78) !important;
}

html.theme-dark .theme-modal,
body.theme-dark .theme-modal,
.theme-dark .theme-modal {
    background-color: #0b1221 !important;
    color: #f8fafc !important;
    border-color: rgba(255,255,255,0.15) !important;
}

html.theme-dark .theme-input,
body.theme-dark .theme-input,
.theme-dark .theme-input,
html.theme-dark textarea,
body.theme-dark textarea,
.theme-dark textarea,
html.theme-dark input,
body.theme-dark input,
.theme-dark input {
    background-color: #0f172a !important;
    color: #f8fafc !important;
    border-color: rgba(255,255,255,0.2) !important;
}

html.theme-dark .theme-input::placeholder,
body.theme-dark .theme-input::placeholder,
.theme-dark .theme-input::placeholder,
html.theme-dark textarea::placeholder,
body.theme-dark textarea::placeholder,
.theme-dark textarea::placeholder,
html.theme-dark input::placeholder,
body.theme-dark input::placeholder,
.theme-dark input::placeholder {
    color: #cbd5f5 !important;
}

html.theme-dark .tiptap,
body.theme-dark .tiptap,
.theme-dark .tiptap {
    color: #f8fafc !important;
}

.theme-chip {
    background-color: #ffffff;
    color: #1f2937;
    border-color: #e2e8f0;
}

.theme-chip-active {
    background-color: #ede9fe;
    color: #4338ca;
    border-color: #c4b5fd;
}

html.theme-dark .theme-chip,
body.theme-dark .theme-chip,
theme-dark .theme-chip {
    background-color: #020617;
    color: #f8fafc;
    border-color: rgba(255,255,255,0.25);
}

html.theme-dark .theme-chip-active,
body.theme-dark .theme-chip-active,
theme-dark .theme-chip-active {
    background-color: #0f172a;
    color: #f8fafc;
    border-color: #818cf8;
}

.theme-light {
    background-color: #f8fafc;
}

.search-highlight {
    background-color: rgba(251, 191, 36, 0.45);
    border-radius: 2px;
}

html.theme-dark .search-highlight,
body.theme-dark .search-highlight,
.theme-dark .search-highlight {
    background-color: rgba(250, 204, 21, 0.65);
}

@media print {
    @page {
        size: ${PAGE_WIDTH_IN}in ${PAGE_HEIGHT_IN}in;
        margin: ${PRINT_PAGE_MARGIN_IN}in;
    }

    html, body {
        background: #ffffff !important;
    }

    .fixed,
    .theme-panel,
    .theme-overlay,
    .theme-gap,
    .theme-shell > header,
    .theme-shell .pagination-controls,
    .header-footer-overlay,
    .page-overlay {
        display: none !important;
    }

    .theme-shell {
        border: none !important;
        box-shadow: none !important;
        background: transparent !important;
    }

    /* Hide absolute overlay layers (page headers/footers/masks) during print */
    .pointer-events-none.z-25,
    .pointer-events-none.z-30 {
        display: none !important;
    }

    .printable-page {
        width: ${PAGE_WIDTH_IN}in !important;
        min-height: ${PAGE_HEIGHT_IN}in !important;
        margin: 0 auto !important;
        padding: ${PAGE_TOP_PADDING_IN}in ${PAGE_SIDE_PADDING_IN}in ${PAGE_BOTTOM_PADDING_IN}in !important;
        box-shadow: none !important;
        background: #ffffff !important;
        color: #0f172a !important;
    }

    .page-break-filler[data-print-break="true"] {
        height: 0 !important;
        padding: 0 !important;
        margin: 0 !important;
        break-after: page;
        page-break-after: always;
    }

    .page-break-filler[data-print-break="false"] {
        height: 0 !important;
        padding: 0 !important;
        margin: 0 !important;
        break-after: auto;
        page-break-after: auto;
    }
}
`;

const DEFAULT_LETTER = `
    <h1>USCIS Cover Letter</h1>
    <p>January 8, 2026</p>
    <p>USCIS<br />
        Attn: I-129 Petition for a Nonimmigrant Worker<br />
        California Service Center
    </p>
    <p>Re: Petition for <strong>Maria Rodriguez</strong></p>
    <p>To Whom It May Concern,</p>
    <p>
        Please accept the enclosed Form I-129, Petition for a Nonimmigrant Worker, filed on behalf of Ms. Rodriguez.
        The petitioner respectfully requests premium processing for this filing as the beneficiary must commence critical
        project work for our client in Q1.
    </p>
    <p>
        The supporting documents have been organized chronologically to simplify adjudication. Kindly keep the order intact
        during your review.
    </p>
    <ul>
        <li>Form G-28, Notice of Entry of Appearance</li>
        <li>Form I-129 with H-1B Data Collection</li>
        <li>Support letter and exhibits</li>
    </ul>
    <p>Thank you for your prompt attention to this matter.</p>
    <p>Sincerely,<br /> LegalBridge LLP</p>
`;

const DEFAULT_HEADER_TEXT = "";
const DEFAULT_FOOTER_TEXT = "";

type ToolbarButtonProps = {
    label: string;
    icon: ComponentType<{ className?: string }>;
    isActive?: boolean;
    onClick: () => void;
    disabled?: boolean;
};

const ToolbarButton = ({ label, icon: Icon, isActive = false, onClick, disabled = false }: ToolbarButtonProps) => (
    <button
        type="button"
        title={label}
        className={cn(
            "inline-flex h-7 w-7 flex-none items-center justify-center rounded-md border text-[11px] font-medium transition theme-icon-button",
            isActive ? "border-brand-500 bg-brand-50 text-brand-600" : "border-slate-200 bg-white text-slate-600",
            disabled && "cursor-not-allowed opacity-40",
        )}
        onClick={onClick}
        disabled={disabled}
    >
        <Icon className="h-3.5 w-3.5" />
    </button>
);

const ToolbarDivider = () => <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden="true" />;

const HeaderIconButton = ({ icon: Icon, label, onClick, disabled = false }: HeaderIconButtonProps) => (
    <button
        type="button"
        aria-label={label}
        title={label}
        className={cn(
            "inline-flex h-7 w-7 items-center justify-center rounded-full border text-slate-600 transition theme-icon-button",
            disabled ? "cursor-not-allowed opacity-40" : "bg-white hover:border-slate-400",
        )}
        onClick={onClick}
        disabled={disabled}
    >
        <Icon className="h-3.5 w-3.5" />
    </button>
);

const collapseRangeSelection = (editor: Editor) => {
    const { state, view } = editor;
    if (!view || state.selection.empty) return;
    const { doc, selection } = state;
    const targetPos = Math.min(selection.to, doc.content.size);
    const tr = state.tr.setSelection(TextSelection.create(doc, targetPos));
    tr.setMeta("addToHistory", false);
    view.dispatch(tr);
};

const runEditorCommand = (
    editor: Editor | null,
    command: (instance: Editor) => void,
    { collapseSelection = true }: { collapseSelection?: boolean } = {},
) => {
    if (!editor) return;
    command(editor);
    if (collapseSelection) {
        collapseRangeSelection(editor);
    }
};

type ColorPickerProps = {
    editor: Editor | null;
};
type SearchMatch = {
    from: number;
    to: number;
};

type ColorSwatchProps = {
    color: string;
    label: string;
    isActive: boolean;
    onSelect: () => void;
};

const ColorSwatch = ({ color, label, isActive, onSelect }: ColorSwatchProps) => (
    <button
        type="button"
        title={label}
        aria-label={`Apply ${label} text color`}
        onClick={onSelect}
        className={cn(
            "h-5 w-5 rounded-full border transition theme-swatch",
            isActive ? "border-slate-900 ring-2 ring-slate-300 ring-offset-1" : "border-slate-200",
        )}
        style={{ backgroundColor: color }}
    />
);

const ColorPicker = ({ editor }: ColorPickerProps) => {
    if (!editor) return null;

    const activeColor = editor.getAttributes("textStyle")?.color ?? "";
    const setSwatchColor = (value: string) => {
        runEditorCommand(editor, (instance) => instance.chain().focus().setColor(value).run());
    };
    const resetColor = () => {
        runEditorCommand(editor, (instance) => instance.chain().focus().unsetColor().run());
    };

    return (
        <div className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 theme-pill">
            <Palette className="h-3.5 w-3.5 text-slate-400" />
            {COLOR_SWATCHES.map(({ label, value }) => (
                <ColorSwatch
                    key={value}
                    label={label}
                    color={value}
                    isActive={activeColor === value}
                    onSelect={() => setSwatchColor(value)}
                />
            ))}
            <button
                type="button"
                onClick={resetColor}
                className="text-[9px] font-semibold uppercase tracking-[0.35em] text-slate-500"
            >
                Reset
            </button>
        </div>
    );
};

const DEFAULT_EXTENSIONS = [
    StarterKit.configure({
        heading: { levels: [1, 2, 3] },
    }),
    Placeholder.configure({ placeholder: "Start drafting your legal document…" }),
    Underline,
    TextStyle,
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    Color,
    Highlight,
    Superscript,
    Subscript,
    CharacterCount.configure(),
    FooterReserveExtension,
    SelectionGuardExtension,
    SearchHighlightExtension,
];

export const PaginatedEditor = () => {
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const contentRef = useRef<HTMLDivElement | null>(null);

    const [contentHeight, setContentHeight] = useState(PAGE_HEIGHT - PAGE_MARGIN * 2);
    const [pageCount, setPageCount] = useState(1);
    const [activePage, setActivePage] = useState(1);
    const [pageStartNumber, setPageStartNumber] = useState(1);
    const [headerText, setHeaderText] = useState(DEFAULT_HEADER_TEXT);
    const [footerText, setFooterText] = useState(DEFAULT_FOOTER_TEXT);
    const [documentTitle, setDocumentTitle] = useState("Paginated Letter Editor");
    const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
    const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "unsaved">("saved");
    const [showPageNumbers, setShowPageNumbers] = useState(true);
    const [autoSaveEnabled, setAutoSaveEnabled] = useState(true);
    const [isDarkMode, setIsDarkMode] = useState(false);
    const [editingRegion, setEditingRegion] = useState<"header" | "footer" | null>(null);
    const [draftText, setDraftText] = useState("");
    const [fontFamily, setFontFamily] = useState<FontChoice>("default");
    const [lineSpacing, setLineSpacing] = useState(1.5);
    const [searchQuery, setSearchQuery] = useState("");
    const [replaceText, setReplaceText] = useState("");
    const [searchMatches, setSearchMatches] = useState<SearchMatch[]>([]);
    const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
    const [searchRefreshKey, setSearchRefreshKey] = useState(0);
    const [saveNowFeedback, setSaveNowFeedback] = useState(false);

    const measureHeight = useCallback(() => {
        if (!contentRef.current) return;
        setContentHeight(contentRef.current.scrollHeight);
    }, []);

    const editor = useEditor({
        extensions: DEFAULT_EXTENSIONS,
        content: DEFAULT_LETTER,
        autofocus: "end",
        editorProps: {
            attributes: {
                class: "tiptap",
            },
        },
        onUpdate: () => {
            measureHeight();
            setSaveStatus("unsaved");
            setSearchRefreshKey((key) => key + 1);
        },
    });

    useEffect(() => {
        if (!contentRef.current || typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver(() => measureHeight());
        observer.observe(contentRef.current);
        measureHeight();
        return () => observer.disconnect();
    }, [measureHeight]);

    useEffect(() => {
        const total = contentHeight + PAGE_MARGIN * 2 + PAGE_GAP;
        setPageCount(Math.max(1, Math.ceil(total / PAGE_STRIDE)));
    }, [contentHeight]);

    const updateActivePage = useCallback(() => {
        if (typeof window === "undefined" || !scrollRef.current) return;
        const containerTop = scrollRef.current.getBoundingClientRect().top + window.scrollY;
        const relativeScroll = Math.max(0, window.scrollY - containerTop);
        const rawPage = Math.floor((relativeScroll + PAGE_HEIGHT / 2) / PAGE_HEIGHT) + 1;
        setActivePage(Math.min(pageCount, Math.max(1, rawPage)));
    }, [pageCount]);

    useEffect(() => {
        updateActivePage();
        if (typeof window === "undefined") return;

        const handle = () => updateActivePage();
        window.addEventListener("scroll", handle, { passive: true });
        window.addEventListener("resize", handle);

        return () => {
            window.removeEventListener("scroll", handle);
            window.removeEventListener("resize", handle);
        };
    }, [updateActivePage]);

    const documentHeight = Math.max(
        pageCount * PAGE_HEIGHT + Math.max(0, pageCount - 1) * PAGE_GAP,
        PAGE_HEIGHT,
    );

    const characters = editor?.storage?.characterCount?.characters() ?? 0;
    const words = editor?.storage?.characterCount?.words() ?? 0;
    const estimatedReadingMinutes = Math.max(1, Math.ceil(words / 200));
    const currentPageNumber = pageStartNumber + activePage - 1;
    const lastPageNumber = pageStartNumber + pageCount - 1;
    const hasSearchQuery = searchQuery.trim().length > 0;
    const hasMatches = searchMatches.length > 0;
    const searchStatusLabel = !hasSearchQuery
        ? "Search"
        : hasMatches
            ? `Match ${currentMatchIndex + 1}/${searchMatches.length}`
            : "No matches";
    const resolvedFontFamily = fontFamily === "default" ? undefined : FONT_PRESETS[fontFamily];

    const canHeading1 = editor ? editor.can().toggleHeading({ level: 1 }) : false;
    const canHeading2 = editor ? editor.can().toggleHeading({ level: 2 }) : false;
    const canHeading3 = editor ? editor.can().toggleHeading({ level: 3 }) : false;
    const canBold = editor ? editor.can().toggleBold() : false;
    const canItalic = editor ? editor.can().toggleItalic() : false;
    const canUnderline = editor ? editor.can().toggleUnderline() : false;
    const canAlignLeft = editor ? editor.can().setTextAlign("left") : false;
    const canAlignCenter = editor ? editor.can().setTextAlign("center") : false;
    const canAlignRight = editor ? editor.can().setTextAlign("right") : false;
    const canJustify = editor ? editor.can().setTextAlign("justify") : false;
    const canUndo = editor ? editor.can().undo() : false;
    const canRedo = editor ? editor.can().redo() : false;

    const trimTrailingEmptyParagraphs = (docJson: any) => {
        if (!docJson || !Array.isArray(docJson.content)) return docJson;
        const content = [...docJson.content];
        while (content.length) {
            const node = content[content.length - 1];
            if (node?.type === "paragraph") {
                const nodeContent = node.content ?? [];
                if (nodeContent.length === 0) {
                    content.pop();
                    continue;
                }
                if (
                    nodeContent.length === 1 &&
                    nodeContent[0].type === "text" &&
                    (nodeContent[0].text ?? "").trim() === ""
                ) {
                    content.pop();
                    continue;
                }
            }
            break;
        }
        return { ...docJson, content };
    };

    const goPrint = () => {
        if (!editor) {
            window.print();
            return;
        }

        const triggerPrint = () => {
            requestAnimationFrame(() => {
                try {
                    window.print();
                } catch {
                    // ignore
                }
            });
        };

        try {
            const original = editor.getJSON();
            const cleaned = trimTrailingEmptyParagraphs(original);
            const same = JSON.stringify(cleaned) === JSON.stringify(original);

            if (same) {
                triggerPrint();
                return;
            }

            editor.commands.setContent(cleaned, false);
            setTimeout(() => {
                try {
                    triggerPrint();
                } finally {
                    setTimeout(() => {
                        try {
                            editor.commands.setContent(original, false);
                        } catch {
                            // ignore
                        }
                    }, 10);
                }
            }, 20);
        } catch (error) {
            // fallback
            // eslint-disable-next-line no-console
            console.warn("print fallback error", error);
            window.print();
        }
    };

    const toggleAutoSave = () => {
        setAutoSaveEnabled((prev) => !prev);
    };

    const setHeading = (level: 1 | 2 | 3) => {
        runEditorCommand(editor, (instance) => instance.chain().focus().toggleHeading({ level }).run());
    };

    const setAlignment = (alignment: "left" | "center" | "right" | "justify") => {
        if (alignment === "justify") {
            runEditorCommand(editor, (instance) => instance.chain().focus().setTextAlign("justify").run());
            return;
        }
        runEditorCommand(editor, (instance) => instance.chain().focus().setTextAlign(alignment).run());
    };

    const clearFormatting = () => {
        runEditorCommand(editor, (instance) => instance.chain().focus().unsetAllMarks().setParagraph().run());
    };

    const insertDivider = () => {
        runEditorCommand(editor, (instance) => instance.chain().focus().setHorizontalRule().run());
    };

    const insertHardBreak = () => {
        runEditorCommand(editor, (instance) => instance.chain().focus().setHardBreak().run());
    };

    const insertCurrentDate = () => {
        const formatted = dayjs().format("MMMM D, YYYY");
        runEditorCommand(editor, (instance) => instance.chain().focus().insertContent(`<p>${formatted}</p>`).run());
    };

    const insertRecipientBlock = () => {
        const block = `<p>USCIS<br />Attn: Petition Review Unit<br />California Service Center</p>`;
        runEditorCommand(editor, (instance) => instance.chain().focus().insertContent(block).run());
    };

    const insertSignatureBlock = () => {
        const block = `<p>Sincerely,<br /><strong>LegalBridge LLP</strong><br />Authorized Signatory</p>`;
        runEditorCommand(editor, (instance) => instance.chain().focus().insertContent(block).run());
    };

    const insertContactBlock = () => {
        const block = `<p>Email: support@legalbridge.com<br />Phone: (555) 010-8899</p>`;
        runEditorCommand(editor, (instance) => instance.chain().focus().insertContent(block).run());
    };

    const applyTextTransform = (transformFn: (text: string) => string) => {
        if (!editor) return;
        const { state } = editor;
        const { from, to } = state.selection;
        if (from === to) return;
        const text = state.doc.textBetween(from, to, "\n");
        const transformed = transformFn(text);
        runEditorCommand(editor, (instance) =>
            instance.chain().focus().insertContentAt({ from, to }, transformed).run(),
        );
    };

    const makeUppercase = () => applyTextTransform((text) => text.toUpperCase());
    const makeLowercase = () => applyTextTransform((text) => text.toLowerCase());

    const insertSalutationBlock = () => {
        const block = `<p>Dear Adjudicating Officer,</p>`;
        runEditorCommand(editor, (instance) => instance.chain().focus().insertContent(block).run());
    };

    const insertExecutiveSummary = () => {
        const block = `
            <section>
                <h2>Executive Summary</h2>
                <p>
                    This section provides a concise overview of the petitioner, the beneficiary, and the relief being requested.
                    Update the placeholders with the specific project description, visa classification, and urgency notes.
                </p>
            </section>
        `;
        runEditorCommand(editor, (instance) => instance.chain().focus().insertContent(block).run());
    };

    const insertEvidenceChecklist = () => {
        const block = `
            <p><strong>Supporting Evidence Checklist</strong></p>
            <ul>
                <li>Government filing forms</li>
                <li>Employment verification letters</li>
                <li>Contracts, statements of work, or project plans</li>
                <li>Academic credentials and evaluations</li>
                <li>Prior approval notices and I-94 records</li>
            </ul>
        `;
        runEditorCommand(editor, (instance) => instance.chain().focus().insertContent(block).run());
    };

    const insertReminderBanner = () => {
        const block = `
            <div style="border: 1px solid #c7d2fe; background: #eef2ff; padding: 12px; border-radius: 12px;">
                <strong>Reminder:</strong> Update this banner with any filing deadlines, premium processing requests,
                or follow-up tasks before sending the packet to USCIS.
            </div>
        `;
        runEditorCommand(editor, (instance) => instance.chain().focus().insertContent(block).run());
    };

    const insertTimelineBlock = () => {
        const block = `
            <p><strong>Key Milestones</strong></p>
            <ol>
                <li>Petitioner gathers supporting evidence — <em>Week 1</em></li>
                <li>Final legal review and exhibit bookmarking — <em>Week 2</em></li>
                <li>USCIS filing and receipt notice — <em>Week 3</em></li>
                <li>Target adjudication or premium processing response — <em>Week 5</em></li>
            </ol>
        `;
        runEditorCommand(editor, (instance) => instance.chain().focus().insertContent(block).run());
    };

    const resetSearchDecorations = useCallback(() => {
        if (!editor) return;
        const tr = editor.state.tr.setMeta(searchHighlightPluginKey, DecorationSet.empty);
        tr.setMeta("addToHistory", false);
        editor.view.dispatch(tr);
    }, [editor]);

    const refreshSearchHighlights = useCallback(() => {
        if (!editor) return;
        const query = searchQuery.trim();
        if (!query) {
            resetSearchDecorations();
            setSearchMatches([]);
            setCurrentMatchIndex(0);
            return;
        }

        const { doc } = editor.state;
        const decorations: Decoration[] = [];
        const matches: SearchMatch[] = [];
        const queryLower = query.toLowerCase();

        doc.descendants((node, pos) => {
            if (!node.isText || !node.text) return true;
            const text = node.text;
            const lower = text.toLowerCase();
            let index = lower.indexOf(queryLower);
            while (index !== -1) {
                const from = pos + index;
                const to = from + query.length;
                decorations.push(Decoration.inline(from, to, { class: "search-highlight" }));
                matches.push({ from, to });
                index = lower.indexOf(queryLower, index + Math.max(1, queryLower.length));
            }
            return true;
        });

        const decorationSet = decorations.length ? DecorationSet.create(doc, decorations) : DecorationSet.empty;
        const tr = editor.state.tr.setMeta(searchHighlightPluginKey, decorationSet);
        tr.setMeta("addToHistory", false);
        editor.view.dispatch(tr);
        setSearchMatches(matches);
        setCurrentMatchIndex(matches.length ? 0 : 0);
    }, [editor, resetSearchDecorations, searchQuery]);

    useEffect(() => {
        refreshSearchHighlights();
    }, [refreshSearchHighlights, searchRefreshKey]);

    const scrollMatchIntoCenter = useCallback(
        (from: number, to?: number) => {
            if (!editor) return;
            try {
                const start = editor.view.coordsAtPos(from);
                const end = editor.view.coordsAtPos(to ?? from);
                const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
                const matchTop = (start.top ?? start.bottom ?? 0) + window.scrollY;
                const matchBottom = (end.bottom ?? end.top ?? start.bottom ?? start.top ?? 0) + window.scrollY;
                const matchCenter = matchTop + (matchBottom - matchTop) / 2;
                const maxScroll = Math.max(0, documentHeight - viewportHeight);
                const rawTarget = matchCenter - viewportHeight / 2;
                const target = Math.max(0, Math.min(rawTarget, maxScroll));
                window.scrollTo({ top: target, behavior: "smooth" });
            } catch (error) {
                editor.commands.scrollIntoView();
            }
        },
        [documentHeight, editor],
    );

    const focusMatchAt = useCallback(
        (index: number) => {
            if (!editor || !searchMatches.length) return;
            const boundedIndex = ((index % searchMatches.length) + searchMatches.length) % searchMatches.length;
            const match = searchMatches[boundedIndex];
            editor
                .chain()
                .focus()
                .setTextSelection({ from: match.from, to: match.to })
                .run();
            scrollMatchIntoCenter(match.from, match.to);
            setCurrentMatchIndex(boundedIndex);
        },
        [editor, scrollMatchIntoCenter, searchMatches],
    );

    const goToNextMatch = () => {
        if (!searchMatches.length) return;
        focusMatchAt(currentMatchIndex + 1);
    };

    const goToPreviousMatch = () => {
        if (!searchMatches.length) return;
        focusMatchAt(currentMatchIndex - 1);
    };

    const clearSearch = () => {
        setSearchQuery("");
        setReplaceText("");
        setSearchMatches([]);
        setCurrentMatchIndex(0);
        resetSearchDecorations();
    };

    const replaceCurrentMatch = () => {
        if (!editor || !searchMatches.length) return;
        const match = searchMatches[currentMatchIndex] ?? searchMatches[0];
        editor
            .chain()
            .focus()
            .insertContentAt({ from: match.from, to: match.to }, replaceText, {
                updateSelection: true,
            })
            .run();
        scrollMatchIntoCenter(match.from, match.from + replaceText.length);
        setSaveStatus("unsaved");
        setSearchRefreshKey((key) => key + 1);
    };

    const replaceAllMatches = () => {
        if (!editor || !searchMatches.length) return;
        const firstMatch = searchMatches[0];
        const matchesDescending = [...searchMatches].sort((a, b) => b.from - a.from);
        const chain = editor.chain().focus();
        matchesDescending.forEach((match) => {
            chain.insertContentAt({ from: match.from, to: match.to }, replaceText, {
                updateSelection: false,
            });
        });
        chain.run();
        scrollMatchIntoCenter(firstMatch.from, firstMatch.from + replaceText.length);
        setSaveStatus("unsaved");
        setSearchRefreshKey((key) => key + 1);
    };

    const handleUndo = () => {
        editor?.chain().focus().undo().run();
    };

    const handleRedo = () => {
        editor?.chain().focus().redo().run();
    };

    const handlePageStartChange = (event: ChangeEvent<HTMLInputElement>) => {
        const value = parseInt(event.target.value, 10);
        if (Number.isNaN(value)) {
            setPageStartNumber(1);
            return;
        }
        setPageStartNumber(Math.max(1, value));
    };

    const openEditor = (
        region: "header" | "footer",
        options?: { scroll?: boolean; pageIndex?: number; initialValue?: string },
    ) => {
        const source = options?.initialValue ?? (region === "header" ? headerText : footerText);
        setDraftText(source ?? "");
        setEditingRegion(region);

        if (options?.scroll) {
            const targetPage = typeof options.pageIndex === "number" && options.pageIndex >= 0
                ? options.pageIndex
                : Math.max(0, activePage - 1);
            requestAnimationFrame(() => {
                if (region === "header") {
                    scrollToHeader(targetPage);
                } else {
                    scrollToFooter(targetPage);
                }
            });
        }
    };

    const scrollToHeader = (pageIndex = Math.max(0, activePage - 1)) => {
        if (!scrollRef.current) return;
        const containerTop = scrollRef.current.getBoundingClientRect().top + window.scrollY;
        const pageTop = pageIndex * (PAGE_HEIGHT + PAGE_GAP);
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
        const elementTop = containerTop + pageTop;
        const elementCenter = elementTop + PAGE_TOP_PADDING / 2;
        const rawTarget = elementCenter - viewportHeight / 2;
        const maxScroll = Math.max(0, documentHeight - viewportHeight);
        const target = Math.max(0, Math.min(rawTarget, maxScroll));
        window.scrollTo({ top: target, behavior: "smooth" });
    };

    const scrollToFooter = (pageIndex = Math.max(0, activePage - 1)) => {
        if (!scrollRef.current) return;
        const containerTop = scrollRef.current.getBoundingClientRect().top + window.scrollY;
        const footerTop = pageIndex * (PAGE_HEIGHT + PAGE_GAP) + PAGE_HEIGHT - PAGE_FOOTER_HEIGHT;
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
        const elementTop = containerTop + footerTop;
        const elementCenter = elementTop + PAGE_FOOTER_HEIGHT / 2;
        const rawTarget = elementCenter - viewportHeight / 2;
        const maxScroll = Math.max(0, documentHeight - viewportHeight);
        const target = Math.max(0, Math.min(rawTarget, maxScroll));
        window.scrollTo({ top: target, behavior: "smooth" });
    };

    const closeEditor = () => {
        setEditingRegion(null);
        setDraftText("");
    };

    const saveEditor = (value?: string) => {
        if (!editingRegion) return;
        const source = value !== undefined ? value : draftText;
        const cleaned = (typeof source === "string" ? source : String(source)).trim();

        if (editingRegion === "header") {
            setHeaderText(cleaned);
        } else {
            setFooterText(cleaned);
        }
        setEditingRegion(null);
        setDraftText("");
        setSaveStatus("unsaved");
    };

    // Local UI state for header/footer dropdown menus in the function section
    const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
    const [footerMenuOpen, setFooterMenuOpen] = useState(false);

    useEffect(() => {
        if (typeof document === "undefined") {
            return undefined;
        }
        const body = document.body;
        const root = document.documentElement;
        if (!body || !root) {
            return undefined;
        }
        body.classList.toggle("theme-dark", isDarkMode);
        body.classList.toggle("theme-light", !isDarkMode);
        root.classList.toggle("theme-dark", isDarkMode);
        root.classList.toggle("theme-light", !isDarkMode);
        return () => {
            body.classList.remove("theme-dark", "theme-light");
            root.classList.remove("theme-dark", "theme-light");
        };
    }, [isDarkMode]);

    const applyHeaderTemplate = (key: "blank" | "three") => {
        const template = key === "three"
            ? "<p>Left</p>|||<p>Center</p>|||<p>Right</p>"
            : "<p>Type header text</p>";
        setHeaderText(template);
        setHeaderMenuOpen(false);
        setSaveStatus("unsaved");
        requestAnimationFrame(() => openEditor("header", { scroll: true, initialValue: template }));
    };

    const applyFooterTemplate = (key: "blank" | "three") => {
        const template = key === "three"
            ? "<p>Left</p>|||<p>Center</p>|||<p>Right</p>"
            : "<p>Type footer text</p>";
        setFooterText(template);
        setFooterMenuOpen(false);
        setSaveStatus("unsaved");
        requestAnimationFrame(() => openEditor("footer", { scroll: true, initialValue: template }));
    };

    const persistDraft = useCallback(
        () => {
            if (!editor || typeof window === "undefined") return;
            try {
                setSaveStatus("saving");
                const payload = {
                    title: documentTitle,
                    headerText,
                    footerText,
                    fontFamily,
                    lineSpacing,
                    content: editor.getJSON(),
                    savedAt: new Date().toISOString(),
                };
                window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(payload));
                setLastSavedAt(new Date());
                setSaveStatus("saved");
            } catch (error) {
                // eslint-disable-next-line no-console
                console.warn("persistDraft error", error);
                setSaveStatus("unsaved");
            }
        },
        [documentTitle, editor, fontFamily, footerText, headerText, lineSpacing],
    );

    useEffect(() => {
        if (typeof window === "undefined") return undefined;
        if (saveStatus !== "unsaved" || !autoSaveEnabled) return undefined;
        const handle = window.setTimeout(() => {
            persistDraft();
        }, 2000);
        return () => window.clearTimeout(handle);
    }, [autoSaveEnabled, persistDraft, saveStatus]);

    useEffect(() => {
        if (!editor || typeof window === "undefined") return;
        try {
            const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
            if (!raw) return;
            const parsed = JSON.parse(raw) as {
                title?: string;
                headerText?: string;
                footerText?: string;
                fontFamily?: FontChoice;
                lineSpacing?: number;
                content?: unknown;
            };
            if (parsed.title) setDocumentTitle(parsed.title);
            if (typeof parsed.headerText === "string") setHeaderText(parsed.headerText);
            if (typeof parsed.footerText === "string") setFooterText(parsed.footerText);
            if (parsed.fontFamily && parsed.fontFamily in FONT_PRESETS) setFontFamily(parsed.fontFamily);
            if (parsed.lineSpacing) setLineSpacing(parsed.lineSpacing);
            if (parsed.content) {
                editor.commands.setContent(parsed.content);
            }
            if (parsed.content || parsed.headerText || parsed.footerText || parsed.title) {
                setSaveStatus("saved");
                setLastSavedAt(new Date());
            }
        } catch (error) {
            // eslint-disable-next-line no-console
            console.warn("Failed to hydrate draft", error);
        }
    }, [editor]);

    const saveStatusLabel = (() => {
        if (saveStatus === "saving") return "Saving…";
        if (saveStatus === "unsaved") return "Unsaved changes";
        if (lastSavedAt) {
            return `Saved ${dayjs(lastSavedAt).format("h:mm:ss A")}`;
        }
        return "Saved";
    })();

    return (
        <div className={cn(isDarkMode ? "theme-dark" : "theme-light")}>
            <section className="px-4 pb-12 pt-[140px]">
            <div className="fixed left-0 right-0 top-0 z-40 flex justify-center px-4">
                <div className="w-full max-w-[1100px] rounded-2xl border border-white/50 bg-white/90 p-2.5 shadow-lg backdrop-blur theme-panel">
                    <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                        <div className="flex items-center gap-3">
                            <span className="text-xs text-slate-500">File name</span>
                            <input
                                type="text"
                                value={documentTitle}
                                onChange={(event) => {
                                    setDocumentTitle(event.target.value);
                                    setSaveStatus("unsaved");
                                }}
                                className="w-64 rounded-md border border-transparent bg-brand-50 px-2 text-base font-semibold text-slate-900 focus:border-brand-400 focus:bg-white focus:outline-none capitalize"
                                aria-label="Document Title"
                            />
                            {!autoSaveEnabled ? (
                                <button
                                    type="button"
                                    disabled={!editor || saveStatus === "saving"}
                                    onClick={() => {
                                        persistDraft();
                                        setSaveNowFeedback(true);
                                        setTimeout(() => setSaveNowFeedback(false), 1500);
                                    }}
                                    className={cn(
                                        "inline-flex items-center gap-1 rounded-full border px-3 py-0.5 text-[10px] font-semibold shadow",
                                        saveStatus === "saving"
                                            ? "border-slate-200 bg-slate-100 text-slate-500"
                                            : "border-brand-200 bg-white text-brand-600 hover:bg-brand-50",
                                    )}
                                >
                                    <Save className="h-3 w-3" />
                                    {saveNowFeedback ? "Saved" : "Save Now"}
                                </button>
                            ) : null}
                            <button
                                type="button"
                                onClick={toggleAutoSave}
                                className={cn(
                                    "inline-flex items-center gap-1 rounded-full border px-3 py-0.5 text-[10px] font-semibold uppercase tracking-[0.3em] shadow-sm theme-pill",
                                    autoSaveEnabled
                                        ? "border-brand-200 bg-brand-50 text-brand-600"
                                        : "border-slate-200 bg-white text-slate-500",
                                )}
                                aria-pressed={autoSaveEnabled}
                            >
                                Auto Save {autoSaveEnabled ? "On" : "Off"}
                            </button>
                        </div>

                        <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-600 lg:justify-end flex-nowrap">
                            <div className="flex items-center gap-1 rounded-full border border-slate-200 bg-white/90 px-1 py-0.5 shadow-sm theme-pill">
                                <HeaderIconButton label="Undo" icon={Undo} onClick={handleUndo} disabled={!canUndo} />
                                <HeaderIconButton label="Redo" icon={Redo} onClick={handleRedo} disabled={!canRedo} />
                            </div>

                            <div className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white/90 px-2 py-0.5 uppercase tracking-[0.3em] text-slate-500 shadow-sm theme-pill">
                                <span>Start Page</span>
                                <div className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-slate-600 theme-pill">
                                    <input
                                        type="number"
                                        min={1}
                                        value={pageStartNumber}
                                        onChange={handlePageStartChange}
                                        className="w-9 rounded-md border border-slate-200 px-1 py-0.5 text-[11px] font-semibold text-slate-700 focus:border-brand-500 focus:outline-none"
                                    />
                                    <span className="text-slate-400">/</span>
                                    <span>{lastPageNumber}</span>
                                </div>
                            </div>

                            {/* Current page indicator moved into the search toolbar */}

                            

                            <div className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white/80 px-1 py-0.5 shadow-sm theme-pill">
                                <button
                                    type="button"
                                    onClick={() => setIsDarkMode(false)}
                                    className={cn(
                                        "rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.3em]",
                                        !isDarkMode
                                            ? "bg-brand-600 text-white shadow"
                                            : "text-slate-200"
                                    )}
                                >
                                    Light
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setIsDarkMode(true)}
                                    className={cn(
                                        "rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.3em]",
                                        isDarkMode
                                            ? "bg-white text-black shadow"
                                            : "text-slate-200"
                                    )}
                                >
                                    Dark
                                </button>
                            </div>

                            <div className="flex items-center gap-1">
                                <button
                                    type="button"
                                    onClick={goPrint}
                                    className="inline-flex items-center gap-1 rounded-full bg-brand-600 px-2 py-0.5 text-[10px] font-semibold text-white shadow hover:bg-brand-500"
                                >
                                    <Printer className="h-3 w-3" />
                                    Print / PDF
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="toolbar mt-2 flex flex-col gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow theme-surface">
                        <div className="flex flex-wrap items-center gap-2">
                            <ColorPicker editor={editor} />

                            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs font-semibold text-slate-600 theme-pill theme-surface">
                                <span className="uppercase tracking-[0.3em] text-[9px] text-slate-400">Font</span>
                                <select
                                    value={fontFamily}
                                    onChange={(event) => {
                                        setFontFamily(event.target.value as FontChoice);
                                        setSaveStatus("unsaved");
                                    }}
                                    className="rounded-md border px-2 py-0.5 text-xs focus:border-brand-500 focus:outline-none theme-input"
                                >
                                    <option value="default">Default</option>
                                    <option value="serif">Serif</option>
                                    <option value="sans">Sans</option>
                                    <option value="mono">Mono</option>
                                </select>
                            </div>

                            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs font-semibold text-slate-600 theme-pill theme-surface">
                                <span className="uppercase tracking-[0.3em] text-[9px] text-slate-400">Spacing</span>
                                <div className="flex items-center gap-1">
                                    {LINE_SPACING_OPTIONS.map((option) => (
                                        <button
                                            key={option.value}
                                            type="button"
                                            onClick={() => {
                                                setLineSpacing(option.value);
                                                setSaveStatus("unsaved");
                                            }}
                                            className={cn(
                                                "rounded-md border px-1.5 py-0.5 text-[11px] transition theme-chip",
                                                lineSpacing === option.value && "theme-chip-active"
                                            )}
                                        >
                                            {option.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-1">
                                <ToolbarButton label="Insert Date" icon={CalendarDays} onClick={insertCurrentDate} disabled={!editor} />
                                <ToolbarButton label="Recipient Block" icon={Building2} onClick={insertRecipientBlock} disabled={!editor} />
                                <ToolbarButton label="Signature" icon={FileSignature} onClick={insertSignatureBlock} disabled={!editor} />
                                <ToolbarButton label="Contact Info" icon={Mail} onClick={insertContactBlock} disabled={!editor} />
                                <ToolbarButton
                                    label="Client Name"
                                    icon={UserRound}
                                    onClick={() =>
                                        runEditorCommand(editor, (instance) =>
                                            instance
                                                .chain()
                                                .focus()
                                                .insertContent("<p><strong>Client Name</strong></p>")
                                                .run(),
                                        )
                                    }
                                    disabled={!editor}
                                />
                                <ToolbarButton label="Salutation" icon={ScrollText} onClick={insertSalutationBlock} disabled={!editor} />
                                <ToolbarButton label="Exec Summary" icon={NotebookPen} onClick={insertExecutiveSummary} disabled={!editor} />
                                <ToolbarButton label="Evidence List" icon={ListChecks} onClick={insertEvidenceChecklist} disabled={!editor} />
                                <ToolbarButton label="Timeline" icon={Stamp} onClick={insertTimelineBlock} disabled={!editor} />
                                <ToolbarButton label="Reminder" icon={Sparkles} onClick={insertReminderBanner} disabled={!editor} />
                                <div className="ml-2 flex items-center gap-1">
                                    {/* Header dropdown (text-only button) */}
                                    <div className="relative">
                                        <button
                                            type="button"
                                            onClick={() => setHeaderMenuOpen((s) => !s)}
                                            className="rounded-md border border-slate-200 bg-white px-3 py-1 text-sm font-medium text-slate-700 hover:border-slate-300 theme-pill"
                                        >
                                            Header
                                        </button>
                                        {headerMenuOpen ? (
                                            <div className="absolute left-0 z-50 mt-2 w-48 rounded-md border border-slate-200 bg-white shadow-lg">
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        openEditor("header", { scroll: true });
                                                        setHeaderMenuOpen(false);
                                                    }}
                                                    className="w-full text-left px-3 py-2 hover:bg-slate-50"
                                                >
                                                    Edit Header
                                                </button>
                                                <div className="border-t" />
                                                <button
                                                    type="button"
                                                    onClick={() => applyHeaderTemplate("blank")}
                                                    className="w-full text-left px-3 py-2 hover:bg-slate-50"
                                                >
                                                    Blank
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => applyHeaderTemplate("three")}
                                                    className="w-full text-left px-3 py-2 hover:bg-slate-50"
                                                >
                                                    Blank (Three Columns)
                                                </button>
                                            </div>
                                        ) : null}
                                    </div>

                                    {/* Footer dropdown (text-only button) */}
                                    <div className="relative">
                                        <button
                                            type="button"
                                            onClick={() => setFooterMenuOpen((s) => !s)}
                                            className="rounded-md border border-slate-200 bg-white px-3 py-1 text-sm font-medium text-slate-700 hover:border-slate-300 theme-pill"
                                        >
                                            Footer
                                        </button>
                                        {footerMenuOpen ? (
                                            <div className="absolute left-0 z-50 mt-2 w-48 rounded-md border border-slate-200 bg-white shadow-lg">
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        openEditor("footer", { scroll: true });
                                                        setFooterMenuOpen(false);
                                                    }}
                                                    className="w-full text-left px-3 py-2 hover:bg-slate-50"
                                                >
                                                    Edit Footer
                                                </button>
                                                <div className="border-t" />
                                                <button
                                                    type="button"
                                                    onClick={() => applyFooterTemplate("blank")}
                                                    className="w-full text-left px-3 py-2 hover:bg-slate-50"
                                                >
                                                    Blank
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => applyFooterTemplate("three")}
                                                    className="w-full text-left px-3 py-2 hover:bg-slate-50"
                                                >
                                                    Blank (Three Columns)
                                                </button>
                                            </div>
                                        ) : null}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="flex w-full flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white/80 px-3 py-2 theme-surface">
                            <div className="flex flex-wrap items-center gap-1">
                                <div className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 shadow-sm theme-surface">
                                    <Search className="h-3.5 w-3.5 text-slate-400" />
                                    <input
                                        type="text"
                                        value={searchQuery}
                                        onChange={(event) => {
                                            setSearchQuery(event.target.value);
                                            setSearchRefreshKey((key) => key + 1);
                                        }}
                                        placeholder="Search text"
                                        className="w-40 border-none bg-transparent text-[12px] placeholder:text-slate-400 focus:outline-none theme-input"
                                    />
                                </div>
                                <button
                                    type="button"
                                    onClick={goToPreviousMatch}
                                    disabled={!hasMatches}
                                    className={cn(
                                        "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.3em] transition theme-chip",
                                        !hasMatches && "opacity-40"
                                    )}
                                >
                                    Prev
                                </button>
                                <button
                                    type="button"
                                    onClick={goToNextMatch}
                                    disabled={!hasMatches}
                                    className={cn(
                                        "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.3em] transition theme-chip",
                                        !hasMatches && "opacity-40"
                                    )}
                                >
                                    Next
                                </button>
                                <span className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500">
                                    {searchStatusLabel}
                                </span>
                                
                            </div>

                            <div className="flex flex-wrap items-center gap-1">
                                <div className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 shadow-sm theme-surface">
                                    <ArrowLeftRight className="h-3.5 w-3.5 text-slate-400" />
                                    <input
                                        type="text"
                                        value={replaceText}
                                        onChange={(event) => setReplaceText(event.target.value)}
                                        placeholder="Replace with"
                                        className="w-40 border-none bg-transparent text-[12px] placeholder:text-slate-400 focus:outline-none theme-input"
                                    />
                                </div>
                                <button
                                    type="button"
                                    onClick={replaceCurrentMatch}
                                    disabled={!hasMatches}
                                    className={cn(
                                        "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.3em] transition theme-chip",
                                        hasMatches ? "theme-chip-active" : "opacity-40"
                                    )}
                                >
                                    Replace
                                </button>
                                <button
                                    type="button"
                                    onClick={replaceAllMatches}
                                    disabled={!hasMatches}
                                    className={cn(
                                        "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.3em] transition theme-chip",
                                        hasMatches ? "theme-chip-active" : "opacity-40"
                                    )}
                                >
                                    Replace All
                                </button>
                                <button
                                    type="button"
                                    onClick={clearSearch}
                                    disabled={!hasSearchQuery && !replaceText}
                                    className={cn(
                                        "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.3em] transition theme-chip",
                                        !hasSearchQuery && !replaceText && "opacity-40"
                                    )}
                                >
                                    Clear
                                </button>
                            </div>
                        
                            <div className="ml-auto flex items-center gap-2">
                                <button
                                    type="button"
                                    title={`Current page ${currentPageNumber}`}
                                    className={cn(
                                        "inline-flex h-7 items-center gap-1 rounded-full border px-2 text-[10px] font-semibold uppercase tracking-[0.25em] whitespace-nowrap shadow-sm theme-pill",
                                        "bg-white/80 border-slate-200 text-slate-500"
                                    )}
                                    onClick={() => null}
                                >
                                    {currentPageNumber}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setShowPageNumbers((prev) => !prev)}
                                    className={cn(
                                        "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.3em] shadow-sm theme-pill",
                                        showPageNumbers
                                            ? "border-brand-200 bg-brand-50 text-brand-600"
                                            : "border-slate-200 bg-white/80 text-slate-500",
                                    )}
                                    title="Toggle page numbers"
                                >
                                    Page # {showPageNumbers ? "On" : "Off"}
                                </button>
                            </div>

                        </div>

                        <div className="flex flex-wrap items-center gap-1">
                            <ToolbarButton
                                label="Heading 1"
                                icon={Heading1}
                                onClick={() => setHeading(1)}
                                isActive={editor?.isActive("heading", { level: 1 })}
                                disabled={!canHeading1}
                            />
                            <ToolbarButton
                                label="Heading 2"
                                icon={Heading2}
                                onClick={() => setHeading(2)}
                                isActive={editor?.isActive("heading", { level: 2 })}
                                disabled={!canHeading2}
                            />
                            <ToolbarButton
                                label="Heading 3"
                                icon={Heading3}
                                onClick={() => setHeading(3)}
                                isActive={editor?.isActive("heading", { level: 3 })}
                                disabled={!canHeading3}
                            />

                            <ToolbarDivider />

                            <ToolbarButton
                                label="Bold"
                                icon={Bold}
                                onClick={() =>
                                    runEditorCommand(editor, (instance) => instance.chain().focus().toggleBold().run())
                                }
                                isActive={editor?.isActive("bold")}
                                disabled={!canBold}
                            />
                            <ToolbarButton
                                label="Italic"
                                icon={Italic}
                                onClick={() =>
                                    runEditorCommand(editor, (instance) => instance.chain().focus().toggleItalic().run())
                                }
                                isActive={editor?.isActive("italic")}
                                disabled={!canItalic}
                            />
                            <ToolbarButton
                                label="Underline"
                                icon={UnderlineIcon}
                                onClick={() =>
                                    runEditorCommand(editor, (instance) => instance.chain().focus().toggleUnderline().run())
                                }
                                isActive={editor?.isActive("underline")}
                                disabled={!canUnderline}
                            />
                            <ToolbarButton
                                label="Strike"
                                icon={Strikethrough}
                                onClick={() =>
                                    runEditorCommand(editor, (instance) => instance.chain().focus().toggleStrike().run())
                                }
                                isActive={editor?.isActive("strike")}
                            />

                            <ToolbarDivider />

                            <ToolbarButton
                                label="Align Left"
                                icon={AlignLeft}
                                onClick={() => setAlignment("left")}
                                isActive={editor?.isActive({ textAlign: "left" })}
                                disabled={!canAlignLeft}
                            />
                            <ToolbarButton
                                label="Align Center"
                                icon={AlignCenter}
                                onClick={() => setAlignment("center")}
                                isActive={editor?.isActive({ textAlign: "center" })}
                                disabled={!canAlignCenter}
                            />
                            <ToolbarButton
                                label="Align Right"
                                icon={AlignRight}
                                onClick={() => setAlignment("right")}
                                isActive={editor?.isActive({ textAlign: "right" })}
                                disabled={!canAlignRight}
                            />
                            <ToolbarButton
                                label="Justify"
                                icon={AlignJustify}
                                onClick={() => setAlignment("justify")}
                                isActive={editor?.isActive({ textAlign: "justify" })}
                                disabled={!canJustify}
                            />

                            <ToolbarDivider />

                            <ToolbarButton label="Clear Formatting" icon={Eraser} onClick={clearFormatting} isActive={false} />

                            <ToolbarDivider />

                            <ToolbarButton
                                label="Bullet List"
                                icon={List}
                                onClick={() =>
                                    runEditorCommand(editor, (instance) => instance.chain().focus().toggleBulletList().run())
                                }
                                isActive={editor?.isActive("bulletList")}
                            />
                            <ToolbarButton
                                label="Numbered List"
                                icon={ListOrdered}
                                onClick={() =>
                                    runEditorCommand(editor, (instance) => instance.chain().focus().toggleOrderedList().run())
                                }
                                isActive={editor?.isActive("orderedList")}
                            />
                            <ToolbarButton
                                label="Block Quote"
                                icon={Quote}
                                onClick={() =>
                                    runEditorCommand(editor, (instance) => instance.chain().focus().toggleBlockquote().run())
                                }
                                isActive={editor?.isActive("blockquote")}
                            />
                            <ToolbarButton
                                label="Code"
                                icon={Code}
                                onClick={() =>
                                    runEditorCommand(editor, (instance) => instance.chain().focus().toggleCode().run())
                                }
                                isActive={editor?.isActive("code")}
                            />
                            <ToolbarButton
                                label="Highlight"
                                icon={Highlighter}
                                onClick={() =>
                                    runEditorCommand(editor, (instance) => instance.chain().focus().toggleHighlight().run())
                                }
                                isActive={editor?.isActive("highlight")}
                            />
                            <ToolbarButton
                                label="Uppercase"
                                icon={ArrowUpAZ}
                                onClick={makeUppercase}
                                isActive={false}
                                disabled={!editor}
                            />
                            <ToolbarButton
                                label="Lowercase"
                                icon={ArrowDownAZ}
                                onClick={makeLowercase}
                                isActive={false}
                                disabled={!editor}
                            />
                            <ToolbarButton
                                label="Subscript"
                                icon={SubscriptIcon}
                                onClick={() =>
                                    runEditorCommand(editor, (instance) => instance.chain().focus().toggleSubscript().run())
                                }
                                isActive={editor?.isActive("subscript")}
                            />
                            <ToolbarButton
                                label="Superscript"
                                icon={SuperscriptIcon}
                                onClick={() =>
                                    runEditorCommand(editor, (instance) => instance.chain().focus().toggleSuperscript().run())
                                }
                                isActive={editor?.isActive("superscript")}
                            />

                            <ToolbarDivider />

                            <ToolbarButton label="Insert Divider" icon={Minus} onClick={insertDivider} isActive={false} />
                            <ToolbarButton label="Hard Break" icon={CornerDownLeft} onClick={insertHardBreak} isActive={false} />

                            <div className="ml-auto inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-0.5 text-[11px] font-semibold text-slate-600 shadow-sm theme-pill">
                                <span>{words} words</span>
                                <span>· {characters} chars</span>
                                <span>· ~{estimatedReadingMinutes} min</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div
                ref={scrollRef}
                className="mx-auto mt-4 w-full max-w-[1100px] rounded-3xl border border-slate-200 bg-white/95 shadow-2xl theme-shell"
            >
                <header className="flex flex-wrap items-center gap-4 border-b border-slate-200 px-6 py-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Pagination monitor</p>
                </header>

                <div className="bg-slate-100/70 px-6 py-6 theme-canvas">
                    <div className="relative flex justify-center" style={{ minHeight: documentHeight }}>
                        <PageOverlay pageCount={pageCount} />
                        <HeaderFooterOverlay
                            pageCount={pageCount}
                            headerText={headerText}
                            footerText={footerText}
                            onHeaderDoubleClick={() => openEditor("header")}
                            onFooterDoubleClick={() => openEditor("footer")}
                            onHeaderClick={(idx) => scrollToHeader(idx)}
                            onFooterClick={(idx) => scrollToFooter(idx)}
                        />
                        <PageGapMask pageCount={pageCount} />
                        <PageTopPaddingMask pageCount={pageCount} />
                        <PageBottomPaddingMask pageCount={pageCount} />
                        {showPageNumbers ? (
                            <PageFooterOverlays pageCount={pageCount} startNumber={pageStartNumber} />
                        ) : null}

                        <div className="relative z-10 w-full max-w-[1100px]">
                            <div
                                ref={contentRef}
                                className="printable-page relative mx-auto min-h-[11in] w-full max-w-[1100px] rounded-md bg-transparent"
                                style={{
                                    padding: `${PAGE_MARGIN}px`,
                                    paddingLeft: `${PAGE_SIDE_PADDING}px`,
                                    paddingRight: `${PAGE_SIDE_PADDING}px`,
                                    paddingTop: `${PAGE_TOP_PADDING}px`,
                                    paddingBottom: `${PAGE_BOTTOM_PADDING}px`,
                                    minHeight: `${PAGE_HEIGHT}px`,
                                }}
                            >
                                <EditorContent
                                    editor={editor}
                                    aria-label="Letter editor"
                                    className="tiptap"
                                    style={{
                                        fontFamily: resolvedFontFamily,
                                        lineHeight: lineSpacing,
                                ["--editor-line-height"as"--editor-line-height"]: `${lineSpacing}`,
                                    }}
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            </section>
            {editingRegion ? (
                <HeaderFooterEditModal
                    region={editingRegion}
                    value={draftText}
                    onChange={setDraftText}
                    onCancel={closeEditor}
                    onSave={saveEditor}
                />
            ) : null}
            <style jsx global>{DARK_MODE_STYLES}</style>
        </div>
    );

    return null;
};

type PageOverlayProps = {
    pageCount: number;
};

const PageOverlay = ({ pageCount }: PageOverlayProps) => {
    const overlayHeight = Math.max(pageCount * PAGE_HEIGHT + Math.max(0, pageCount - 1) * PAGE_GAP, PAGE_HEIGHT);

    return (
        <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-0 z-0 -translate-x-1/2 -translate-y-px"
            style={{ height: overlayHeight, width: "100%" }}
        >
            {Array.from({ length: pageCount }).map((_, index) => {
                const top = index * (PAGE_HEIGHT + PAGE_GAP);
                return (
                    <div
                        key={`page-bg-${index}`}
                        className="absolute w-full max-w-[1100px] rounded-[18px] border border-slate-200 bg-white shadow-[0_30px_70px_rgba(15,23,42,0.18)] theme-page"
                        style={{ height: `${PAGE_HEIGHT}px`, top: `${top}px` }}
                    />
                );
            })}

            {Array.from({ length: Math.max(0, pageCount - 1) }).map((_, index) => {
                const top = (index + 1) * PAGE_HEIGHT + index * PAGE_GAP;
                return (
                    <div
                        key={`page-gap-${index}`}
                        className="absolute flex w-full justify-center"
                        style={{ top: `${top}px`, height: `${PAGE_GAP}px` }}
                    >
                        <div className="h-full w-[90%] max-w-[1100px] rounded-full bg-slate-200/70 blur-xl theme-gap" />
                    </div>
                );
            })}
        </div>
    );
};

type PageGapMaskProps = {
    pageCount: number;
};

const PageGapMask = ({ pageCount }: PageGapMaskProps) => (
    <div aria-hidden className="pointer-events-none absolute left-1/2 top-0 z-20 -translate-x-1/2 w-full">
        {Array.from({ length: Math.max(0, pageCount - 1) }).map((_, index) => {
            const top = (index + 1) * PAGE_HEIGHT + index * PAGE_GAP;
            const height = PAGE_GAP;
            return (
                <div
                    key={`gap-mask-${index}`}
                    className="absolute left-0 right-0 overflow-hidden"
                    style={{ top: `${top}px`, height: `${height}px` }}
                >
                    <div className="mx-auto h-full w-full max-w-[1100px] rounded-[18px] bg-slate-100 shadow-[inset_0_10px_30px_rgba(15,23,42,0.10)] theme-page" />
                    <div className="absolute inset-0 bg-slate-100 theme-page" />
                </div>
            );
        })}
    </div>
);

type PageFooterOverlaysProps = {
    pageCount: number;
    startNumber: number;
};

const PageFooterOverlays = ({ pageCount, startNumber }: PageFooterOverlaysProps) => (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-30">
        {Array.from({ length: pageCount }).map((_, index) => {
            const pageTop = index * (PAGE_HEIGHT + PAGE_GAP);
            const overlayTop = pageTop + PAGE_HEIGHT - PAGE_FOOTER_HEIGHT;

            return (
                <div
                    key={`divider-${index}`}
                    className="absolute left-1/2 -translate-x-1/2 w-full max-w-[1100px]"
                    style={{ top: `${overlayTop}px`, height: `${PAGE_FOOTER_HEIGHT}px` }}
                >
                    <div className="relative h-full">
                        <div className="absolute right-4 bottom-4 flex items-end justify-end">
                            <span className="text-[12px] font-semibold uppercase tracking-[0.45em] text-slate-500 theme-muted">
                                Page {startNumber + index}
                            </span>
                        </div>
                    </div>
                </div>
            );
        })}
    </div>
);

type PageTopPaddingMaskProps = {
    pageCount: number;
};

const PageTopPaddingMask = ({ pageCount }: PageTopPaddingMaskProps) => (
    <div aria-hidden className="pointer-events-none absolute left-1/2 top-0 z-25 -translate-x-1/2 w-full">
        {Array.from({ length: Math.max(0, pageCount - 1) }).map((_, index) => {
            const pageIndex = index + 1;
            const top = pageIndex * (PAGE_HEIGHT + PAGE_GAP);
            return (
                <div
                    key={`top-pad-mask-${pageIndex}`}
                    className="absolute left-0 right-0"
                    style={{ top: `${top}px`, height: `${PAGE_TOP_PADDING}px` }}
                >
                    <div className="mx-auto h-full w-full max-w-[1100px] rounded-t-[18px] bg-white theme-page" />
                </div>
            );
        })}
    </div>
);

type PageBottomPaddingMaskProps = {
    pageCount: number;
};

const PageBottomPaddingMask = ({ pageCount }: PageBottomPaddingMaskProps) => (
    <div aria-hidden className="pointer-events-none absolute left-1/2 top-0 z-25 -translate-x-1/2 w-full">
        {Array.from({ length: pageCount }).map((_, index) => {
            const top = index * (PAGE_HEIGHT + PAGE_GAP) + (PAGE_HEIGHT - PAGE_BOTTOM_PADDING);
            return (
                <div
                    key={`bottom-pad-mask-${index}`}
                    className="absolute left-0 right-0"
                    style={{ top: `${top}px`, height: `${PAGE_BOTTOM_PADDING}px` }}
                >
                    <div className="mx-auto h-full w-full max-w-[1100px] rounded-b-[18px] bg-white theme-page" />
                </div>
            );
        })}
    </div>
);

type HeaderFooterOverlayProps = {
    pageCount: number;
    headerText: string;
    footerText: string;
    onHeaderDoubleClick: () => void;
    onFooterDoubleClick: () => void;
    onHeaderClick?: (pageIndex: number) => void;
    onFooterClick?: (pageIndex: number) => void;
};

const HeaderFooterOverlay = ({
    pageCount,
    headerText,
    footerText,
    onHeaderDoubleClick,
    onFooterDoubleClick,
    onHeaderClick,
    onFooterClick,
}: HeaderFooterOverlayProps) => (
    <div className="pointer-events-none absolute left-1/2 top-0 z-20 -translate-x-1/2 w-full">
        {Array.from({ length: pageCount }).map((_, index) => {
            const pageTop = index * (PAGE_HEIGHT + PAGE_GAP);
            const footerTop = pageTop + PAGE_HEIGHT - PAGE_FOOTER_HEIGHT + PAGE_FOOTER_BORDER_OFFSET;

            const headerHas = typeof headerText === "string" && headerText.replace(/\|\|\|/g, "").trim().length > 0;
            const footerHas = typeof footerText === "string" && footerText.replace(/\|\|\|/g, "").trim().length > 0;

            return (
                <div key={`hf-${index}`}>
                    <div
                        className={cn(
                            "pointer-events-auto absolute left-1/2 flex w-full max-w-[1100px] -translate-x-1/2 items-center justify-center rounded-t-md bg-white px-4 py-2 text-slate-600 shadow theme-overlay",
                            headerHas ? "border-b-2 border-slate-700" : ""
                        )}
                        style={{ top: `${pageTop}px`, height: `${PAGE_TOP_PADDING}px`, padding: "0 1rem" }}
                        onDoubleClick={onHeaderDoubleClick}
                        onClick={() => onHeaderClick?.(index)}
                        role="button"
                        tabIndex={0}
                    >
                            <div className="text-center w-full">
                                {headerText ? (
                                    (() => {
                                        const isCols = typeof headerText === "string" && (headerText.includes("|||") || /\s{2,}/.test(headerText));
                                        if (isCols) {
                                            const parts = headerText.includes("|||")
                                                ? headerText.split("|||").map((s) => s.trim())
                                                : headerText.split(/\s{2,}/).map((s) => s.trim());
                                            const cols = [parts[0] ?? "", parts[1] ?? "", parts[2] ?? ""];
                                            return (
                                                <div className="mx-auto flex w-full max-w-[95%] items-center justify-between">
                                                    {cols.map((c, i) => (
                                                        <div
                                                            key={i}
                                                            className="flex-1 px-2 text-[13px] font-semibold text-slate-800 text-center truncate"
                                                            dangerouslySetInnerHTML={asHtml(c)}
                                                        />
                                                    ))}
                                                </div>
                                            );
                                        }

                                        return (
                                            <div className="mx-auto max-w-[95%]">
                                                <div
                                                    className="text-[13px] font-semibold text-slate-800 truncate"
                                                    dangerouslySetInnerHTML={asHtml(headerText)}
                                                />
                                            </div>
                                        );
                                    })()
                                ) : (
                                    <span className="text-[9px] font-semibold uppercase tracking-[0.25em] text-slate-400">
                                        Double click to edit header (applies to all pages)
                                    </span>
                                )}
                            </div>
                    </div>

                    <div
                        className={cn(
                            "pointer-events-auto absolute left-1/2 flex w-full max-w-[1100px] -translate-x-1/2 items-center justify-center rounded-b-md bg-white text-slate-600 shadow theme-overlay",
                            footerHas ? "border-t-2 border-slate-700" : ""
                        )}
                        style={{ top: `${footerTop}px`, height: `${PAGE_FOOTER_BORDER_HEIGHT}px`, padding: "0 1rem" }}
                        onDoubleClick={onFooterDoubleClick}
                        onClick={() => onFooterClick?.(index)}
                        role="button"
                        tabIndex={0}
                    >
                        <div className="text-center w-full">
                            {footerText ? (
                                (() => {
                                    const isCols = typeof footerText === "string" && (footerText.includes("|||") || /\s{2,}/.test(footerText));
                                    if (isCols) {
                                        const parts = footerText.includes("|||")
                                            ? footerText.split("|||").map((s) => s.trim())
                                            : footerText.split(/\s{2,}/).map((s) => s.trim());
                                        const cols = [parts[0] ?? "", parts[1] ?? "", parts[2] ?? ""];
                                        return (
                                            <div className="mx-auto flex w-full max-w-[95%] items-center justify-between">
                                                {cols.map((c, i) => (
                                                    <div
                                                        key={i}
                                                        className="flex-1 px-2 text-[12px] font-medium text-slate-700 text-center truncate"
                                                        dangerouslySetInnerHTML={asHtml(c)}
                                                    />
                                                ))}
                                            </div>
                                        );
                                    }

                                    return (
                                        <div className="mx-auto max-w-[95%]">
                                            <div
                                                className="text-[12px] font-medium text-slate-700 truncate"
                                                dangerouslySetInnerHTML={asHtml(footerText)}
                                            />
                                        </div>
                                    );
                                })()
                            ) : (
                                <span className="text-[9px] font-semibold uppercase tracking-[0.25em] text-slate-400 text-center">
                                    Double click to edit footer (applies to all pages)
                                </span>
                            )}
                        </div>
                    </div>
                </div>
            );
        })}
    </div>
);

type HeaderFooterEditModalProps = {
    region: "header" | "footer";
    value: string;
    onChange: (value: string) => void;
    onCancel: () => void;
    onSave: (value?: string) => void;
};

const HEADER_FOOTER_EDITOR_EXTENSIONS = [
    StarterKit,
    TextStyle,
    Color,
    Highlight,
    Underline,
    Superscript,
    Subscript,
    TextAlign.configure({ types: ["heading", "paragraph"] }),
];

const ensureSegmentLayout = (target: 1 | 3, source: string[]) => {
    if (target === 3) {
        const [a = "", b = "", c = ""] = source;
        return [a, b, c];
    }
    return [source[0] ?? ""];
};

const joinSegments = (segmentsToJoin: string[], targetLayout: 1 | 3) => {
    const normalized = ensureSegmentLayout(targetLayout, segmentsToJoin);
    return targetLayout === 3 ? normalized.slice(0, 3).join("|||") : normalized[0];
};

const parseSegments = (raw: string) => {
    const nextLayout: 1 | 3 = raw.includes("|||") ? 3 : 1;
    const parts = nextLayout === 3 ? raw.split("|||") : [raw];
    return { layout: nextLayout, segments: ensureSegmentLayout(nextLayout, parts) };
};

const ALIGN_OPTIONS: Array<"left" | "center" | "right" | "justify"> = ["left", "center", "right", "justify"];

const HeaderFooterEditModal = ({ region, value, onChange, onCancel, onSave }: HeaderFooterEditModalProps) => {
    const title = region === "header" ? "Header" : "Footer";
    const initialParsedRef = useRef(parseSegments(value));
    const [layout, setLayout] = useState<1 | 3>(initialParsedRef.current.layout);
    const [segments, setSegments] = useState<string[]>(initialParsedRef.current.segments);
    const [activeIndex, setActiveIndex] = useState(0);
    const layoutRef = useRef(layout);
    const activeIndexRef = useRef(activeIndex);
    const segmentsRef = useRef(segments);
    const internalValueRef = useRef(value);

    useEffect(() => {
        layoutRef.current = layout;
    }, [layout]);

    useEffect(() => {
        activeIndexRef.current = activeIndex;
    }, [activeIndex]);

    useEffect(() => {
        segmentsRef.current = segments;
    }, [segments]);

    const editor = useEditor({
        extensions: HEADER_FOOTER_EDITOR_EXTENSIONS,
        content: segments[activeIndex] || "<p></p>",
        autofocus: "end",
        onUpdate({ editor: instance }) {
            const html = instance.getHTML();
            setSegments((prev) => {
                const next = [...prev];
                next[activeIndexRef.current] = html;
                const joined = joinSegments(next, layoutRef.current);
                internalValueRef.current = joined;
                onChange(joined);
                return next;
            });
        },
    });

    useEffect(() => {
        if (value === internalValueRef.current) return;
        const next = parseSegments(value);
        internalValueRef.current = value;
        setLayout(next.layout);
        layoutRef.current = next.layout;
        setSegments(next.segments);
        segmentsRef.current = next.segments;
        setActiveIndex(0);
        activeIndexRef.current = 0;
        if (editor) {
            editor.commands.setContent(next.segments[0] || "<p></p>", false);
            editor.commands.focus("end");
        }
    }, [value, editor]);

    useEffect(() => {
        if (!editor) return;
        const currentSegments = segmentsRef.current ?? [];
        editor.commands.setContent(currentSegments[activeIndex] || "<p></p>", false);
        editor.commands.focus("end");
    }, [editor, activeIndex]);

    const handleLayoutChange = (target: 1 | 3) => {
        const normalized = ensureSegmentLayout(target, segmentsRef.current ?? []);
        setLayout(target);
        layoutRef.current = target;
        setSegments(normalized);
        segmentsRef.current = normalized;
        setActiveIndex(0);
        activeIndexRef.current = 0;
        const joined = joinSegments(normalized, target);
        internalValueRef.current = joined;
        onChange(joined);
        if (editor) {
            editor.commands.setContent(normalized[0] || "<p></p>", false);
            editor.commands.focus("end");
        }
    };

    const handleSegmentSwitch = (index: number) => {
        setActiveIndex(index);
    };

    const insertCurrentDateToModal = () => {
        if (!editor) return;
        // Insert plain text (no span tags) so the editor stores rendered text rather than raw HTML
        const text = dayjs().format("MMMM D, YYYY");
        editor.chain().focus().insertContent(text).run();
    };

    const finalValue = joinSegments(segments, layout);

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4 theme-modal-overlay"
            onClick={onCancel}
            role="presentation"
        >
            <div
                className="w-full max-w-3xl rounded-2xl bg-white p-6 shadow-2xl theme-modal"
                onClick={(event) => event.stopPropagation()}
            >
                <p className="text-xs font-semibold uppercase tracking-[0.35em] text-brand-500">{title} editor</p>
                <h2 className="mt-1 text-lg font-semibold text-slate-900">{title} (shows on every page)</h2>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Layout</span>
                    <button
                        type="button"
                        onClick={() => handleLayoutChange(1)}
                        className={cn(
                            "rounded-full border px-3 py-1 text-xs font-semibold",
                            layout === 1 ? "border-brand-500 text-brand-600" : "border-slate-200 text-slate-500",
                        )}
                    >
                        Single
                    </button>
                    <button
                        type="button"
                        onClick={() => handleLayoutChange(3)}
                        className={cn(
                            "rounded-full border px-3 py-1 text-xs font-semibold",
                            layout === 3 ? "border-brand-500 text-brand-600" : "border-slate-200 text-slate-500",
                        )}
                    >
                        Three Columns
                    </button>
                </div>

                {layout === 3 ? (
                    <div className="mt-4 flex gap-2">
                        {["Left", "Center", "Right"].map((label, idx) => (
                            <button
                                key={label}
                                type="button"
                                onClick={() => handleSegmentSwitch(idx)}
                                className={cn(
                                    "flex-1 rounded-lg border px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em]",
                                    activeIndex === idx
                                        ? "border-brand-500 bg-brand-50 text-brand-600"
                                        : "border-slate-200 text-slate-500",
                                )}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                ) : null}

                <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    {editor ? (
                        <>
                            <button
                                type="button"
                                onClick={() => editor.chain().focus().toggleBold().run()}
                                className={cn(
                                    "rounded-md px-2 py-1 text-xs font-semibold",
                                    editor.isActive("bold") ? "bg-slate-900 text-white" : "bg-white text-slate-600",
                                )}
                            >
                                Bold
                            </button>
                            <button
                                type="button"
                                onClick={() => editor.chain().focus().toggleItalic().run()}
                                className={cn(
                                    "rounded-md px-2 py-1 text-xs font-semibold",
                                    editor.isActive("italic") ? "bg-slate-900 text-white" : "bg-white text-slate-600",
                                )}
                            >
                                Italic
                            </button>
                            <button
                                type="button"
                                onClick={() => editor.chain().focus().toggleUnderline().run()}
                                className={cn(
                                    "rounded-md px-2 py-1 text-xs font-semibold",
                                    editor.isActive("underline") ? "bg-slate-900 text-white" : "bg-white text-slate-600",
                                )}
                            >
                                Underline
                            </button>
                            <button
                                type="button"
                                onClick={() => editor.chain().focus().toggleStrike().run()}
                                className={cn(
                                    "rounded-md px-2 py-1 text-xs font-semibold",
                                    editor.isActive("strike") ? "bg-slate-900 text-white" : "bg-white text-slate-600",
                                )}
                            >
                                Strike
                            </button>
                            <button
                                type="button"
                                onClick={() => editor.chain().focus().toggleHighlight().run()}
                                className={cn(
                                    "rounded-md px-2 py-1 text-xs font-semibold",
                                    editor.isActive("highlight") ? "bg-slate-900 text-white" : "bg-white text-slate-600",
                                )}
                            >
                                Highlight
                            </button>
                            <button
                                type="button"
                                onClick={() => editor.chain().focus().toggleBulletList().run()}
                                className={cn(
                                    "rounded-md px-2 py-1 text-xs font-semibold",
                                    editor.isActive("bulletList") ? "bg-slate-900 text-white" : "bg-white text-slate-600",
                                )}
                            >
                                Bullet
                            </button>
                            <button
                                type="button"
                                onClick={() => editor.chain().focus().toggleOrderedList().run()}
                                className={cn(
                                    "rounded-md px-2 py-1 text-xs font-semibold",
                                    editor.isActive("orderedList") ? "bg-slate-900 text-white" : "bg-white text-slate-600",
                                )}
                            >
                                Numbered
                            </button>
                            <div className="flex items-center gap-1">
                                {ALIGN_OPTIONS.map((align) => (
                                    <button
                                        type="button"
                                        key={align}
                                        onClick={() => editor.chain().focus().setTextAlign(align).run()}
                                        className={cn(
                                            "rounded-md px-2 py-1 text-xs font-semibold capitalize",
                                            editor.isActive({ textAlign: align })
                                                ? "bg-slate-900 text-white"
                                                : "bg-white text-slate-600",
                                        )}
                                    >
                                        {align}
                                    </button>
                                ))}
                            </div>
                            <div className="flex items-center gap-1">
                                {COLOR_SWATCHES.map((swatch) => (
                                    <button
                                        type="button"
                                        key={swatch.value}
                                        onClick={() => editor.chain().focus().setColor(swatch.value).run()}
                                        className="h-5 w-5 rounded-full border border-white shadow"
                                        style={{ backgroundColor: swatch.value }}
                                        title={swatch.label}
                                    />
                                ))}
                                <button
                                    type="button"
                                    onClick={() => editor.chain().focus().unsetColor().run()}
                                    className="rounded-full border border-slate-300 px-2 py-0.5 text-[10px] text-slate-500"
                                >
                                    Reset Color
                                </button>
                            </div>
                            <button
                                type="button"
                                onClick={insertCurrentDateToModal}
                                className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600"
                            >
                                Insert Date
                            </button>
                        </>
                    ) : null}
                </div>

                <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-inner">
                    {editor ? <EditorContent editor={editor} /> : null}
                </div>

                <div className="mt-6 flex justify-end gap-2">
                    <button
                        type="button"
                        onClick={() => onSave("")}
                        className="rounded-full border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-600 hover:border-red-300"
                    >
                        Delete
                    </button>
                    <button
                        type="button"
                        onClick={onCancel}
                        className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:border-slate-300"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={() => onSave(finalValue)}
                        className="rounded-full bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-brand-500"
                    >
                        Save
                    </button>
                </div>
            </div>
        </div>
    );
};
