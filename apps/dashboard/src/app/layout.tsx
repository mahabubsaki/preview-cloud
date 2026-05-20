import "../styles/globals.css";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "GitHub Preview | Dashboard",
  description: "Manage your preview deployments and environment variables.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <header>
          <div className="container nav-container">
            <div className="logo">
              <span style={{ color: 'var(--color-primary)', marginRight: '0.2rem' }}>✦</span>
              PREVIEW.CLOUD
            </div>
            <nav>
              <ul style={{ display: 'flex', gap: '2rem', listStyle: 'none', alignItems: 'center' }}>
                <li><Link href="/">Deployments</Link></li>
                <li><Link href="/projects">Projects</Link></li>
                <li><Link href="/settings">Settings</Link></li>
              </ul>
            </nav>
          </div>
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
