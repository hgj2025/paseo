import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { HomeOverviewScreen } from "@/home-overview/screen";
export default function HomeRoute() {
  return (
    <HostRouteBootstrapBoundary>
      <HomeOverviewScreen />
    </HostRouteBootstrapBoundary>
  );
}
