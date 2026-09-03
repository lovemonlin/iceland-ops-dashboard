import { Dashboard } from "@/components/Dashboard";
import { MOCK_BASELINE_CHECKED_AT } from "@/monitors/mockMonitors";

export default function Home() {
  return <Dashboard initialCheckedAt={MOCK_BASELINE_CHECKED_AT} />;
}
