import "./admin.css";

export const metadata = {
  title: "Flaksefeber admin",
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }) {
  return <div className="ad">{children}</div>;
}
