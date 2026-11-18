/**
 * Picking a time zone (PRD §4.3, §13): the display zone in Settings and the toolbar, and an event's own zone in the
 * popover. Every IANA zone the runtime knows is offered.
 */
import { timeZoneIds } from '@daybird/core';

const label = (id: string) => id.replaceAll('_', ' ');

/**
 * A select of zones. `extra` options come first (the system's zone, floating); a value that isn't a known zone
 * (a file's own zone name) is listed too, so the select never shows the wrong one.
 */
export function ZoneSelect(props: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly extra?: readonly { readonly value: string; readonly label: string }[];
  readonly class?: string;
}) {
  const ids = timeZoneIds();
  const extra = props.extra ?? [];
  const unknown = !ids.includes(props.value) && !extra.some((e) => e.value === props.value);
  return (
    <select
      class={props.class}
      aria-label={props.label}
      value={props.value}
      onChange={(e) => props.onChange(e.currentTarget.value)}
    >
      {extra.map((e) => (
        <option key={`extra-${e.value}`} value={e.value}>
          {e.label}
        </option>
      ))}
      {unknown && <option value={props.value}>{label(props.value)}</option>}
      {ids.map((id) => (
        <option key={id} value={id}>
          {label(id)}
        </option>
      ))}
    </select>
  );
}

/** The display-zone picker: the system's zone first, then every zone. Picking the system's zone clears the choice. */
export function DisplayZoneSelect(props: {
  readonly zone: string;
  readonly systemZone: string;
  readonly onChange: (zone: string | null) => void;
  readonly class?: string;
}) {
  return (
    <ZoneSelect
      label="Show times in"
      class={props.class}
      value={props.zone === props.systemZone ? '' : props.zone}
      extra={[{ value: '', label: `System (${label(props.systemZone)})` }]}
      onChange={(v) => props.onChange(v === '' || v === props.systemZone ? null : v)}
    />
  );
}
