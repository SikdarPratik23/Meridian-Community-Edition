import WelcomeDashboard from './WelcomeDashboard';

/**
 * Desktop's own main-pane screen when nothing is selected. On phones this
 * content instead lives at the top of the Timeline tab (see
 * `features/timeline/Timeline.tsx`) — see `WelcomeDashboard.tsx`'s own doc
 * comment for why (MOTION_PLAN.md Part II, P1).
 */
export default function WelcomeState() {
  return (
    <div className="relative h-full overflow-y-auto">
      <WelcomeDashboard />
    </div>
  );
}
