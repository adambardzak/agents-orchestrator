/**
 * Remotion entry point. `remotion studio` and `remotion render` both load
 * this file to discover compositions registered on <Root/>.
 */
import { registerRoot } from 'remotion';
import { Root } from './Root';

registerRoot(Root);
