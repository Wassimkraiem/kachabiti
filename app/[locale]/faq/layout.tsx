import { pageMetadata } from "@/lib/page-metadata";

export const generateMetadata = pageMetadata("faq");

export default function Layout({ children }: { children: React.ReactNode }) {
    return children;
}
