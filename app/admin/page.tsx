import AdminConsole from "@/components/admin-console";
export const metadata = {
  title: "维护入口 · MUSE 互助会",
  robots: { index: false, follow: false },
};
export default function AdminPage() {
  return (
    <main className="admin-page">
      <a href="/" className="back-link">
        ← 返回邀请码广场
      </a>
      <h1>MUSE 互助会 · 维护入口</h1>
      <p>核实社区反馈，标记失效或恢复邀请码。</p>
      <AdminConsole />
    </main>
  );
}
