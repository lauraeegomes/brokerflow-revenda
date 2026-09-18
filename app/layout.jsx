export const metadata = {
  title: "BrokerFlow Revenda — MyBroker Imobiliária",
  description: "Captação, precificação e publicação de imóveis para revenda.",
  robots: { index: false, follow: false },
};

export const viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body style={{ margin: 0, fontFamily: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif", background: "#f4f6fb" }}>
        {children}
      </body>
    </html>
  );
}
