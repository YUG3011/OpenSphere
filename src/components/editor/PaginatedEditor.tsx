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
    Bold,
    Building2,
    CalendarDays,
    Code,
    CornerDownLeft,
    Eraser,
    FileSignature,
    Heading1,
    Heading2,
    Heading3,
    Highlighter,
    IndentDecrease,
    IndentIncrease,
    Italic,
    List,
    ListOrdered,
    Mail,
    Minus,
    Palette,
    Printer,
    Quote,
    Redo,
    Strikethrough,
    Subscript as SubscriptIcon,
    Superscript as SuperscriptIcon,
    Underline as UnderlineIcon,
    Undo,
    UserRound,
} from "lucide-react";

import { cn } from "@/lib/utils";

const INCH_IN_PX = 96;
const PAGE_HEIGHT = 11 * INCH_IN_PX;
const PAGE_MARGIN = 0;
const PAGE_HEADER_HEIGHT = 32;
const PAGE_SIDE_PADDING = 64;

// Reserve 10% of page height for header and footer by default.
const HEADER_FOOTER_PERCENT = 0.10;
const PAGE_TOP_PADDING = Math.round(PAGE_HEIGHT * HEADER_FOOTER_PERCENT);
const PAGE_FOOTER_HEIGHT = Math.round(PAGE_HEIGHT * HEADER_FOOTER_PERCENT);
const PAGE_GAP = 56;
const PAGE_STRIDE = PAGE_HEIGHT + PAGE_GAP;
// Bottom padding (space reserved at bottom of page content).
const PAGE_BOTTOM_PADDING = PAGE_FOOTER_HEIGHT;
const PAGE_SEPARATOR_OFFSET = PAGE_BOTTOM_PADDING / 2;
const PAGE_CONTENT_HEIGHT = PAGE_HEIGHT - PAGE_TOP_PADDING - PAGE_BOTTOM_PADDING;

const footerReservePluginKey = new PluginKey<DecorationSet>("footer-reserve");

