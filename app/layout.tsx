import type { Metadata } from 'next';
import { Plus_Jakarta_Sans, DM_Sans, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-plus-jakarta',
  display: 'swap',
});

const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-dm-sans',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'MetaScope — Penampil Metadata Universal',
  description:
    'Penampil metadata universal berbasis browser yang membongkar struktur file hingga lapisan byte, cross-check integritas, skor privasi, dan penjelasan AI opsional.',
  openGraph: {
    title: 'MetaScope — Penampil Metadata Universal',
    description:
      'Penampil metadata universal berbasis browser yang membongkar struktur file hingga lapisan byte, cross-check integritas, skor privasi, dan penjelasan AI opsional.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'MetaScope — Penampil Metadata Universal',
    description:
      'Penampil metadata universal berbasis browser yang membongkar struktur file hingga lapisan byte, cross-check integritas, skor privasi, dan penjelasan AI opsional.',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="id"
      suppressHydrationWarning
      className={`${plusJakarta.variable} ${dmSans.variable} ${jetbrainsMono.variable}`}
    >
      <body
        suppressHydrationWarning
        className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100 antialiased selection:bg-sky-200 selection:text-slate-950 dark:selection:bg-sky-800 dark:selection:text-slate-50"
      >
        {children}
      </body>
    </html>
  );
}
