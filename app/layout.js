import "./globals.css";

export const metadata = {
  title: "Flaksefeber",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }) {
  return (
    <html lang="nb">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Fjalla+One&family=Nunito+Sans:wght@400;700;800&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
