import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mouvéo — Mobilité guidée",
  description: "Jeux de mobilité personnalisés pour les bras, les jambes et l’équilibre, guidés par la caméra.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Mouvéo", statusBarStyle: "black-translucent" },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export const viewport = {
  themeColor: "#07111f",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr">
      <body className="antialiased">{children}</body>
    </html>
  );
}
