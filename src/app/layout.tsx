import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LegalBridge Paginated Editor",
  description: "Tiptap editor with live pagination for legal documents",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-slate-100 text-slate-900">
        {children}

        {/* Vercel Analytics */}
        <Analytics />
      </body>
    </html>
  );
}
