import { pageMetadata } from "@/lib/page-metadata";

export const generateMetadata = pageMetadata("settings");

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-gray-50">
      <main className="min-h-screen">
        {children}
      </main>
    </div>
  );
}