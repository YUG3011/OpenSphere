import { PaginatedEditor } from "@/components/editor/PaginatedEditor";

export default function HomePage() {
  return (
    <main className="editor-shell min-h-screen px-3 pb-6 pt-3">
      <div className="mx-auto max-w-6xl">
        <PaginatedEditor />
      </div>
    </main>
  );
}
