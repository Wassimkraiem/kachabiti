import { pageMetadata } from "@/lib/page-metadata";

export const generateMetadata = pageMetadata("cart");

export default function Layout({ children }: { children: React.ReactNode }) {
    return children;
}
