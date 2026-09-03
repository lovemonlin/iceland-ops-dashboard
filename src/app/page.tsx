import { Dashboard } from "@/components/Dashboard";
import { getMockMonitors } from "@/monitors/mockMonitors";
export default function Home() { return <Dashboard monitors={getMockMonitors()} />; }
