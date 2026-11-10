import { headerConfig } from "@/lib/config";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-surface">
      <main className="min-h-screen">
        {children}
      </main>
    </div>
  );
}