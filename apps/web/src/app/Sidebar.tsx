import { useRef, useState } from 'preact/hooks';
import { addMonths, countsByDay, dayBounds, formatPlainDate, monthGrid, startOfMonth } from '@daybird/core';
import { Icon, PopupMenu, type CommandCatalog } from '@daybird/ui';
import { CalendarList } from './CalendarList.tsx';
import type { AppController } from './controller.ts';
import { MiniMonth } from './MiniMonth.tsx';
import { showTrash, trashCount } from './trashActions.ts';

/**
 * The sidebar (PRD §5.2): a mini month whose arrows page it without moving the view, then the calendars.
 */
export function Sidebar({ app, catalog }: { readonly app: AppController; readonly catalog: CommandCatalog }) {
  const anchor = app.anchor.value;
  // The mini month follows the view until its own arrows move it away.
  const [offset, setOffset] = useState<{ from: string; by: number }>({ from: anchor, by: 0 });
  const by = offset.from === anchor ? offset.by : 0;
  const month = addMonths(startOfMonth(anchor), by);
  const grid = monthGrid(month, app.weekStart.value);
  const from = dayBounds(grid.start, app.displayZone).start;
  const to = dayBounds(grid.end, app.displayZone).start;
  const counts = countsByDay(app.occurrencesBetween(from, to), grid, app.displayZone);
  // While the edge is dragged the width lives here, and is kept once on letting go.
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const width = dragWidth ?? app.settings.value.sidebarWidth;
  return (
    <aside class="db-sidebar" style={{ width: `${width}px` }} aria-label="Sidebar">
      <SidebarEdge app={app} width={width} onDrag={setDragWidth} />
      <div class="db-mini-nav">
        <span class="db-mini-title">
          {formatPlainDate(month, app.locale, { month: 'long', year: 'numeric' })}
        </span>
        <button
          type="button"
          class="db-icon-button db-small"
          aria-label="Previous month"
          onClick={() => setOffset({ from: anchor, by: by - 1 })}
        >
          <Icon name="chevron-left" />
        </button>
        <button
          type="button"
          class="db-icon-button db-small"
          aria-label="Next month"
          onClick={() => setOffset({ from: anchor, by: by + 1 })}
        >
          <Icon name="chevron-right" />
        </button>
      </div>
      <MiniMonth
        month={month}
        today={app.today.value}
        weekStart={app.weekStart.value}
        locale={app.locale}
        shaded={app.view.value === 'year' ? undefined : app.range.value}
        counts={counts}
        onPick={(d) => app.goTo(d)}
      />
      <CalendarList app={app} catalog={catalog} />
      <TrashRow app={app} catalog={catalog} />
    </aside>
  );
}

const MIN_WIDTH = 200;
const MAX_WIDTH = 360;
const clampWidth = (w: number) => Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w)));

/** The sidebar's right edge: drag it, or focus it and use ← →, to make the sidebar 200–360 px wide (§5.2). */
function SidebarEdge(props: {
  readonly app: AppController;
  readonly width: number;
  readonly onDrag: (width: number | null) => void;
}) {
  const start = useRef<{ x: number; width: number } | null>(null);
  const keep = (width: number) => props.app.update({ sidebarWidth: clampWidth(width) });
  return (
    <div
      class="db-sidebar-edge"
      role="separator"
      aria-orientation="vertical"
      aria-label="Sidebar width"
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={MAX_WIDTH}
      aria-valuenow={props.width}
      tabIndex={0}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, width: props.width };
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (s) props.onDrag(clampWidth(s.width + e.clientX - s.x));
      }}
      onPointerUp={(e) => {
        const s = start.current;
        if (!s) return;
        start.current = null;
        keep(s.width + e.clientX - s.x);
        props.onDrag(null);
      }}
      onDblClick={() => keep(240)}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 40 : 10;
        if (e.key === 'ArrowLeft') keep(props.width - step);
        else if (e.key === 'ArrowRight') keep(props.width + step);
        else return;
        e.preventDefault();
        e.stopPropagation();
      }}
    />
  );
}

/** The Trash row under the calendars (§7.7): opens the Trash view; its right-click menu offers Empty Trash. */
function TrashRow({ app, catalog }: { readonly app: AppController; readonly catalog: CommandCatalog }) {
  const count = trashCount(app);
  const shown = app.trashShown.value;
  const menu = app.trashMenu.value;
  return (
    <>
      <button
        type="button"
        class={`db-sidebar-trash${shown ? ' db-selected' : ''}`}
        aria-pressed={shown}
        aria-label={count ? `Trash, ${count} item${count === 1 ? '' : 's'}` : 'Trash, empty'}
        onClick={() => showTrash(app, !shown)}
        onContextMenu={(e) => {
          e.preventDefault();
          app.trashMenu.value = { x: e.clientX, y: e.clientY };
        }}
      >
        <Icon name="trash" />
        <span class="db-sidebar-trash-label">Trash</span>
        {count > 0 && <span class="db-count">{count}</span>}
      </button>
      {menu && (
        <PopupMenu
          label="Trash menu"
          catalog={catalog}
          items={['trash.empty']}
          x={menu.x}
          y={menu.y}
          onClose={() => {
            app.trashMenu.value = null;
          }}
        />
      )}
    </>
  );
}
