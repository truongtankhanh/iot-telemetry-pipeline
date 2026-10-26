import { useLocation, useNavigate } from 'react-router';
import { carriedSelection, type ViewName, viewSwitchTarget } from '../lib/viewSwitch';
import { Segmented } from './Segmented';

export interface ViewSwitchProps {
  /** The view this page is. */
  current: ViewName;
  /**
   * The selection this page holds in its own state, if it does (the Overview's graph, the Lab's canvas). A page that holds
   * it in the address (the Topology, the Twin) leaves this out: the switch reads the address.
   */
  selection?: { type: string; id: string } | null;
}

/**
 * _Topology | Twin_: the same simulated campus as a graph of components and as a place. Choosing the other one goes to its
 * page with the device or building that is selected here still selected there; nothing else is carried. It is a
 * navigation, so the browser's Back button returns to this view. Native radio buttons underneath (`Segmented`), so the
 * arrow keys, the single tab stop and the announcement are the browser's.
 */
export function ViewSwitch({ current, selection }: ViewSwitchProps) {
  const navigate = useNavigate();
  const { search } = useLocation();
  return (
    <Segmented
      label="View"
      value={current}
      onChange={(value) => {
        if (value === current) return;
        const to: ViewName = value === 'twin' ? 'twin' : 'topology';
        void navigate(viewSwitchTarget(to, carriedSelection(search, selection)));
      }}
      options={[
        { value: 'topology', label: 'Topology' },
        { value: 'twin', label: 'Twin' },
      ]}
    />
  );
}
