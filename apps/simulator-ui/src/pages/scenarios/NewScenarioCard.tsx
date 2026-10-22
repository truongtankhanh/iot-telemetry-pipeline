import { Link } from 'react-router';
import { Icon } from '../../ui/Icon';
import { uiIcons } from '../../ui/icons';
import styles from './newScenarioCard.module.css';

/**
 * The dashed card that ends the list (frame 03): a link to the timeline editor with a new scenario. A link, not a button,
 * because choosing it is going to a page, and the address says which.
 */
export function NewScenarioCard() {
  return (
    <Link className={styles.card} to="/lab/timeline">
      <span className={styles.plus} aria-hidden="true">
        <Icon glyph={uiIcons.plus} />
      </span>
      <span className={styles.title}>New scenario</span>
      <span className={styles.text}>
        Build one by hand on the timeline, then save it as a file.
      </span>
    </Link>
  );
}