const createSpacerDecoration = (pos: number, height: number, key: string) =>
    Decoration.widget(
        pos,
        () => {
            const el = document.createElement("div");
            el.className = "page-break-filler block h-full w-full";
            el.style.cssText = `display:block;width:100%;height:${Math.max(0, height)}px;pointer-events:none;background:transparent;`;
            el.setAttribute("data-page-filler", "true");
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
    const dom = view.dom as HTMLElement;
    const domRect = dom.getBoundingClientRect();
    const blocks: BlockRect[] = [];

    view.state.doc.descendants((node, pos) => {
        if (!node.isTextblock) {
            return true;
        }

        const element = view.nodeDOM(pos) as HTMLElement | null;
        if (!element || !element.getBoundingClientRect) {
            return true;
        }

        const rect = element.getBoundingClientRect();
        blocks.push({
            pos,
            height: rect.height,
            nodeSize: node.nodeSize,
        });

        return true;
    });

    return blocks;
};

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
        let blockRemaining = Math.min(Math.max(block.height, 1), PAGE_HEIGHT * 2);

        while (blockRemaining > remainingOnPage && remainingOnPage > 0) {
            const filler = remainingOnPage + footerCarryHeight;
            const pos = Math.max(1, Math.min(block.pos, doc.content.size));
            decorations.push(createSpacerDecoration(pos, filler, `page-filler-${pos}-${fillerIndex}`));
            fillerIndex += 1;
            blockRemaining -= remainingOnPage;
            remainingOnPage = PAGE_CONTENT_HEIGHT;
        }

        if (blockRemaining >= remainingOnPage) {
            const pos = Math.max(1, Math.min(block.pos, doc.content.size));
            const filler = (blockRemaining - remainingOnPage) + footerCarryHeight;
            decorations.push(createSpacerDecoration(pos, filler, `page-filler-split-${pos}-${fillerIndex}`));
            fillerIndex += 1;
            blockRemaining = remainingOnPage;
        }

        remainingOnPage -= blockRemaining;
        remainingOnPage = Math.max(remainingOnPage, 0);
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

const createSelectionGuardPlugin = () =>
    new Plugin({
        key: selectionGuardPluginKey,
        view(editorView) {
            return {
                update: (view, prevState) => {
                    try {
                        if (view.state.selection.eq(prevState.selection)) return;

                        const sel = view.state.selection;
                        const dom = view.dom as HTMLElement;
                        const domRect = dom.getBoundingClientRect();

                        // Only guard caret (collapsed) selections for a predictable UX.
                        if (!sel.empty) return;

                        const pos = sel.from;
                        const coords = view.coordsAtPos(pos);
                        if (!coords) return;

                        const relativeTop = coords.top - domRect.top;
                        const stride = PAGE_HEIGHT + PAGE_GAP;
                        const pageIndex = Math.max(0, Math.floor(relativeTop / stride));
                        const pageTop = pageIndex * stride;

                        // If caret is inside header reserved area, move it to page body top
                        if (relativeTop < pageTop + PAGE_TOP_PADDING) {
                            const targetTop = domRect.top + pageTop + PAGE_TOP_PADDING + 2;
                            const target = view.posAtCoords({ left: domRect.left + 12, top: targetTop });
                            let targetPos = target?.pos ?? view.state.doc.content.size;
                            if (targetPos < 1) targetPos = 1;
                            const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, targetPos));
                            view.dispatch(tr);
                            return;
                        }

                        // If caret is inside footer reserved area, move it to next page body start
                        const footerTop = pageTop + PAGE_HEIGHT - PAGE_FOOTER_HEIGHT;
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
            };
        },
    });

const SelectionGuardExtension = Extension.create({
    name: "selectionGuard",
    addProseMirrorPlugins() {
        return [createSelectionGuardPlugin()];
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

const FONT_SIZES = [
    { label: "S", value: "12px" },
    { label: "M", value: "14px" },
    { label: "L", value: "16px" },
    { label: "XL", value: "18px" },
];

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

const DEFAULT_HEADER_TEXT = "This is a 10% header area";
const DEFAULT_FOOTER_TEXT = "This is a 10% footer area";

type ToolbarButtonProps = {
    label: string;
    icon: ComponentType<{ className?: string }>;
    isActive?: boolean;
    onClick: () => void;
    disabled?: boolean;
};

const ToolbarButton = ({ label, icon: Icon, isActive, onClick, disabled = false }: ToolbarButtonProps) => (
    <button
        type="button"
        title={label}
        className={cn(
            "inline-flex h-7 w-7 flex-none items-center justify-center rounded-md border text-[11px] font-medium transition",
            isActive ? "border-brand-500 bg-brand-50 text-brand-600" : "border-slate-200 bg-white text-slate-600",
            disabled && "cursor-not-allowed opacity-40",
        )}
        onClick={onClick}
        disabled={disabled}
    >
        <Icon className="h-3.5 w-3.5" />
    </button>
);

const ToolbarDivider = () => <div className="mx-1 h-4 w-px flex-none bg-slate-200" />;

type HeaderIconButtonProps = {
    icon: ComponentType<{ className?: string }>;
    label: string;
    onClick: () => void;
    disabled?: boolean;
};

const HeaderIconButton = ({ icon: Icon, label, onClick, disabled = false }: HeaderIconButtonProps) => (
    <button
        type="button"
        aria-label={label}
        title={label}
        className={cn(
            "inline-flex h-7 w-7 items-center justify-center rounded-full border text-slate-600 transition",
            disabled ? "cursor-not-allowed opacity-40" : "bg-white hover:border-slate-400",
        )}
        onClick={onClick}
        disabled={disabled}
    >
        <Icon className="h-3.5 w-3.5" />
    </button>
);

type ColorPickerProps = {
    editor: Editor | null;
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
            "h-5 w-5 rounded-full border transition",
            isActive ? "border-slate-900 ring-2 ring-slate-300 ring-offset-1" : "border-slate-200",
        )}
        style={{ backgroundColor: color }}
    />
);

const ColorPicker = ({ editor }: ColorPickerProps) => {
    if (!editor) return null;

    const activeColor = editor.getAttributes("textStyle")?.color ?? "";
    const setSwatchColor = (value: string) => {
        editor.chain().focus().setColor(value).run();
    };
    const resetColor = () => {
        editor.chain().focus().unsetColor().run();
    };

    return (
        <div className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5">
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

type FontSizeSelectorProps = {
    editor: Editor | null;
};

const FontSizeSelector = ({ editor }: FontSizeSelectorProps) => {
    if (!editor) return null;

    const activeAttrs = editor.getAttributes("textStyle") ?? {};
    const activeSize = activeAttrs.fontSize ?? "";

    const applySize = (value: string) => {
        const attrs = editor.getAttributes("textStyle") ?? {};
        editor.chain().focus().setMark("textStyle", { ...attrs, fontSize: value }).run();
    };

    const resetSize = () => {
        const attrs = editor.getAttributes("textStyle") ?? {};
        if (attrs.fontSize) {
            const nextAttrs = { ...attrs } as Record<string, string>;
            delete nextAttrs.fontSize;
            if (Object.keys(nextAttrs).length === 0) {
                editor.chain().focus().unsetMark("textStyle").run();
            } else {
                editor.chain().focus().setMark("textStyle", nextAttrs).run();
            }
        }
    };

    return (
        <div className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.25em] text-slate-500">
            {FONT_SIZES.map(({ label, value }) => (
                <button
                    key={value}
                    type="button"
                    onClick={() => applySize(value)}
                    className={cn(
                        "rounded-full px-2 py-0.5",
                        activeSize === value ? "bg-brand-50 text-brand-600" : "text-slate-500",
                    )}
                >
                    {label}
                </button>
            ))}
            <button type="button" onClick={resetSize} className="text-slate-400 hover:text-slate-600">
                reset
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
    const [editingRegion, setEditingRegion] = useState<"header" | "footer" | null>(null);
    const [draftText, setDraftText] = useState("");

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
    const canIndent = editor ? editor.can().sinkListItem("listItem") : false;
    const canOutdent = editor ? editor.can().liftListItem("listItem") : false;
    const canUndo = editor ? editor.can().undo() : false;
    const canRedo = editor ? editor.can().redo() : false;

    const goPrint = () => window.print();

    const setHeading = (level: 1 | 2 | 3) => {
        editor?.chain().focus().toggleHeading({ level }).run();
    };

    const setAlignment = (alignment: "left" | "center" | "right" | "justify") => {
        if (alignment === "justify") {
            editor?.chain().focus().setTextAlign("justify").run();
            return;
        }
        editor?.chain().focus().setTextAlign(alignment).run();
    };

    const clearFormatting = () => {
        editor?.chain().focus().unsetAllMarks().setParagraph().run();
    };

    const indentList = () => {
        editor?.chain().focus().sinkListItem("listItem").run();
    };

    const outdentList = () => {
        editor?.chain().focus().liftListItem("listItem").run();
    };

    const insertDivider = () => {
        editor?.chain().focus().setHorizontalRule().run();
    };

    const insertHardBreak = () => {
        editor?.chain().focus().setHardBreak().run();
    };

    const insertCurrentDate = () => {
        const formatted = dayjs().format("MMMM D, YYYY");
        editor?.chain().focus().insertContent(`<p>${formatted}</p>`).run();
    };

    const insertRecipientBlock = () => {
        const block = `<p>USCIS<br />Attn: Petition Review Unit<br />California Service Center</p>`;
        editor?.chain().focus().insertContent(block).run();
    };

    const insertSignatureBlock = () => {
        const block = `<p>Sincerely,<br /><strong>LegalBridge LLP</strong><br />Authorized Signatory</p>`;
        editor?.chain().focus().insertContent(block).run();
    };

    const insertContactBlock = () => {
        const block = `<p>Email: support@legalbridge.com<br />Phone: (555) 010-8899</p>`;
        editor?.chain().focus().insertContent(block).run();
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

    const openEditor = (region: "header" | "footer") => {
        setDraftText(region === "header" ? headerText : footerText);
        setEditingRegion(region);
    };

    const closeEditor = () => {
        setEditingRegion(null);
        setDraftText("");
    };

    const saveEditor = () => {
        if (!editingRegion) return;
        const cleaned = draftText.trim() || (editingRegion === "header" ? DEFAULT_HEADER_TEXT : DEFAULT_FOOTER_TEXT);
        if (editingRegion === "header") {
            setHeaderText(cleaned);
        } else {
            setFooterText(cleaned);
        }
        setEditingRegion(null);
        setDraftText("");
    };

    return (
        <>
            <section className="px-4 pb-12 pt-[140px]">
            <div className="fixed left-0 right-0 top-0 z-40 flex justify-center px-4">
                <div className="w-full max-w-[1100px] rounded-2xl border border-white/50 bg-white/90 p-2.5 shadow-lg backdrop-blur">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                            <p className="text-[9px] font-semibold uppercase tracking-[0.35em] text-brand-500">
                                LegalBridge Drafting
                            </p>
                            <h1 className="text-base font-semibold text-slate-900">Paginated Letter Editor</h1>
                        </div>

                        <div className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                            <div className="flex items-center gap-1 rounded-full border border-slate-200 bg-white/90 px-1.5 py-0.5 shadow-sm">
                                <HeaderIconButton label="Undo" icon={Undo} onClick={handleUndo} disabled={!canUndo} />
                                <HeaderIconButton label="Redo" icon={Redo} onClick={handleRedo} disabled={!canRedo} />
                            </div>

                            <label className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white/90 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.35em] text-slate-500 shadow-sm">
                                Start
                                <input
                                    type="number"
                                    min={1}
                                    value={pageStartNumber}
                                    onChange={handlePageStartChange}
                                    className="w-12 rounded-md border border-slate-300 px-1 py-0.5 text-[11px] font-semibold text-slate-700 focus:border-brand-500 focus:outline-none"
                                />
                            </label>

                            <span className="rounded-full border border-slate-200 px-2.5 py-0.5 text-[10px] uppercase tracking-[0.35em] text-slate-500">
                                Page {pageStartNumber + activePage - 1} / {pageStartNumber + pageCount - 1}
                            </span>

                            <button
                                type="button"
                                onClick={goPrint}
                                className="inline-flex items-center gap-1.5 rounded-full bg-brand-600 px-3.5 py-1 text-[11px] font-semibold text-white shadow hover:bg-brand-500"
                            >
                                <Printer className="h-3 w-3" />
                                Print / PDF
                            </button>
                        </div>
                    </div>

                    <div className="toolbar mt-2 flex flex-col gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow">
                        <div className="flex flex-wrap items-center gap-2">
                            <ColorPicker editor={editor} />
                            <FontSizeSelector editor={editor} />

                            <div className="flex flex-wrap items-center gap-1">
                                <ToolbarButton label="Insert Date" icon={CalendarDays} onClick={insertCurrentDate} disabled={!editor} />
                                <ToolbarButton label="Recipient Block" icon={Building2} onClick={insertRecipientBlock} disabled={!editor} />
                                <ToolbarButton label="Signature" icon={FileSignature} onClick={insertSignatureBlock} disabled={!editor} />
                                <ToolbarButton label="Contact Info" icon={Mail} onClick={insertContactBlock} disabled={!editor} />
                                <ToolbarButton
                                    label="Client Name"
                                    icon={UserRound}
                                    onClick={() => editor?.chain().focus().insertContent("<p><strong>Client Name</strong></p>").run()}
                                    disabled={!editor}
                                />
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
                                onClick={() => editor?.chain().focus().toggleBold().run()}
                                isActive={editor?.isActive("bold")}
                                disabled={!canBold}
                            />
                            <ToolbarButton
                                label="Italic"
                                icon={Italic}
                                onClick={() => editor?.chain().focus().toggleItalic().run()}
                                isActive={editor?.isActive("italic")}
                                disabled={!canItalic}
                            />
                            <ToolbarButton
                                label="Underline"
                                icon={UnderlineIcon}
                                onClick={() => editor?.chain().focus().toggleUnderline().run()}
                                isActive={editor?.isActive("underline")}
                                disabled={!canUnderline}
                            />
                            <ToolbarButton
                                label="Strike"
                                icon={Strikethrough}
                                onClick={() => editor?.chain().focus().toggleStrike().run()}
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

                            <ToolbarButton label="Indent" icon={IndentIncrease} onClick={indentList} disabled={!canIndent} />
                            <ToolbarButton label="Outdent" icon={IndentDecrease} onClick={outdentList} disabled={!canOutdent} />

                            <ToolbarDivider />

                            <ToolbarButton
                                label="Bullet List"
                                icon={List}
                                onClick={() => editor?.chain().focus().toggleBulletList().run()}
                                isActive={editor?.isActive("bulletList")}
                            />
                            <ToolbarButton
                                label="Numbered List"
                                icon={ListOrdered}
                                onClick={() => editor?.chain().focus().toggleOrderedList().run()}
                                isActive={editor?.isActive("orderedList")}
                            />
                            <ToolbarButton
                                label="Block Quote"
                                icon={Quote}
                                onClick={() => editor?.chain().focus().toggleBlockquote().run()}
                                isActive={editor?.isActive("blockquote")}
                            />
                            <ToolbarButton
                                label="Code"
                                icon={Code}
                                onClick={() => editor?.chain().focus().toggleCode().run()}
                                isActive={editor?.isActive("code")}
                            />
                            <ToolbarButton
                                label="Highlight"
                                icon={Highlighter}
                                onClick={() => editor?.chain().focus().toggleHighlight().run()}
                                isActive={editor?.isActive("highlight")}
                            />
                            <ToolbarButton
                                label="Subscript"
                                icon={SubscriptIcon}
                                onClick={() => editor?.chain().focus().toggleSubscript().run()}
                                isActive={editor?.isActive("subscript")}
                            />
                            <ToolbarButton
                                label="Superscript"
                                icon={SuperscriptIcon}
                                onClick={() => editor?.chain().focus().toggleSuperscript().run()}
                                isActive={editor?.isActive("superscript")}
                            />

                            <ToolbarDivider />

                            <ToolbarButton label="Insert Divider" icon={Minus} onClick={insertDivider} isActive={false} />
                            <ToolbarButton label="Hard Break" icon={CornerDownLeft} onClick={insertHardBreak} isActive={false} />
                        </div>
                    </div>
                </div>
            </div>

            <div
                ref={scrollRef}
                className="mx-auto mt-4 w-full max-w-[1100px] rounded-3xl border border-slate-200 bg-white/95 shadow-2xl"
            >
                <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 px-6 py-4">
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Pagination monitor</p>
                    </div>
                    <div className="text-sm text-slate-500">
                        {words} words · {characters} characters
                    </div>
                </header>

                <div className="bg-slate-100/70 px-6 py-6">
                    <div className="relative flex justify-center" style={{ minHeight: documentHeight }}>
                        <PageOverlay pageCount={pageCount} />
                        <HeaderFooterOverlay
                            pageCount={pageCount}
                            headerText={headerText}
                            footerText={footerText}
                            onHeaderDoubleClick={() => openEditor("header")}
                            onFooterDoubleClick={() => openEditor("footer")}
                        />
                        <PageGapMask pageCount={pageCount} />
                        <PageTopPaddingMask pageCount={pageCount} />
                        <PageBottomPaddingMask pageCount={pageCount} />
                        <PageFooterOverlays pageCount={pageCount} startNumber={pageStartNumber} />

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
                                <EditorContent editor={editor} aria-label="Letter editor" className="tiptap" />
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
        </>
    );
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
                        className="absolute w-full max-w-[1100px] rounded-[18px] border border-slate-200 bg-white shadow-[0_30px_70px_rgba(15,23,42,0.18)]"
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
                        <div className="h-full w-[90%] max-w-[1100px] rounded-full bg-slate-200/70 blur-xl" />
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
                    <div className="mx-auto h-full w-full max-w-[1100px] rounded-[18px] bg-slate-100 shadow-[inset_0_10px_30px_rgba(15,23,42,0.10)]" />
                    <div className="absolute inset-0 bg-slate-100" />
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
        {Array.from({ length: pageCount }).map((_, index) => (
            <div
                key={`divider-${index}`}
                className="absolute left-1/2 w-[8.5in] -translate-x-1/2 px-4"
                style={{ top: (index + 1) * PAGE_HEIGHT + index * PAGE_GAP - PAGE_FOOTER_HEIGHT + PAGE_SEPARATOR_OFFSET }}
            >
                <div className="flex items-center justify-end gap-4">
                    <div
                        className="flex-1 rounded-full bg-slate-400/80 shadow-[0_2px_12px_rgba(15,23,42,0.18)]"
                        style={{ height: "4px" }}
                    />
                    <span className="text-[11px] font-semibold uppercase tracking-[0.4em] text-slate-600">
                        Page {startNumber + index}
                    </span>
                </div>
            </div>
        ))}
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
                    <div className="mx-auto h-full w-full max-w-[1100px] rounded-t-[18px] bg-white" />
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
                    <div className="mx-auto h-full w-full max-w-[1100px] rounded-b-[18px] bg-white" />
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
};

const HeaderFooterOverlay = ({
    pageCount,
    headerText,
    footerText,
    onHeaderDoubleClick,
    onFooterDoubleClick,
}: HeaderFooterOverlayProps) => (
    <div aria-hidden className="pointer-events-none absolute left-1/2 top-0 z-40 -translate-x-1/2 w-full">
        {Array.from({ length: pageCount }).map((_, index) => {
            const pageTop = index * (PAGE_HEIGHT + PAGE_GAP);
            const footerTop = pageTop + PAGE_HEIGHT - PAGE_FOOTER_HEIGHT;

            return (
                <div key={`hf-${index}`}>
                    <div
                        className="pointer-events-auto absolute left-1/2 flex w-full max-w-[1100px] -translate-x-1/2 flex-col rounded-t-md border border-slate-400 bg-white/80 px-4 py-2 text-slate-600 shadow"
                        style={{ top: `${pageTop}px`, height: `${PAGE_TOP_PADDING}px` }}
                        onDoubleClick={onHeaderDoubleClick}
                        role="button"
                        tabIndex={0}
                    >
                        <span className="text-[11px] font-semibold">{headerText}</span>
                        <span className="text-[9px] font-semibold uppercase tracking-[0.3em] text-slate-400">
                            Double click to edit header (applies to all pages)
                        </span>
                    </div>

                    <div
                        className="pointer-events-auto absolute left-1/2 flex w-full max-w-[1100px] -translate-x-1/2 flex-col rounded-b-md border border-slate-400 bg-white/80 px-4 py-2 text-slate-600 shadow"
                        style={{ top: `${footerTop}px`, height: `${PAGE_FOOTER_HEIGHT}px` }}
                        onDoubleClick={onFooterDoubleClick}
                        role="button"
                        tabIndex={0}
                    >
                        <span className="text-[11px] font-semibold">{footerText}</span>
                        <span className="text-[9px] font-semibold uppercase tracking-[0.3em] text-slate-400">
                            Double click to edit footer (applies to all pages)
                        </span>
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
    onSave: () => void;
};

const HeaderFooterEditModal = ({ region, value, onChange, onCancel, onSave }: HeaderFooterEditModalProps) => {
    const title = region === "header" ? "Header" : "Footer";
    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4"
            onClick={onCancel}
            role="presentation"
        >
            <div
                className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl"
                onClick={(event) => event.stopPropagation()}
            >
                <p className="text-xs font-semibold uppercase tracking-[0.35em] text-brand-500">{title} editor</p>
                <h2 className="mt-1 text-lg font-semibold text-slate-900">{title} (shows on every page)</h2>
                <textarea
                    value={value}
                    onChange={(event) => onChange(event.target.value)}
                    className="mt-4 h-32 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 shadow-inner focus:border-brand-500 focus:outline-none"
                    placeholder={`Enter ${title.toLowerCase()} text`}
                />
                <div className="mt-6 flex justify-end gap-2">
                    <button
                        type="button"
                        onClick={onCancel}
                        className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:border-slate-300"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={onSave}
                        className="rounded-full bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-brand-500"
                    >
                        Save
                    </button>
                </div>
            </div>
        </div>
    );
};
