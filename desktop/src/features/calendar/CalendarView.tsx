/**
 * Calendar screen entry point.
 *
 * Chooses between the two calendar engines based on the view mode:
 *
 *  - Month / 2 Weeks → {@link ScrollingCalendar}: infinite vertical scroll
 *    with fixed-height week rows, plus page-based Prev/Next buttons.
 *  - Week / N Days   → {@link PagedCalendar}: one auto-fitting page at a time.
 *
 * Month and 2 Weeks share one ScrollingCalendar instance (no `key`), so
 * switching between them keeps the scroll position. Switching to a paged
 * view unmounts it, and it hands its focused date back as the anchor.
 */

import type { IsoDate } from "../../api";
import { usePreferences } from "../../state/preferences";
import { PagedCalendar } from "./PagedCalendar";
import { ScrollingCalendar } from "./ScrollingCalendar";

interface CalendarViewProps {
  /** Date the view is positioned around (owned by App so other tabs can jump here). */
  anchor: Date;
  onAnchorChange: (date: Date) => void;
  /** Day shown in the side panel, or `null`. */
  selectedIso: IsoDate | null;
  onSelectIso: (iso: IsoDate | null) => void;
}

export function CalendarView(props: CalendarViewProps) {
  const { preferences } = usePreferences();
  const { viewMode } = preferences;

  if (viewMode === "month" || viewMode === "twoWeeks") {
    return <ScrollingCalendar viewMode={viewMode} {...props} />;
  }
  return <PagedCalendar viewMode={viewMode} {...props} />;
}
