import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Building Puzzle Visualizer",
  description:
    "ROW / COL条件とビルの高さをGRID・3Dビューへ同期する、プロジェクト補助用のビルディングパズル可視化ツール。",
  openGraph: {
    title: "Building Puzzle Visualizer",
    description: "ROW / COL条件とビルの高さを確認する2D・3D可視化ツール。",
    type: "website",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
