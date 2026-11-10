// Buying, account and text pages use the cream palette (see .theme-cream in globals.css);
// the header and footer around them stay dark.
export default function CreamLayout({ children }: { children: React.ReactNode }) {
    return <div className="theme-cream">{children}</div>;
}
