# LegalBridge Paginated Editor

Production-ready Next.js prototype of a Tiptap-powered rich-text editor that renders real-time US Letter pagination for immigration filings.

## Features
- 📄 **Live pagination overlay** sized to 8.5" × 11" with 1" margins and dashed break markers that stay in sync as you type.
- ✍️ **Tiptap formatting** for paragraphs, headings 1–3, bold, italic, underline, block quotes, and bullet/numbered lists.
- 🔢 **Live stats** for word and character counts plus the current/total page indicator.
- 🖨️ **Print/PDF ready** styling using `@media print` rules so what you see matches exports.
- 🛡️ **Edge-case aware layout** that recalculates pagination via `ResizeObserver`, so long paragraphs, mid-document edits, and mixed line heights stay accurate.

## Stack
- Next.js 14 (App Router, TypeScript)
- Tailwind CSS
- Tiptap v2 (StarterKit + CharacterCount, Placeholder, Underline, TextStyle, Color)
- Lucide React icons

## Getting Started

```bash
# install dependencies
pnpm install

# start dev server
pnpm dev

# lint
pnpm lint

# build for production
pnpm build && pnpm start
```

> Replace `pnpm` with `npm` or `yarn` if you prefer another package manager.

## Pagination Approach
1. **True-size canvas** – the editor canvas is fixed to US Letter dimensions (converted to 96 DPI pixels) with 1" inset padding so content always mirrors print layout.
2. **Live measurement** – a `ResizeObserver` watches the Tiptap content height and computes the number of pages by dividing by the physical page height.
3. **Overlayed sheets** – for each calculated page, we render a background “sheet” with drop shadows plus dashed ruler lines at every break. This gives the Google Docs-style stacked pages while keeping a single editable ProseMirror document.
4. **Debounced scroll context** – the scroll container tracks which page is currently in view, updating the status pill instantly.
5. **Print media** – when printing or exporting to PDF, the overlay/toolbar are hidden and the same US Letter sizing is enforced via `@media print` to keep WYSIWYG parity.

## Trade-offs & Next Steps
- **DOM-based measuring** keeps fidelity high but will eventually need virtualization for super long documents; in practice this handles 20–30 pages smoothly.
- **Single-flow editing** means we simulate page breaks visually rather than splitting the underlying ProseMirror document. A future iteration could insert true `pageBreak` nodes so content reflows with semantic markers.
- **Tables & images** are not yet handled; extending the measurement logic to respect node-specific heights (and preventing orphan rows) is the next milestone.
- **Collaborative editing** (e.g., WebSocket-driven) can plug into the same component because pagination is derived from rendered height, not editorial events.

## Deployment
1. Create a Vercel project and point it to this repo.
2. Set the build command to `npm run build` (or `pnpm build`) and output directory to `.next`.
3. Add GitHub Action: a workflow file is included at `.github/workflows/deploy-vercel.yml` that will deploy on push to `main` when you set these repository secrets in GitHub: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`.
4. Ensure the default Node 18+ runtime is selected; no additional runtime environment variables are required for the prototype.

## Contact
Send the live link and repo to `atal@opensphere.ai` with the subject **“Full-Stack Intern Role - Assignment Submission.”** Be ready to walk through `src/components/editor/PaginatedEditor.tsx` and explain the measurement strategy.
